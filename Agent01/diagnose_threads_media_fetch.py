"""Diagnostic: takes ONE imgbb-hosted image URL and creates a media
container on both Instagram and Threads with it, back-to-back, then prints
both raw responses side by side.

Why this exists: publish_threads() fails with OAuthException code=1,
error_subcode 2207052 ("could not fetch media") on imgbb-hosted images,
while the equivalent Instagram/Facebook posts succeed through the exact
same validate_and_prepare_instagram_image() -> upload_to_imgbb() pipeline.
That split - same host, same bytes, same retry logic, different platform -
means the fastest way to learn anything is to give both platforms the
identical URL in the same run and compare:

  - Instagram succeeds, Threads fails on the same URL
        -> confirms it's graph.threads.net's crawler being pickier/
           currently flakier about this host, not the image or imgbb in
           general. Re-hosting to S3/Cloudflare R2/Cloudinary might still
           be worth trying, but isn't guaranteed to fix it - there's an
           open upstream report (gitroomhq/postiz-app#1364) of the same
           Threads-only failure reproducing across multiple different
           hosts.
  - Both fail
        -> genuinely an imgbb/CDN-propagation issue, not Threads-specific.
           The existing _create_meta_media_container retry should already
           handle transient cases; a persistent failure here means move
           off imgbb for real.
  - Both succeed
        -> today's earlier Threads failure was a one-off flake. Worth
           re-running this a few times before concluding anything.

This only creates media containers - it does not publish anything, so
nothing goes live. Unpublished containers expire on Meta's side on their
own (see error_subcode 2207020) and need no cleanup.

Run from Agent01/:
    python diagnose_threads_media_fetch.py
    python diagnose_threads_media_fetch.py --image-url https://example.com/some.jpg
"""
import argparse
import asyncio
import sys

import requests
from sqlalchemy import select

from Agent import IMGBB_API_KEY, upload_to_imgbb, validate_and_prepare_instagram_image
from db import AsyncSessionLocal, Platform, PlatformConnection, decrypt_secret
from oauth_platforms import instagram_fetch_media

parser = argparse.ArgumentParser()
parser.add_argument(
    "--image-url",
    default=None,
    help="Image to test with. If omitted, uses your most recent published "
         "Instagram post's image (fetched live from the Graph API).",
)
args = parser.parse_args()


def _print_result(label: str, resp: requests.Response):
    print(f"\n{'=' * 60}\n{label}\n{'=' * 60}")
    print(f"HTTP {resp.status_code}")
    try:
        body = resp.json()
    except ValueError:
        print(resp.text)
        return
    print(body)
    err = body.get("error")
    if err:
        print(f"\n  -> code={err.get('code')} subcode={err.get('error_subcode')} "
              f"message={err.get('message')!r}")
    else:
        print(f"\n  -> OK, container id: {body.get('id')}")


async def main():
    async with AsyncSessionLocal() as db:
        ig_result = await db.execute(select(PlatformConnection).where(PlatformConnection.platform == Platform.INSTAGRAM))
        ig_conn = ig_result.scalars().first()
        threads_result = await db.execute(select(PlatformConnection).where(PlatformConnection.platform == Platform.THREADS))
        threads_conn = threads_result.scalars().first()

        if ig_conn is None or threads_conn is None:
            missing = "Instagram" if ig_conn is None else "Threads"
            print(f"No {missing} connection found - connect it in the app first.", file=sys.stderr)
            sys.exit(1)

        ig_creds = ig_conn.credentials or {}
        ig_page_access_token = decrypt_secret(ig_creds["page_access_token"])
        ig_page_id = ig_creds["ig_page_id"]

        threads_creds = threads_conn.credentials or {}
        threads_access_token = decrypt_secret(threads_creds["access_token"])
        threads_user_id = threads_creds["threads_user_id"]

    image_url = args.image_url
    if not image_url:
        posts, _ = instagram_fetch_media(ig_page_access_token, ig_page_id, limit=1)
        if not posts or not posts[0].get("media_url"):
            print("No existing Instagram post with an image found, and no --image-url "
                  "was given - pass --image-url explicitly.", file=sys.stderr)
            sys.exit(1)
        image_url = posts[0]["media_url"]
        print(f"Using most recent Instagram post's image: {image_url}")

    print("\nPreparing image (same validate_and_prepare_instagram_image() both "
          "platforms already use)...")
    prepared_bytes = validate_and_prepare_instagram_image(image_url)
    if prepared_bytes is None:
        print("Could not fetch/open the source image - fix --image-url and retry.", file=sys.stderr)
        sys.exit(1)

    print("Uploading to imgbb (one upload, same hosted URL used for both tests)...")
    hosted_url = upload_to_imgbb(prepared_bytes, IMGBB_API_KEY)
    print(f"Hosted URL: {hosted_url}")

    # Instagram first
    ig_resp = requests.post(
        f"https://graph.facebook.com/v21.0/{ig_page_id}/media",
        data={"image_url": hosted_url, "caption": "", "access_token": ig_page_access_token},
        timeout=15,
    )
    _print_result("INSTAGRAM: POST /{ig-user-id}/media", ig_resp)

    # Then Threads, same URL, same moment
    threads_resp = requests.post(
        f"https://graph.threads.net/v1.0/{threads_user_id}/threads",
        data={
            "media_type": "IMAGE",
            "image_url": hosted_url,
            "text": "",
            "access_token": threads_access_token,
        },
        timeout=15,
    )
    _print_result("THREADS: POST /{threads-user-id}/threads", threads_resp)

    # Verdict
    ig_ok = ig_resp.ok
    threads_ok = threads_resp.ok
    print(f"\n{'=' * 60}\nVERDICT\n{'=' * 60}")
    if ig_ok and not threads_ok:
        print("Instagram accepted this exact URL; Threads rejected it. This points at "
              "graph.threads.net's crawler specifically, not the image or imgbb in "
              "general - see this script's docstring for what that does and doesn't "
              "imply about switching hosts.")
    elif not ig_ok and not threads_ok:
        print("Both platforms rejected the same URL - this looks like a genuine "
              "imgbb/CDN issue, not something Threads-specific. Worth moving off "
              "imgbb for real at this point.")
    elif ig_ok and threads_ok:
        print("Both succeeded. Whatever failed earlier looks like a one-off - re-run "
              "this a few times (and/or re-run your actual Threads post) before "
              "concluding anything further.")
    else:
        print("Threads succeeded but Instagram didn't - unexpected; check the "
              "Instagram error above, that's a separate problem from what we were "
              "chasing.")


if __name__ == "__main__":
    asyncio.run(main())