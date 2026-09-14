"""widen inbox_items.external_id to Text

inbox_items.external_id was VARCHAR(128), sized around Facebook Messenger's
short "mid" values. Instagram's real DM message ids are long opaque
base64-ish tokens that comfortably exceed 128 characters - short enough
synthetic ids in test_webhook_delivery.py and Facebook's own mids never
hit the limit, so this went unnoticed until real Instagram DMs started
arriving in Development Mode and every single one failed at insert time
with "value too long for type character varying(128)", aborting that
webhook request with a 500 before it ever reached the Inbox.

Widened to Text (no length cap in Postgres, indexes the same way varchar
does) rather than a larger fixed VARCHAR, since there's no guaranteed
upper bound on how long a platform's opaque id gets in the future.

Revision ID: 5e6e24fc72c7
Revises: 8f2c4a6d9e1b
Create Date: 2026-09-14 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '5e6e24fc72c7'
down_revision: Union[str, Sequence[str], None] = '8f2c4a6d9e1b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.alter_column(
        'inbox_items', 'external_id',
        existing_type=sa.String(length=128),
        type_=sa.Text(),
        existing_nullable=False,
    )


def downgrade() -> None:
    """Downgrade schema."""
    # Truncates any external_id longer than 128 chars back down - real
    # Instagram mids recorded while this migration was applied would be
    # corrupted (no longer matching Meta's actual id) by a downgrade.
    op.alter_column(
        'inbox_items', 'external_id',
        existing_type=sa.Text(),
        type_=sa.String(length=128),
        existing_nullable=False,
    )