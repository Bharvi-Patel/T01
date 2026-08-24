"""add notification_preferences and push_subscriptions tables

Backs the Publish page's "Mobile Notifications" tab, which was previously a
frontend-only mock (toggles didn't persist, nothing was ever sent). Two
tables: notification_preferences (one row per user, which kinds of alerts
they want) and push_subscriptions (one row per browser/device the user has
enabled Web Push on).

Revision ID: f1a2b3c4d5e6
Revises: e5f9a2c7b3d4
Create Date: 2026-08-24 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f1a2b3c4d5e6'
down_revision: Union[str, Sequence[str], None] = 'e5f9a2c7b3d4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        'drafts',
        sa.Column('reminder_sent', sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.alter_column('drafts', 'reminder_sent', server_default=None)
    op.create_table(
        'notification_preferences',
        sa.Column('user_id', sa.UUID(), nullable=False),
        sa.Column('before_publish', sa.Boolean(), nullable=False),
        sa.Column('needs_approval', sa.Boolean(), nullable=False),
        sa.Column('publish_failed', sa.Boolean(), nullable=False),
        sa.Column('weekly_digest', sa.Boolean(), nullable=False),
        sa.Column('weekly_digest_last_sent', sa.DateTime(timezone=True), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('user_id'),
    )
    op.create_table(
        'push_subscriptions',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('user_id', sa.UUID(), nullable=False),
        sa.Column('endpoint', sa.Text(), nullable=False),
        sa.Column('p256dh', sa.String(length=255), nullable=False),
        sa.Column('auth', sa.String(length=255), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('endpoint'),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('push_subscriptions')
    op.drop_table('notification_preferences')
    op.drop_column('drafts', 'reminder_sent')