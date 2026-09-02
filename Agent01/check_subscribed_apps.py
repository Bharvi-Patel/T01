"""One-off diagnostic: check which webhook fields Meta ACTUALLY has your
Facebook/Instagram Page enrolled for, via Meta's own GET
/{page_id}/subscribed_apps endpoint. Read-only - makes no changes.

Why this exists: oauth_platforms.py's _subscribe_page_to_webhooks() is
called with "feed, mention, messages" at connect time, but that call is
best-effort - if Meta rejects any field in the requested list (its
/subscribed_apps validation treats the whole list as one atomic request),
the retry logic silently trims the rejected field(s) and only logs the
outcome to stderr. There is no user-facing error, and the Page connection
itself still succeeds either way. So "I requested feed" and "Meta actually
has feed enrolled for this Page" are two different facts, and this script
checks the second one directly instead of inferring it from old logs.

This directly answers: is the "comments not arriving" problem caused by
feed never having been enrolled? If this script shows "feed" present, the
subscription is fine and the problem is elsewhere on Meta's side
(Development Mode / App Review access level for pages_read_engagement). If
"feed" is missing, that's the whole answer - re-run subscribe_existing_connections.py
or reconnect the Page to retry enrollment.

Run from Agent01/:
    python check_subscribed_apps.py
    python check_subscribed_apps.py --platform instagram
"""
import argparse
import asyncio

import requests
from sqlalchemy import select

from db import AsyncSessionLocal, Platform, PlatformConnection, decrypt_secret

parser = argparse.ArgumentParser()
parser.add_argument("--platform", choices=["facebook", "instagram"], default="facebook")
args = parser.parse_args()

# Fields the app requests at connect time (see oauth_platforms.py) - shown
# alongside what Meta actually reports so it's obvious at a glance which
# ones, if any, didn't stick.
EXPECTED_FIELDS = {
    "facebook": {"feed", "mention", "messages"},
    "instagram": {"mention", "messages"},
}


async def main():
    platform = Platform.FACEBOOK if args.platform == "facebook" else Platform.INSTAGRAM

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(PlatformConnection).where(PlatformConnection.platform == platform)
        )
        conn = result.scalars().first()
        if conn is None:
            print(f"No {platform.value} connection found.")
            return

        creds = conn.credentials or {}
        raw_token = creds.get("page_access_token")
        if not raw_token:
            print(f"Connection {conn.id} has no page_access_token stored.")
            return
        try:
            page_access_token = decrypt_secret(raw_token)
        except Exception as e:
            print(f"Could not decrypt stored token: {e}")
            return

        # Facebook connections store the Page id directly as page_id.
        # Instagram connections need the Page id too (subscribed_apps is a
        # Page-scoped endpoint, not an IG-business-account-scoped one) -
        # that's fb_page_id, recovered/stored the same way
        # subscribe_existing_connections.py does.
        if platform == Platform.FACEBOOK:
            page_id = creds.get("page_id")
        else:
            page_id = creds.get("fb_page_id")
            if not page_id:
                print(f"Connection {conn.id} (instagram) has no fb_page_id stored - "
                      f"run subscribe_existing_connections.py first to recover it.")
                return

        if not page_id:
            print(f"Connection {conn.id} ({platform.value}) has no page_id stored.")
            return

    print(f"Checking subscribed_apps for {platform.value} page_id={page_id!r} ...\n")

    resp = requests.get(
        f"https://graph.facebook.com/v21.0/{page_id}/subscribed_apps",
        params={"access_token": page_access_token},
        timeout=15,
    )
    print(f"HTTP {resp.status_code}")

    try:
        data = resp.json()
    except ValueError:
        print(f"Non-JSON response: {resp.text!r}")
        return

    if "error" in data:
        print("Meta returned an error checking this Page's subscriptions:")
        print(f"  {data['error']}")
        return

    apps = data.get("data", [])
    if not apps:
        print("No apps are subscribed to this Page at all - the connect-time "
              "/subscribed_apps call never succeeded for ANY field, or this "
              "Page was disconnected/re-permissioned since. Comments, "
              "mentions, and messages will all silently fail to arrive.")
        return

    expected = EXPECTED_FIELDS[args.platform]
    for app in apps:
        subscribed_fields = set(app.get("subscribed_fields", []))
        print(f"App '{app.get('name', app.get('id'))}' (id={app.get('id')}) "
              f"is subscribed to fields: {sorted(subscribed_fields)}")

        missing = expected - subscribed_fields
        if missing:
            print(f"\nMISSING expected field(s): {sorted(missing)}")
            if "feed" in missing:
                print("'feed' is what delivers Facebook Page comments - its absence here")
                print("fully explains why comments aren't reaching the inbox, independent")
                print("of everything else in the pipeline (which has already been verified")
                print("working via test_webhook_delivery.py --event comment).")
            print("\nFix: re-run subscribe_existing_connections.py, or disconnect and")
            print("reconnect this Page in T01, then run this script again to confirm")
            print("the missing field(s) actually stuck this time.")
        else:
            print("\nAll expected fields are present - this Page's webhook enrollment")
            print("is correct. If events still aren't arriving, the problem is on")
            print("Meta's delivery side (Development Mode access level for the")
            print("underlying permission, e.g. pages_read_engagement) rather than")
            print("the subscription itself.")


if __name__ == "__main__":
    asyncio.run(main())