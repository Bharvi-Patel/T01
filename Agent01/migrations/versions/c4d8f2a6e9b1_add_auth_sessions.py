"""add auth_sessions table

Auth tokens issued by /login and the OAuth callback used to live only in
an in-memory dict on the running process (AUTH_TOKENS in main.py) - every
restart or redeploy wiped it, silently logging out every user whose
browser still held a now-nonexistent token ("Not authenticated" on their
next request). This moves sessions into Postgres so they survive restarts;
only an actual expiry (or a future logout) invalidates a token now.

Revision ID: c4d8f2a6e9b1
Revises: a7e3c9f5d1b2
Create Date: 2026-08-20 13:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c4d8f2a6e9b1'
down_revision: Union[str, Sequence[str], None] = 'a7e3c9f5d1b2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'auth_sessions',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('user_id', sa.UUID(), nullable=False),
        sa.Column('token', sa.String(length=64), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('token'),
    )
    op.create_index('ix_auth_sessions_token', 'auth_sessions', ['token'])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_auth_sessions_token', table_name='auth_sessions')
    op.drop_table('auth_sessions')