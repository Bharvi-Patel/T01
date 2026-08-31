"""add workspace scoping (workspaces, workspace_members, member_platform_access,
workspace_id on drafts/platform_connections/follower_snapshots/media_assets/
custom_ideas/custom_todos/inbox_items)

db.py's models moved to workspace-level scoping, but no migration ever shipped
for it - init_db()'s create_all() only creates missing tables, it never adds
columns to ones that already existed, so drafts.workspace_id (etc.) was
silently never added and the scheduler poll started failing with
UndefinedColumnError. This migration is idempotent (checks before creating/
adding) since create_all may have already created the brand-new tables
(workspaces, workspace_members, member_platform_access) on some deployments.

Backfill strategy: every user with any pre-existing rows gets a personal
workspace (mirrors get_or_create_membership's lazy-creation naming - "<name>'s
Workspace") with themselves as ADMIN, and all their existing rows are pointed
at it. inbox_items had no user_id (webhook-sourced, not user-owned) so it's
backfilled by matching platform -> whichever workspace already has a
platform_connections row for that platform (best-effort; fine for the
single-tenant era this data predates).

Revision ID: a1b2c3d4e5f6
Revises: d1e2f3a4b5c6
Create Date: 2026-08-26 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, Sequence[str], None] = 'd1e2f3a4b5c6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _existing_tables():
    return set(sa.inspect(op.get_bind()).get_table_names())


def _existing_columns(table):
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def _existing_constraint_names(table):
    insp = sa.inspect(op.get_bind())
    names = {c["name"] for c in insp.get_unique_constraints(table)}
    names |= {c["name"] for c in insp.get_indexes(table) if c.get("unique")}
    return names


def upgrade() -> None:
    bind = op.get_bind()
    tables = _existing_tables()

    # SQLAlchemy's Enum(SomePyEnum) binds each member by its .name (e.g.
    # "ADMIN"), not its .value ("admin") - see c1c875d2cf6b's docstring for
    # where this project already got bitten by that once before.
    workspace_role_enum = postgresql.ENUM("ADMIN", "MEMBER", name="workspace_role_enum", create_type=False)
    access_level_enum = postgresql.ENUM("FULL", "NEEDS_APPROVAL", name="access_level_enum", create_type=False)
    workspace_role_enum.create(bind, checkfirst=True)
    access_level_enum.create(bind, checkfirst=True)
    platform_enum = postgresql.ENUM(name="platform_enum", create_type=False)

    # --- new tables (no-ops if create_all already made them) ---
    if "workspaces" not in tables:
        op.create_table(
            "workspaces",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column("name", sa.String(length=120), nullable=False),
            sa.Column("owner_user_id", postgresql.UUID(as_uuid=True),
                      sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
            sa.Column("plan", sa.String(length=32), nullable=False, server_default="free"),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        )

    if "workspace_members" not in tables:
        op.create_table(
            "workspace_members",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column("workspace_id", postgresql.UUID(as_uuid=True),
                      sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False),
            sa.Column("user_id", postgresql.UUID(as_uuid=True),
                      sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("role", workspace_role_enum, nullable=False),
            sa.Column("default_access", access_level_enum, nullable=False,
                      server_default="NEEDS_APPROVAL"),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.UniqueConstraint("workspace_id", "user_id", name="uq_workspace_user"),
        )

    if "member_platform_access" not in tables:
        op.create_table(
            "member_platform_access",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column("workspace_member_id", postgresql.UUID(as_uuid=True),
                      sa.ForeignKey("workspace_members.id", ondelete="CASCADE"), nullable=False),
            sa.Column("platform", platform_enum, nullable=False),
            sa.Column("access", access_level_enum, nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.UniqueConstraint("workspace_member_id", "platform", name="uq_member_platform"),
        )

    # --- add workspace_id (nullable for now - backfilled below) ---
    for table in ("drafts", "platform_connections", "follower_snapshots",
                  "media_assets", "custom_ideas", "custom_todos", "inbox_items"):
        if table in tables and "workspace_id" not in _existing_columns(table):
            op.add_column(
                table,
                sa.Column("workspace_id", postgresql.UUID(as_uuid=True),
                          sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=True),
            )

    # platform_connections also needs connected_by_user_id (new, nullable, audit-only)
    if "platform_connections" in tables and "connected_by_user_id" not in _existing_columns("platform_connections"):
        op.add_column(
            "platform_connections",
            sa.Column("connected_by_user_id", postgresql.UUID(as_uuid=True),
                      sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        )

    # --- backfill: one personal workspace per user who has pre-existing rows ---
    conn = bind
    user_owned_tables = ["drafts", "platform_connections", "follower_snapshots",
                          "media_assets", "custom_ideas", "custom_todos"]
    for table in user_owned_tables:
        if table not in tables:
            continue
        user_ids = conn.execute(sa.text(
            f"SELECT DISTINCT user_id FROM {table} WHERE user_id IS NOT NULL"
        )).scalars().all()
        for user_id in user_ids:
            row = conn.execute(sa.text(
                "SELECT wm.workspace_id FROM workspace_members wm WHERE wm.user_id = :uid LIMIT 1"
            ), {"uid": user_id}).first()
            if row is not None:
                workspace_id = row[0]
            else:
                user_row = conn.execute(sa.text(
                    "SELECT full_name, username FROM users WHERE id = :uid"
                ), {"uid": user_id}).first()
                display = (user_row[0] or user_row[1] or "My") if user_row else "My"
                workspace_id = conn.execute(sa.text(
                    "INSERT INTO workspaces (id, name, owner_user_id, plan, created_at) "
                    "VALUES (gen_random_uuid(), :name, :uid, 'free', now()) RETURNING id"
                ), {"name": f"{display}'s Workspace", "uid": user_id}).scalar_one()
                conn.execute(sa.text(
                    "INSERT INTO workspace_members "
                    "(id, workspace_id, user_id, role, default_access, created_at) "
                    "VALUES (gen_random_uuid(), :wid, :uid, 'ADMIN', 'FULL', now())"
                ), {"wid": workspace_id, "uid": user_id})
            conn.execute(sa.text(
                f"UPDATE {table} SET workspace_id = :wid WHERE user_id = :uid AND workspace_id IS NULL"
            ), {"wid": workspace_id, "uid": user_id})

    # inbox_items has no user_id - best-effort match by platform against
    # whichever workspace already has a connection for that platform.
    if "inbox_items" in tables:
        conn.execute(sa.text("""
            UPDATE inbox_items ii
            SET workspace_id = pc.workspace_id
            FROM platform_connections pc
            WHERE ii.workspace_id IS NULL AND ii.platform = pc.platform
        """))

    # --- swap old user-scoped uniqueness for workspace-scoped, drop old user_id ---
    if "platform_connections" in tables:
        for name in _existing_constraint_names("platform_connections"):
            if "user_platform" in name and "workspace" not in name:
                op.drop_constraint(name, "platform_connections", type_="unique")
        op.create_unique_constraint(
            "uq_workspace_platform", "platform_connections", ["workspace_id", "platform"]
        )
        if "user_id" in _existing_columns("platform_connections"):
            op.drop_column("platform_connections", "user_id")

    if "follower_snapshots" in tables:
        for name in _existing_constraint_names("follower_snapshots"):
            if "user_platform_day" in name and "workspace" not in name:
                op.drop_constraint(name, "follower_snapshots", type_="unique")
        op.create_unique_constraint(
            "uq_workspace_platform_day", "follower_snapshots", ["workspace_id", "platform", "captured_on"]
        )
        if "user_id" in _existing_columns("follower_snapshots"):
            op.drop_column("follower_snapshots", "user_id")

    # --- finally make workspace_id required now that every row has one ---
    for table in ("drafts", "platform_connections", "follower_snapshots",
                  "media_assets", "custom_ideas", "custom_todos", "inbox_items"):
        if table in tables:
            op.alter_column(table, "workspace_id", nullable=False)


def downgrade() -> None:
    """Not supported - this migration backfills/deletes data (old user_id
    columns on platform_connections/follower_snapshots) that can't be
    reconstructed. Restore from a pre-migration backup instead."""
    raise NotImplementedError("Downgrade not supported for a1b2c3d4e5f6 - restore from backup")