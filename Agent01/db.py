from __future__ import annotations

import enum
import os
import uuid
from datetime import datetime, timezone
import bcrypt

from cryptography.fernet import Fernet
from dotenv import load_dotenv
from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
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
    username: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    # Nullable at the DB level because OAuth-login users may not expose an
    # email (e.g. X/Twitter). Required and validated at the /signup endpoint
    # for password-based accounts — see SignupRequest in main.py.
    email: Mapped[str | None] = mapped_column(String(255), unique=True, nullable=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=True)
    # Password accounts start unverified and can't log in until they click
    # the emailed link (see /verify-email in main.py). OAuth logins and the
    # bootstrapped admin are marked verified immediately - their email is
    # already confirmed by the provider (or there's no email to confirm).
    is_verified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    verification_token: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    verification_token_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Profile settings (bottom-left account popup in the sidebar). avatar_url
    # points at a file under MEDIA_DIR/<user_id>/ served via /media-files,
    # same convention as MediaAsset - see save_avatar in main.py. timezone is
    # an IANA name (e.g. "America/New_York"); "UTC" until the user picks one.
    avatar_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    timezone: Mapped[str] = mapped_column(String(64), nullable=False, default="UTC", server_default="UTC")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    platform_connections: Mapped[list["PlatformConnection"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    drafts: Mapped[list["Draft"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
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
    

class PlatformConnection(Base):
    """
    One row per (user, platform). `credentials` holds whatever that
    platform needs:

        finto:    {"email": "...", "password": "<fernet-encrypted>"}
        linkedin: {"access_token": "...", "refresh_token": "...", "member_id": "..."}

    Always read finto's password through decrypt_secret(), never store it
    plaintext - use encrypt_secret() before writing.
    """
    __tablename__ = "platform_connections"
    __table_args__ = (UniqueConstraint("user_id", "platform", name="uq_user_platform"),)

    id: Mapped[uuid.UUID] = _uuid_col()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    platform: Mapped[Platform] = mapped_column(Enum(Platform, name="platform_enum"))
    credentials: Mapped[dict] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now
    )

    user: Mapped["User"] = relationship(back_populates="platform_connections")


class Draft(Base):
    __tablename__ = "drafts"

    id: Mapped[uuid.UUID] = _uuid_col()
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

    # Guards the "remind me 15 minutes before a scheduled post goes live"
    # notification against firing on every scheduler poll cycle between
    # T-15min and T-0 - set True the moment the reminder is sent, reset to
    # False whenever the draft is (re)scheduled to a new time.
    reminder_sent: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

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
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    kind: Mapped[MediaKind] = mapped_column(Enum(MediaKind, name="media_kind_enum"), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    content_type: Mapped[str | None] = mapped_column(String(128), nullable=True)
    file_path: Mapped[str | None] = mapped_column(String(512), nullable=True)
    file_size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    text_content: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

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
    Page). `user_id` is resolved in the webhook handler by matching the
    payload's page/ig_user id against PlatformConnection.credentials
    (page_id / ig_page_id) - there's no FK to PlatformConnection itself
    since one user can have both a Facebook and Instagram connection and
    a single webhook entry belongs to whichever one the event was for.
    `thread_id` groups a DM conversation (Meta's conversation id) or a
    post's comment thread (the media/post id) so the frontend can list
    conversations before expanding individual items. `raw_payload` is
    kept as a debugging/replay escape hatch - the frontend should read
    the normalized columns, not this.
    """
    __tablename__ = "inbox_items"
    __table_args__ = (UniqueConstraint("platform", "external_id", name="uq_platform_external_id"),)

    id: Mapped[uuid.UUID] = _uuid_col()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
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
    raw_payload: Mapped[dict] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    user: Mapped["User"] = relationship()


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
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    date: Mapped[str | None] = mapped_column(String(10), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

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