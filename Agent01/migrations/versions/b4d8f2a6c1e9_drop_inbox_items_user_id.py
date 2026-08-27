"""drop leftover inbox_items.user_id (schema drift from pre-workspace-scoping)

a1b2c3d4e5f6_add_workspace_scoping's docstring assumed "inbox_items had no
user_id (webhook-sourced, not user-owned)" and never touched this column -
but that assumption was wrong for any deployment where inbox_items was
originally created (via Base.metadata.create_all(), from an older version
of the InboxItem model) back when it still had a NOT NULL user_id column,
the same way drafts/platform_connections/follower_snapshots once did. That
migration explicitly dropped the equivalent leftover column on
platform_connections and follower_snapshots, but inbox_items was missed.

The live column stayed NOT NULL with no default and nothing in the current
codebase ever sets it (InboxItem's current model in db.py has no user_id
field at all - workspace_id replaced it), so every real insert into
inbox_items - i.e. every webhook-sourced comment/DM/mention - has been
failing with a NotNullViolationError and rolling back silently. This is
why no webhook event has ever actually been saved, even once delivery
itself started working correctly.

Revision ID: b4d8f2a6c1e9
Revises: a9f3c7e1b5d2
Create Date: 2026-08-27 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b4d8f2a6c1e9'
down_revision: Union[str, Sequence[str], None] = 'a9f3c7e1b5d2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _existing_columns(table):
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    """Idempotent: only drops the column if it's actually still there, so
    this is safe to run against a database that was somehow already fixed
    by hand."""
    if "user_id" in _existing_columns("inbox_items"):
        op.drop_column("inbox_items", "user_id")


def downgrade() -> None:
    """Restored as nullable, not NOT NULL - there's no way to know what
    user_id each existing row "should" have had (inbox_items rows are
    webhook-sourced and workspace-scoped, not tied to a single user), so
    re-adding a NOT NULL constraint here would just reintroduce the same
    insert failures this migration fixes."""
    op.add_column("inbox_items", sa.Column("user_id", sa.UUID(), nullable=True))