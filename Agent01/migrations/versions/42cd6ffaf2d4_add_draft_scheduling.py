"""add draft scheduling

Revision ID: 42cd6ffaf2d4
Revises: 0888237c05fb
Create Date: 2026-08-19 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '42cd6ffaf2d4'
down_revision: Union[str, Sequence[str], None] = '0888237c05fb'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Postgres enum values can't be added inside the same transaction that
    # might use them, so this runs in its own autocommit block.
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE draft_status_enum ADD VALUE IF NOT EXISTS 'scheduled'")

    op.add_column('drafts', sa.Column('scheduled_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('drafts', sa.Column('scheduled_platforms', sa.JSON(), nullable=True))
    op.add_column('drafts', sa.Column('scheduled_live', sa.Boolean(), nullable=False, server_default=sa.false()))
    op.create_index('ix_drafts_scheduled_at', 'drafts', ['scheduled_at'])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_drafts_scheduled_at', table_name='drafts')
    op.drop_column('drafts', 'scheduled_live')
    op.drop_column('drafts', 'scheduled_platforms')
    op.drop_column('drafts', 'scheduled_at')
    # Note: Postgres doesn't support removing an enum value, so 'scheduled'
    # stays a valid draft_status_enum member even after downgrade.