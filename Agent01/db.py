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
    PUBLISHED = "published"
    PUBLISH_FAILED = "publish_failed"
    REJECTED = "rejected"


class Platform(str, enum.Enum):
    FINTO = "finto"
    LINKEDIN = "linkedin"
    FACEBOOK = "facebook"
    INSTAGRAM = "instagram"
    THREADS = "threads"


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
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    platform_connections: Mapped[list["PlatformConnection"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    drafts: Mapped[list["Draft"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    oauth_identities: Mapped[list["OAuthIdentity"]] = relationship(back_populates="user", cascade="all, delete-orphan")


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