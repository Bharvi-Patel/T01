"""add custom_ideas table

Backs the Dashboard Ideas section's "+ New" button - previously it just
navigated to the post generator and had no way to let a user jot down
their own idea and have it show up alongside the Calendarific-sourced
festival ideas. This adds a small per-user table for those, merged into
the /dashboard/ideas response.

Revision ID: b8d3e6a1f4c2
Revises: f1a2b3c4d5e6
Create Date: 2026-08-24 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b8d3e6a1f4c2'
down_revision: Union[str, Sequence[str], None] = 'f1a2b3c4d5e6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'custom_ideas',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('user_id', sa.UUID(), nullable=False),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('date', sa.String(length=10), nullable=True),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_custom_ideas_user_id', 'custom_ideas', ['user_id'])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_custom_ideas_user_id', table_name='custom_ideas')
    op.drop_table('custom_ideas')