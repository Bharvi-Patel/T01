"""add idea_attachments table

The Dashboard Ideas "+ New" modal now lets a user attach photos/videos to
an idea instead of typing a date and free-text notes. This adds a small
per-idea attachments table, storing files on disk under
MEDIA_DIR/<user_id>/ the same way the Publish page's media library does.

Revision ID: c9e4f7b2a5d3
Revises: b8d3e6a1f4c2
Create Date: 2026-08-24 13:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c9e4f7b2a5d3'
down_revision: Union[str, Sequence[str], None] = 'b8d3e6a1f4c2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'idea_attachments',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('idea_id', sa.UUID(), nullable=False),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('content_type', sa.String(length=128), nullable=True),
        sa.Column('file_path', sa.String(length=512), nullable=False),
        sa.Column('file_size', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['idea_id'], ['custom_ideas.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_idea_attachments_idea_id', 'idea_attachments', ['idea_id'])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_idea_attachments_idea_id', table_name='idea_attachments')
    op.drop_table('idea_attachments')