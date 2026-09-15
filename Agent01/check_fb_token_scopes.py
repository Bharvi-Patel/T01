"""One-off diagnostic: check what scopes are ACTUALLY attached to your
stored Facebook page_access_token, via Meta's own /debug_token endpoint.

Same idea as check_token_scopes.py, but for the Facebook connection and
the permission Facebook Page comment webhooks depend on
(pages_read_engagement) instead of Instagram's messaging scopes.

Run from Agent01/:
    python check_fb_token_scopes.py
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
            select(PlatformConnection).where(PlatformConnection.platform == Platform.FACEBOOK)
        )
        conn = result.scalars().first()
        if conn is None:
            print("No Facebook connection found.")
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

    print(f"\nToken belongs to app_id: {info.get('app_id')}")
    print(f"Token type: {info.get('type')}")
    print(f"Valid: {info.get('is_valid')}")
    print(f"Expires at: {info.get('expires_at')} (0 = never/long-lived)")
    print(f"\nGranted scopes ({len(scopes)}):")
    for s in sorted(scopes):
        print(f"  - {s}")

    needed = {"pages_read_engagement", "pages_show_list", "pages_manage_metadata"}
    missing = needed - set(scopes)
    print()
    if missing:
        print(f"MISSING required scope(s) for receiving Page comment webhooks: {sorted(missing)}")
        print("This token does not have permission to receive Facebook Page comment events -")
        print("that's why nothing arrives, independent of everything else already verified.")
        print("Fix: reconnect Facebook in T01 (disconnect + go through OAuth again), making")
        print("sure the account granting consent is itself added as an App Role")
        print("(Admin/Developer/Tester) on the Meta app BEFORE reconnecting.")
    else:
        print("All required scopes are present on this token.")
        print("The token itself is not the problem - look elsewhere (which Page/post you")
        print("commented on, propagation delay after resubscribing, or Meta-side delivery).")


if __name__ == "__main__":
    asyncio.run(main())