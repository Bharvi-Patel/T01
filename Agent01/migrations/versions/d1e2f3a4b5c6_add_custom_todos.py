"""add custom_todos table

Backs the Dashboard To Do section's new "+ New" button and inline editing
- previously the three starter tasks were a hardcoded, uneditable frontend
list. This adds a small per-user table for todos (seeded with those three
on first fetch, see get_dashboard_todos) so every item, built-in or
user-added, is a normal row that can be edited or deleted.

Revision ID: d1e2f3a4b5c6
Revises: c9d0e1f2a3b4
Create Date: 2026-08-25 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd1e2f3a4b5c6'
down_revision: Union[str, Sequence[str], None] = 'c9d0e1f2a3b4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'custom_todos',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('user_id', sa.UUID(), nullable=False),
        sa.Column('title', sa.String(length=255), nullable=False),
        sa.Column('body', sa.Text(), nullable=True),
        sa.Column('accent', sa.String(length=16), nullable=True),
        sa.Column('nav', sa.String(length=32), nullable=True),
        sa.Column('sort_order', sa.Integer(), server_default='0', nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_custom_todos_user_id', 'custom_todos', ['user_id'])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_custom_todos_user_id', table_name='custom_todos')
    op.drop_table('custom_todos')