"""add is_outbound and deleted_at to inbox_items (reply + delete support)

Backs POST /inbox/{id}/reply and DELETE /inbox/{id} - the "custom inbox
solution" reply/delete functionality Meta's App Review requires for
instagram_manage_messages ("apps for other businesses" track). is_outbound
marks a reply the business sent back through the app, so the thread view
can show a real conversation instead of only inbound events. deleted_at is
a soft-delete: a hard delete would let a webhook redelivery of the same
external_id (see uq_platform_external_id) silently resurrect a message the
user deliberately removed from their inbox, since deleted rows would just
look "not yet received" to that dedup check.

Revision ID: c8e1a4f7b2d5
Revises: b4d8f2a6c1e9
Create Date: 2026-08-27 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c8e1a4f7b2d5'
down_revision: Union[str, Sequence[str], None] = 'b4d8f2a6c1e9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _existing_columns(table):
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    """Idempotent, same pattern as the rest of this migration set."""
    cols = _existing_columns("inbox_items")
    if "is_outbound" not in cols:
        op.add_column(
            "inbox_items",
            sa.Column("is_outbound", sa.Boolean(), nullable=False, server_default=sa.false()),
        )
        op.alter_column("inbox_items", "is_outbound", server_default=None)
    if "deleted_at" not in cols:
        op.add_column("inbox_items", sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("inbox_items", "deleted_at")
    op.drop_column("inbox_items", "is_outbound")