"""add chat_messages table

Checkpoint 2 of the floating help-assistant widget: persists each turn of
a user's conversation with the assistant so it can be replayed as history
on the next turn and reloaded when the widget reopens, instead of every
message being a stateless one-off (Checkpoint 1). Scoped to both
workspace_id and user_id - always queried by both, since this is a
personal conversation, not a shared workspace list.

Revision ID: 07c6146cbe9c
Revises: a3f7d9e2c5b8
Create Date: 2026-09-11 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = '07c6146cbe9c'
down_revision: Union[str, Sequence[str], None] = 'a3f7d9e2c5b8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema.

    Written defensively: db.py's init_db() runs Base.metadata.create_all()
    on every backend startup (see main.py), which will auto-create
    chat_messages (and the chat_role enum) the moment ChatMessage exists
    in db.py's models - independent of whether this migration has run.
    So this checks what's actually there instead of assuming a clean
    slate, to stay correct whichever one gets there first.
    """
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if 'chat_messages' not in inspector.get_table_names():
        chat_role = postgresql.ENUM('user', 'assistant', name='chat_role')
        chat_role.create(bind, checkfirst=True)

        # create_type=False: the type is already handled (created just
        # above, or already existed) - letting create_table's own column
        # setup also try to create it is what caused the original
        # DuplicateObjectError.
        chat_role_col = postgresql.ENUM('user', 'assistant', name='chat_role', create_type=False)

        op.create_table(
            'chat_messages',
            sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column('workspace_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('workspaces.id', ondelete='CASCADE'), nullable=False),
            sa.Column('user_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
            sa.Column('role', chat_role_col, nullable=False),
            sa.Column('content', sa.Text(), nullable=False),
            sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        )

    existing_indexes = {ix['name'] for ix in sa.inspect(bind).get_indexes('chat_messages')}
    if 'ix_chat_messages_workspace_user' not in existing_indexes:
        op.create_index('ix_chat_messages_workspace_user', 'chat_messages', ['workspace_id', 'user_id', 'created_at'])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_chat_messages_workspace_user', table_name='chat_messages')
    op.drop_table('chat_messages')
    postgresql.ENUM(name='chat_role').drop(op.get_bind(), checkfirst=True)