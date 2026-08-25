"""add username_is_set to users

Revision ID: c9d0e1f2a3b4
Revises: b7c8d9e0f1a2
Create Date: 2026-08-25 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c9d0e1f2a3b4'
down_revision: Union[str, Sequence[str], None] = 'b7c8d9e0f1a2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # True means the user themselves picked this username (password signup,
    # or the onboarding prompt after OAuth). False means it's still the
    # auto-generated placeholder from OAuth signup and the frontend should
    # block on the "choose a username" prompt until they set a real one.
    # Existing rows default True - we can't retroactively know which ones
    # were auto-generated, and forcing already-active users into a new
    # mandatory prompt would be more disruptive than leaving their current
    # username as-is.
    op.add_column('users', sa.Column('username_is_set', sa.Boolean(), nullable=False, server_default=sa.true()))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('users', 'username_is_set')