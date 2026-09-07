"""add inbox_items table and inbox_kind_enum (missing from history)

inbox_items and inbox_kind_enum were originally created directly against
dev databases by init_db()'s create_all() when the Inbox feature first
shipped, and no migration was ever committed to capture that. Every fresh
database (e.g. a new Neon/Render deployment) that runs the migration chain
from scratch fails at e5f9a2c7b3d4 ("add MENTION/STORY_REPLY values to
inbox_kind_enum") with UndefinedObjectError: type "inbox_kind_enum" does
not exist, because nothing before it ever created that type or the table.

This migration recreates the table as it existed at this point in history
(before workspace scoping added workspace_id, and before
c8e1a4f7b2d5 added is_outbound/deleted_at) - those later migrations already
add their own columns and are unaffected by this insertion. checkfirst /
existence checks are used throughout so this is a no-op on any database
where inbox_items already exists (e.g. an existing production database
that hit this gap a different way).

Revision ID: f7a1b3c9d2e8
Revises: c4d8f2a6e9b1
Create Date: 2026-09-07 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'f7a1b3c9d2e8'
down_revision: Union[str, Sequence[str], None] = 'c4d8f2a6e9b1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _existing_tables():
    return set(sa.inspect(op.get_bind()).get_table_names())


def upgrade() -> None:
    """Upgrade schema."""
    if "inbox_items" in _existing_tables():
        return

    bind = op.get_bind()

    inbox_kind_enum = postgresql.ENUM("COMMENT", "MESSAGE", name="inbox_kind_enum")
    inbox_kind_enum.create(bind, checkfirst=True)

    platform_enum = postgresql.ENUM(name="platform_enum", create_type=False)

    op.create_table(
        "inbox_items",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("platform", platform_enum, nullable=False),
        sa.Column("kind", inbox_kind_enum, nullable=False),
        sa.Column("external_id", sa.String(length=128), nullable=False),
        sa.Column("thread_id", sa.String(length=128), nullable=True),
        sa.Column("sender_name", sa.String(length=255), nullable=True),
        sa.Column("sender_external_id", sa.String(length=128), nullable=True),
        sa.Column("body", sa.Text(), nullable=True),
        sa.Column("is_read", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("raw_payload", postgresql.JSON(astext_type=sa.Text()), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("platform", "external_id", name="uq_platform_external_id"),
    )
    op.create_index("ix_inbox_items_external_id", "inbox_items", ["external_id"])
    op.create_index("ix_inbox_items_thread_id", "inbox_items", ["thread_id"])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_inbox_items_thread_id", table_name="inbox_items")
    op.drop_index("ix_inbox_items_external_id", table_name="inbox_items")
    op.drop_table("inbox_items")
    op.execute("DROP TYPE IF EXISTS inbox_kind_enum")