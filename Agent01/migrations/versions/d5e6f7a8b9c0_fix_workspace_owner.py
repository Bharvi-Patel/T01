"""fix workspaces.owner_user_id FK to CASCADE (was RESTRICT)

The workspaces table was originally created with
owner_user_id -> users.id ON DELETE RESTRICT (see
a1b2c3d4e5f6_add_workspace_scoping). db.py's Workspace model was later
updated to declare ondelete="CASCADE" instead, but no migration ever
altered the live constraint to match - so DELETE /me still fails with
asyncpg.exceptions.RestrictViolationError whenever the account being
deleted owns a workspace. This migration brings the actual database
constraint in line with the model.

Revision ID: d5e6f7a8b9c0
Revises: c7d8e9f0a1b2
Create Date: 2026-08-26
"""
from alembic import op


# revision identifiers, used by Alembic.
revision = 'd5e6f7a8b9c0'
down_revision = 'c7d8e9f0a1b2'
branch_labels = None
depends_on = None


def upgrade():
    op.drop_constraint(
        "workspaces_owner_user_id_fkey", "workspaces", type_="foreignkey"
    )
    op.create_foreign_key(
        "workspaces_owner_user_id_fkey",
        "workspaces", "users",
        ["owner_user_id"], ["id"],
        ondelete="CASCADE",
    )


def downgrade():
    op.drop_constraint(
        "workspaces_owner_user_id_fkey", "workspaces", type_="foreignkey"
    )
    op.create_foreign_key(
        "workspaces_owner_user_id_fkey",
        "workspaces", "users",
        ["owner_user_id"], ["id"],
        ondelete="RESTRICT",
    )