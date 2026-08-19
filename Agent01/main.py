import asyncio
import json
import os
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
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool
from auth_oauth import LOGIN_PROVIDERS, x_start, x_finish
from emailer import send_verification_email

import time
from fastapi.responses import RedirectResponse
from oauth_platforms import (
    OAUTH_PROVIDERS, facebook_exchange, instagram_exchange, 
    facebook_credentials_from_page, instagram_credentials_from_page, list_pages,  
)

PENDING_PAGE_SELECTIONS: dict[str, dict] = {} # pending_id -> {"user_id","platform","pages","expires_at"}

FRONTEND_BASE_URL = os.environ.get("FRONTEND_BASE_URL", "http://localhost:5173")
BACKEND_BASE_URL = os.environ.get("BACKEND_BASE_URL", "http://localhost:8000")
OAUTH_STATES: dict[str, dict] = {} 

# Local disk storage for user-uploaded video. Images from manual drafts go
# through the same imgbb hosting the AI path already uses (Instagram etc.
# need a public URL regardless of who supplied the image) - but imgbb only
# accepts images, so video is served directly off this backend instead.
# NOTE: no publish adapter currently posts video to any platform - it's
# stored and shown in review, but Approve & publish only sends the text +
# images through. Wiring per-platform video upload is separate future work.
MEDIA_DIR = Path(__file__).resolve().parent / "media"
MEDIA_DIR.mkdir(exist_ok=True)
EMAIL_VERIFICATION_TOKEN_TTL_HOURS = int(os.environ.get("EMAIL_VERIFICATION_TOKEN_TTL_HOURS", "24"))


sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "Agent01"))

from Agent import agent01, revise_draft, approve_and_publish, clean_json_string, VALID_CATEGORIES, upload_to_imgbb, IMGBB_API_KEY, suggest_hashtags

from db import (
    AsyncSessionLocal,
    Draft,
    DraftStatus,
    OAuthIdentity,
    Platform,
    PlatformConnection,
    PublishResult,
    User,
    decrypt_secret,
    encrypt_secret,
    hash_password,
    verify_password,
    get_db,
    init_db,
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

app = FastAPI(title="Content Agent API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/media", StaticFiles(directory=MEDIA_DIR), name="media")

# In-memory auth tokens issued by /login. Resets on server restart, which
# just logs everyone out - fine for an internal single-admin tool. Real
# multi-user accounts (against the `users` table) are a separate task -
# for now every draft is attributed to one bootstrapped admin User row,
# purely so drafts/platform_connections have a valid user_id FK to hang off.
AUTH_TOKENS: dict[str, uuid.UUID] = {}
ADMIN_USER_ID = None  # set on startup

bearer_scheme = HTTPBearer(auto_error=False)


def require_auth(creds: HTTPAuthorizationCredentials | None = Depends(bearer_scheme)) -> uuid.UUID:
    if creds is None or creds.credentials not in AUTH_TOKENS:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return AUTH_TOKENS[creds.credentials]



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
    token = secrets.token_urlsafe(32)
    AUTH_TOKENS[token] = user_id
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


async def _scheduler_loop():
    while True:
        try:
            await _run_due_scheduled_drafts()
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

    token = secrets.token_urlsafe(32)
    AUTH_TOKENS[token] = user.id
    return {"token": token}


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
                "url": f"{BACKEND_BASE_URL}/media/{stored_name}",
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

    # A date-range filter matches drafts scheduled in that range OR published
    # in that range, so calendar views can pull both upcoming and past posts
    # with a single call.
    if scheduled_from is not None or scheduled_to is not None:
        from_utc = _ensure_utc(scheduled_from) if scheduled_from is not None else None
        to_utc = _ensure_utc(scheduled_to) if scheduled_to is not None else None

        sched_cond = Draft.scheduled_at.isnot(None)
        pub_cond = first_published_subq.c.first_published_at.isnot(None)
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
        db.add(PublishResult(draft_id=draft.id, platform=platform, success=success, detail=detail))

    draft.status = DraftStatus.PUBLISHED if any_success else DraftStatus.PUBLISH_FAILED
    draft.scheduled_at = None
    draft.scheduled_platforms = None
    draft.scheduled_live = False
    await db.commit()
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
    result = await db.execute(select(PlatformConnection.platform).where(PlatformConnection.user_id == user_id))
    return {"connections": [p.value for p in result.scalars().all()]}



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