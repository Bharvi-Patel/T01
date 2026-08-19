"""fix SCHEDULED enum case mismatch

The initial schema created draft_status_enum with uppercase labels
(PENDING_REVIEW, PUBLISHED, PUBLISH_FAILED, REJECTED) — SQLAlchemy's
default is to bind a Python Enum member by its .name, not its .value.
The scheduling migration (42cd6ffaf2d4) added 'scheduled' in lowercase
instead of matching that convention, so every query/write comparing
Draft.status to DraftStatus.SCHEDULED sends 'SCHEDULED' and Postgres
rejects it — breaking both the schedule endpoint and the auto-publish
poller. This adds the correctly-cased label. Postgres can't drop enum
values, so the orphaned lowercase 'scheduled' stays but is never
written to again.

Revision ID: c1c875d2cf6b
Revises: 42cd6ffaf2d4
Create Date: 2026-08-19 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'c1c875d2cf6b'
down_revision: Union[str, Sequence[str], None] = '42cd6ffaf2d4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE draft_status_enum ADD VALUE IF NOT EXISTS 'SCHEDULED'")

    # Any row that got stuck with the unusable lowercase value (e.g. a
    # schedule attempt that partially wrote before failing) gets normalized.
    op.execute("UPDATE drafts SET status = 'SCHEDULED' WHERE status = 'scheduled'")


def downgrade() -> None:
    """Downgrade schema."""
    # Postgres doesn't support removing an enum value, so 'SCHEDULED' stays
    # a valid draft_status_enum member even after downgrade. Rows written
    # with it since the upgrade would need manual handling if you actually
    # roll back this far.
    pass