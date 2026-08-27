"""One-off diagnostic: check what scopes are ACTUALLY attached to your
stored Instagram/Facebook page_access_token, via Meta's own /debug_token
endpoint.

Why this exists: oauth_platforms.py's instagram_authorize_url() requests
instagram_manage_messages and pages_messaging in its scope string, but
requesting a scope and Meta actually granting it are different things. In
Development Mode, "Advanced Access" permissions like instagram_manage_messages
are only silently granted to a token if the account that did the OAuth
consent is itself listed as an App Role (Admin/Developer/Tester) - otherwise
Meta drops the permission from the token with no error at authorization
time. Every earlier check in this conversation (subscription succeeding,
signature verification, tester invite acceptance, DB writes working) proves
the pipeline is correct - this is the one thing that hasn't been directly
inspected yet: whether the token itself actually carries the permission
needed to receive message events at all.

Run from Agent01/:
    python check_token_scopes.py
"""
import asyncio

import requests
from sqlalchemy import select

from db import AsyncSessionLocal, Platform, PlatformConnection, decrypt_secret
from oauth_platforms import META_APP_ID, META_APP_SECRET


async def main():
    if not META_APP_ID or not META_APP_SECRET:
        print("APP_ID/APP_SECRET (or META_APP_ID/META_APP_SECRET) not set - can't call /debug_token without them.")
        return

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(PlatformConnection).where(PlatformConnection.platform == Platform.INSTAGRAM)
        )
        conn = result.scalars().first()
        if conn is None:
            print("No Instagram connection found.")
            return

        creds = conn.credentials or {}
        raw_token = creds.get("page_access_token")
        if not raw_token:
            print("Connection has no page_access_token stored.")
            return

        try:
            page_access_token = decrypt_secret(raw_token)
        except Exception as e:
            print(f"Could not decrypt stored token: {e}")
            return

    # /debug_token needs an "app token" (app_id|app_secret) as the
    # inspecting credential - separate from the user/page token being
    # inspected.
    app_token = f"{META_APP_ID}|{META_APP_SECRET}"

    resp = requests.get(
        "https://graph.facebook.com/v21.0/debug_token",
        params={"input_token": page_access_token, "access_token": app_token},
        timeout=15,
    )
    print(f"HTTP {resp.status_code}")
    data = resp.json()

    if "error" in data:
        print("Meta returned an error inspecting this token:")
        print(f"  {data['error']}")
        return

    info = data.get("data", {})
    scopes = info.get("scopes", [])
    granular = info.get("granular_scopes", [])

    print(f"\nToken belongs to app_id: {info.get('app_id')}")
    print(f"Token type: {info.get('type')}")
    print(f"Valid: {info.get('is_valid')}")
    print(f"Expires at: {info.get('expires_at')} (0 = never/long-lived)")
    print(f"\nGranted scopes ({len(scopes)}):")
    for s in sorted(scopes):
        print(f"  - {s}")

    needed = {"instagram_manage_messages", "instagram_basic", "pages_messaging"}
    missing = needed - set(scopes)
    print()
    if missing:
        print(f"MISSING required scope(s) for receiving DMs: {sorted(missing)}")
        print("This token does not have permission to receive Instagram messages at all -")
        print("that's why nothing arrives, independent of everything else already verified.")
        print("Fix: reconnect Instagram in T01 (disconnect + go through OAuth again), making")
        print("sure the account granting consent is itself added as an App Role")
        print("(Admin/Developer/Tester) on the Meta app BEFORE reconnecting.")
    else:
        print("All required message-related scopes are present on this token.")
        print("The token itself is not the problem - look elsewhere (Meta-side delivery).")


if __name__ == "__main__":
    asyncio.run(main())