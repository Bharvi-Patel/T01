"""One-off diagnostic: send a correctly-signed fake Instagram DM webhook
straight to your own /webhooks/meta endpoint, bypassing Meta's dashboard
"Send to server" button entirely.

Why this exists: Meta's dashboard test button can report "sent
successfully" even when nothing actually reaches your callback URL - the
FastAPI access log is the only reliable ground truth, and it showed zero
POST /webhooks/meta requests despite that success message. This script
removes Meta's delivery layer from the equation completely: it builds the
exact JSON shape meta_webhook_receive() parses, signs it with your own
APP_SECRET as Meta would, and POSTs it directly to your ngrok URL. If this
arrives and processes cleanly, your entire pipeline (ngrok -> FastAPI ->
signature check -> DB write) is proven correct, and the problem is
isolated to Meta's delivery (Development Mode's block on real events, or a
dashboard config issue) rather than anything in this codebase.

Run from Agent01/:
    python test_webhook_delivery.py

By default this targets your Instagram connection. Pass --platform
facebook to test the Facebook Page path instead.
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


def _build_payload(object_type: str, page_id: str) -> dict:
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

    payload = _build_payload(object_type, page_id)
    raw_body = json.dumps(payload).encode()
    signature = _sign(raw_body)

    print(f"POSTing signed test payload to {url} ...")
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
        print("\nSuccess - now check your FastAPI terminal for the "
              "'[webhooks/meta] received payload' line, and your app's "
              "Inbox tab for a new test message.")
    else:
        print("\nSomething rejected this request - see the status/body above. "
              "A 403 usually means APP_SECRET here doesn't match what's "
              "configured in the Meta Dashboard, or the callback URL routed "
              "somewhere other than this FastAPI instance.")


if __name__ == "__main__":
    asyncio.run(main())