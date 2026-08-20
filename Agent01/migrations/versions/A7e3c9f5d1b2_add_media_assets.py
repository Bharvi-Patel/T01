"""add media_assets table

Backs the Publish page's "Media" tab, which up to now only held assets in
frontend component state (see the "there's no media backend wired up"
notice that used to sit in Publish.jsx) - anything a user uploaded there
vanished on refresh. This adds a permanent, per-user media library: photos
and videos are written to disk under MEDIA_DIR/<user_id>/ (main.py) and
tracked here so they survive restarts and reloads, and text assets are
stored inline via text_content.

Revision ID: a7e3c9f5d1b2
Revises: b2f6a1d4e8c7
Create Date: 2026-08-20 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a7e3c9f5d1b2'
down_revision: Union[str, Sequence[str], None] = 'b2f6a1d4e8c7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'media_assets',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('user_id', sa.UUID(), nullable=False),
        sa.Column('kind', sa.Enum('PHOTO', 'VIDEO', 'TEXT', name='media_kind_enum'), nullable=False),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('content_type', sa.String(length=128), nullable=True),
        sa.Column('file_path', sa.String(length=512), nullable=True),
        sa.Column('file_size', sa.Integer(), nullable=True),
        sa.Column('text_content', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_media_assets_user_id', 'media_assets', ['user_id'])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_media_assets_user_id', table_name='media_assets')
    op.drop_table('media_assets')
    op.execute('DROP TYPE IF EXISTS media_kind_enum')