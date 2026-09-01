"""add requested_* approval-request fields to drafts + PENDING_APPROVAL enum value

Same root cause as a1b2c3d4e5f6: Draft picked up requested_scheduled_at,
requested_platforms, requested_live (holding what a NEEDS_APPROVAL member
asked for while a draft sits at status=PENDING_APPROVAL - see Draft's
docstring in db.py) and DraftStatus picked up the PENDING_APPROVAL member,
but init_db()'s create_all() never alters an existing table/enum, so these
were silently never added - breaking the scheduler poll exactly like
workspace_id did.

Revision ID: b3c4d5e6f7a8
Revises: a1b2c3d4e5f6
Create Date: 2026-08-26 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'b3c4d5e6f7a8'
down_revision: Union[str, Sequence[str], None] = '4ffa0ceeadeb'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _existing_columns(table):
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    # SQLAlchemy binds enum members by .name, so the Postgres label to add
    # is "PENDING_APPROVAL" (matching the c1c875d2cf6b convention already
    # established in this project), not the lowercase .value.
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE draft_status_enum ADD VALUE IF NOT EXISTS 'PENDING_APPROVAL'")

    cols = _existing_columns("drafts")
    if "requested_scheduled_at" not in cols:
        op.add_column("drafts", sa.Column("requested_scheduled_at", sa.DateTime(timezone=True), nullable=True))
    if "requested_platforms" not in cols:
        op.add_column("drafts", sa.Column("requested_platforms", postgresql.JSON(), nullable=True))
    if "requested_live" not in cols:
        op.add_column(
            "drafts",
            sa.Column("requested_live", sa.Boolean(), nullable=False, server_default=sa.false()),
        )


def downgrade() -> None:
    """Not supported - Postgres can't drop an enum value (PENDING_APPROVAL
    would stay valid regardless), so this only reverses the column adds."""
    cols = _existing_columns("drafts")
    for col in ("requested_live", "requested_platforms", "requested_scheduled_at"):
        if col in cols:
            op.drop_column("drafts", col)