"""add full_name to users

Revision ID: b7c8d9e0f1a2
Revises: e6f7a8b9c0d1
Create Date: 2026-08-25 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b7c8d9e0f1a2'
down_revision: Union[str, Sequence[str], None] = 'e6f7a8b9c0d1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Separate from `username` (the unique, slug-style login handle) -
    # full_name is the free-text display name (spaces, capitals, anything)
    # that used to be crammed into username itself. Backfill existing rows
    # with their current username so nobody's display name goes blank.
    op.add_column('users', sa.Column('full_name', sa.String(length=120), nullable=True))
    op.execute("UPDATE users SET full_name = username WHERE full_name IS NULL")


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('users', 'full_name')