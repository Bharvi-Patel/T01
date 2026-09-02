"""add reach/views to post_engagements

The PostEngagement model (db.py) now has reach and views columns,
nullable (unlike likes_count/comments_count) since not every platform can
provide them: LinkedIn never can with our current API access, and
Facebook/Instagram only can once a workspace reconnects those platforms
to grant the insights OAuth scope. None means "not available", not the
same as a genuine zero.

Revision ID: a3f7d9e2c5b8
Revises: f4a8c2e6b9d3
Create Date: 2026-09-02 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a3f7d9e2c5b8'
down_revision: Union[str, Sequence[str], None] = 'f4a8c2e6b9d3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('post_engagements', sa.Column('reach', sa.Integer(), nullable=True))
    op.add_column('post_engagements', sa.Column('views', sa.Integer(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('post_engagements', 'views')
    op.drop_column('post_engagements', 'reach')