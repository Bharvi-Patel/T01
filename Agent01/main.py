import json
import os
import secrets
import sys
import uuid
from pathlib import Path

from dotenv import load_dotenv

# Must run before importing auth_oauth / oauth_platforms — both read their
# client IDs and secrets from os.environ at MODULE IMPORT TIME. If .env
# hasn't been loaded yet, every provider silently locks in None for its
# client_id, which is why OAuth login/connect fails identically across
# every platform with "invalid_client" rather than just one misconfigured
# provider.
load_dotenv(override=True)

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool
from auth_oauth import LOGIN_PROVIDERS, x_start, x_finish

import time
from fastapi.responses import RedirectResponse
from oauth_platforms import (
    OAUTH_PROVIDERS, facebook_exchange, instagram_exchange, 
    facebook_credentials_from_page, instagram_credentials_from_page, list_pages,  
)

PENDING_PAGE_SELECTIONS: dict[str, dict] = {} # pending_id -> {"user_id","platform","pages","expires_at"}

FRONTEND_BASE_URL = os.environ.get("FRONTEND_BASE_URL", "http://localhost:5173")
OAUTH_STATES: dict[str, dict] = {} 


sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "Agent01"))

from Agent import agent01, revise_draft, approve_and_publish, clean_json_string, VALID_CATEGORIES

from db import (
    AsyncSessionLocal,
    Draft,
    DraftStatus,
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

    user = User(username=username, password_hash=None)
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

    
@app.on_event("startup")
async def on_startup():
    global ADMIN_USER_ID
    await init_db()
    async with AsyncSessionLocal() as session:
        ADMIN_USER_ID = await _get_or_create_admin_user(session)



class LoginRequest(BaseModel):
    username: str
    password: str

class SignupRequest(BaseModel):
    username: str
    email: str
    password: str


class GenerateRequest(BaseModel):
    category: str
    subtopic: str
    word_count: int


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
    result = await db.execute(select(User).where(User.username == req.username))
    user = result.scalar_one_or_none()
    if user is None or not verify_password(req.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid username or password")

    token = secrets.token_urlsafe(32)
    AUTH_TOKENS[token] = user.id
    return {"token": token}


async def _get_or_create_admin_user(session: AsyncSession):
    if not ADMIN_USERNAME or not ADMIN_PASSWORD:
        raise RuntimeError("ADMIN_USERNAME / ADMIN_PASSWORD not set in .env")
    result = await session.execute(select(User).where(User.username == ADMIN_USERNAME))
    user = result.scalar_one_or_none()
    if user is None:
        user = User(username=ADMIN_USERNAME, password_hash=hash_password(ADMIN_PASSWORD))
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

    user = User(username=req.username, email=email, password_hash=hash_password(req.password))
    db.add(user)
    await db.commit()
    await db.refresh(user)

    token = secrets.token_urlsafe(32)
    AUTH_TOKENS[token] = user.id
    return {"token": token}


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
        user_id=ADMIN_USER_ID,
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
    await _upsert_connection(db, user_id, Platform.META_FACEBOOK, {"page_access_token": encrypt_secret(req.page_access_token), "page_id": req.page_id})
    return {"success": True}

@app.post("/connect/instagram")
async def connect_instagram(req: ConnectInstagramRequest, db: AsyncSession = Depends(get_db),  user_id: uuid.UUID = Depends(require_auth)):
    await _upsert_connection(db, user_id, Platform.META_INSTAGRAM, {"page_access_token": encrypt_secret(req.page_access_token), "ig_page_id": req.ig_page_id})
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
                live=req.live,
            )
            success = True
            detail = json.dumps(publish_result) if not isinstance(publish_result, str) else publish_result
        except Exception as e:
            publish_result, success, detail = None, False, str(e)

        results[platform.value] = publish_result if success else {"success": False, "error": detail}
        any_success = any_success or success
        db.add(PublishResult(draft_id=draft.id, platform=platform, success=success, detail=detail))

    draft.status = DraftStatus.PUBLISHED if any_success else DraftStatus.PUBLISH_FAILED
    await db.commit()

    return {"draft_id": str(draft.id), "results": results}

@app.get("/connections")
async def list_connections(db: AsyncSession = Depends(get_db), user_id: uuid.UUID = Depends(require_auth)):
    result = await db.execute(select(PlatformConnection.platform).where(PlatformConnection.user_id == user_id))
    return {"connections": [p.value for p in result.scalars().all()]}