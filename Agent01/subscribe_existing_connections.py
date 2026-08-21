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
import asyncio

from sqlalchemy import select

from db import AsyncSessionLocal, Platform, PlatformConnection
from oauth_platforms import _subscribe_page_to_webhooks


async def main():
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(PlatformConnection).where(
                PlatformConnection.platform.in_([Platform.FACEBOOK, Platform.INSTAGRAM])
            )
        )
        connections = result.scalars().all()

    if not connections:
        print("No Facebook/Instagram connections found.")
        return

    for conn in connections:
        creds = conn.credentials or {}
        page_access_token = creds.get("page_access_token")
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
    asyncio.run(main())