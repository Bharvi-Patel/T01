"""One-off backfill: subscribe already-connected Facebook/Instagram pages
to this app's webhooks.

_subscribe_page_to_webhooks() (added to oauth_platforms.py) only runs when
someone connects an account *from now on* - any PlatformConnection created
before that fix was never enrolled, so its Page/IG account still won't
send webhook events no matter how correctly the App Dashboard fields are
configured. This re-runs that same subscription call for every existing
Facebook/Instagram connection, using the page_access_token already stored
in each row's credentials. Safe to run more than once - resubscribing just
overwrites the field list with the same values.

Run from Agent01/:
    python subscribe_existing_connections.py
"""
import sys
print("CHECKPOINT 1: script file started executing", flush=True)

import asyncio

from sqlalchemy import select

from db import AsyncSessionLocal, Platform, PlatformConnection, decrypt_secret
from oauth_platforms import _subscribe_page_to_webhooks

print("CHECKPOINT 2: imports finished", flush=True)


async def main():
    print("CHECKPOINT 3: entered main()", flush=True)
    async with AsyncSessionLocal() as db:
        print("CHECKPOINT 4: DB session opened, about to query", flush=True)
        result = await db.execute(
            select(PlatformConnection).where(
                PlatformConnection.platform.in_([Platform.FACEBOOK, Platform.INSTAGRAM])
            )
        )
        connections = result.scalars().all()
    print(f"CHECKPOINT 5: query returned {len(connections)} connection(s)", flush=True)

    if not connections:
        print("No Facebook/Instagram connections found.")
        return

    for conn in connections:
        creds = conn.credentials or {}
        raw_token = creds.get("page_access_token")
        # page_access_token is stored Fernet-encrypted (see encrypt_secret()
        # calls in main.py) - every other call site decrypts before using
        # it against the Graph API. This script previously passed the
        # encrypted blob straight through, which Facebook rejected with a
        # 400 (it's not a valid access token).
        try:
            page_access_token = decrypt_secret(raw_token) if raw_token else None
        except Exception as e:
            print(f"Skipping connection {conn.id} ({conn.platform.value}) - could not decrypt stored token: {e}")
            continue
        if conn.platform == Platform.FACEBOOK:
            page_id = creds.get("page_id")
            fields = "feed,messages"
        else:
            page_id = creds.get("ig_page_id")
            fields = "comments,mentions,messages"

        if not page_id or not page_access_token:
            print(f"Skipping connection {conn.id} ({conn.platform.value}) - missing page_id/page_access_token in credentials")
            continue

        print(f"Subscribing {conn.platform.value} page {page_id} (connection {conn.id}) to fields: {fields} ...")
        _subscribe_page_to_webhooks(page_id, page_access_token, fields)

    print("Done - check the output above for any [oauth_platforms] failure lines.")


if __name__ == "__main__":
    print("CHECKPOINT 0: __main__ block reached", flush=True)
    asyncio.run(main())
else:
    print(f"NOT RUNNING AS MAIN - __name__ is {__name__!r}", flush=True)