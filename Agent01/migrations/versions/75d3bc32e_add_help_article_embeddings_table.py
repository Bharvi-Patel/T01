"""add help_article_embeddings table

Fills a gap left by Checkpoint 4/5's help-content embedding work: the
HelpArticleEmbedding model (db.py) and the pgvector extension it needs
were only ever created by init_db()'s Base.metadata.create_all() on
backend startup, never by an Alembic migration. That works functionally
(init_db() runs before you'd notice anything missing) but leaves Alembic's
own tracked history out of sync with the real schema - a fresh database,
a downgrade, or a later autogenerate wouldn't know this table exists.
This migration exists purely to close that gap, matching what init_db()
already put in place.

Written defensively like 07c6146cbe9c before it: your database almost
certainly already has this table (that's the whole reason this migration
is needed), so this checks what's there instead of assuming a clean slate.

Revision ID: 75d3bc3fc32e
Revises: 07c6146cbe9c
Create Date: 2026-09-11 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from pgvector.sqlalchemy import Vector


# revision identifiers, used by Alembic.
revision: str = '75d3bc3fc32e'
down_revision: Union[str, Sequence[str], None] = '07c6146cbe9c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

HELP_EMBEDDING_DIM = 768  # must match db.py's HELP_EMBEDDING_DIM


def upgrade() -> None:
    """Upgrade schema."""
    bind = op.get_bind()

    # No-op if already enabled (e.g. by init_db()) - CREATE EXTENSION IF
    # NOT EXISTS is safe to run unconditionally, unlike CREATE TABLE/TYPE.
    bind.execute(sa.text("CREATE EXTENSION IF NOT EXISTS vector"))

    inspector = sa.inspect(bind)
    if 'help_article_embeddings' not in inspector.get_table_names():
        op.create_table(
            'help_article_embeddings',
            sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column('article_id', sa.String(255), nullable=False),
            sa.Column('section_key', sa.String(64), nullable=False),
            sa.Column('section_title', sa.String(255), nullable=False),
            sa.Column('question', sa.Text(), nullable=False),
            sa.Column('answer', sa.Text(), nullable=False),
            sa.Column('content_hash', sa.String(64), nullable=False),
            sa.Column('embedding', Vector(HELP_EMBEDDING_DIM), nullable=False),
            sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        )

    existing_indexes = {ix['name'] for ix in sa.inspect(bind).get_indexes('help_article_embeddings')}
    if 'ix_help_article_embeddings_article_id' not in existing_indexes:
        op.create_index(
            'ix_help_article_embeddings_article_id',
            'help_article_embeddings',
            ['article_id'],
            unique=True,
        )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_help_article_embeddings_article_id', table_name='help_article_embeddings')
    op.drop_table('help_article_embeddings')
    # Deliberately NOT dropping the vector extension - other tables/future
    # migrations may depend on it, and DROP EXTENSION would cascade to
    # anything else using the type.