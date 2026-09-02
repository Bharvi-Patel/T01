"""One-off diagnostic: send a correctly-signed fake Meta webhook straight to
your own /webhooks/meta endpoint, bypassing Meta's dashboard "Send to
server" button entirely.

Why this exists: Meta's dashboard test button can report "sent
successfully" even when nothing actually reaches your callback URL - the
FastAPI access log is the only reliable ground truth, and it showed zero
POST /webhooks/meta requests despite that success message. This script
removes Meta's delivery layer from the equation completely: it builds the
exact JSON shape meta_webhook_receive() parses, signs it with your own
APP_SECRET as Meta would, and POSTs it directly to your ngrok URL. If this
arrives and processes cleanly, your entire pipeline (ngrok -> FastAPI ->
signature check -> DB write) is proven correct, and the problem is
isolated to Meta's delivery (Development Mode's block on real events, a
dashboard config issue, or the account never actually being enrolled via
/subscribed_apps for the field in question) rather than anything in this
codebase.

Run from Agent01/:
    python test_webhook_delivery.py

By default this targets your Instagram connection and sends a fake DM.
Pass --platform facebook to test the Facebook Page path instead, and
--event comment to simulate a Page/media comment instead of a DM (comments
arrive under the "feed" field for Facebook, "comments" for Instagram - a
different code path than messaging, so a passing DM test does NOT prove
the comment path works too).
"""
import argparse
import asyncio
import hashlib
import hmac
import json
import sys
import time

import requests
from sqlalchemy import select

from db import AsyncSessionLocal, Platform, PlatformConnection
from oauth_platforms import META_APP_SECRET

parser = argparse.ArgumentParser()
parser.add_argument("--platform", choices=["instagram", "facebook"], default="instagram")
parser.add_argument(
    "--event",
    choices=["message", "comment"],
    default="message",
    help="'message' (default) simulates an inbound DM via entry[].messaging[]. "
         "'comment' simulates a Page/media comment via entry[].changes[] - "
         "field='feed' for facebook, field='comments' for instagram.",
)
parser.add_argument(
    "--callback-url",
    default=None,
    help="Your current ngrok URL, e.g. https://abcd1234.ngrok-free.app "
         "(without the /webhooks/meta path - that's added automatically). "
         "If omitted, you'll be prompted.",
)
args = parser.parse_args()


async def _find_page_id(platform: Platform) -> str | None:
    """Pull the real page_id/ig_page_id already stored for your connection -
    the fake payload has to reference an id that actually exists in
    PlatformConnection.credentials, or _workspace_id_for_page() will find
    no match and silently drop the event (same as it would for a real,
    unrecognized sender)."""
    field = "ig_page_id" if platform == Platform.INSTAGRAM else "page_id"
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(PlatformConnection).where(PlatformConnection.platform == platform)
        )
        conn = result.scalars().first()
        if conn is None:
            return None
        return (conn.credentials or {}).get(field)


def _build_message_payload(object_type: str, page_id: str) -> dict:
    """Matches exactly what meta_webhook_receive() expects under
    entry[].messaging[] for an inbound (non-echo) text DM. The message id
    is unique per run (not a fixed "test_mid_001") because
    _upsert_inbox_item() correctly treats a repeated external_id as a
    webhook redelivery and no-ops - that's the right behavior for real
    Meta redeliveries, but it means re-running this script with a fixed id
    would silently do nothing on the 2nd+ run instead of creating a new,
    visibly-checkable Inbox item each time."""
    mid = f"test_mid_{int(time.time() * 1000)}"
    return {
        "object": object_type,
        "entry": [
            {
                "id": page_id,
                "time": 0,
                "messaging": [
                    {
                        "sender": {"id": "TEST_SENDER_123"},
                        "recipient": {"id": page_id},
                        "timestamp": 0,
                        "message": {
                            "mid": mid,
                            "text": "This is a test DM sent by test_webhook_delivery.py",
                        },
                    }
                ],
            }
        ],
    }


def _build_comment_payload(object_type: str, platform: Platform, page_id: str) -> dict:
    """Matches what meta_webhook_receive() expects under entry[].changes[]
    for an inbound comment. Facebook Page comments arrive under the "feed"
    field (filtered there to item=="comment", verb=="add"/"edit"/"edited" -
    see the matching comment in main.py); Instagram comments arrive under
    a dedicated "comments" field instead. These are two separate code
    paths from the messaging one above - a passing --event message run does
    NOT exercise this branch, which is exactly why comments can be broken
    while DMs work fine. The comment/post id is unique per run for the same
    redelivery-dedup reason as the message mid above."""
    ts = int(time.time() * 1000)
    if platform == Platform.FACEBOOK:
        change = {
            "field": "feed",
            "value": {
                "item": "comment",
                "verb": "add",
                "comment_id": f"test_comment_{ts}",
                "post_id": f"{page_id}_test_post",
                "from": {"id": "TEST_COMMENTER_123", "name": "Test Commenter"},
                "message": "This is a test comment sent by test_webhook_delivery.py",
            },
        }
    else:
        change = {
            "field": "comments",
            "value": {
                "id": f"test_comment_{ts}",
                "text": "This is a test comment sent by test_webhook_delivery.py",
                "from": {"id": "TEST_COMMENTER_123", "username": "test_commenter"},
                "media": {"id": f"{page_id}_test_media"},
            },
        }
    return {
        "object": object_type,
        "entry": [
            {
                "id": page_id,
                "time": 0,
                "changes": [change],
            }
        ],
    }


def _sign(raw_body: bytes) -> str:
    """Same algorithm as _verify_meta_signature() in main.py - HMAC-SHA256
    over the raw request body, using the app secret."""
    return "sha256=" + hmac.new(META_APP_SECRET.encode(), raw_body, hashlib.sha256).hexdigest()


async def main():
    if not META_APP_SECRET:
        print("APP_SECRET / META_APP_SECRET is not set in your environment - "
              "can't sign a request without it. Check your .env.", file=sys.stderr)
        sys.exit(1)

    platform = Platform.INSTAGRAM if args.platform == "instagram" else Platform.FACEBOOK
    object_type = "instagram" if platform == Platform.INSTAGRAM else "page"

    page_id = await _find_page_id(platform)
    if not page_id:
        print(f"No {platform.value} connection with a stored page id was found in the "
              f"database - connect one first, or check the field name if this still fails.",
              file=sys.stderr)
        sys.exit(1)
    print(f"Using {platform.value} page_id={page_id!r} from your existing connection.")

    callback_base = args.callback_url or input(
        "Paste your current ngrok URL (e.g. https://abcd1234.ngrok-free.app): "
    ).strip().rstrip("/")
    url = f"{callback_base}/webhooks/meta"

    if args.event == "comment":
        payload = _build_comment_payload(object_type, platform, page_id)
    else:
        payload = _build_message_payload(object_type, page_id)
    raw_body = json.dumps(payload).encode()
    signature = _sign(raw_body)

    print(f"POSTing signed test {args.event} payload to {url} ...")
    resp = requests.post(
        url,
        data=raw_body,
        headers={
            "Content-Type": "application/json",
            "X-Hub-Signature-256": signature,
        },
        timeout=15,
    )
    print(f"Response: {resp.status_code} {resp.text!r}")
    if resp.status_code == 200:
        print(f"\nSuccess - now check your FastAPI terminal for the "
              f"'[webhooks/meta] received payload' line, and your app's "
              f"Inbox tab for a new test {args.event}.\n"
              f"If it shows up here but real comments still never arrive, "
              f"your code is fine and this is purely a Meta-side delivery "
              f"issue - most likely the Page was never actually enrolled "
              f"for the 'feed' field via /subscribed_apps (check your "
              f"server logs for the '[oauth_platforms] subscribed_apps' "
              f"line from when you connected this Page).")
    else:
        print("\nSomething rejected this request - see the status/body above. "
              "A 403 usually means APP_SECRET here doesn't match what's "
              "configured in the Meta Dashboard, or the callback URL routed "
              "somewhere other than this FastAPI instance.")


if __name__ == "__main__":
    asyncio.run(main())