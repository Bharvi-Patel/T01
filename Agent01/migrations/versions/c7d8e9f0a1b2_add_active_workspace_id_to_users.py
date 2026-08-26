"""add active_workspace_id to users

Supports multi-workspace switching (see TopBar's "Create a new
workspace" / workspace switcher). Nullable FK to workspaces.id -
null means "no explicit choice made yet", in which case
get_or_create_membership() keeps falling back to the caller's oldest
membership exactly as before. ondelete=SET NULL so deleting a
workspace never cascades into deleting the user, it just clears their
pointer back to null/oldest.

Revision ID: c7d8e9f0a1b2
Revises: b3c4d5e6f7a8
Create Date: 2026-08-26 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'c7d8e9f0a1b2'
down_revision: Union[str, Sequence[str], None] = 'b3c4d5e6f7a8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _existing_columns(table):
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    cols = _existing_columns("users")
    if "active_workspace_id" not in cols:
        op.add_column("users", sa.Column("active_workspace_id", sa.UUID(), nullable=True))
        op.create_foreign_key(
            "fk_users_active_workspace_id_workspaces",
            "users", "workspaces",
            ["active_workspace_id"], ["id"],
            ondelete="SET NULL",
        )


def downgrade() -> None:
    cols = _existing_columns("users")
    if "active_workspace_id" in cols:
        op.drop_constraint("fk_users_active_workspace_id_workspaces", "users", type_="foreignkey")
        op.drop_column("users", "active_workspace_id")