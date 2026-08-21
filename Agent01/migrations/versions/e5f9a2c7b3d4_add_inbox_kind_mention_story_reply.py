"""add MENTION/STORY_REPLY values to inbox_kind_enum

InboxKind gained MENTION and STORY_REPLY members (splitting them out of
COMMENT, see main.py's meta/threads webhook handlers) but inbox_kind_enum
was already created in Postgres back when the Inbox feature first shipped
with just 'COMMENT'/'MESSAGE' - init_db()'s create_all only creates types
that don't exist yet, it never alters an existing one. Any webhook event
that tried to insert kind=InboxKind.MENTION or kind=InboxKind.STORY_REPLY
therefore failed outright, aborting that request's transaction (and with
it, everything else recorded in the same webhook batch).

Values are uppercase (MENTION, STORY_REPLY) to match the member .name,
not the lowercase .value - the Enum() column here has no values_callable,
so SQLAlchemy's default of binding by member name applies, same as every
other enum column in this file. See c1c875d2cf6b for the same casing
mistake previously made (and fixed) on draft_status_enum - this revision
originally repeated it with lowercase values before being corrected.

Revision ID: e5f9a2c7b3d4
Revises: c4d8f2a6e9b1
Create Date: 2026-08-21 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'e5f9a2c7b3d4'
down_revision: Union[str, Sequence[str], None] = 'c4d8f2a6e9b1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # ALTER TYPE ... ADD VALUE can't run inside Alembic's normal transaction
    # block (same constraint as c1c875d2cf6b), so it needs autocommit_block.
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE inbox_kind_enum ADD VALUE IF NOT EXISTS 'MENTION'")
        op.execute("ALTER TYPE inbox_kind_enum ADD VALUE IF NOT EXISTS 'STORY_REPLY'")


def downgrade() -> None:
    """Downgrade schema."""
    # Postgres doesn't support removing an enum value, so 'MENTION' and
    # 'STORY_REPLY' stay valid inbox_kind_enum members even after downgrade.
    # Any inbox_items rows written with them since the upgrade would need
    # manual reclassification back to 'COMMENT' if you actually roll back
    # this far.
    pass