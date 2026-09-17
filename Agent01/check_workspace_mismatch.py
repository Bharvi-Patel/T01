"""One-off diagnostic: lists every PlatformConnection and the most recent
InboxItems, side by side by workspace_id. Read-only - makes no changes.

Why this exists: we've now hit the same symptom twice - a webhook event
(a seeded Facebook comment, then a real Instagram DM) processes cleanly on
the server with no error, yet never appears in the Inbox UI. The likely
cause both times is the same root issue that originally caused
_workspace_id_for_page's MultipleResultsFound crash: the same connected
account (Page or IG account) has more than one PlatformConnection row,
each under a different workspace_id - so an event can be correctly
received and stored, just under a workspace_id your browser session isn't
currently viewing. This script makes that mismatch (or its absence)
directly visible instead of inferring it from symptoms.

Run from Agent01/:
    python check_workspace_mismatch.py
"""
import asyncio
from collections import defaultdict

from sqlalchemy import select

from db import AsyncSessionLocal, InboxItem, PlatformConnection


async def main():
    async with AsyncSessionLocal() as db:
        conn_result = await db.execute(
            select(PlatformConnection).order_by(PlatformConnection.platform, PlatformConnection.updated_at.desc())
        )
        connections = conn_result.scalars().all()

        item_result = await db.execute(
            select(InboxItem).order_by(InboxItem.created_at.desc()).limit(30)
        )
        items = item_result.scalars().all()

    print("=== PlatformConnection rows ===")
    by_platform = defaultdict(list)
    for c in connections:
        by_platform[c.platform.value].append(c)
    for platform, rows in by_platform.items():
        flag = "  <-- MULTIPLE WORKSPACES FOR THE SAME PLATFORM" if len(rows) > 1 else ""
        print(f"\n{platform} ({len(rows)} connection{'s' if len(rows) != 1 else ''}){flag}")
        for c in rows:
            page_id = (c.credentials or {}).get("page_id") or (c.credentials or {}).get("ig_page_id") or (c.credentials or {}).get("threads_user_id") or "?"
            print(f"  workspace_id={c.workspace_id}  page/account_id={page_id}  updated_at={c.updated_at}")

    print("\n=== Most recent 30 InboxItem rows ===")
    for item in items:
        print(f"  [{item.created_at}] workspace_id={item.workspace_id}  platform={item.platform.value}  "
              f"kind={item.kind.value}  sender={item.sender_name!r}  body={(item.body or '')[:40]!r}")

    print("\n=== What to look for ===")
    print("If any platform above shows 'MULTIPLE WORKSPACES', compare the workspace_id(s) "
          "listed there against the workspace_id(s) shown in the InboxItem list. If your "
          "missing DM's workspace_id doesn't match the workspace_id your logged-in browser "
          "session uses, that confirms the mismatch - the fix is either logging into that "
          "other workspace, or removing/consolidating the duplicate PlatformConnection so "
          "future events land in the right place.")


if __name__ == "__main__":
    asyncio.run(main())