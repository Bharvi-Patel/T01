"""add reset_token and reset_token_expires_at to users

Backs the "forgot password" flow (POST /forgot-password, POST
/reset-password): a signed random token emailed to the account, separate
from verification_token so an in-flight email-verification link and an
in-flight password-reset link never step on each other.

Revision ID: dc2b7a4e9f31
Revises: ccef71fddbea
Create Date: 2026-09-01 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'dc2b7a4e9f31'
down_revision: Union[str, Sequence[str], None] = 'c8e1a4f7b2d5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _inspector():
    return sa.inspect(op.get_bind())


def upgrade() -> None:
    """Upgrade schema (idempotent: app startup may have run metadata.create_all)."""
    insp = _inspector()
    columns = {c['name'] for c in insp.get_columns('users')}

    if 'reset_token' not in columns:
        op.add_column('users', sa.Column('reset_token', sa.String(length=64), nullable=True))
        op.create_index(op.f('ix_users_reset_token'), 'users', ['reset_token'], unique=False)

    if 'reset_token_expires_at' not in columns:
        op.add_column('users', sa.Column('reset_token_expires_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_users_reset_token'), table_name='users')
    op.drop_column('users', 'reset_token_expires_at')
    op.drop_column('users', 'reset_token')