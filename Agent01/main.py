import asyncio
import hashlib
import hmac
import json
import logging
import os
import requests
import secrets
import sys
import traceback
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from dotenv import load_dotenv

# Must run before importing auth_oauth / oauth_platforms — both read their
# client IDs and secrets from os.environ at MODULE IMPORT TIME. If .env
# hasn't been loaded yet, every provider silently locks in None for its
# client_id, which is why OAuth login/connect fails identically across
# every platform with "invalid_client" rather than just one misconfigured
# provider.
load_dotenv(override=True)

from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sqlalchemy import func, or_, select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool
from auth_oauth import LOGIN_PROVIDERS, x_start, x_finish
from emailer import send_verification_email

import time
from fastapi.responses import RedirectResponse
from oauth_platforms import (
    META_APP_SECRET, OAUTH_PROVIDERS, facebook_exchange, instagram_exchange,
    facebook_credentials_from_page, instagram_credentials_from_page, list_pages,
    instagram_fetch_media, facebook_fetch_posts, threads_fetch_posts,
)

PENDING_PAGE_SELECTIONS: dict[str, dict] = {} # pending_id -> {"user_id","platform","pages","expires_at"}

FRONTEND_BASE_URL = os.environ.get("FRONTEND_BASE_URL", "http://localhost:5173")
BACKEND_BASE_URL = os.environ.get("BACKEND_BASE_URL", "http://localhost:8000")
OAUTH_STATES: dict[str, dict] = {} 

# Local disk storage for user-uploaded video. Images from manual drafts go
# through the same imgbb hosting the AI path already uses (Instagram etc.
# need a public URL regardless of who supplied the image) - but imgbb only
# accepts images, so video is served directly off this backend instead, at
# BACKEND_BASE_URL/media/<file>. That URL is what publish_dispatch hands to
# each platform adapter (LinkedIn, Facebook, Instagram, Threads) to publish
# the video - it needs to be a real public URL, not localhost, in production.
MEDIA_DIR = Path(__file__).resolve().parent / "media"
MEDIA_DIR.mkdir(exist_ok=True)
EMAIL_VERIFICATION_TOKEN_TTL_HOURS = int(os.environ.get("EMAIL_VERIFICATION_TOKEN_TTL_HOURS", "24"))

# Per-user media library (Publish page's "Media" tab). Each user's uploads
# live under MEDIA_DIR/<user_id>/ so one person's files never collide with
# another's and a whole account's media can be wiped by deleting one
# directory. Served publicly through the same /media static mount as the
# manual-draft video above.
MEDIA_LIBRARY_MAX_BYTES = 50 * 1024 * 1024  # 50 MB per file


def user_media_dir(user_id: uuid.UUID) -> Path:
    d = MEDIA_DIR / str(user_id)
    d.mkdir(parents=True, exist_ok=True)
    return d


def media_asset_url(asset: "MediaAsset") -> str | None:
    if not asset.file_path:
        return None
    return f"{BACKEND_BASE_URL}/media-files/{asset.file_path}"


def serialize_media_asset(asset: "MediaAsset") -> dict:
    return {
        "id": str(asset.id),
        "kind": asset.kind.value,
        "name": asset.name,
        "content_type": asset.content_type,
        "url": media_asset_url(asset),
        "text_content": asset.text_content,
        "file_size": asset.file_size,
        "created_at": asset.created_at.isoformat(),
    }


sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "Agent01"))

from Agent import agent01, revise_draft, approve_and_publish, clean_json_string, VALID_CATEGORIES, upload_to_imgbb, IMGBB_API_KEY, suggest_hashtags

from db import (
    AsyncSessionLocal,
    AuthSession,
    CustomIdea,
    Draft,
    DraftStatus,
    IdeaAttachment,
    InboxItem,
    InboxKind,
    MediaAsset,
    MediaKind,
    NotificationPreference,
    OAuthIdentity,
    Platform,
    PlatformConnection,
    PushSubscription,
    PublishResult,
    User,
    decrypt_secret,
    encrypt_secret,
    hash_password,
    verify_password,
    get_db,
    init_db,
)
from notifications import (
    VAPID_PUBLIC_KEY,
    get_or_create_notification_prefs,
    maybe_send_weekly_digests,
    notify_user,
)

# Which credential fields must be Fernet-encrypted before hitting the DB,
# per platform. Mirrors the plaintext/secret split used by the manual
# /connect/{platform} endpoints below (e.g. finto's "email" stays plaintext,
# "password" gets encrypted).
SECRET_CREDENTIAL_FIELDS: dict[Platform, list[str]] = {
    Platform.FINTO: ["password"],
    Platform.LINKEDIN: ["access_token"],
    Platform.FACEBOOK: ["page_access_token"],
    Platform.INSTAGRAM: ["page_access_token"],
    Platform.THREADS: ["access_token"],
}

LOGIN_OAUTH_STATES: dict[str, dict] = {} 

ADMIN_USERNAME = os.environ.get("ADMIN_USERNAME")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD")

# Powers the Dashboard's "Ideas" section - upcoming festivals/observances
# pulled from Calendarific (https://calendarific.com). Optional: if unset,
# /dashboard/ideas returns an empty list with a "not configured" flag rather
# than failing the whole dashboard load.
CALENDARIFIC_API_KEY = os.environ.get("CALENDARIFIC_API_KEY")
CALENDARIFIC_COUNTRY = os.environ.get("CALENDARIFIC_COUNTRY", "IN")

app = FastAPI(title="Content Agent API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Served at /media-files rather than /media - the latter is the media
# library's API namespace (POST/GET/DELETE /media...) below. Starlette
# matches routes in registration order and a Mount claims its whole prefix,
# so a StaticFiles mount at "/media" would swallow every "/media" API
# request before those route handlers ever ran (405/404s where a 200 was
# expected) - hence the separate prefix instead of trying to register the
# API routes first.
app.mount("/media-files", StaticFiles(directory=MEDIA_DIR), name="media-files")

# Auth sessions live in the `auth_sessions` table (db.py) - see create_session
# / require_auth below. Nothing process-local here anymore, so a restart or
# redeploy no longer logs everyone out.
AUTH_TOKEN_TTL_DAYS = int(os.environ.get("AUTH_TOKEN_TTL_DAYS", "30"))
ADMIN_USER_ID = None  # set on startup

bearer_scheme = HTTPBearer(auto_error=False)


async def create_session(db: AsyncSession, user_id: uuid.UUID) -> str:
    """Issue a new bearer token for user_id and persist it so it survives
    server restarts. Returns the raw token to hand back to the client."""
    token = secrets.token_urlsafe(32)
    db.add(AuthSession(
        user_id=user_id,
        token=token,
        expires_at=datetime.now(timezone.utc) + timedelta(days=AUTH_TOKEN_TTL_DAYS),
    ))
    await db.commit()
    return token


async def require_auth(
    creds: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> uuid.UUID:
    if creds is None:
        raise HTTPException(status_code=401, detail="Not authenticated")

    result = await db.execute(select(AuthSession).where(AuthSession.token == creds.credentials))
    session = result.scalar_one_or_none()
    if session is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if session.expires_at is not None and session.expires_at < datetime.now(timezone.utc):
        await db.delete(session)
        await db.commit()
        raise HTTPException(status_code=401, detail="Session expired, please log in again")

    return session.user_id



@app.post("/auth/{provider}/authorize-url")
def get_login_authorize_url(provider: str):
    state = secrets.token_urlsafe(24)
    if provider == "x":
        url, verifier = x_start(state)
        LOGIN_OAUTH_STATES[state] = {"provider": "x", "expires_at": time.time() + 600, "code_verifier": verifier}
        return {"authorize_url": url}

    entry = LOGIN_PROVIDERS.get(provider)
    if entry is None:
        raise HTTPException(status_code=400, detail=f"No login flow for provider: {provider}")
    LOGIN_OAUTH_STATES[state] = {"provider": provider, "expires_at": time.time() + 600}
    return {"authorize_url": entry["authorize_url"](state)}


async def _get_or_create_oauth_user(db: AsyncSession, provider: str, identity: dict) -> uuid.UUID:
    result = await db.execute(
        select(OAuthIdentity).where(
            OAuthIdentity.provider == provider,
            OAuthIdentity.provider_user_id == identity["provider_user_id"],
        )
    )
    existing = result.scalar_one_or_none()
    if existing is not None:
        return existing.user_id

    base_username = identity.get("email") or f"{provider}_{identity['provider_user_id']}"
    username = base_username
    suffix = 1
    while (await db.execute(select(User).where(User.username == username))).scalar_one_or_none() is not None:
        suffix += 1
        username = f"{base_username}{suffix}"

    user = User(username=username, password_hash=None, is_verified=True)
    db.add(user)
    await db.flush()  # get user.id without a full commit yet
    db.add(OAuthIdentity(user_id=user.id, provider=provider, provider_user_id=identity["provider_user_id"], email=identity.get("email")))
    await db.commit()
    return user.id


@app.get("/auth/{provider}/callback")
async def login_oauth_callback(provider: str, code: str | None = None, state: str | None = None,
                                error: str | None = None, db: AsyncSession = Depends(get_db)):
    def redirect_with(status: str, detail: str = "") -> RedirectResponse:
        qp = "" if status == "success" else f"?error={detail or 'oauth_failed'}"
        return RedirectResponse(url=f"{FRONTEND_BASE_URL}/{qp}")

    if error:
        return redirect_with("error", error)

    entry = LOGIN_OAUTH_STATES.pop(state, None) if state else None
    if entry is None or entry["provider"] != provider or entry["expires_at"] < time.time():
        return redirect_with("error", "invalid_or_expired_state")
    if not code:
        return redirect_with("error", "missing_code")

    try:
        if provider == "x":
            identity = await run_in_threadpool(x_finish, code, code_verifier=entry["code_verifier"])
        else:
            identity = await run_in_threadpool(LOGIN_PROVIDERS[provider]["finish"], code)
    except Exception as e:
        return redirect_with("error", str(e))

    user_id = await _get_or_create_oauth_user(db, provider, identity)
    token = await create_session(db, user_id)
    return RedirectResponse(url=f"{FRONTEND_BASE_URL}/?login_token={token}")

    
SCHEDULER_POLL_SECONDS = int(os.environ.get("SCHEDULER_POLL_SECONDS", "30"))
_scheduler_task: asyncio.Task | None = None


async def _run_due_scheduled_drafts():
    """One poll cycle: publish every draft whose scheduled_at has arrived.
    Each draft is published independently — one bad publish (or one bad
    draft) shouldn't stop the rest of the batch or crash the loop."""
    async with AsyncSessionLocal() as db:
        now = datetime.now(timezone.utc)
        result = await db.execute(
            select(Draft).where(Draft.status == DraftStatus.SCHEDULED, Draft.scheduled_at <= now)
        )
        due_drafts = result.scalars().all()
        for draft in due_drafts:
            try:
                platforms = [Platform(p) for p in (draft.scheduled_platforms or [])]
                if not platforms:
                    draft.status = DraftStatus.PUBLISH_FAILED
                    draft.scheduled_at = None
                    draft.scheduled_platforms = None
                    await db.commit()
                    continue
                await _publish_to_platforms(db, draft, platforms, draft.scheduled_live, draft.user_id)
            except Exception:
                # Don't let one draft's failure kill the rest of this cycle
                # (or the loop) — mark it failed and move on; the real error
                # per-platform is already captured in PublishResult rows.
                draft.status = DraftStatus.PUBLISH_FAILED
                draft.scheduled_at = None
                draft.scheduled_platforms = None
                await db.commit()


async def _send_due_publish_reminders():
    """One poll cycle: notify the owner of every scheduled draft whose
    publish time is <=15 minutes away and hasn't been reminded about yet.
    Runs alongside _run_due_scheduled_drafts on the same poll - a draft
    typically gets one reminder cycle hit, then the actual publish, both
    within the same SCHEDULER_POLL_SECONDS-spaced loop."""
    async with AsyncSessionLocal() as db:
        now = datetime.now(timezone.utc)
        soon = now + timedelta(minutes=15)
        result = await db.execute(
            select(Draft).where(
                Draft.status == DraftStatus.SCHEDULED,
                Draft.reminder_sent.is_(False),
                Draft.scheduled_at.isnot(None),
                Draft.scheduled_at <= soon,
            )
        )
        for draft in result.scalars().all():
            minutes = max(0, round((draft.scheduled_at - now).total_seconds() / 60))
            await notify_user(
                db, draft.user_id, "before_publish",
                title="Scheduled post going live soon",
                body=f'"{draft.category}: {draft.subtopic}" publishes in about {minutes} minute(s).',
            )
            draft.reminder_sent = True
        await db.commit()


async def _scheduler_loop():
    while True:
        try:
            await _run_due_scheduled_drafts()
            await _send_due_publish_reminders()
            async with AsyncSessionLocal() as db:
                await maybe_send_weekly_digests(db)
        except Exception:
            # Keep polling even if a whole cycle throws unexpectedly, but
            # don't go silent about it — a swallowed exception here is how
            # the SCHEDULED enum-case bug went unnoticed for as long as it did.
            print("[scheduler] poll cycle failed:", file=sys.stderr)
            traceback.print_exc()
        await asyncio.sleep(SCHEDULER_POLL_SECONDS)


@app.on_event("startup")
async def on_startup():
    global ADMIN_USER_ID, _scheduler_task
    await init_db()
    async with AsyncSessionLocal() as session:
        ADMIN_USER_ID = await _get_or_create_admin_user(session)
    _scheduler_task = asyncio.create_task(_scheduler_loop())



class LoginRequest(BaseModel):
    identifier: str  # username or email
    password: str

class SignupRequest(BaseModel):
    username: str
    email: str
    password: str

class ResendVerificationRequest(BaseModel):
    email: str

class UpdateProfileRequest(BaseModel):
    username: str | None = None
    email: str | None = None
    timezone: str | None = None

class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str

class DeleteAccountRequest(BaseModel):
    # Required whenever the account has a password set (see /me DELETE) so a
    # hijacked/left-open session can't wipe the account with one click.
    # OAuth-only accounts (no password_hash) may omit this.
    password: str | None = None

class VerifyEmailRequest(BaseModel):
    token: str


class GenerateRequest(BaseModel):
    category: str
    subtopic: str
    word_count: int


class HashtagSuggestRequest(BaseModel):
    text: str
    category: str | None = None


class ConnectFintoRequest(BaseModel):
    email: str
    password: str

class ConnectLinkedInRequest(BaseModel):
    access_token: str
    member_id: str

class ConnectFacebookRequest(BaseModel):
    page_access_token: str
    page_id: str

class ConnectInstagramRequest(BaseModel):
    page_access_token: str
    ig_page_id: str

class ConnectThreadsRequest(BaseModel):
    access_token: str
    threads_user_id: str

class ReviewRequest(BaseModel):
    draft_id: str
    decision: str  # "approve" | "reject"
    platforms: list[str] | None = None  # required when decision == "approve"
    feedback: str | None = None
    live: bool = False

class ScheduleRequest(BaseModel):
    scheduled_at: datetime
    platforms: list[str]
    live: bool = False

class RescheduleRequest(BaseModel):
    scheduled_at: datetime


class NotificationPreferencesRequest(BaseModel):
    before_publish: bool
    needs_approval: bool
    publish_failed: bool
    weekly_digest: bool


class PushSubscriptionKeys(BaseModel):
    p256dh: str
    auth: str


class PushSubscriptionRequest(BaseModel):
    endpoint: str
    keys: PushSubscriptionKeys


class PushUnsubscribeRequest(BaseModel):
    endpoint: str


def _parse_draft(content: str) -> dict:
    try:
        return json.loads(clean_json_string(content))
    except (json.JSONDecodeError, TypeError) as e:
        raise HTTPException(
            status_code=502,
            detail=f"Agent did not return valid draft JSON: {e}. Raw content was: {content!r}",
        )


async def _upsert_connection(db: AsyncSession, user_id, platform: Platform, credentials: dict):
    result = await db.execute(
        select(PlatformConnection).where(
            PlatformConnection.user_id == user_id,
            PlatformConnection.platform == platform,
        )
    )
    connection = result.scalar_one_or_none()
    if connection is None:
        db.add(PlatformConnection(user_id=user_id, platform=platform, credentials=credentials))
    else:
        connection.credentials = credentials
    await db.commit()


@app.post("/login")
async def login(req: LoginRequest, db: AsyncSession = Depends(get_db)):
    identifier = req.identifier.strip()
    result = await db.execute(
        select(User).where(or_(User.username == identifier, User.email == identifier.lower()))
    )
    user = result.scalar_one_or_none()
    if user is None or not user.password_hash or not verify_password(req.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid username/email or password")

    if not user.is_verified:
        raise HTTPException(
            status_code=403,
            detail="Please verify your email before logging in. Check your inbox for the verification link, "
                   "or request a new one.",
        )

    token = await create_session(db, user.id)
    return {"token": token}


@app.post("/logout")
async def logout(
    creds: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
):
    """Invalidate the current session server-side. Best-effort: if the
    token's already gone (expired, already logged out elsewhere) this is
    still a 200 - the end state the caller wants (no longer authenticated)
    is already true."""
    if creds is not None:
        result = await db.execute(select(AuthSession).where(AuthSession.token == creds.credentials))
        session = result.scalar_one_or_none()
        if session is not None:
            await db.delete(session)
            await db.commit()
    return {"logged_out": True}


def serialize_profile(user: User) -> dict:
    return {
        "id": str(user.id),
        "username": user.username,
        "email": user.email,
        "avatar_url": user.avatar_url,
        "timezone": user.timezone,
        "created_at": user.created_at.isoformat() if user.created_at else None,
        "has_password": bool(user.password_hash),
    }


# --- Profile settings (bottom-left account popup) --------------------------
# Separate from PlatformConnection (social accounts to publish to) - this is
# the user's own login identity: username/email, avatar, timezone, password,
# and account deletion.

@app.get("/me")
async def get_me(db: AsyncSession = Depends(get_db), user_id: uuid.UUID = Depends(require_auth)):
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="Account not found")
    return serialize_profile(user)


@app.patch("/me")
async def update_me(
    req: UpdateProfileRequest, db: AsyncSession = Depends(get_db), user_id: uuid.UUID = Depends(require_auth),
):
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="Account not found")

    if req.username is not None:
        username = req.username.strip()
        if len(username) < 3:
            raise HTTPException(status_code=400, detail="Username must be at least 3 characters")
        if username != user.username:
            existing = await db.execute(select(User).where(User.username == username, User.id != user_id))
            if existing.scalar_one_or_none() is not None:
                raise HTTPException(status_code=409, detail="Username already taken")
            user.username = username

    if req.email is not None:
        email = req.email.strip().lower()
        if "@" not in email or "." not in email.split("@")[-1]:
            raise HTTPException(status_code=400, detail="Enter a valid email address")
        if email != user.email:
            existing = await db.execute(select(User).where(User.email == email, User.id != user_id))
            if existing.scalar_one_or_none() is not None:
                raise HTTPException(status_code=409, detail="An account with that email already exists")
            user.email = email

    if req.timezone is not None:
        user.timezone = req.timezone.strip() or "UTC"

    await db.commit()
    await db.refresh(user)
    return serialize_profile(user)


AVATAR_MAX_BYTES = 5 * 1024 * 1024  # 5MB


@app.post("/me/avatar")
async def upload_avatar(
    file: UploadFile = File(...), db: AsyncSession = Depends(get_db), user_id: uuid.UUID = Depends(require_auth),
):
    if not (file.content_type or "").startswith("image/"):
        raise HTTPException(status_code=400, detail="File must be an image")

    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(status_code=400, detail="file is empty")
    if len(file_bytes) > AVATAR_MAX_BYTES:
        raise HTTPException(status_code=400, detail="Image exceeds 5MB limit")

    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="Account not found")

    # Remove the previous avatar file so uploads don't pile up on disk.
    if user.avatar_url:
        old_relative = user.avatar_url.split("/media-files/", 1)[-1]
        old_path = MEDIA_DIR / old_relative
        if old_path.is_file():
            old_path.unlink(missing_ok=True)

    ext = Path(file.filename or "").suffix or ".jpg"
    stored_name = f"avatar_{uuid.uuid4()}{ext}"
    (user_media_dir(user_id) / stored_name).write_bytes(file_bytes)

    user.avatar_url = f"{BACKEND_BASE_URL}/media-files/{user_id}/{stored_name}"
    await db.commit()
    await db.refresh(user)
    return serialize_profile(user)


@app.post("/me/change-password")
async def change_password(
    req: ChangePasswordRequest, db: AsyncSession = Depends(get_db), user_id: uuid.UUID = Depends(require_auth),
):
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="Account not found")
    if not user.password_hash:
        raise HTTPException(status_code=400, detail="This account signed in via a connected provider and has no password to change")
    if not verify_password(req.current_password, user.password_hash):
        raise HTTPException(status_code=401, detail="Current password is incorrect")
    if len(req.new_password) < 8:
        raise HTTPException(status_code=400, detail="New password must be at least 8 characters")

    user.password_hash = hash_password(req.new_password)
    await db.commit()
    return {"status": "ok"}


@app.delete("/me")
async def delete_account(
    req: DeleteAccountRequest, db: AsyncSession = Depends(get_db), user_id: uuid.UUID = Depends(require_auth),
):
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="Account not found")

    if user.password_hash:
        if not req.password or not verify_password(req.password, user.password_hash):
            raise HTTPException(status_code=401, detail="Password is incorrect")

    # Invalidate every session for this account, then delete the user row -
    # cascades (platform_connections, drafts, oauth_identities, media_assets,
    # auth_sessions, custom_ideas) are already declared on the User model.
    await db.execute(AuthSession.__table__.delete().where(AuthSession.user_id == user_id))
    await db.delete(user)
    await db.commit()
    return {"status": "deleted"}


async def _get_or_create_admin_user(session: AsyncSession):
    if not ADMIN_USERNAME or not ADMIN_PASSWORD:
        raise RuntimeError("ADMIN_USERNAME / ADMIN_PASSWORD not set in .env")
    result = await session.execute(select(User).where(User.username == ADMIN_USERNAME))
    user = result.scalar_one_or_none()
    if user is None:
        user = User(username=ADMIN_USERNAME, password_hash=hash_password(ADMIN_PASSWORD), is_verified=True)
        session.add(user)
        await session.commit()
        await session.refresh(user)
    return user.id


@app.post("/signup")
async def signup(req: SignupRequest, db: AsyncSession = Depends(get_db)):
    if len(req.username.strip()) < 3:
        raise HTTPException(status_code=400, detail="Username must be at least 3 characters")
    email = req.email.strip().lower()
    if "@" not in email or "." not in email.split("@")[-1]:
        raise HTTPException(status_code=400, detail="Enter a valid email address")
    if len(req.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")

    existing_username = await db.execute(select(User).where(User.username == req.username))
    if existing_username.scalar_one_or_none() is not None:
        raise HTTPException(status_code=409, detail="Username already taken")

    existing_email = await db.execute(select(User).where(User.email == email))
    if existing_email.scalar_one_or_none() is not None:
        raise HTTPException(status_code=409, detail="An account with that email already exists")

    verification_token = secrets.token_urlsafe(32)
    user = User(
        username=req.username,
        email=email,
        password_hash=hash_password(req.password),
        is_verified=False,
        verification_token=verification_token,
        verification_token_expires_at=datetime.now(timezone.utc) + timedelta(hours=EMAIL_VERIFICATION_TOKEN_TTL_HOURS),
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    await run_in_threadpool(send_verification_email, email, verification_token, FRONTEND_BASE_URL)

    # No auth token here - the account can't log in until the email link is
    # clicked. The frontend shows a "check your email" screen instead.
    return {"status": "verification_sent", "email": email}


@app.post("/verify-email")
async def verify_email(req: VerifyEmailRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.verification_token == req.token))
    user = result.scalar_one_or_none()

    if user is None:
        raise HTTPException(status_code=400, detail="Invalid or already-used verification link.")

    if user.verification_token_expires_at and user.verification_token_expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="This verification link has expired. Request a new one.")

    user.is_verified = True
    user.verification_token = None
    user.verification_token_expires_at = None
    await db.commit()

    return {"status": "verified", "username": user.username}


@app.post("/resend-verification")
async def resend_verification(req: ResendVerificationRequest, db: AsyncSession = Depends(get_db)):
    email = req.email.strip().lower()
    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()

    # Same response whether or not the account exists / is already verified,
    # so this endpoint can't be used to enumerate registered emails.
    if user is not None and not user.is_verified:
        token = secrets.token_urlsafe(32)
        user.verification_token = token
        user.verification_token_expires_at = datetime.now(timezone.utc) + timedelta(hours=EMAIL_VERIFICATION_TOKEN_TTL_HOURS)
        await db.commit()
        await run_in_threadpool(send_verification_email, email, token, FRONTEND_BASE_URL)

    return {"status": "ok"}


@app.post("/generate")
async def generate(req: GenerateRequest, db: AsyncSession = Depends(get_db), user_id: uuid.UUID = Depends(require_auth)):
    if req.category not in VALID_CATEGORIES:
        raise HTTPException(
            status_code=400,
            detail=f"category must be one of: {', '.join(VALID_CATEGORIES)}",
        )
    if req.word_count < 100:
        raise HTTPException(status_code=400, detail="word_count must be at least 100")

    content, messages = await run_in_threadpool(
        agent01, category=req.category, subtopic=req.subtopic, word_count=req.word_count
    )
    draft_content = _parse_draft(content)

    draft = Draft(
        user_id=user_id,
        category=req.category,
        subtopic=req.subtopic,
        word_count=req.word_count,
        content=draft_content,
        messages=messages,
        status=DraftStatus.PENDING_REVIEW,
    )
    db.add(draft)
    await db.commit()
    await db.refresh(draft)

    await notify_user(
        db, user_id, "needs_approval",
        title="A draft is ready for review",
        body=f'"{draft.category}: {draft.subtopic}" was generated and is waiting for your approval.',
    )

    return {"draft_id": str(draft.id), "draft": draft.content}


@app.post("/assist/hashtags")
async def assist_hashtags(req: HashtagSuggestRequest, user_id: uuid.UUID = Depends(require_auth)):
    """Backs the manual composer's "# Hashtags" button - suggests hashtags
    for whatever the user has written so far. Doesn't touch the DB; the
    frontend inserts the returned tags into the post text itself."""
    if not req.text.strip():
        raise HTTPException(status_code=400, detail="text must not be empty")
    hashtags = await run_in_threadpool(suggest_hashtags, req.text, req.category)
    return {"hashtags": hashtags}


@app.post("/drafts/manual")
async def create_manual_draft(
    category: str = Form(...),
    subtopic: str = Form(...),
    title: str = Form(...),
    body: str = Form(...),
    images: list[UploadFile] = File(default=[]),
    video: UploadFile | None = File(default=None),
    intro: str | None = Form(default=None),
    linkedin_post: str | None = Form(default=None),
    facebook_post: str | None = Form(default=None),
    instagram_caption: str | None = Form(default=None),
    threads_post: str | None = Form(default=None),
    db: AsyncSession = Depends(get_db),
    user_id: uuid.UUID = Depends(require_auth),
):
    """Same draft pipeline as /generate, minus the LLM: the user writes the
    post and supplies their own media instead of the agent researching and
    drafting it. Produces the exact same `content` shape /generate does
    (title/intro/sections/conclusion/featured_image/carousel_images plus
    per-platform post fields) so review, scheduling, and approve_and_publish
    all work unchanged - they only ever look at draft.content, never at how
    it was built.

    `body` is used everywhere a per-network field isn't explicitly supplied
    (the frontend's "customize post per network" toggle - off by default).
    """
    if category not in VALID_CATEGORIES:
        raise HTTPException(
            status_code=400,
            detail=f"category must be one of: {', '.join(VALID_CATEGORIES)}",
        )
    if not body.strip():
        raise HTTPException(status_code=400, detail="body must not be empty")

    carousel_images = []
    for image in images:
        image_bytes = await image.read()
        if not image_bytes:
            continue
        hosted_url = await run_in_threadpool(upload_to_imgbb, image_bytes, IMGBB_API_KEY)
        if hosted_url:
            carousel_images.append({"url": hosted_url, "source": "user upload"})

    video_field = None
    if video is not None and video.filename:
        video_bytes = await video.read()
        if video_bytes:
            ext = Path(video.filename).suffix or ".mp4"
            stored_name = f"{uuid.uuid4()}{ext}"
            (MEDIA_DIR / stored_name).write_bytes(video_bytes)
            video_field = {
                "url": f"{BACKEND_BASE_URL}/media-files/{stored_name}",
                "filename": video.filename,
            }

    draft_content = {
        "title": title,
        "meta_description": body[:160],
        "intro": intro or body,
        "sections": [],
        "conclusion": "",
        "featured_image": carousel_images[0] if carousel_images else {"url": "", "source": ""},
        "carousel_images": carousel_images,
        "video": video_field,
        "linkedin_post": linkedin_post or body,
        "facebook_post": facebook_post or body,
        "instagram_caption": instagram_caption or body,
        "threads_post": threads_post or body,
        "twitter_post": body[:280],
    }

    draft = Draft(
        user_id=user_id,
        category=category,
        subtopic=subtopic,
        word_count=len(body.split()),
        content=draft_content,
        messages=[],  # no LLM conversation - nothing to revise against via /review reject
        status=DraftStatus.PENDING_REVIEW,
    )
    db.add(draft)
    await db.commit()
    await db.refresh(draft)

    return {"draft_id": str(draft.id), "draft": draft.content}


# Media library — backs the Publish page's "Media" tab. Photos/videos are
# saved permanently to disk under MEDIA_DIR/<user_id>/ (see user_media_dir
# above); text assets are stored inline. Unlike the AI draft pipeline's
# imgbb hosting (temporary, third-party, used only to hand platforms a
# fetchable URL) or the manual draft's flat MEDIA_DIR video (per-draft, not
# revisitable), everything here belongs to the user's account and is listed
# back to them on every visit until they delete it.

@app.post("/media")
async def upload_media(
    file: UploadFile = File(...),
    kind: str = Form(...),
    name: str | None = Form(default=None),
    db: AsyncSession = Depends(get_db),
    user_id: uuid.UUID = Depends(require_auth),
):
    if kind not in ("photo", "video"):
        raise HTTPException(status_code=400, detail="kind must be 'photo' or 'video'")

    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(status_code=400, detail="file is empty")
    if len(file_bytes) > MEDIA_LIBRARY_MAX_BYTES:
        raise HTTPException(status_code=400, detail="file exceeds 50MB limit")

    ext = Path(file.filename or "").suffix or (".jpg" if kind == "photo" else ".mp4")
    stored_name = f"{uuid.uuid4()}{ext}"
    (user_media_dir(user_id) / stored_name).write_bytes(file_bytes)

    asset = MediaAsset(
        user_id=user_id,
        kind=MediaKind.PHOTO if kind == "photo" else MediaKind.VIDEO,
        name=(name or file.filename or stored_name).strip() or stored_name,
        content_type=file.content_type,
        file_path=f"{user_id}/{stored_name}",
        file_size=len(file_bytes),
    )
    db.add(asset)
    await db.commit()
    await db.refresh(asset)
    return serialize_media_asset(asset)


class MediaTextRequest(BaseModel):
    name: str
    content: str


@app.post("/media/text")
async def add_media_text(
    req: MediaTextRequest,
    db: AsyncSession = Depends(get_db),
    user_id: uuid.UUID = Depends(require_auth),
):
    if not req.content.strip():
        raise HTTPException(status_code=400, detail="content must not be empty")

    asset = MediaAsset(
        user_id=user_id,
        kind=MediaKind.TEXT,
        name=req.name.strip() or "Untitled text",
        text_content=req.content.strip(),
    )
    db.add(asset)
    await db.commit()
    await db.refresh(asset)
    return serialize_media_asset(asset)


@app.get("/media")
async def list_media(db: AsyncSession = Depends(get_db), user_id: uuid.UUID = Depends(require_auth)):
    result = await db.execute(
        select(MediaAsset).where(MediaAsset.user_id == user_id).order_by(MediaAsset.created_at.desc())
    )
    assets = result.scalars().all()
    return {"assets": [serialize_media_asset(a) for a in assets]}


@app.delete("/media/{media_id}")
async def delete_media(
    media_id: uuid.UUID, db: AsyncSession = Depends(get_db), user_id: uuid.UUID = Depends(require_auth),
):
    result = await db.execute(
        select(MediaAsset).where(MediaAsset.id == media_id, MediaAsset.user_id == user_id)
    )
    asset = result.scalar_one_or_none()
    if asset is None:
        raise HTTPException(status_code=404, detail="Unknown media_id")

    if asset.file_path:
        file_on_disk = MEDIA_DIR / asset.file_path
        file_on_disk.unlink(missing_ok=True)

    await db.delete(asset)
    await db.commit()
    return {"deleted": True}


@app.get("/analytics/summary")
async def analytics_summary(
    days: int = 30,
    db: AsyncSession = Depends(get_db),
    user_id: uuid.UUID = Depends(require_auth),
):
    """Real usage stats derived from publish attempts — no follower/reach data,
    since T01 doesn't call any platform's insights API. Everything here is
    counted from our own PublishResult rows."""
    since = datetime.now(timezone.utc) - timedelta(days=days)

    # Drafts the user actually wrote in this range — independent of whether
    # they were ever published, since that's their own content output.
    draft_totals = (
        await db.execute(
            select(func.count(Draft.id), func.coalesce(func.sum(Draft.word_count), 0))
            .where(Draft.user_id == user_id, Draft.created_at >= since)
        )
    ).one()
    total_drafts, total_words = draft_totals[0], int(draft_totals[1])

    # "Currently scheduled" is a live count, not scoped to the days range —
    # it's whatever's sitting on the calendar right now.
    currently_scheduled = (
        await db.execute(
            select(func.count(Draft.id)).where(Draft.user_id == user_id, Draft.status == DraftStatus.SCHEDULED)
        )
    ).scalar_one()

    rows = (
        await db.execute(
            select(PublishResult.platform, PublishResult.success, PublishResult.published_at, PublishResult.detail)
            .join(Draft, Draft.id == PublishResult.draft_id)
            .where(Draft.user_id == user_id, PublishResult.published_at >= since)
        )
    ).all()

    total = len(rows)
    successes = sum(1 for r in rows if r.success)
    failures = total - successes

    by_platform: dict[str, dict] = {}
    for r in rows:
        key = r.platform.value if hasattr(r.platform, "value") else r.platform
        entry = by_platform.setdefault(key, {"total": 0, "success": 0})
        entry["total"] += 1
        entry["success"] += 1 if r.success else 0

    # Daily counts for the sparkline bars - success vs failure per day, oldest first
    daily: dict[str, dict] = {}
    for r in rows:
        day = r.published_at.date().isoformat()
        entry = daily.setdefault(day, {"date": day, "success": 0, "failure": 0})
        entry["success" if r.success else "failure"] += 1
    daily_sorted = [daily[d] for d in sorted(daily.keys())]

    # Posting cadence — successful publishes grouped by weekday, Monday first.
    weekday_labels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    cadence_counts = [0] * 7
    for r in rows:
        if r.success:
            cadence_counts[r.published_at.weekday()] += 1
    cadence_by_weekday = [{"weekday": wl, "count": c} for wl, c in zip(weekday_labels, cadence_counts)]

    # Per-platform reliability over time — daily success/total per platform,
    # so a platform that's degrading (e.g. expired token) is visible as a trend
    # rather than buried in the single aggregate success rate.
    platform_daily: dict[str, dict[str, dict]] = {}
    for r in rows:
        key = r.platform.value if hasattr(r.platform, "value") else r.platform
        day = r.published_at.date().isoformat()
        day_bucket = platform_daily.setdefault(key, {}).setdefault(day, {"date": day, "success": 0, "total": 0})
        day_bucket["total"] += 1
        day_bucket["success"] += 1 if r.success else 0
    platform_reliability_daily = {
        key: [days_map[d] for d in sorted(days_map.keys())]
        for key, days_map in platform_daily.items()
    }

    # Top categories among drafts that had at least one publish attempt in range
    cat_rows = (
        await db.execute(
            select(Draft.category, func.count(func.distinct(Draft.id)))
            .join(PublishResult, PublishResult.draft_id == Draft.id)
            .where(Draft.user_id == user_id, PublishResult.published_at >= since)
            .group_by(Draft.category)
            .order_by(func.count(func.distinct(Draft.id)).desc())
            .limit(5)
        )
    ).all()
    top_categories = [{"category": c, "count": n} for c, n in cat_rows]

    recent_failures = [
        {
            "platform": r.platform.value if hasattr(r.platform, "value") else r.platform,
            "detail": r.detail,
            "published_at": r.published_at.isoformat(),
        }
        for r in sorted(rows, key=lambda r: r.published_at, reverse=True)
        if not r.success
    ][:10]

    return {
        "range_days": days,
        "total_drafts": total_drafts,
        "total_words": total_words,
        "currently_scheduled": currently_scheduled,
        "total_attempts": total,
        "successes": successes,
        "failures": failures,
        "success_rate": round(successes / total * 100, 1) if total else None,
        "by_platform": by_platform,
        "daily": daily_sorted,
        "cadence_by_weekday": cadence_by_weekday,
        "platform_reliability_daily": platform_reliability_daily,
        "top_categories": top_categories,
        "recent_failures": recent_failures,
    }


@app.get("/drafts")
async def list_drafts(
    status: str | None = None,
    exclude_status: str | None = None,
    scheduled_from: datetime | None = None,
    scheduled_to: datetime | None = None,
    was_scheduled: bool | None = None,
    db: AsyncSession = Depends(get_db),
    user_id: uuid.UUID = Depends(require_auth),
):
    # Earliest successful publish per draft — this is what "past posts" get
    # placed on the calendar by, since scheduled_at is cleared to None the
    # moment a draft actually publishes (see _publish_to_platforms).
    first_published_subq = (
        select(
            PublishResult.draft_id.label("draft_id"),
            func.min(PublishResult.published_at).label("first_published_at"),
        )
        .where(PublishResult.success.is_(True))
        .group_by(PublishResult.draft_id)
        .subquery()
    )

    query = (
        select(Draft, first_published_subq.c.first_published_at)
        .outerjoin(first_published_subq, first_published_subq.c.draft_id == Draft.id)
        .where(Draft.user_id == user_id)
        .order_by(Draft.created_at.desc())
    )
    if status:
        try:
            query = query.where(Draft.status == DraftStatus(status))
        except ValueError:
            raise HTTPException(status_code=400, detail=f"status must be one of: {', '.join(s.value for s in DraftStatus)}")
    if exclude_status:
        try:
            excluded = [DraftStatus(s) for s in exclude_status.split(",")]
        except ValueError:
            raise HTTPException(status_code=400, detail=f"exclude_status must be a comma-separated list from: {', '.join(s.value for s in DraftStatus)}")
        query = query.where(Draft.status.notin_(excluded))

    # Direct filter for "posts that are or were ever scheduled" (the Publish
    # page's Scheduled tab), independent of the date-range logic below —
    # this covers currently-scheduled drafts, drafts that already published
    # after being scheduled, and drafts that were scheduled and later
    # unscheduled back to pending_review (was_scheduled is never cleared).
    if was_scheduled is not None:
        query = query.where(Draft.was_scheduled.is_(was_scheduled))

    # A date-range filter matches drafts scheduled in that range OR published
    # in that range, so calendar/scheduled views can pull both upcoming and
    # past posts with a single call. The published side is further limited
    # to drafts that were AT SOME POINT scheduled (was_scheduled) — this is
    # a "scheduled" view, not a full publish history, so a draft published
    # immediately (never scheduled) shouldn't show up here just because its
    # publish date happens to fall in the range.
    if scheduled_from is not None or scheduled_to is not None:
        from_utc = _ensure_utc(scheduled_from) if scheduled_from is not None else None
        to_utc = _ensure_utc(scheduled_to) if scheduled_to is not None else None

        sched_cond = Draft.scheduled_at.isnot(None)
        pub_cond = first_published_subq.c.first_published_at.isnot(None) & Draft.was_scheduled.is_(True)
        if from_utc is not None:
            sched_cond = sched_cond & (Draft.scheduled_at >= from_utc)
            pub_cond = pub_cond & (first_published_subq.c.first_published_at >= from_utc)
        if to_utc is not None:
            sched_cond = sched_cond & (Draft.scheduled_at <= to_utc)
            pub_cond = pub_cond & (first_published_subq.c.first_published_at <= to_utc)

        query = query.where(or_(sched_cond, pub_cond))

    result = await db.execute(query)
    rows = result.all()
    draft_ids = [d.id for d, _ in rows]

    # Full per-platform publish history (success and failure) for each draft,
    # so a calendar chip/detail view can show real status per platform, not
    # just "it went out".
    results_by_draft: dict[uuid.UUID, list[dict]] = {}
    if draft_ids:
        pr_result = await db.execute(
            select(PublishResult)
            .where(PublishResult.draft_id.in_(draft_ids))
            .order_by(PublishResult.published_at.asc())
        )
        for pr in pr_result.scalars().all():
            results_by_draft.setdefault(pr.draft_id, []).append({
                "platform": pr.platform.value,
                "success": pr.success,
                "detail": pr.detail,
                "published_at": pr.published_at.isoformat() if pr.published_at else None,
            })

    return {
        "drafts": [
            {
                "draft_id": str(d.id),
                "category": d.category,
                "subtopic": d.subtopic,
                "title": (d.content or {}).get("title"),
                "meta_description": (d.content or {}).get("meta_description"),
                "featured_image": (d.content or {}).get("featured_image"),
                "status": d.status.value,
                "created_at": d.created_at.isoformat(),
                "updated_at": d.updated_at.isoformat(),
                "scheduled_at": d.scheduled_at.isoformat() if d.scheduled_at else None,
                "scheduled_platforms": d.scheduled_platforms,
                "scheduled_live": d.scheduled_live,
                "published_at": first_published_at.isoformat() if first_published_at else None,
                "publish_results": results_by_draft.get(d.id, []),
            }
            for d, first_published_at in rows
        ]
    }


@app.get("/drafts/{draft_id}")
async def get_draft(draft_id: uuid.UUID, db: AsyncSession = Depends(get_db), user_id: uuid.UUID = Depends(require_auth)):
    result = await db.execute(select(Draft).where(Draft.id == draft_id, Draft.user_id == user_id))
    draft = result.scalar_one_or_none()
    if draft is None:
        raise HTTPException(status_code=404, detail="Unknown draft_id")
    return {"draft_id": str(draft.id), "draft": draft.content, "status": draft.status.value}


@app.post("/drafts/{draft_id}/schedule")
async def schedule_draft(
    draft_id: uuid.UUID, req: ScheduleRequest,
    db: AsyncSession = Depends(get_db), user_id: uuid.UUID = Depends(require_auth),
):
    result = await db.execute(select(Draft).where(Draft.id == draft_id, Draft.user_id == user_id))
    draft = result.scalar_one_or_none()
    if draft is None:
        raise HTTPException(status_code=404, detail="Unknown draft_id")

    if not req.platforms:
        raise HTTPException(status_code=400, detail="platforms is required to schedule a draft")

    for p in req.platforms:
        try:
            Platform(p)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"platform must be one of: {', '.join(pl.value for pl in Platform)} (got {p!r})")

    scheduled_at = _ensure_utc(req.scheduled_at)
    if scheduled_at <= datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="scheduled_at must be in the future")

    draft.scheduled_at = scheduled_at
    draft.scheduled_platforms = req.platforms
    draft.scheduled_live = req.live
    draft.status = DraftStatus.SCHEDULED
    draft.was_scheduled = True
    draft.reminder_sent = False
    await db.commit()
    await db.refresh(draft)
    return {
        "draft_id": str(draft.id), "status": draft.status.value,
        "scheduled_at": draft.scheduled_at.isoformat(), "scheduled_platforms": draft.scheduled_platforms,
    }


@app.patch("/drafts/{draft_id}/schedule")
async def reschedule_draft(
    draft_id: uuid.UUID, req: RescheduleRequest,
    db: AsyncSession = Depends(get_db), user_id: uuid.UUID = Depends(require_auth),
):
    """Move an already-scheduled draft to a new date/time (e.g. calendar
    drag & drop) without needing to resend its platforms/live choice."""
    result = await db.execute(select(Draft).where(Draft.id == draft_id, Draft.user_id == user_id))
    draft = result.scalar_one_or_none()
    if draft is None:
        raise HTTPException(status_code=404, detail="Unknown draft_id")
    if draft.status != DraftStatus.SCHEDULED:
        raise HTTPException(status_code=400, detail="This draft isn't currently scheduled")

    scheduled_at = _ensure_utc(req.scheduled_at)
    if scheduled_at <= datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="scheduled_at must be in the future")

    draft.scheduled_at = scheduled_at
    draft.reminder_sent = False
    await db.commit()
    return {"draft_id": str(draft.id), "scheduled_at": draft.scheduled_at.isoformat()}


@app.delete("/drafts/{draft_id}/schedule")
async def unschedule_draft(
    draft_id: uuid.UUID, db: AsyncSession = Depends(get_db), user_id: uuid.UUID = Depends(require_auth),
):
    result = await db.execute(select(Draft).where(Draft.id == draft_id, Draft.user_id == user_id))
    draft = result.scalar_one_or_none()
    if draft is None:
        raise HTTPException(status_code=404, detail="Unknown draft_id")
    if draft.status != DraftStatus.SCHEDULED:
        raise HTTPException(status_code=400, detail="This draft isn't currently scheduled")

    draft.status = DraftStatus.PENDING_REVIEW
    draft.scheduled_at = None
    draft.scheduled_platforms = None
    draft.scheduled_live = False
    await db.commit()
    return {"draft_id": str(draft.id), "status": draft.status.value}


@app.post("/connect/finto")
async def connect_finto(req: ConnectFintoRequest, db: AsyncSession = Depends(get_db),  user_id: uuid.UUID = Depends(require_auth)):
    await _upsert_connection(db, user_id, Platform.FINTO, {"email": req.email, "password": encrypt_secret(req.password)})
    return {"success": True}

@app.post("/connect/linkedin")
async def connect_linkedin(req: ConnectLinkedInRequest, db: AsyncSession = Depends(get_db),  user_id: uuid.UUID = Depends(require_auth)):
    await _upsert_connection(db, user_id, Platform.LINKEDIN, {"access_token": encrypt_secret(req.access_token), "member_id": req.member_id})
    return {"success": True}

@app.post("/connect/facebook")
async def connect_facebook(req: ConnectFacebookRequest, db: AsyncSession = Depends(get_db),  user_id: uuid.UUID = Depends(require_auth)):
    await _upsert_connection(db, user_id, Platform.FACEBOOK, {"page_access_token": encrypt_secret(req.page_access_token), "page_id": req.page_id})
    return {"success": True}

@app.post("/connect/instagram")
async def connect_instagram(req: ConnectInstagramRequest, db: AsyncSession = Depends(get_db),  user_id: uuid.UUID = Depends(require_auth)):
    await _upsert_connection(db, user_id, Platform.INSTAGRAM, {"page_access_token": encrypt_secret(req.page_access_token), "ig_page_id": req.ig_page_id})
    return {"success": True}

@app.post("/connect/threads")
async def connect_threads(req: ConnectThreadsRequest, db: AsyncSession = Depends(get_db),  user_id: uuid.UUID = Depends(require_auth)):
    await _upsert_connection(db, user_id, Platform.THREADS, {"access_token": encrypt_secret(req.access_token), "threads_user_id": req.threads_user_id})
    return {"success": True}


@app.post("/connect/{platform}/authorize-url")
def get_authorize_url(platform: str, user_id: uuid.UUID = Depends(require_auth)):
    provider = OAUTH_PROVIDERS.get(platform)
    if provider is None:
        raise HTTPException(status_code=400, detail=f"No OAuth flow for platform: {platform}")
    state = secrets.token_urlsafe(24)
    OAUTH_STATES[state] = {"user_id": user_id, "platform": platform, "expires_at": time.time() + 600}
    return {"authorize_url": provider["authorize_url"](state)}


@app.get("/connect/{platform}/callback")
async def oauth_callback(platform: str, code: str | None = None, state: str | None = None,
                          error: str | None = None, db: AsyncSession = Depends(get_db)):
    def redirect_with(status: str, detail: str = "") -> RedirectResponse:
        qp = f"connected={platform}" if status == "success" else f"error={detail or 'oauth_failed'}"
        return RedirectResponse(url=f"{FRONTEND_BASE_URL}/settings?{qp}")

    if error:
        return redirect_with("error", error)

    entry = OAUTH_STATES.pop(state, None) if state else None
    if entry is None or entry["platform"] != platform or entry["expires_at"] < time.time():
        return redirect_with("error", "invalid_or_expired_state")

    if platform in ("facebook", "instagram"):
        try:
            long_token = await run_in_threadpool(facebook_exchange if platform == "facebook" else instagram_exchange, code)
            pages = await run_in_threadpool(list_pages, long_token)
        except Exception as e:
            return redirect_with("error", str(e))

        if len(pages) == 1:
            try:
                credentials = (facebook_credentials_from_page if platform == "facebook" else instagram_credentials_from_page)(pages[0])
            except Exception as e:
                return redirect_with("error", str(e))
            for field in SECRET_CREDENTIAL_FIELDS.get(Platform(platform), []):
                if field in credentials:
                    credentials[field] = encrypt_secret(credentials[field])
            await _upsert_connection(db, entry["user_id"], Platform(platform), credentials)
            return redirect_with("success")

        # More than one Page — stash the choice and let the frontend show a picker
        pending_id = secrets.token_urlsafe(16)
        PENDING_PAGE_SELECTIONS[pending_id] = {
            "user_id": entry["user_id"], "platform": platform, "pages": pages, "expires_at": time.time() + 600,
        }
        return RedirectResponse(url=f"{FRONTEND_BASE_URL}/settings?select_page={platform}&pending={pending_id}")

    provider = OAUTH_PROVIDERS.get(platform)
    if provider is None or not code:
        return redirect_with("error", "missing_code")
    try:
        credentials = await run_in_threadpool(provider["finish"], code)
    except Exception as e:
        return redirect_with("error", str(e))
    for field in SECRET_CREDENTIAL_FIELDS.get(Platform(platform), []):
        if field in credentials:
            credentials[field] = encrypt_secret(credentials[field])
    await _upsert_connection(db, entry["user_id"], Platform(platform), credentials)
    return redirect_with("success")


    
@app.get("/connect/{platform}/pending-pages/{pending_id}")
def get_pending_pages(platform: str, pending_id: str, user_id: uuid.UUID = Depends(require_auth)):
    entry = PENDING_PAGE_SELECTIONS.get(pending_id)
    if entry is None or entry["platform"] != platform or entry["expires_at"] < time.time() or entry["user_id"] != user_id:
        raise HTTPException(status_code=404, detail="No pending page selection found - reconnect to try again.")
    return {"pages": [{"id": p["id"], "name": p.get("name", p["id"])} for p in entry["pages"]]}


class SelectPageRequest(BaseModel):
    pending_id: str
    page_id: str

@app.post("/connect/{platform}/select-page")
async def select_page(platform: str, req: SelectPageRequest, db: AsyncSession = Depends(get_db), user_id: uuid.UUID = Depends(require_auth)):
    entry = PENDING_PAGE_SELECTIONS.get(req.pending_id)
    if entry is None or entry["platform"] != platform or entry["expires_at"] < time.time() or entry["user_id"] != user_id:
        raise HTTPException(status_code=404, detail="No pending page selection found - reconnect to try again.")
    page = next((p for p in entry["pages"] if p["id"] == req.page_id), None)
    if page is None:
        raise HTTPException(status_code=400, detail="That page wasn't in the list from your last connect attempt.")
    try:
        credentials = (facebook_credentials_from_page if platform == "facebook" else instagram_credentials_from_page)(page)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))
    for field in SECRET_CREDENTIAL_FIELDS.get(Platform(platform), []):
        if field in credentials:
            credentials[field] = encrypt_secret(credentials[field])
    await _upsert_connection(db, user_id, Platform(platform), credentials)
    PENDING_PAGE_SELECTIONS.pop(req.pending_id, None)
    return {"success": True}

async def _publish_to_platforms(db: AsyncSession, draft: Draft, platforms: list[Platform], live: bool, user_id) -> dict:
    """Publish `draft` to each platform in `platforms`, recording a PublishResult
    per platform and updating draft.status to PUBLISHED/PUBLISH_FAILED based on
    whether any platform succeeded. Also clears any scheduling fields, since a
    draft that has just been published (successfully or not) is no longer
    "on the calendar" either way.

    Shared by the immediate approve-and-publish path (/review) and the
    background scheduler (_run_due_scheduled_drafts) so both go through
    identical publish/record-keeping logic.
    """
    results = {}
    any_success = False
    failed_platforms: list[str] = []
    for platform in platforms:
        conn_result = await db.execute(
            select(PlatformConnection).where(
                PlatformConnection.user_id == user_id,
                PlatformConnection.platform == platform,
            )
        )
        connection = conn_result.scalar_one_or_none()
        if connection is None:
            error = f"No {platform.value} connection found - connect that platform first."
            results[platform.value] = {"success": False, "error": error}
            db.add(PublishResult(draft_id=draft.id, platform=platform, success=False, detail=error))
            failed_platforms.append(platform.value)
            continue

        user_credentials = dict(connection.credentials)
        for field in SECRET_CREDENTIAL_FIELDS.get(platform, []):
            if field in user_credentials:
                user_credentials[field] = decrypt_secret(user_credentials[field])

        try:
            publish_result = await run_in_threadpool(
                approve_and_publish,
                draft_json_str=json.dumps(draft.content),
                platform=platform.value,
                user_credentials=user_credentials,
                live=live,
            )
            success = True
            detail = json.dumps(publish_result) if not isinstance(publish_result, str) else publish_result
        except Exception as e:
            publish_result, success, detail = None, False, str(e)

        results[platform.value] = publish_result if success else {"success": False, "error": detail}
        any_success = any_success or success
        if not success:
            failed_platforms.append(platform.value)
        db.add(PublishResult(draft_id=draft.id, platform=platform, success=success, detail=detail))

    draft.status = DraftStatus.PUBLISHED if any_success else DraftStatus.PUBLISH_FAILED
    draft.scheduled_at = None
    draft.scheduled_platforms = None
    draft.scheduled_live = False
    await db.commit()

    if failed_platforms:
        await notify_user(
            db, user_id, "publish_failed",
            title="A publish attempt failed",
            body=f'"{draft.category}: {draft.subtopic}" failed to publish to: {", ".join(failed_platforms)}.',
        )

    return results


def _ensure_utc(dt: datetime) -> datetime:
    """Treat a naive datetime (no tzinfo) as UTC rather than raising or
    silently comparing wrong — browsers/JS can send either form."""
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


@app.post("/review")
async def review(req: ReviewRequest, db: AsyncSession = Depends(get_db),  user_id: uuid.UUID = Depends(require_auth)):
    result = await db.execute(select(Draft).where(Draft.id == req.draft_id))
    draft = result.scalar_one_or_none()
    if draft is None:
        raise HTTPException(status_code=404, detail="Unknown or expired draft_id")

    if req.decision not in ("approve", "reject"):
        raise HTTPException(status_code=400, detail="decision must be 'approve' or 'reject'")

    if req.decision == "reject":
        if not req.feedback:
            raise HTTPException(status_code=400, detail="feedback is required to reject a draft")
        if not draft.messages:
            # Manually-written drafts (POST /drafts/manual) have no LLM
            # conversation to hand back to revise_draft - there's nothing
            # for the agent to revise. The user should just edit their text
            # and resubmit a new manual draft instead.
            raise HTTPException(
                status_code=400,
                detail="This draft was written manually and can't be sent back for AI revision. Edit and resubmit it instead.",
            )

        content, messages = await run_in_threadpool(revise_draft, draft.messages, feedback=req.feedback)
        draft.content = _parse_draft(content)
        draft.messages = messages
        draft.status = DraftStatus.PENDING_REVIEW
        await db.commit()

        return {"draft_id": str(draft.id), "draft": draft.content}

# decision == "approve"
    if not req.platforms:
        raise HTTPException(status_code=400, detail="platforms is required to approve a draft")

    platforms: list[Platform] = []
    for p in req.platforms:
        try:
            platforms.append(Platform(p))
        except ValueError:
            raise HTTPException(status_code=400, detail=f"platform must be one of: {', '.join(pl.value for pl in Platform)} (got {p!r})")

    results = await _publish_to_platforms(db, draft, platforms, req.live, user_id)

    return {"draft_id": str(draft.id), "results": results}

@app.get("/connections")
async def list_connections(db: AsyncSession = Depends(get_db), user_id: uuid.UUID = Depends(require_auth)):
    result = await db.execute(
        select(PlatformConnection.platform, PlatformConnection.credentials).where(
            PlatformConnection.user_id == user_id
        )
    )
    connections = {
        platform.value: {
            "profile_name": (credentials or {}).get("profile_name"),
            "profile_picture_url": (credentials or {}).get("profile_picture_url"),
        }
        for platform, credentials in result.all()
    }
    return {"connections": connections}


def _fetch_calendarific_holidays_sync(year: int, month: int) -> list[dict]:
    """Blocking Calendarific call - run via run_in_threadpool. Returns []
    on any error (bad key, rate limit, network) rather than raising, so a
    flaky third-party API never takes down the rest of the dashboard."""
    try:
        resp = requests.get(
            "https://calendarific.com/api/v2/holidays",
            params={
                "api_key": CALENDARIFIC_API_KEY,
                "country": CALENDARIFIC_COUNTRY,
                "year": year,
                "month": month,
            },
            timeout=8,
        )
        resp.raise_for_status()
        return resp.json().get("response", {}).get("holidays", [])
    except Exception:
        logging.getLogger("dashboard").warning("Calendarific fetch failed for %s-%s", year, month, exc_info=True)
        return []


def idea_attachment_url(attachment: "IdeaAttachment") -> str:
    return f"{BACKEND_BASE_URL}/media-files/{attachment.file_path}"


def serialize_idea_attachment(attachment: "IdeaAttachment") -> dict:
    return {
        "id": str(attachment.id),
        "name": attachment.name,
        "content_type": attachment.content_type,
        "url": idea_attachment_url(attachment),
        "file_size": attachment.file_size,
    }


def serialize_custom_idea(idea: "CustomIdea") -> dict:
    return {
        "id": str(idea.id),
        "name": idea.name,
        "date": idea.date,
        "description": idea.description or "",
        "types": ["custom"],
        "custom": True,
        "media": [serialize_idea_attachment(a) for a in idea.attachments],
    }


class CreateIdeaRequest(BaseModel):
    name: str
    date: str | None = None  # ISO "YYYY-MM-DD"; legacy/optional, no longer collected by the form
    description: str | None = None  # legacy/optional, no longer collected by the form


@app.get("/dashboard/ideas")
async def get_dashboard_ideas(db: AsyncSession = Depends(get_db), user_id: uuid.UUID = Depends(require_auth)):
    """Upcoming festivals/observances for the Dashboard's Ideas section,
    each turned into a lightweight content suggestion, merged with any
    ideas the user has entered themselves via the "+ New" button
    (POST /dashboard/ideas). Auth-gated like the rest of the dashboard
    even though the Calendarific data isn't user-specific, so an
    unauthenticated caller can't use this as a free Calendarific proxy."""
    result = await db.execute(
        select(CustomIdea)
        .where(CustomIdea.user_id == user_id)
        .options(selectinload(CustomIdea.attachments))
        .order_by(CustomIdea.created_at.desc())
    )
    custom_ideas = [serialize_custom_idea(i) for i in result.scalars().all()]

    if not CALENDARIFIC_API_KEY:
        return {"configured": False, "ideas": custom_ideas}

    today = datetime.now(timezone.utc).date()
    months_to_fetch = {(today.year, today.month)}
    next_month_date = (today.replace(day=28) + timedelta(days=4)).replace(day=1)
    months_to_fetch.add((next_month_date.year, next_month_date.month))

    raw_holidays: list[dict] = []
    for year, month in months_to_fetch:
        raw_holidays.extend(await run_in_threadpool(_fetch_calendarific_holidays_sync, year, month))

    ideas = []
    seen = set()
    for h in raw_holidays:
        iso_date = (h.get("date") or {}).get("iso")
        name = h.get("name")
        if not iso_date or not name:
            continue
        try:
            event_date = datetime.fromisoformat(iso_date[:10]).date()
        except ValueError:
            continue
        if event_date < today:
            continue
        key = (name, iso_date[:10])
        if key in seen:
            continue
        seen.add(key)
        ideas.append({
            "name": name,
            "date": iso_date[:10],
            "description": h.get("description") or "",
            "types": h.get("type") or [],
            "custom": False,
        })

    ideas.sort(key=lambda i: i["date"])
    # User-entered ideas always surface first, regardless of date, since
    # they're the ones the person just told us they care about.
    return {"configured": True, "ideas": custom_ideas + ideas[:12]}


@app.post("/dashboard/ideas")
async def create_dashboard_idea(
    req: CreateIdeaRequest,
    db: AsyncSession = Depends(get_db),
    user_id: uuid.UUID = Depends(require_auth),
):
    """Save a user-entered idea from the Dashboard's "+ New" button. Attach
    media afterward via POST /dashboard/ideas/{idea_id}/media."""
    name = req.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="name must not be empty")

    date_str = None
    if req.date:
        date_str = req.date.strip()
        try:
            datetime.fromisoformat(date_str[:10])
        except ValueError:
            raise HTTPException(status_code=400, detail="date must be an ISO date (YYYY-MM-DD)")
        date_str = date_str[:10]

    idea = CustomIdea(
        user_id=user_id,
        name=name,
        date=date_str,
        description=(req.description or "").strip() or None,
    )
    db.add(idea)
    await db.commit()
    await db.refresh(idea, attribute_names=["attachments"])
    return serialize_custom_idea(idea)


@app.post("/dashboard/ideas/{idea_id}/media")
async def add_idea_media(
    idea_id: uuid.UUID,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    user_id: uuid.UUID = Depends(require_auth),
):
    """Attach a photo or video to a saved idea (Dashboard "+ New" modal)."""
    result = await db.execute(
        select(CustomIdea).where(CustomIdea.id == idea_id, CustomIdea.user_id == user_id)
    )
    idea = result.scalar_one_or_none()
    if idea is None:
        raise HTTPException(status_code=404, detail="Unknown idea_id")

    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(status_code=400, detail="file is empty")
    if len(file_bytes) > MEDIA_LIBRARY_MAX_BYTES:
        raise HTTPException(status_code=400, detail="file exceeds 50MB limit")

    ext = Path(file.filename or "").suffix or ".bin"
    stored_name = f"{uuid.uuid4()}{ext}"
    (user_media_dir(user_id) / stored_name).write_bytes(file_bytes)

    attachment = IdeaAttachment(
        idea_id=idea.id,
        name=(file.filename or stored_name).strip() or stored_name,
        content_type=file.content_type,
        file_path=f"{user_id}/{stored_name}",
        file_size=len(file_bytes),
    )
    db.add(attachment)
    await db.commit()
    await db.refresh(attachment)
    return serialize_idea_attachment(attachment)


@app.delete("/dashboard/ideas/{idea_id}/media/{attachment_id}")
async def delete_idea_media(
    idea_id: uuid.UUID,
    attachment_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user_id: uuid.UUID = Depends(require_auth),
):
    result = await db.execute(
        select(IdeaAttachment)
        .join(CustomIdea, CustomIdea.id == IdeaAttachment.idea_id)
        .where(
            IdeaAttachment.id == attachment_id,
            IdeaAttachment.idea_id == idea_id,
            CustomIdea.user_id == user_id,
        )
    )
    attachment = result.scalar_one_or_none()
    if attachment is None:
        raise HTTPException(status_code=404, detail="Unknown attachment_id")

    file_on_disk = MEDIA_DIR / attachment.file_path
    file_on_disk.unlink(missing_ok=True)

    await db.delete(attachment)
    await db.commit()
    return {"deleted": True}


@app.delete("/dashboard/ideas/{idea_id}")
async def delete_dashboard_idea(
    idea_id: uuid.UUID, db: AsyncSession = Depends(get_db), user_id: uuid.UUID = Depends(require_auth),
):
    result = await db.execute(
        select(CustomIdea)
        .where(CustomIdea.id == idea_id, CustomIdea.user_id == user_id)
        .options(selectinload(CustomIdea.attachments))
    )
    idea = result.scalar_one_or_none()
    if idea is None:
        raise HTTPException(status_code=404, detail="Unknown idea_id")

    for attachment in idea.attachments:
        (MEDIA_DIR / attachment.file_path).unlink(missing_ok=True)

    await db.delete(idea)
    await db.commit()
    return {"deleted": True}


@app.get("/notifications/vapid-public-key")
def get_vapid_public_key():
    """Public - the frontend needs this to call pushManager.subscribe()
    before the user is necessarily authenticated in a persisted-session
    sense (though in practice this is only called from the logged-in
    Publish page). Returns null if VAPID isn't configured yet, which the
    frontend treats as "push isn't available on this server"."""
    return {"publicKey": VAPID_PUBLIC_KEY}


@app.get("/notifications/preferences")
async def get_notification_preferences(
    db: AsyncSession = Depends(get_db), user_id: uuid.UUID = Depends(require_auth),
):
    prefs = await get_or_create_notification_prefs(db, user_id)
    return {
        "before_publish": prefs.before_publish,
        "needs_approval": prefs.needs_approval,
        "publish_failed": prefs.publish_failed,
        "weekly_digest": prefs.weekly_digest,
    }


@app.put("/notifications/preferences")
async def update_notification_preferences(
    req: NotificationPreferencesRequest,
    db: AsyncSession = Depends(get_db), user_id: uuid.UUID = Depends(require_auth),
):
    prefs = await get_or_create_notification_prefs(db, user_id)
    prefs.before_publish = req.before_publish
    prefs.needs_approval = req.needs_approval
    prefs.publish_failed = req.publish_failed
    prefs.weekly_digest = req.weekly_digest
    await db.commit()
    return {"ok": True}


@app.post("/notifications/push-subscription")
async def register_push_subscription(
    req: PushSubscriptionRequest,
    db: AsyncSession = Depends(get_db), user_id: uuid.UUID = Depends(require_auth),
):
    """Upsert by endpoint - re-subscribing the same browser (e.g. after a
    key rotation Chrome does periodically) updates the existing row instead
    of creating a duplicate that would double-send pushes to one device."""
    result = await db.execute(select(PushSubscription).where(PushSubscription.endpoint == req.endpoint))
    sub = result.scalar_one_or_none()
    if sub is None:
        sub = PushSubscription(
            user_id=user_id, endpoint=req.endpoint,
            p256dh=req.keys.p256dh, auth=req.keys.auth,
        )
        db.add(sub)
    else:
        sub.user_id = user_id
        sub.p256dh = req.keys.p256dh
        sub.auth = req.keys.auth
    await db.commit()
    return {"ok": True}


@app.delete("/notifications/push-subscription")
async def remove_push_subscription(
    req: PushUnsubscribeRequest,
    db: AsyncSession = Depends(get_db), user_id: uuid.UUID = Depends(require_auth),
):
    result = await db.execute(
        select(PushSubscription).where(
            PushSubscription.endpoint == req.endpoint, PushSubscription.user_id == user_id,
        )
    )
    sub = result.scalar_one_or_none()
    if sub is not None:
        await db.delete(sub)
        await db.commit()
    return {"ok": True}


@app.get("/connect/{platform}/history")
async def platform_post_history(
    platform: str,
    limit: int = 50,
    debug: bool = False,
    db: AsyncSession = Depends(get_db),
    user_id: uuid.UUID = Depends(require_auth),
):
    """The account's REAL post history, pulled live from the platform itself -
    not from T01's own drafts table. This is the only way to surface posts
    made before the account was ever connected here, since T01 has no local
    record of those at all.

    `debug=true` includes Meta's raw first-page response alongside the
    normalized posts, so an unexpectedly-empty result can be diagnosed
    without needing server log access.
    """
    try:
        platform_enum = Platform(platform)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"platform must be one of: {', '.join(p.value for p in Platform)}")

    if platform_enum == Platform.LINKEDIN:
        # LinkedIn only grants this app w_member_social (publish-only) -
        # reading a member's past posts needs r_member_social, which is a
        # restricted, partner-only scope LinkedIn doesn't hand out to
        # regular apps. There's no way around this without LinkedIn
        # approving that additional permission for the app.
        raise HTTPException(
            status_code=400,
            detail="LinkedIn doesn't allow to read your past posts (only to publish new ones), "
                   "so pre-existing LinkedIn posts can't be shown here.",
        )
    if platform_enum not in (Platform.INSTAGRAM, Platform.FACEBOOK, Platform.THREADS):
        raise HTTPException(status_code=400, detail=f"Post history isn't supported for {platform}.")

    result = await db.execute(
        select(PlatformConnection.credentials).where(
            PlatformConnection.user_id == user_id, PlatformConnection.platform == platform_enum
        )
    )
    row = result.first()
    if not row:
        raise HTTPException(status_code=404, detail=f"{platform} isn't connected.")
    credentials = dict(row[0] or {})
    for field in SECRET_CREDENTIAL_FIELDS.get(platform_enum, []):
        if field in credentials:
            credentials[field] = decrypt_secret(credentials[field])

    debug_raw = None
    try:
        if platform_enum == Platform.INSTAGRAM:
            raw_posts, debug_raw = await run_in_threadpool(
                instagram_fetch_media, credentials["page_access_token"], credentials["ig_page_id"], limit, debug
            )
            posts = [
                {
                    "id": p["id"],
                    "text": p.get("caption") or "",
                    "image": p.get("media_url") or p.get("thumbnail_url"),
                    "permalink": p.get("permalink"),
                    "published_at": p.get("timestamp"),
                }
                for p in raw_posts
            ]
        elif platform_enum == Platform.FACEBOOK:
            raw_posts = await run_in_threadpool(
                facebook_fetch_posts, credentials["page_access_token"], credentials["page_id"], limit
            )
            posts = [
                {
                    "id": p["id"],
                    "text": p.get("message") or "",
                    "image": p.get("full_picture"),
                    "permalink": p.get("permalink_url"),
                    "published_at": p.get("created_time"),
                }
                for p in raw_posts
            ]
        else:  # threads
            raw_posts = await run_in_threadpool(
                threads_fetch_posts, credentials["access_token"], credentials["threads_user_id"], limit
            )
            posts = [
                {
                    "id": p["id"],
                    "text": p.get("text") or "",
                    "image": p.get("media_url"),
                    "permalink": p.get("permalink"),
                    "published_at": p.get("timestamp"),
                }
                for p in raw_posts
            ]
    except requests.RequestException as e:
        # Surface Meta/Threads' actual error body when debugging - that's
        # usually exactly what explains an unexpectedly-empty result
        # (wrong permission, wrong node id, app not in the right mode, etc).
        detail = f"Couldn't reach {platform} to load post history: {e}"
        if debug and e.response is not None:
            try:
                detail += f" | response body: {e.response.text}"
            except Exception:
                pass
        raise HTTPException(status_code=502, detail=detail)
    except KeyError:
        raise HTTPException(status_code=400, detail=f"{platform} connection is missing required credentials - try reconnecting it.")

    response = {"platform": platform, "posts": posts}
    if debug:
        response["debug_ig_page_id"] = credentials.get("ig_page_id") or credentials.get("page_id") or credentials.get("threads_user_id")
        response["debug_raw_first_page"] = debug_raw
    return response



@app.delete("/connect/{platform}")
async def disconnect_platform(platform: str, db: AsyncSession = Depends(get_db), user_id: uuid.UUID = Depends(require_auth)):
    try:
        platform_enum = Platform(platform)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"platform must be one of: {', '.join(pl.value for pl in Platform)} (got {platform!r})")

    result = await db.execute(
        select(PlatformConnection).where(
            PlatformConnection.user_id == user_id,
            PlatformConnection.platform == platform_enum,
        )
    )
    connection = result.scalar_one_or_none()
    if connection is None:
        raise HTTPException(status_code=404, detail=f"No {platform_enum.value} connection found")

    await db.delete(connection)
    await db.commit()
    return {"success": True}


# ---------------------------------------------------------------------------
# Meta webhooks (Instagram + Facebook Page comments & messages)
#
# Two routes, both at /webhooks/meta:
#   GET  - the one-time handshake Meta sends when you save the callback URL
#          in the App Dashboard. Must echo back hub.challenge as plain text
#          if hub.verify_token matches ours, or the dashboard shows
#          "couldn't be validated".
#   POST - the actual event deliveries (new comment / new message). Verified
#          via the X-Hub-Signature-256 header (HMAC-SHA256 of the raw body,
#          signed with META_APP_SECRET) before we touch the payload, since
#          this endpoint is public by necessity.
#
# Events are matched to a user by looking up PlatformConnection rows whose
# credentials->>'page_id' (Facebook) or credentials->>'ig_page_id'
# (Instagram) equal the id in the payload - see _user_id_for_page below.
# Unmatched events (e.g. a stale/disconnected page) are logged and dropped
# rather than raising, since Meta will keep retrying a failing webhook and
# we don't want redelivery storms over an account someone already unlinked.
# ---------------------------------------------------------------------------

META_WEBHOOK_VERIFY_TOKEN = os.environ.get("META_WEBHOOK_VERIFY_TOKEN")

# FastAPI needs the raw query param names (hub.mode, hub.verify_token,
# hub.challenge) which aren't valid Python identifiers, so this route reads
# them off the raw Request instead of declaring them as function params.
from fastapi import Request as _Request
from fastapi.responses import PlainTextResponse as _PlainTextResponse


@app.get("/webhooks/meta", include_in_schema=False)
async def meta_webhook_verify(request: _Request):
    mode = request.query_params.get("hub.mode")
    token = request.query_params.get("hub.verify_token")
    challenge = request.query_params.get("hub.challenge")

    if mode != "subscribe" or not META_WEBHOOK_VERIFY_TOKEN or token != META_WEBHOOK_VERIFY_TOKEN:
        raise HTTPException(status_code=403, detail="Verification failed")

    return _PlainTextResponse(challenge or "")


def _verify_meta_signature(raw_body: bytes, signature_header: str | None) -> bool:
    if not signature_header or not META_APP_SECRET:
        return False
    if not signature_header.startswith("sha256="):
        return False
    expected = hmac.new(META_APP_SECRET.encode(), raw_body, hashlib.sha256).hexdigest()
    provided = signature_header.removeprefix("sha256=")
    return hmac.compare_digest(expected, provided)


async def _user_id_for_page(db: AsyncSession, platform: Platform, page_id: str) -> uuid.UUID | None:
    field = "ig_page_id" if platform == Platform.INSTAGRAM else "page_id"
    result = await db.execute(
        select(PlatformConnection.user_id).where(
            PlatformConnection.platform == platform,
            PlatformConnection.credentials[field].as_string() == page_id,
        )
    )
    return result.scalar_one_or_none()


async def _connection_for_page(db: AsyncSession, platform: Platform, page_id: str) -> PlatformConnection | None:
    """Like _user_id_for_page but returns the whole row - mentions need the
    stored page_access_token to make a follow-up Graph API call, since the
    webhook payload itself doesn't include the mentioning user's identity."""
    field = "ig_page_id" if platform == Platform.INSTAGRAM else "page_id"
    result = await db.execute(
        select(PlatformConnection).where(
            PlatformConnection.platform == platform,
            PlatformConnection.credentials[field].as_string() == page_id,
        )
    )
    return result.scalar_one_or_none()


def _fetch_mention_context(page_access_token: str, ig_page_id: str, value: dict) -> dict:
    """Runs in a threadpool (blocking `requests` call) - mentions webhooks
    only give us a media_id (caption mention) or comment_id+media_id
    (comment mention), never the mentioning user's identity directly, so we
    have to look it up via a follow-up Graph API call. Best-effort: on any
    error we return an empty dict and the inbox item is still recorded, just
    without a sender name/body filled in - better than dropping the event.
    """
    import requests

    comment_id = value.get("comment_id")
    media_id = value.get("media_id")

    if comment_id:
        try:
            resp = requests.get(
                f"https://graph.facebook.com/v21.0/{comment_id}",
                params={"fields": "text,username,timestamp", "access_token": page_access_token},
                timeout=10,
            )
            resp.raise_for_status()
            data = resp.json()
            return {
                "sender_name": data.get("username"),
                "body": data.get("text"),
                "thread_id": str(media_id or ""),
            }
        except Exception:
            return {"thread_id": str(media_id or "")}

    if media_id:
        try:
            resp = requests.get(
                f"https://graph.facebook.com/v21.0/{ig_page_id}",
                params={
                    "fields": f"mentioned_media.media_id({media_id}){{caption,media_type}}",
                    "access_token": page_access_token,
                },
                timeout=10,
            )
            resp.raise_for_status()
            data = resp.json().get("mentioned_media", {})
            # Meta's mentioned_media edge returns the caption but not the
            # author's username, so sender_name stays unset for caption
            # mentions - the caption text itself is still useful context.
            return {"body": data.get("caption"), "thread_id": str(media_id)}
        except Exception:
            return {"thread_id": str(media_id or "")}

    return {}


async def _user_id_for_threads_account(db: AsyncSession, threads_user_id: str) -> uuid.UUID | None:
    result = await db.execute(
        select(PlatformConnection.user_id).where(
            PlatformConnection.platform == Platform.THREADS,
            PlatformConnection.credentials["threads_user_id"].as_string() == threads_user_id,
        )
    )
    return result.scalar_one_or_none()


async def _upsert_inbox_item(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    platform: Platform,
    kind: InboxKind,
    external_id: str,
    thread_id: str | None,
    sender_name: str | None,
    sender_external_id: str | None,
    body: str | None,
    raw_payload: dict,
) -> None:
    existing = await db.execute(
        select(InboxItem.id).where(
            InboxItem.platform == platform, InboxItem.external_id == external_id
        )
    )
    if existing.scalar_one_or_none() is not None:
        return  # webhook redelivery of something we already recorded - no-op

    db.add(InboxItem(
        user_id=user_id,
        platform=platform,
        kind=kind,
        external_id=external_id,
        thread_id=thread_id,
        sender_name=sender_name,
        sender_external_id=sender_external_id,
        body=body,
        raw_payload=raw_payload,
    ))


@app.post("/webhooks/meta", include_in_schema=False)
async def meta_webhook_receive(request: _Request, db: AsyncSession = Depends(get_db)):
    raw_body = await request.body()
    signature = request.headers.get("X-Hub-Signature-256")
    if not _verify_meta_signature(raw_body, signature):
        print(f"[webhooks/meta] signature verification failed - header present: {signature is not None}", file=sys.stderr)
        raise HTTPException(status_code=403, detail="Invalid signature")

    payload = json.loads(raw_body)
    print(f"[webhooks/meta] received payload for object={payload.get('object')!r}, "
          f"{len(payload.get('entry', []))} entr(y/ies)", file=sys.stderr)

    for entry in payload.get("entry", []):
        page_id = str(entry.get("id", ""))

        # Instagram comments/mentions arrive under "changes"; DMs (both IG
        # and Facebook Messenger) arrive under "messaging". Facebook Page
        # feed comments also arrive under "changes" with a different field.
        for change in entry.get("changes", []):
            field = change.get("field")
            value = change.get("value", {})

            if field == "comments":
                platform = Platform.INSTAGRAM if payload.get("object") == "instagram" else Platform.FACEBOOK
                user_id = await _user_id_for_page(db, platform, page_id)
                if user_id is None:
                    print(f"[webhooks/meta] dropped comment - no PlatformConnection matches "
                          f"platform={platform.value} page_id={page_id!r}", file=sys.stderr)
                    continue
                await _upsert_inbox_item(
                    db, user_id=user_id, platform=platform, kind=InboxKind.COMMENT,
                    external_id=str(value.get("id")),
                    thread_id=str(value.get("media", {}).get("id") or value.get("post_id") or ""),
                    sender_name=(value.get("from") or {}).get("username") or (value.get("from") or {}).get("name"),
                    sender_external_id=(value.get("from") or {}).get("id"),
                    body=value.get("text") or value.get("message"),
                    raw_payload=change,
                )

            elif field == "mentions":
                # Instagram-only - someone @-mentioned the connected account
                # in a comment or caption on media the account doesn't own.
                # The payload gives just comment_id/media_id, not who did
                # it or what they said, so a follow-up Graph API call using
                # the page's stored access token fills that in.
                connection = await _connection_for_page(db, Platform.INSTAGRAM, page_id)
                if connection is None:
                    print(f"[webhooks/meta] dropped mention - no PlatformConnection matches "
                          f"platform=instagram page_id={page_id!r}", file=sys.stderr)
                    continue
                credentials = connection.credentials or {}
                page_access_token = credentials.get("page_access_token")
                ig_page_id = credentials.get("ig_page_id")
                if not page_access_token or not ig_page_id:
                    print(f"[webhooks/meta] dropped mention - connection {connection.id} "
                          f"missing page_access_token/ig_page_id in credentials", file=sys.stderr)
                    continue
                context = await run_in_threadpool(_fetch_mention_context, page_access_token, ig_page_id, value)
                await _upsert_inbox_item(
                    db, user_id=connection.user_id, platform=Platform.INSTAGRAM, kind=InboxKind.MENTION,
                    external_id=str(value.get("comment_id") or value.get("media_id")),
                    thread_id=context.get("thread_id", str(value.get("media_id") or "")),
                    sender_name=context.get("sender_name"),
                    sender_external_id=None,
                    body=context.get("body") or "Mentioned your account",
                    raw_payload=change,
                )

            else:
                print(f"[webhooks/meta] unhandled changes field={field!r} - ignoring", file=sys.stderr)

        for messaging_event in entry.get("messaging", []):
            platform = Platform.INSTAGRAM if payload.get("object") == "instagram" else Platform.FACEBOOK
            user_id = await _user_id_for_page(db, platform, page_id)
            if user_id is None:
                print(f"[webhooks/meta] dropped messaging event - no PlatformConnection matches "
                      f"platform={platform.value} page_id={page_id!r}", file=sys.stderr)
                continue
            message = messaging_event.get("message", {})
            if message.get("is_echo"):
                continue  # our own outgoing message, echoed back - not an inbound item

            sender_id = (messaging_event.get("sender") or {}).get("id")

            # Story mentions arrive as a messaging event with a
            # story_mention-typed attachment rather than as a "changes"
            # field - Meta delivers "someone tagged you in their story" the
            # same way it delivers a DM, just with this attachment shape
            # instead of message text. Recorded as its own kind, not a
            # message, since there's no conversation to reply into the way
            # a real DM has.
            attachments = message.get("attachments", [])
            story_mention = next((a for a in attachments if a.get("type") == "story_mention"), None)
            if story_mention is not None:
                await _upsert_inbox_item(
                    db, user_id=user_id, platform=platform, kind=InboxKind.STORY_REPLY,
                    external_id=str(message.get("mid") or f"story-{sender_id}-{messaging_event.get('timestamp')}"),
                    thread_id=str(sender_id or ""),
                    sender_name=None,  # not included in this event shape either
                    sender_external_id=sender_id,
                    body="Mentioned you in their story",
                    raw_payload=messaging_event,
                )
                continue

            await _upsert_inbox_item(
                db, user_id=user_id, platform=platform, kind=InboxKind.MESSAGE,
                external_id=str(message.get("mid") or f"{sender_id}-{messaging_event.get('timestamp')}"),
                thread_id=str(sender_id or ""),
                sender_name=None,  # Meta doesn't include a display name on the messaging event itself
                sender_external_id=sender_id,
                body=message.get("text"),
                raw_payload=messaging_event,
            )

    try:
        await db.commit()
    except Exception:
        print("[webhooks/meta] commit failed - event(s) from this payload were NOT saved:", file=sys.stderr)
        traceback.print_exc()
        raise
    return {"received": True}


@app.get("/inbox")
async def list_inbox(db: AsyncSession = Depends(get_db), user_id: uuid.UUID = Depends(require_auth)):
    result = await db.execute(
        select(InboxItem)
        .where(InboxItem.user_id == user_id)
        .order_by(InboxItem.created_at.desc())
        .limit(200)
    )
    items = result.scalars().all()
    return {
        "items": [
            {
                "id": str(item.id),
                "platform": item.platform.value,
                "kind": item.kind.value,
                "thread_id": item.thread_id,
                "sender_name": item.sender_name,
                "body": item.body,
                "is_read": item.is_read,
                "created_at": item.created_at.isoformat(),
            }
            for item in items
        ]
    }


@app.patch("/inbox/{item_id}/read")
async def mark_inbox_item_read(
    item_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user_id: uuid.UUID = Depends(require_auth),
):
    result = await db.execute(
        select(InboxItem).where(InboxItem.id == item_id, InboxItem.user_id == user_id)
    )
    item = result.scalar_one_or_none()
    if item is None:
        raise HTTPException(status_code=404, detail="Inbox item not found")
    item.is_read = True
    await db.commit()
    return {"id": str(item.id), "is_read": True}


# ---------------------------------------------------------------------------
# Threads webhooks - separate product from Instagram/Facebook in Meta's
# dashboard (Threads has its own "Subscribe to this object" screen), so it
# gets its own callback path and its own handshake/signature verification,
# even though the code is nearly identical to the /webhooks/meta routes
# above. Threads has no DMs as a platform - only "replies" (someone replying
# to your thread, recorded as InboxKind.COMMENT) and "mentions" (someone
# @-mentioning your account, recorded as InboxKind.MENTION) - same kind
# split as the Instagram comments/mentions handling above.
#
# Signing works the same way as the other Meta products - Threads payloads
# are also signed with the app's secret via X-Hub-Signature-256, so
# _verify_meta_signature is reused as-is.
# ---------------------------------------------------------------------------

@app.get("/webhooks/threads", include_in_schema=False)
async def threads_webhook_verify(request: _Request):
    mode = request.query_params.get("hub.mode")
    token = request.query_params.get("hub.verify_token")
    challenge = request.query_params.get("hub.challenge")

    if mode != "subscribe" or not META_WEBHOOK_VERIFY_TOKEN or token != META_WEBHOOK_VERIFY_TOKEN:
        raise HTTPException(status_code=403, detail="Verification failed")

    return _PlainTextResponse(challenge or "")


@app.post("/webhooks/threads", include_in_schema=False)
async def threads_webhook_receive(request: _Request, db: AsyncSession = Depends(get_db)):
    raw_body = await request.body()
    signature = request.headers.get("X-Hub-Signature-256")
    if not _verify_meta_signature(raw_body, signature):
        print(f"[webhooks/threads] signature verification failed - header present: {signature is not None}", file=sys.stderr)
        raise HTTPException(status_code=403, detail="Invalid signature")

    payload = json.loads(raw_body)
    print(f"[webhooks/threads] received payload, {len(payload.get('entry', []))} entr(y/ies)", file=sys.stderr)

    for entry in payload.get("entry", []):
        threads_user_id = str(entry.get("id", ""))
        user_id = await _user_id_for_threads_account(db, threads_user_id)
        if user_id is None:
            print(f"[webhooks/threads] dropped entry - no PlatformConnection matches "
                  f"threads_user_id={threads_user_id!r}", file=sys.stderr)
            continue

        for change in entry.get("changes", []):
            field = change.get("field")  # "replies" or "mentions"
            if field not in ("replies", "mentions"):
                print(f"[webhooks/threads] unhandled changes field={field!r} - ignoring", file=sys.stderr)
                continue
            value = change.get("value", {})
            kind = InboxKind.COMMENT if field == "replies" else InboxKind.MENTION
            await _upsert_inbox_item(
                db, user_id=user_id, platform=Platform.THREADS, kind=kind,
                external_id=str(value.get("id")),
                thread_id=str(value.get("root_post", {}).get("id") or value.get("replied_to", {}).get("id") or ""),
                sender_name=(value.get("from") or {}).get("username"),
                sender_external_id=(value.get("from") or {}).get("id"),
                body=value.get("text"),
                raw_payload=change,
            )

    try:
        await db.commit()
    except Exception:
        print("[webhooks/threads] commit failed - event(s) from this payload were NOT saved:", file=sys.stderr)
        traceback.print_exc()
        raise
    return {"received": True}