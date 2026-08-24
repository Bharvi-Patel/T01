"""add avatar_url and timezone to users

Backs the new Profile settings popup (bottom-left account button in the
sidebar): profile picture upload and a timezone picker, both previously
nonexistent. avatar_url points at a file served through the same
/media-files static mount as the media library; timezone is an IANA name,
defaulting to "UTC" for every existing row.

Revision ID: d4e5f6a7b8c9
Revises: c9e4f7b2a5d3
Create Date: 2026-08-24 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd4e5f6a7b8c9'
down_revision: Union[str, Sequence[str], None] = 'c9e4f7b2a5d3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _inspector():
    return sa.inspect(op.get_bind())


def upgrade() -> None:
    """Upgrade schema (idempotent: app startup may have run metadata.create_all)."""
    insp = _inspector()
    columns = {c['name'] for c in insp.get_columns('users')}

    if 'avatar_url' not in columns:
        op.add_column('users', sa.Column('avatar_url', sa.String(length=500), nullable=True))

    if 'timezone' not in columns:
        op.add_column(
            'users',
            sa.Column('timezone', sa.String(length=64), nullable=False, server_default='UTC'),
        )
        op.alter_column('users', 'timezone', server_default=None)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('users', 'timezone')
    op.drop_column('users', 'avatar_url')