from __future__ import annotations

import enum
import os
import uuid
from datetime import date, datetime, timezone
import bcrypt

from cryptography.fernet import Fernet
from dotenv import load_dotenv
from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    true as sa_true,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

load_dotenv(override=True)

DATABASE_URL = os.environ.get("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL not set in .env")

_FERNET_KEY = os.environ.get("CREDENTIAL_FERNET_KEY")
if not _FERNET_KEY:
    raise RuntimeError(
        "CREDENTIAL_FERNET_KEY not set in .env. Generate one with:\n"
        "  python -c \"from cryptography.fernet import Fernet; "
        "print(Fernet.generate_key().decode())\""
    )
_fernet = Fernet(_FERNET_KEY.encode() if isinstance(_FERNET_KEY, str) else _FERNET_KEY)



def encrypt_secret(plaintext: str) -> str:
    """Encrypt a secret (e.g. finto.day password) before storing it."""
    return _fernet.encrypt(plaintext.encode()).decode()


def decrypt_secret(ciphertext: str) -> str:
    """Decrypt a secret previously stored with encrypt_secret."""
    return _fernet.decrypt(ciphertext.encode()).decode()


def hash_password(plaintext: str) -> str:
    """Hash a user's password for storage in User.password_hash."""
    pw_bytes = plaintext.encode("utf-8")[:72]  # bcrypt's own hard limit — truncate rather than crash
    return bcrypt.hashpw(pw_bytes, bcrypt.gensalt()).decode("utf-8")


def verify_password(plaintext: str, hashed: str) -> bool:
    """Check a login attempt's password against the stored hash."""
    pw_bytes = plaintext.encode("utf-8")[:72]
    return bcrypt.checkpw(pw_bytes, hashed.encode("utf-8"))

# Engine / session
engine = create_async_engine(DATABASE_URL, echo=False, future=True)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)


async def get_db() -> AsyncSession:
    """FastAPI dependency: yields a session, closes it after the request."""
    async with AsyncSessionLocal() as session:
        yield session


def _uuid_col():
    return mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)


def _now() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass



# Enums


class DraftStatus(str, enum.Enum):
    PENDING_REVIEW = "pending_review"
    SCHEDULED = "scheduled"
    PUBLISHED = "published"
    PUBLISH_FAILED = "publish_failed"
    REJECTED = "rejected"
    # A member whose access on at least one requested platform is
    # NEEDS_APPROVAL tried to schedule or publish - the request (see
    # Draft.requested_* below) is parked here until a workspace admin
    # grants or denies it via POST /drafts/{id}/approval.
    PENDING_APPROVAL = "pending_approval"


class Platform(str, enum.Enum):
    FINTO = "finto"
    LINKEDIN = "linkedin"
    FACEBOOK = "facebook"
    INSTAGRAM = "instagram"
    THREADS = "threads"


class MediaKind(str, enum.Enum):
    PHOTO = "photo"
    VIDEO = "video"
    TEXT = "text"


class WorkspaceRole(str, enum.Enum):
    ADMIN = "admin"
    MEMBER = "member"


class AccessLevel(str, enum.Enum):
    FULL = "full"
    NEEDS_APPROVAL = "needs_approval"


class InboxKind(str, enum.Enum):
    COMMENT = "comment"
    MESSAGE = "message"
    # Split out from COMMENT: someone @-mentioned the account in a comment
    # or caption (Instagram "mentions" webhook field), rather than commenting
    # on the account's own post.
    MENTION = "mention"
    # Split out from COMMENT: someone tagged the account in their story.
    # Arrives via the "messaging" webhook (a story_mention attachment) even
    # though it's not a DM - see meta_webhook_receive.
    STORY_REPLY = "story_reply"


# Models

class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = _uuid_col()
    # The unique login handle - slug-style only (lowercase letters, digits,
    # underscore, no spaces). See USERNAME_RE in main.py for the enforced
    # pattern. Free-text display name lives separately in full_name below,
    # so a display name like "Bharvi Patel" never has to be mangled to fit
    # a unique-username constraint.
    username: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    # Free-text display name (spaces/capitals/anything allowed, not unique).
    # Populated from the OAuth provider's "name" field on first login, or
    # settable directly in profile settings. Nullable for older rows.
    full_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    # Nullable at the DB level because OAuth-login users may not expose an
    # email (e.g. X/Twitter). Required and validated at the /signup endpoint
    # for password-based accounts — see SignupRequest in main.py.
    email: Mapped[str | None] = mapped_column(String(255), unique=True, nullable=True)
    # True once the user has picked their own username (password signup, or
    # the onboarding prompt after OAuth). False means it's still the
    # auto-generated placeholder from OAuth signup and the frontend blocks
    # on the "choose a username" prompt until a real one is set.
    username_is_set: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=sa_true())
    password_hash: Mapped[str] = mapped_column(String(255), nullable=True)
    # Password accounts start unverified and can't log in until they click
    # the emailed link (see /verify-email in main.py). OAuth logins and the
    # bootstrapped admin are marked verified immediately - their email is
    # already confirmed by the provider (or there's no email to confirm).
    is_verified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    verification_token: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    verification_token_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # "Forgot password" flow (see /forgot-password and /reset-password in
    # main.py). Separate columns from verification_token above so an
    # in-flight signup-verification link and an in-flight password-reset
    # link can't invalidate each other. Nullable/None means no reset is
    # currently pending; cleared the moment the token is used or replaced.
    reset_token: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    reset_token_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Profile settings (bottom-left account popup in the sidebar). avatar_url
    # points at a file under MEDIA_DIR/<user_id>/ served via /media-files,
    # same convention as MediaAsset - see save_avatar in main.py. timezone is
    # an IANA name (e.g. "America/New_York"); "UTC" until the user picks one.
    avatar_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    timezone: Mapped[str] = mapped_column(String(64), nullable=False, default="UTC", server_default="UTC")
    # Which of this user's workspaces get_or_create_membership() should
    # resolve to. Nullable - null means "no explicit choice yet, fall
    # back to the oldest membership" (covers every pre-existing row and
    # anyone who has only ever belonged to one workspace). Set on the
    # /workspaces switch endpoint and again whenever a new workspace is
    # created (the creator's context follows their new workspace). Not a
    # FK-with-cascade-delete on purpose: if the active workspace is ever
    # deleted this should fall back to null/oldest, not cascade the user
    # row away - see the switch/create endpoints for the fallback logic.
    active_workspace_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("workspaces.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    # Drafts, media, ideas, todos below are attribution FKs, not scoping -
    # a Draft etc. belongs to a Workspace now (see Draft.workspace_id);
    # user_id just records who authored/uploaded/created it, and stays
    # intact even after that user's WorkspaceMember row is removed.
    drafts: Mapped[list["Draft"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    # Workspaces this user owns outright (see Workspace.owner_user_id).
    # Deliberately not cascade="delete-orphan" - deleting a user shouldn't
    # silently delete a whole workspace and everyone else's data in it;
    # ownership transfer (not yet built) is the intended path off this.
    owned_workspaces: Mapped[list["Workspace"]] = relationship(
        foreign_keys="Workspace.owner_user_id", viewonly=True
    )
    # This user's seats across every workspace they belong to (including
    # ones they own - the owner also gets a WorkspaceMember row with
    # role=ADMIN, so membership lookups don't need a special case).
    workspace_memberships: Mapped[list["WorkspaceMember"]] = relationship(
        back_populates="user", foreign_keys="WorkspaceMember.user_id", cascade="all, delete-orphan"
    )
    oauth_identities: Mapped[list["OAuthIdentity"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    media_assets: Mapped[list["MediaAsset"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    auth_sessions: Mapped[list["AuthSession"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    custom_ideas: Mapped[list["CustomIdea"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    custom_todos: Mapped[list["CustomTodo"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )


class OAuthIdentity(Base):
    __tablename__ = "oauth_identities"
    __table_args__ = (UniqueConstraint("provider", "provider_user_id", name="uq_provider_identity"),)

    id: Mapped[uuid.UUID] = _uuid_col()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    provider: Mapped[str] = mapped_column(String(32), nullable=False)  # "google" | "linkedin" | "facebook" | "x"
    provider_user_id: Mapped[str] = mapped_column(String(255), nullable=False)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    user: Mapped["User"] = relationship(back_populates="oauth_identities")
    

class Workspace(Base):
    """A self-contained tenant: owns its connected platforms, drafts,
    media, and calendar. `owner_user_id` is the workspace creator - an
    Admin who cannot be demoted except through an explicit ownership
    transfer (not yet built; the column is the seam for it). `plan` is a
    plain string ("free" / "pro" / ...) rather than an enum since billing
    tiers are expected to change independently of a schema migration.

    `owner_user_id` cascades: deleting the owner's account deletes every
    workspace they own outright (see DELETE /me in main.py), which in
    turn cascades to that workspace's WorkspaceMember rows - so any other
    member loses their seat and everything they made in it too. There's
    no ownership-transfer flow yet to avoid that, so DELETE /me warns
    about it up front instead of blocking the deletion.

    Every existing single-tenant table that used to be scoped by user_id
    directly (PlatformConnection, Draft, MediaAsset, FollowerSnapshot,
    CustomIdea, CustomTodo, InboxItem) now carries a workspace_id instead
    - see each model's own docstring for what happened to its old
    user_id column (usually demoted to an attribution field, not removed).
    """
    __tablename__ = "workspaces"

    id: Mapped[uuid.UUID] = _uuid_col()
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    owner_user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    plan: Mapped[str] = mapped_column(String(32), nullable=False, default="free", server_default="free")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    owner: Mapped["User"] = relationship(foreign_keys=[owner_user_id])
    members: Mapped[list["WorkspaceMember"]] = relationship(
        back_populates="workspace", cascade="all, delete-orphan"
    )


class WorkspaceMember(Base):
    """One row per (workspace, user) - a person's seat in a workspace.
    `role` is ADMIN or MEMBER only, no third tier (see the design notes
    this schema was built from). `default_access` is what a Member gets
    on any platform they don't have an explicit MemberPlatformAccess
    override for, and is what newly-connected platforms fall back to
    automatically - no re-approval ritual needed every time the Admin
    connects another platform. Meaningless for ADMIN rows (an Admin
    always has full access everywhere) but still populated as FULL for
    consistency rather than made nullable-only-for-members.

    Deleting this row (kicking a Member out) does NOT touch anything
    they created - Draft.user_id etc. keep pointing at their still-
    existing User row, just with no more WorkspaceMember linking them to
    this workspace. See MemberPlatformAccess for the per-platform
    override table this points at.
    """
    __tablename__ = "workspace_members"
    __table_args__ = (UniqueConstraint("workspace_id", "user_id", name="uq_workspace_user"),)

    id: Mapped[uuid.UUID] = _uuid_col()
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    role: Mapped[WorkspaceRole] = mapped_column(Enum(WorkspaceRole, name="workspace_role_enum"), nullable=False)
    default_access: Mapped[AccessLevel] = mapped_column(
        Enum(AccessLevel, name="access_level_enum"), nullable=False, default=AccessLevel.NEEDS_APPROVAL
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    workspace: Mapped["Workspace"] = relationship(back_populates="members")
    user: Mapped["User"] = relationship(back_populates="workspace_memberships", foreign_keys=[user_id])
    platform_overrides: Mapped[list["MemberPlatformAccess"]] = relationship(
        back_populates="member", cascade="all, delete-orphan"
    )


class MemberPlatformAccess(Base):
    """Sparse override table: a row exists ONLY when a Member's access to
    one specific platform diverges from their WorkspaceMember.default_access
    - no row means "just use the default". Covers both upgrades (Admin
    grants Full on one platform while the Member's default stays
    needs_approval) and downgrades (Admin revokes Full on one platform
    without touching the others). Revoking is the same write as granting,
    just in the other direction - deleting the row snaps that platform
    back to following the default again.

    Revocation is forward-only by convention, enforced in the API layer
    rather than here: a Draft already scheduled under looser access when
    this row changes is left alone and still publishes; only new
    schedule/publish actions after the change are gated by the new value.
    """
    __tablename__ = "member_platform_access"
    __table_args__ = (
        UniqueConstraint("workspace_member_id", "platform", name="uq_member_platform"),
    )

    id: Mapped[uuid.UUID] = _uuid_col()
    workspace_member_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workspace_members.id", ondelete="CASCADE")
    )
    platform: Mapped[Platform] = mapped_column(Enum(Platform, name="platform_enum"))
    access: Mapped[AccessLevel] = mapped_column(Enum(AccessLevel, name="access_level_enum"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)

    member: Mapped["WorkspaceMember"] = relationship(back_populates="platform_overrides")


class PlatformConnection(Base):
    """
    One row per (workspace, platform) - platforms are connected at the
    workspace level, not per-user, so every Member with adequate access
    can publish through the same connection. `connected_by_user_id`
    keeps a record of who actually did the OAuth/credential handoff, for
    audit purposes only; it does not gate anything and is untouched if
    that user is later removed from the workspace. `credentials` holds
    whatever that platform needs:

        finto:    {"email": "...", "password": "<fernet-encrypted>"}
        linkedin: {"access_token": "...", "refresh_token": "...", "member_id": "..."}

    Always read finto's password through decrypt_secret(), never store it
    plaintext - use encrypt_secret() before writing.
    """
    __tablename__ = "platform_connections"
    __table_args__ = (UniqueConstraint("workspace_id", "platform", name="uq_workspace_platform"),)

    id: Mapped[uuid.UUID] = _uuid_col()
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    connected_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    platform: Mapped[Platform] = mapped_column(Enum(Platform, name="platform_enum"))
    credentials: Mapped[dict] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now
    )

    workspace: Mapped["Workspace"] = relationship()
    connected_by: Mapped["User | None"] = relationship(foreign_keys=[connected_by_user_id])


class Draft(Base):
    """workspace_id scopes the draft (which workspace it belongs to,
    what /generate and /review filter by); user_id is now just the
    author - kept for attribution even after that user's WorkspaceMember
    row is removed, per the "removal revokes login, not content" rule.
    """
    __tablename__ = "drafts"

    id: Mapped[uuid.UUID] = _uuid_col()
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    category: Mapped[str] = mapped_column(String(64), nullable=False)
    subtopic: Mapped[str] = mapped_column(String(255), nullable=False)
    word_count: Mapped[int] = mapped_column(Integer, nullable=False)
    content: Mapped[dict] = mapped_column(JSON, nullable=False)  # the draft JSON itself
    messages: Mapped[list] = mapped_column(JSON, nullable=False)  # LLM conversation history
    status: Mapped[DraftStatus] = mapped_column(
        Enum(DraftStatus, name="draft_status_enum"), default=DraftStatus.PENDING_REVIEW
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now
    )

    # Scheduling — set when a draft is queued for future auto-publish
    # (status becomes SCHEDULED). All three are cleared back to None/False
    # the moment the scheduler actually publishes it (success or failure),
    # so "has a scheduled_at" is equivalent to "currently on the calendar".
    scheduled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    scheduled_platforms: Mapped[list | None] = mapped_column(JSON, nullable=True)  # list[str] of Platform values
    scheduled_live: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # Set once, the first time a draft is scheduled, and never cleared
    # afterwards (unlike scheduled_at/scheduled_platforms/scheduled_live,
    # which reset on publish or unschedule). This is what distinguishes
    # "was ever scheduled, now published" from "published immediately,
    # never scheduled" once scheduled_at has been wiped.
    was_scheduled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # True only once the user explicitly clicks "Save as draft" on the
    # review screen. Every draft is persisted at PENDING_REVIEW the
    # instant it's generated (so /review's reject-and-revise has
    # something to work against even if the user never touches the
    # review screen again) - but that means "status == PENDING_REVIEW"
    # alone can't be used to decide what belongs in the Publish page's
    # Drafts tab, or every freshly-generated draft the user hasn't acted
    # on yet (or ever will) would show up there. This flag is what the
    # Drafts tab actually filters on; see GET /drafts in main.py.
    saved_as_draft: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # Guards the "remind me 15 minutes before a scheduled post goes live"
    # notification against firing on every scheduler poll cycle between
    # T-15min and T-0 - set True the moment the reminder is sent, reset to
    # False whenever the draft is (re)scheduled to a new time.
    reminder_sent: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # What a NEEDS_APPROVAL member actually asked for, held here while
    # status == PENDING_APPROVAL. requested_scheduled_at set means they
    # asked to schedule; None means they asked to publish immediately.
    # Cleared (all three back to None/False) the moment an admin grants
    # or denies the request via POST /drafts/{id}/approval - see
    # _platforms_needing_approval and that endpoint in main.py.
    requested_scheduled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    requested_platforms: Mapped[list | None] = mapped_column(JSON, nullable=True)  # list[str] of Platform values
    requested_live: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    workspace: Mapped["Workspace"] = relationship()
    user: Mapped["User"] = relationship(back_populates="drafts")
    publish_results: Mapped[list["PublishResult"]] = relationship(
        back_populates="draft", cascade="all, delete-orphan"
    )


class PublishResult(Base):
    __tablename__ = "publish_results"

    id: Mapped[uuid.UUID] = _uuid_col()
    draft_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("drafts.id", ondelete="CASCADE"))
    platform: Mapped[Platform] = mapped_column(Enum(Platform, name="platform_enum"))
    success: Mapped[bool] = mapped_column(Boolean, nullable=False)
    detail: Mapped[str | None] = mapped_column(Text, nullable=True)  # URL on success, error on failure
    published_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    draft: Mapped["Draft"] = relationship(back_populates="publish_results")
    engagement: Mapped["PostEngagement | None"] = relationship(
        back_populates="publish_result", cascade="all, delete-orphan", uselist=False
    )


class FollowerSnapshot(Base):
    """One row per (user, platform, day) — the only way to chart follower
    growth over time, since every platform's API only ever exposes a
    current count, not history. Written by POST /analytics/refresh (see
    main.py) — there's no background scheduler for this yet, so growth
    only has data points for days the Analytics page was actually opened
    (and refreshed) on."""
    __tablename__ = "follower_snapshots"
    __table_args__ = (UniqueConstraint("workspace_id", "platform", "captured_on", name="uq_workspace_platform_day"),)

    id: Mapped[uuid.UUID] = _uuid_col()
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    platform: Mapped[Platform] = mapped_column(Enum(Platform, name="platform_enum"))
    follower_count: Mapped[int] = mapped_column(Integer, nullable=False)
    captured_on: Mapped[date] = mapped_column(Date, nullable=False)
    captured_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class PostEngagement(Base):
    """Cached like/comment (and, where the platform's API and our OAuth
    scope allow it, reach/views) counts for one published post, keyed to
    the PublishResult that created it (its `detail` JSON holds the
    platform's post_id on success — see approve_and_publish/publish_dispatch).
    Refreshed on-demand by POST /analytics/refresh rather than live on
    every /analytics/summary call, since that would mean one platform API
    round-trip per post on every page load.

    reach/views are nullable, not defaulted to 0 like likes/comments -
    None means "not available for this post" (LinkedIn never has it;
    Facebook/Instagram only have it once the workspace reconnects with
    the insights scope), which the frontend needs to tell apart from a
    genuine zero.
    """
    __tablename__ = "post_engagements"

    id: Mapped[uuid.UUID] = _uuid_col()
    publish_result_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("publish_results.id", ondelete="CASCADE"), unique=True
    )
    likes_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    comments_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    reach: Mapped[int | None] = mapped_column(Integer, nullable=True)
    views: Mapped[int | None] = mapped_column(Integer, nullable=True)
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)

    publish_result: Mapped["PublishResult"] = relationship(back_populates="engagement")


class MediaAsset(Base):
    """A user's permanent media library - backs the Publish page's "Media"
    tab. Photos/videos are saved to disk under MEDIA_DIR/<user_id>/ (see
    main.py) and stay there indefinitely until the user deletes them or
    their account is removed; `file_path` is relative to MEDIA_DIR and
    `file_url` (built in main.py) is what the frontend actually renders/
    sends to the composer. Text assets have no file - just `text_content`.
    """
    __tablename__ = "media_assets"

    id: Mapped[uuid.UUID] = _uuid_col()
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    kind: Mapped[MediaKind] = mapped_column(Enum(MediaKind, name="media_kind_enum"), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    content_type: Mapped[str | None] = mapped_column(String(128), nullable=True)
    file_path: Mapped[str | None] = mapped_column(String(512), nullable=True)
    file_size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    text_content: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    workspace: Mapped["Workspace"] = relationship()
    user: Mapped["User"] = relationship(back_populates="media_assets")


class AuthSession(Base):
    """A logged-in session, keyed by the bearer token handed to the
    frontend. Previously these lived only in an in-memory dict on the
    FastAPI process (AUTH_TOKENS in main.py), so every deploy or restart
    silently logged out every user - the token their browser still held
    just stopped existing anywhere. Persisting sessions here means a
    restart no longer invalidates anyone's login; only an actual expiry
    (or a future /logout deleting the row) does.
    """
    __tablename__ = "auth_sessions"

    id: Mapped[uuid.UUID] = _uuid_col()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    token: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    user: Mapped["User"] = relationship(back_populates="auth_sessions")


class InboxItem(Base):
    """One comment or DM from a Meta webhook event (Instagram + Facebook
    Page). `workspace_id` is resolved in the webhook handler by matching
    the payload's page/ig_user id against PlatformConnection.credentials
    (page_id / ig_page_id) - there's no FK to PlatformConnection itself
    since one workspace can have both a Facebook and Instagram connection
    and a single webhook entry belongs to whichever one the event was for.
    `thread_id` groups a DM conversation (Meta's conversation id) or a
    post's comment thread (the media/post id) so the frontend can list
    conversations before expanding individual items. `raw_payload` is
    kept as a debugging/replay escape hatch - the frontend should read
    the normalized columns, not this.
    """
    __tablename__ = "inbox_items"
    __table_args__ = (UniqueConstraint("platform", "external_id", name="uq_platform_external_id"),)

    id: Mapped[uuid.UUID] = _uuid_col()
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    platform: Mapped[Platform] = mapped_column(Enum(Platform, name="platform_enum"))
    kind: Mapped[InboxKind] = mapped_column(Enum(InboxKind, name="inbox_kind_enum"), nullable=False)
    # Meta's id for this comment/message - the uniqueness guard above
    # relies on this to make webhook redelivery a no-op instead of a dupe.
    external_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    thread_id: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    sender_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    sender_external_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    body: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_read: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # True for a reply the business sent back through T01 (see
    # /inbox/{id}/reply); False (the default) for everything received via
    # webhook. Lets the thread view show a real back-and-forth conversation
    # instead of only ever showing what came in.
    is_outbound: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # Soft-delete: set by DELETE /inbox/{id} instead of removing the row,
    # so a webhook redelivery of the same external_id (see the
    # UniqueConstraint above) can't resurrect something the user
    # deliberately deleted from their inbox.
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    raw_payload: Mapped[dict] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    workspace: Mapped["Workspace"] = relationship()


class NotificationPreference(Base):
    """One row per user, created lazily (see get_or_create_notification_prefs
    in notifications.py) the first time preferences are read or written.
    Each column gates one notification kind - see notifications.py's
    PREFERENCE_FIELD map for how a `kind` string resolves to a column here.
    weekly_digest_last_sent guards the digest job against re-sending on every
    scheduler poll within the same Monday - it's date-only, not datetime.
    """
    __tablename__ = "notification_preferences"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    before_publish: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    needs_approval: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    publish_failed: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    weekly_digest: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    weekly_digest_last_sent: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)

    user: Mapped["User"] = relationship()


class Notification(Base):
    """One in-app inbox item for a single user. Populated by notify_user()
    alongside the existing push+email send, so every existing call site
    (draft-ready, publish-failed, approval-granted, weekly digest) starts
    filling this automatically with no changes to those call sites. `kind`
    reuses the same strings as NotificationPreference/PREFERENCE_FIELD.
    `url` is where clicking the notification should take the user, if
    anywhere. This is user-scoped (not workspace-scoped like InboxItem) -
    notifications are about things that happened to *you*, not shared
    workspace activity."""
    __tablename__ = "notifications"

    id: Mapped[uuid.UUID] = _uuid_col()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(64), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    url: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_read: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, index=True)

    user: Mapped["User"] = relationship()


class PushSubscription(Base):
    """A single browser/device's Web Push subscription (one user can have
    several - e.g. phone + laptop). `endpoint` is the push service URL the
    browser gave us and is globally unique per registration; p256dh/auth are
    the subscription's encryption keys, both required by pywebpush. Rows are
    deleted automatically by notifications.py when the push service reports
    the subscription as gone (HTTP 404/410), which happens whenever the user
    revokes notification permission or uninstalls/clears the site."""
    __tablename__ = "push_subscriptions"

    id: Mapped[uuid.UUID] = _uuid_col()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    endpoint: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    p256dh: Mapped[str] = mapped_column(String(255), nullable=False)
    auth: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    user: Mapped["User"] = relationship()


class CustomIdea(Base):
    """A user's own post idea, entered from the Dashboard's Ideas "+ New"
    button rather than pulled from Calendarific. Shares the same
    {name, date, description} shape as the festival ideas so the frontend
    can render both kinds with IdeaCard, merged and sorted by date in
    /dashboard/ideas. date/description are legacy-optional - the "+ New"
    form only collects a name and optional media attachments now."""
    __tablename__ = "custom_ideas"

    id: Mapped[uuid.UUID] = _uuid_col()
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    date: Mapped[str | None] = mapped_column(String(10), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    workspace: Mapped["Workspace"] = relationship()
    user: Mapped["User"] = relationship(back_populates="custom_ideas")
    attachments: Mapped[list["IdeaAttachment"]] = relationship(
        back_populates="idea", cascade="all, delete-orphan"
    )


class IdeaAttachment(Base):
    """A photo or video attached to a CustomIdea, uploaded from the
    Dashboard's "+ New" idea modal. Stored on disk the same way as the
    Publish page's per-user MediaAsset library (MEDIA_DIR/<user_id>/), but
    scoped to a single idea rather than the shared library - an idea's
    reference images aren't meant to double as reusable Media tab assets."""
    __tablename__ = "idea_attachments"

    id: Mapped[uuid.UUID] = _uuid_col()
    idea_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("custom_ideas.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    content_type: Mapped[str | None] = mapped_column(String(128), nullable=True)
    file_path: Mapped[str] = mapped_column(String(512), nullable=False)
    file_size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    idea: Mapped["CustomIdea"] = relationship(back_populates="attachments")


class CustomTodo(Base):
    """A Dashboard "To Do" item. The three starter tasks (post today, plan
    ahead, connect an account) used to be a hardcoded frontend list; they're
    now seeded into this table the first time a user's todos are fetched
    (see get_dashboard_todos), so they're regular rows the user can edit or
    delete just like anything they add themselves via the "+ New" button.
    nav is the dashboard tab (e.g. "generate", "calendar", "settings") to
    jump to on click when the item isn't being edited - None for anything
    the user added themselves, since those have nowhere built-in to go."""
    __tablename__ = "custom_todos"

    id: Mapped[uuid.UUID] = _uuid_col()
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    body: Mapped[str | None] = mapped_column(Text, nullable=True)
    accent: Mapped[str | None] = mapped_column(String(16), nullable=True)
    nav: Mapped[str | None] = mapped_column(String(32), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    workspace: Mapped["Workspace"] = relationship()
    user: Mapped["User"] = relationship(back_populates="custom_todos")


# Init helper (dev convenience - use Alembic migrations once schema stabilizes)

async def init_db() -> None:
    """Create all tables if they don't exist yet. Fine for dev; swap for
    Alembic migrations before this touches a real production database."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


if __name__ == "__main__":
    import asyncio

    asyncio.run(init_db())
    print("Tables created.")