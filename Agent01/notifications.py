"""Notification delivery for the Publish page's "Mobile Notifications" tab
and the sidebar's in-app Notifications inbox.

Three channels, all written/sent together whenever a notification fires:
  - In-app inbox row (see Notification) - what GET /notifications reads.
  - Web Push, to every browser/device the user has subscribed (see
    PushSubscription) - this is the actual "mobile push" the UI promises.
  - Email, to the user's account email if they have one - a fallback that
    reaches them even with no push subscription registered.

All three are gated per-kind by NotificationPreference. This module is the
only place that should call pywebpush or emailer.send_email for a
notification purpose, and the only place that should insert a Notification
row - everywhere else just calls notify_user(...).

Requires VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY in .env for push to actually
send (generate a pair with `python -m py_vapid --gen` from the pywebpush
package). If they're unset, push sends are skipped with a warning rather
than failing the caller - email still goes out, and the frontend's "Enable
push notifications" toggle will simply have no public key to subscribe
against yet.
"""
import json
import logging
import os
from datetime import datetime, timedelta, timezone

from dotenv import load_dotenv
from pywebpush import WebPushException, webpush
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from db import Draft, DraftStatus, Notification, NotificationPreference, PushSubscription, User
from emailer import send_email

load_dotenv(override=True)

logger = logging.getLogger("notifications")

VAPID_PUBLIC_KEY = os.environ.get("VAPID_PUBLIC_KEY")
VAPID_PRIVATE_KEY = os.environ.get("VAPID_PRIVATE_KEY")
VAPID_CLAIMS_EMAIL = os.environ.get("VAPID_CLAIMS_EMAIL", "mailto:no-reply@starttrack.app")

# Maps a notification `kind` to the NotificationPreference column that gates
# it - the single source of truth both notify_user() and the /notifications/
# preferences API key off of.
PREFERENCE_FIELD = {
    "before_publish": "before_publish",
    "needs_approval": "needs_approval",
    "publish_failed": "publish_failed",
    "weekly_digest": "weekly_digest",
}

DIGEST_MIN_HOUR_UTC = 8  # weekly digest won't fire before 08:00 UTC on Monday


async def get_or_create_notification_prefs(db: AsyncSession, user_id) -> NotificationPreference:
    result = await db.execute(select(NotificationPreference).where(NotificationPreference.user_id == user_id))
    prefs = result.scalar_one_or_none()
    if prefs is None:
        prefs = NotificationPreference(user_id=user_id)
        db.add(prefs)
        await db.commit()
        await db.refresh(prefs)
    return prefs


def _send_push_sync(subscription: PushSubscription, title: str, body: str, url: str | None) -> bool:
    """Blocking pywebpush call - run via run_in_threadpool. Returns False if
    the push service says this subscription no longer exists (404/410),
    which the caller uses to delete the row; returns True in every other
    case (sent, or a transient failure worth keeping the subscription for -
    including network errors, which pywebpush surfaces as a plain requests
    exception rather than WebPushException)."""
    if not VAPID_PRIVATE_KEY:
        logger.warning("VAPID_PRIVATE_KEY not set - skipping push send (%r)", title)
        return True
    try:
        webpush(
            subscription_info={
                "endpoint": subscription.endpoint,
                "keys": {"p256dh": subscription.p256dh, "auth": subscription.auth},
            },
            data=json.dumps({"title": title, "body": body, "url": url or "/"}),
            vapid_private_key=VAPID_PRIVATE_KEY,
            vapid_claims={"sub": VAPID_CLAIMS_EMAIL},
        )
        return True
    except WebPushException as e:
        status = e.response.status_code if e.response is not None else None
        if status in (404, 410):
            return False
        logger.warning("push send failed (status=%s): %s", status, e)
        return True
    except Exception:
        # Network errors (DNS failure, timeout, connection refused, etc.)
        # come through as plain requests exceptions, not WebPushException -
        # treat the same as "transient, keep the subscription".
        logger.warning("push send failed for endpoint=%s", subscription.endpoint, exc_info=True)
        return True


async def notify_user(db: AsyncSession, user_id, kind: str, title: str, body: str, url: str | None = None) -> None:
    """Send `title`/`body` to `user_id` via in-app inbox + push + email, if
    they have `kind` enabled. Never raises - a notification failure should
    never take down the /generate or publish flow that triggered it. One
    dead/unreachable push subscription is isolated to itself: it never
    blocks delivery to the user's other devices, to email, or to the
    in-app inbox row (which is written first and committed on its own)."""
    try:
        field = PREFERENCE_FIELD[kind]
        prefs = await get_or_create_notification_prefs(db, user_id)
        if not getattr(prefs, field):
            return

        db.add(Notification(user_id=user_id, kind=kind, title=title, body=body, url=url))
        await db.commit()

        result = await db.execute(select(PushSubscription).where(PushSubscription.user_id == user_id))
        subscriptions = result.scalars().all()
        any_dead = False
        for sub in subscriptions:
            try:
                alive = await run_in_threadpool(_send_push_sync, sub, title, body, url)
            except Exception:
                logger.exception("push send raised unexpectedly for endpoint=%s", sub.endpoint)
                continue
            if not alive:
                await db.delete(sub)
                any_dead = True
        if any_dead:
            await db.commit()

        try:
            user_result = await db.execute(select(User.email).where(User.id == user_id))
            email = user_result.scalar_one_or_none()
            if email:
                await run_in_threadpool(send_email, email, title, body)
        except Exception:
            logger.exception("email send failed for user_id=%s kind=%s", user_id, kind)
    except Exception:
        logger.exception("notify_user failed for user_id=%s kind=%s", user_id, kind)


async def maybe_send_weekly_digests(db: AsyncSession) -> None:
    """Called from the scheduler loop on every poll cycle. Cheap no-op on
    every cycle except the small Monday-morning window: for each user with
    weekly_digest enabled whose last digest wasn't sent today, send a
    published/scheduled summary and stamp weekly_digest_last_sent so the
    next poll cycle (30s later, by default) doesn't send it again."""
    now = datetime.now(timezone.utc)
    if now.weekday() != 0 or now.hour < DIGEST_MIN_HOUR_UTC:
        return

    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    result = await db.execute(
        select(NotificationPreference).where(
            NotificationPreference.weekly_digest.is_(True),
            (NotificationPreference.weekly_digest_last_sent.is_(None))
            | (NotificationPreference.weekly_digest_last_sent < today_start),
        )
    )
    due = result.scalars().all()
    if not due:
        return

    week_ago = now - timedelta(days=7)
    for prefs in due:
        published_count = (
            await db.execute(
                select(func.count(Draft.id)).where(
                    Draft.user_id == prefs.user_id,
                    Draft.status == DraftStatus.PUBLISHED,
                    Draft.updated_at >= week_ago,
                )
            )
        ).scalar_one()
        scheduled_count = (
            await db.execute(
                select(func.count(Draft.id)).where(
                    Draft.user_id == prefs.user_id,
                    Draft.status == DraftStatus.SCHEDULED,
                )
            )
        ).scalar_one()

        title = "Your weekly startTrack digest"
        body = (
            f"{published_count} post(s) published in the last 7 days. "
            f"{scheduled_count} post(s) currently scheduled ahead."
        )
        await notify_user(db, prefs.user_id, "weekly_digest", title, body)
        prefs.weekly_digest_last_sent = now
    await db.commit()