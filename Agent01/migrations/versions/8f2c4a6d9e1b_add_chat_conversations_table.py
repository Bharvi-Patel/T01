"""add chat_conversations table

Moves the floating help-assistant widget from one endless per-user thread
to multiple named conversations (like Claude's own chat list), matching
db.py's new ChatConversation model. Existing chat_messages rows are
backfilled into one conversation per (workspace_id, user_id) pair so no
history is lost - that conversation is left untitled (title=NULL), same
as any other conversation whose title hasn't been generated yet.

Revision ID: 8f2c4a6d9e1b
Revises: 75d3bc3fc32e
Create Date: 2026-09-14 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = '8f2c4a6d9e1b'
down_revision: Union[str, Sequence[str], None] = '75d3bc3fc32e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema.

    Written defensively like the chat_messages and help_article_embeddings
    migrations before it: db.py's init_db() runs create_all() on every
    backend startup, which can create these objects independent of whether
    this migration has run - so this checks what's actually there instead
    of assuming a clean slate.
    """
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if 'chat_conversations' not in inspector.get_table_names():
        op.create_table(
            'chat_conversations',
            sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column('workspace_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('workspaces.id', ondelete='CASCADE'), nullable=False),
            sa.Column('user_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
            sa.Column('title', sa.String(255), nullable=True),
            sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
            sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        )

    existing_conv_indexes = {ix['name'] for ix in sa.inspect(bind).get_indexes('chat_conversations')}
    if 'ix_chat_conversations_workspace_user' not in existing_conv_indexes:
        op.create_index(
            'ix_chat_conversations_workspace_user',
            'chat_conversations',
            ['workspace_id', 'user_id', 'updated_at'],
        )

    chat_messages_columns = {c['name'] for c in inspector.get_columns('chat_messages')}
    if 'conversation_id' not in chat_messages_columns:
        # Nullable for now - existing rows have no conversation yet. Backfilled
        # below, then tightened to NOT NULL once every row has one.
        op.add_column(
            'chat_messages',
            sa.Column('conversation_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('chat_conversations.id', ondelete='CASCADE'), nullable=True),
        )

    # Backfill: one conversation per (workspace_id, user_id) pair that still
    # has unassigned messages. Re-running this is safe - the WHERE clause
    # only ever touches rows still missing a conversation_id.
    op.execute("""
        INSERT INTO chat_conversations (id, workspace_id, user_id, title, created_at, updated_at)
        SELECT gen_random_uuid(), workspace_id, user_id, NULL, MIN(created_at), MAX(created_at)
        FROM chat_messages
        WHERE conversation_id IS NULL
        GROUP BY workspace_id, user_id
    """)
    op.execute("""
        UPDATE chat_messages cm
        SET conversation_id = cc.id
        FROM chat_conversations cc
        WHERE cm.conversation_id IS NULL
          AND cm.workspace_id = cc.workspace_id
          AND cm.user_id = cc.user_id
    """)

    op.alter_column('chat_messages', 'conversation_id', nullable=False)

    existing_msg_indexes = {ix['name'] for ix in sa.inspect(bind).get_indexes('chat_messages')}
    if 'ix_chat_messages_conversation' not in existing_msg_indexes:
        op.create_index('ix_chat_messages_conversation', 'chat_messages', ['conversation_id', 'created_at'])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_chat_messages_conversation', table_name='chat_messages')
    op.drop_column('chat_messages', 'conversation_id')
    op.drop_index('ix_chat_conversations_workspace_user', table_name='chat_conversations')
    op.drop_table('chat_conversations')