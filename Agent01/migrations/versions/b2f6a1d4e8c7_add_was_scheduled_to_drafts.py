"""add was_scheduled to drafts

The Draft model (db.py) has a was_scheduled column - set once the first
time a draft is scheduled and never cleared, distinguishing "was ever
scheduled, now published" from "published immediately, never scheduled"
once scheduled_at/scheduled_platforms/scheduled_live get reset on
publish. That column was never added in a migration, so every query
that selects a Draft (including the scheduler's poll loop) fails with
asyncpg.exceptions.UndefinedColumnError: column drafts.was_scheduled
does not exist.

Revision ID: b2f6a1d4e8c7
Revises: c1c875d2cf6b
Create Date: 2026-08-20 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b2f6a1d4e8c7'
down_revision: Union[str, Sequence[str], None] = 'c1c875d2cf6b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        'drafts',
        sa.Column('was_scheduled', sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('drafts', 'was_scheduled')