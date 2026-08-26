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

Instagram connections need a second fix on top of that: /subscribed_apps is
a Facebook-Page-scoped endpoint, but old Instagram connections only ever
stored ig_page_id (the Instagram business account id), not the Facebook
Page id that owns it - calling /subscribed_apps with ig_page_id fails with
"(#3) Application does not have the capability to make this API call",
which reads like a permissions problem but is actually just the wrong id
type. This script recovers the real Facebook Page id via GET /me (a Page
access token, asked "who am I", identifies its own Page) and saves it into
the connection's credentials as fb_page_id, so this recovery only ever has
to happen once per connection - both this script's future re-runs and the
app itself (oauth_platforms.py now stores fb_page_id on every new Instagram
connection) can use the stored value after that.

Run from Agent01/:
    python subscribe_existing_connections.py
"""
import sys
print("CHECKPOINT 1: script file started executing", flush=True)

import asyncio

import requests
from sqlalchemy import select

from db import AsyncSessionLocal, Platform, PlatformConnection, decrypt_secret
from oauth_platforms import _subscribe_page_to_webhooks

print("CHECKPOINT 2: imports finished", flush=True)


def _recover_fb_page_id(page_access_token: str) -> str | None:
    """A Page access token used against /me returns that Page's own id/name -
    this is how we recover the Facebook Page id for an Instagram connection
    that only ever stored ig_page_id. Returns None (logged) on any failure
    rather than raising, so one bad token doesn't stop the rest of the run."""
    try:
        resp = requests.get(
            "https://graph.facebook.com/v21.0/me",
            params={"fields": "id,name", "access_token": page_access_token},
            timeout=15,
        )
        resp.raise_for_status()
        payload = resp.json()
        return payload.get("id")
    except requests.RequestException as e:
        print(f"  could not recover Facebook Page id via GET /me: {e}")
        return None


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

        dirty = False
        for conn in connections:
            creds = dict(conn.credentials or {})
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
                # "mention" is deliberately singular here to match what this
                # account's permission set actually allows - see the matching
                # comment in oauth_platforms.py's instagram_credentials_from_page.
                fields = "feed,messages"
            else:
                page_id = creds.get("fb_page_id")
                if not page_id:
                    print(f"Connection {conn.id} (instagram) has no fb_page_id stored yet - recovering it via GET /me ...")
                    if not page_access_token:
                        print(f"Skipping connection {conn.id} (instagram) - no page_access_token to recover with")
                        continue
                    page_id = _recover_fb_page_id(page_access_token)
                    if not page_id:
                        print(f"Skipping connection {conn.id} (instagram) - could not recover its Facebook Page id")
                        continue
                    creds["fb_page_id"] = page_id
                    conn.credentials = creds
                    dirty = True
                    print(f"  recovered fb_page_id={page_id} for connection {conn.id}")
                # Matches the field list oauth_platforms.py actually requests
                # on connect - "comments" isn't in this account's currently-
                # permitted set (Meta rejects it outright), so it's left out
                # here too rather than relying on the auto-retry to trim it.
                fields = "mention,messages"

            if not page_id or not page_access_token:
                print(f"Skipping connection {conn.id} ({conn.platform.value}) - missing page_id/page_access_token in credentials")
                continue

            print(f"Subscribing {conn.platform.value} page {page_id} (connection {conn.id}) to fields: {fields} ...")
            _subscribe_page_to_webhooks(page_id, page_access_token, fields)

        if dirty:
            await db.commit()
            print("Saved recovered fb_page_id value(s) to the database.")

    print("Done - check the output above for any [oauth_platforms] failure lines.")


if __name__ == "__main__":
    print("CHECKPOINT 0: __main__ block reached", flush=True)
    asyncio.run(main())
else:
    print(f"NOT RUNNING AS MAIN - __name__ is {__name__!r}", flush=True)