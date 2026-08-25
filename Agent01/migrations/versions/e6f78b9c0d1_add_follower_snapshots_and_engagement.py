"""add follower_snapshots and post_engagements

Backs the new Analytics additions: follower growth over time (snapshotted
daily, since platform APIs only expose a current count) and cached
like/comment counts per published post (so /analytics/summary doesn't have
to hit every platform's API on every page load).

Revision ID: e6f7a8b9c0d1
Revises: d4e5f6a7b8c9
Create Date: 2026-08-25 09:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'e6f7a8b9c0d1'
down_revision: Union[str, Sequence[str], None] = 'd4e5f6a7b8c9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _existing_tables():
    return set(sa.inspect(op.get_bind()).get_table_names())


def upgrade() -> None:
    """Upgrade schema (idempotent: app startup may have run metadata.create_all)."""
    tables = _existing_tables()
    platform_enum = postgresql.ENUM(name="platform_enum", create_type=False)

    if 'follower_snapshots' not in tables:
        op.create_table(
            'follower_snapshots',
            sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column('user_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
            sa.Column('platform', platform_enum, nullable=False),
            sa.Column('follower_count', sa.Integer(), nullable=False),
            sa.Column('captured_on', sa.Date(), nullable=False),
            sa.Column('captured_at', sa.DateTime(timezone=True), nullable=False),
            sa.UniqueConstraint('user_id', 'platform', 'captured_on', name='uq_user_platform_day'),
        )

    if 'post_engagements' not in tables:
        op.create_table(
            'post_engagements',
            sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column('publish_result_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('publish_results.id', ondelete='CASCADE'), nullable=False, unique=True),
            sa.Column('likes_count', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('comments_count', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('fetched_at', sa.DateTime(timezone=True), nullable=False),
        )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('post_engagements')
    op.drop_table('follower_snapshots')