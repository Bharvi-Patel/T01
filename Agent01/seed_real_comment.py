"""Seeds a REAL, repliable comment for App Review screencasts - unlike
test_webhook_delivery.py --event comment, which fabricates a comment_id
that never existed on Meta's servers (fine for proving your webhook
pipeline works, but useless for filming a reply: Meta rejects a reply to
a fake object with "Object with ID ... does not exist").

Why this exists: your app is in Development Mode, so Meta doesn't deliver
real organic comment webhooks to you right now (see check_subscribed_apps.py
and test_webhook_delivery.py's docstrings for how that was diagnosed) - and
pages_read_engagement/instagram_manage_comments are exactly the permissions
under review that will fix that once approved. Meanwhile, the shot list
still needs a real reply demo. This script closes that gap correctly:

  1. Posts an ACTUAL top-level comment on your most recent real post, via
     the same Graph API "create a comment" edge your own reply functions
     use - so the resulting comment_id genuinely exists on Meta's side.
  2. Inserts that real comment directly into your Inbox (bypassing the
     webhook, since Development Mode won't deliver it to you anyway - this
     script IS the delivery mechanism for demo purposes).
  3. Now facebook_reply_to_comment / instagram_reply_to_comment will
     succeed for real when you click reply in your app, live on camera.

One honest caveat worth knowing before you film: because this uses your
own Page's access token, Meta attributes the seeded comment's authorship
to your Page/app itself, not an independent commenter - visibly labelled
as "Test Commenter (seeded for screencast)" in the inbox so it's not
confused with a real customer. The object is genuine and the reply call
is genuine; only the "who left this comment" story is staged. That's
worth a one-line mention in your submission notes, same as the shot
list's own suggested disclosure for the comment permissions.

Run from Agent01/:
    python seed_real_comment.py --platform facebook
    python seed_real_comment.py --platform instagram
    python seed_real_comment.py --platform facebook --post-id 123456789_987654321
"""
import argparse
import asyncio
import sys

import requests
from sqlalchemy import select

from db import AsyncSessionLocal, InboxItem, InboxKind, Platform, PlatformConnection, decrypt_secret
from oauth_platforms import facebook_fetch_posts, instagram_fetch_media

parser = argparse.ArgumentParser()
parser.add_argument("--platform", choices=["facebook", "instagram"], required=True)
parser.add_argument(
    "--post-id",
    default=None,
    help="Post/media id to comment on. If omitted, uses your most recent "
         "published post on that platform (fetched live from the Graph API).",
)
parser.add_argument(
    "--text",
    default="This is a seeded test comment for an App Review screencast.",
    help="Comment body. Keep it obviously a test comment, not something "
         "that reads as a real user message.",
)
args = parser.parse_args()


def _post_top_level_comment(platform: Platform, page_access_token: str, object_id: str, text: str) -> str:
    """Both platforms create a top-level comment via POST
    /{object-id}/comments - this is the "new comment" edge, distinct from
    /{comment-id}/replies which nests under an existing comment
    (facebook_reply_to_comment/instagram_reply_to_comment in
    oauth_platforms.py use that second edge). Deliberately not importing
    those two here since posting a NEW comment, not a reply, is the
    correct operation for seeding."""
    resp = requests.post(
        f"https://graph.facebook.com/v21.0/{object_id}/comments",
        data={"message": text, "access_token": page_access_token},
        timeout=15,
    )
    if not resp.ok:
        try:
            err_msg = resp.json().get("error", {}).get("message", resp.text)
        except ValueError:
            err_msg = resp.text
        raise ValueError(f"Meta rejected the seed comment: {err_msg}")
    return resp.json()["id"]


async def main():
    platform = Platform.FACEBOOK if args.platform == "facebook" else Platform.INSTAGRAM

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(PlatformConnection).where(PlatformConnection.platform == platform))
        connection = result.scalars().first()
        if connection is None:
            print(f"No {platform.value} connection found - connect it in the app first.", file=sys.stderr)
            sys.exit(1)

        creds = connection.credentials or {}
        page_access_token = decrypt_secret(creds["page_access_token"])

        object_id = args.post_id
        if not object_id:
            if platform == Platform.FACEBOOK:
                posts = facebook_fetch_posts(page_access_token, creds["page_id"], limit=1)
            else:
                posts, _ = instagram_fetch_media(page_access_token, creds["ig_page_id"], limit=1)
            if not posts:
                print(f"No existing posts found on this {platform.value} account, and no "
                      f"--post-id was given - publish something first, or pass --post-id "
                      f"explicitly.", file=sys.stderr)
                sys.exit(1)
            object_id = posts[0]["id"]
            print(f"Using most recent post/media id: {object_id}")

        print(f"Posting a real comment on {object_id} via the Graph API ...")
        comment_id = _post_top_level_comment(platform, page_access_token, object_id, args.text)
        print(f"Success - Meta created real comment id: {comment_id}")

        db.add(InboxItem(
            workspace_id=connection.workspace_id,
            platform=platform,
            kind=InboxKind.COMMENT,
            external_id=comment_id,
            thread_id=object_id,
            sender_name="Test Commenter (seeded for screencast)",
            sender_external_id=None,
            body=args.text,
            raw_payload={"seeded_by": "seed_real_comment.py", "post_id": object_id},
        ))
        await db.commit()

    print(f"\nDone. Check your app's Inbox tab - a new {platform.value} comment should be "
          f"there, and unlike test_webhook_delivery.py's fake comments, replying to it "
          f"will actually succeed since Meta genuinely has this object.")


if __name__ == "__main__":
    asyncio.run(main())