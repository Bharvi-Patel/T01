"""One-off diagnostic: check whether the currently-connected Threads
account's token actually has threads_manage_insights, by calling the real
/insights endpoint directly and reading Meta's response.

Why this exists: after reconnecting Threads with the updated OAuth scope
(threads_authorize_url() now requests threads_manage_insights), Meta's App
Review "API test calls" tracker still showed 0 of 1 - this calls the exact
endpoint threads_fetch_post_engagement() uses, so a clean result here both
confirms the token genuinely has the permission and IS the test call Meta
is looking for (so running this for real, against a real post, is useful
regardless of what caused the tracker to read 0).

Run from Agent01/:
    python check_threads_insights.py
"""
import asyncio

import requests
from sqlalchemy import select

from db import AsyncSessionLocal, Platform, PlatformConnection, decrypt_secret


async def main():
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(PlatformConnection).where(PlatformConnection.platform == Platform.THREADS)
        )
        conn = result.scalars().first()
        if conn is None:
            print("No Threads connection found - connect one first.")
            return

        creds = conn.credentials or {}
        raw_token = creds.get("access_token")
        if not raw_token:
            print("Connection has no access_token stored.")
            return
        try:
            access_token = decrypt_secret(raw_token)
        except Exception as e:
            print(f"Could not decrypt stored token: {e}")
            return

    # Step 1: confirm the token itself is alive at all.
    me_resp = requests.get(
        "https://graph.threads.net/v1.0/me",
        params={"fields": "id,username", "access_token": access_token},
        timeout=15,
    )
    print(f"GET /me -> {me_resp.status_code}: {me_resp.text}")
    if not me_resp.ok:
        print("\nToken itself is invalid/expired - reconnect Threads before going further.")
        return
    threads_user_id = me_resp.json().get("id")

    # Step 2: find a real post to test insights against - the endpoint
    # needs a real media id, not the account id.
    posts_resp = requests.get(
        f"https://graph.threads.net/v1.0/{threads_user_id}/threads",
        params={"fields": "id,text", "limit": 1, "access_token": access_token},
        timeout=15,
    )
    print(f"\nGET /{{user}}/threads -> {posts_resp.status_code}: {posts_resp.text}")
    posts = posts_resp.json().get("data", [])
    if not posts:
        print("\nNo published Threads posts found to test insights against - "
              "publish at least one post through the app first, then re-run this.")
        return
    media_id = posts[0]["id"]

    # Step 3: the actual permission test - this is the same call
    # threads_fetch_post_engagement() makes.
    insights_resp = requests.get(
        f"https://graph.threads.net/v1.0/{media_id}/insights",
        params={"metric": "likes,replies", "access_token": access_token},
        timeout=15,
    )
    print(f"\nGET /{{media_id}}/insights -> {insights_resp.status_code}: {insights_resp.text}")

    if insights_resp.ok:
        print("\nSuccess - threads_manage_insights is genuinely present and working on this token.")
        print("If Meta's App Review tracker still shows 0 of 1 after this, it's their tracker "
              "lagging (their own docs mention test-call data can take up to 24 hours to register) "
              "rather than anything wrong on your end.")
    else:
        try:
            err = insights_resp.json().get("error", {})
            print(f"\nFailed - Meta's error: {err.get('message')}")
            if err.get("code") == 10 or "permission" in str(err.get("message", "")).lower():
                print("This looks like a genuine missing-permission error, not a transient issue - "
                      "the token doesn't actually have threads_manage_insights. Reconnect Threads and "
                      "watch the consent screen closely for an insights-related permission line item.")
        except ValueError:
            pass


if __name__ == "__main__":
    asyncio.run(main())