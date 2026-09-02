"""add saved_as_draft to drafts

The Draft model (db.py) has a saved_as_draft column - True only once the
user explicitly clicks "Save as draft" on the review screen, distinct
from status == PENDING_REVIEW, which every draft has from the moment it's
generated regardless of whether the user ever touches it again. The
Publish page's Drafts tab filters on this flag (see GET /drafts in
main.py) so it only shows drafts the user actually chose to save, not
every freshly-generated draft sitting untouched.

Revision ID: f4a8c2e6b9d3
Revises: dc2b7a4e9f31
Create Date: 2026-09-02 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f4a8c2e6b9d3'
down_revision: Union[str, Sequence[str], None] = 'dc2b7a4e9f31'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        'drafts',
        sa.Column('saved_as_draft', sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('drafts', 'saved_as_draft')