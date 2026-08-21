import base64
import hashlib
import os
import secrets

import requests
from dotenv import load_dotenv

# Defensive: guarantees .env is loaded even if this module gets imported
# before main.py's load_dotenv() call (that ordering bug is exactly what
# caused every OAuth provider to read client_id as None).
load_dotenv(override=False)

# Reuse the same app credentials oauth_platforms.py already loads for the
# publish connectors — Google is the only provider that needs its own app
# registration; LinkedIn/Facebook already have one from the connector flow,
# just with a second redirect URI (/auth/{provider}/callback) added to it.
from oauth_platforms import (
    LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET,
    META_APP_ID, META_APP_SECRET,
)

BACKEND_BASE_URL = os.environ.get("BACKEND_BASE_URL", "http://localhost:8000")
GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID")
GOOGLE_CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET")
X_CLIENT_ID = os.environ.get("X_CLIENT_ID")
X_CLIENT_SECRET = os.environ.get("X_CLIENT_SECRET")


def _redirect_uri(provider: str) -> str:
    return f"{BACKEND_BASE_URL}/auth/{provider}/callback"


# Google

def google_authorize_url(state: str) -> str:
    return (
        "https://accounts.google.com/o/oauth2/v2/auth"
        f"?response_type=code&client_id={GOOGLE_CLIENT_ID}"
        f"&redirect_uri={_redirect_uri('google')}&state={state}"
        "&scope=openid%20email%20profile&access_type=online"
    )


def google_finish(code: str) -> dict:
    resp = requests.post(
        "https://oauth2.googleapis.com/token",
        data={
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": _redirect_uri("google"),
            "client_id": GOOGLE_CLIENT_ID,
            "client_secret": GOOGLE_CLIENT_SECRET,
        },
        timeout=15,
    )
    resp.raise_for_status()
    access_token = resp.json()["access_token"]

    userinfo = requests.get(
        "https://openidconnect.googleapis.com/v1/userinfo",
        headers={"Authorization": f"Bearer {access_token}"},
        timeout=15,
    )
    userinfo.raise_for_status()
    info = userinfo.json()
    return {
        "provider_user_id": info["sub"],
        "email": info.get("email"),
        "profile_name": info.get("name"),
        "profile_picture_url": info.get("picture"),
    }


# LinkedIn (login only — just identifies the member via openid/profile/email;
# the w_member_social publish scope is a separate authorization, requested by
# oauth_platforms.py's connector flow, not this one)

def linkedin_login_authorize_url(state: str) -> str:
    return (
        "https://www.linkedin.com/oauth/v2/authorization"
        f"?response_type=code&client_id={LINKEDIN_CLIENT_ID}"
        f"&redirect_uri={_redirect_uri('linkedin')}&state={state}"
        "&scope=openid%20profile%20email"
    )


def linkedin_login_finish(code: str) -> dict:
    resp = requests.post(
        "https://www.linkedin.com/oauth/v2/accessToken",
        data={
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": _redirect_uri("linkedin"),
            "client_id": LINKEDIN_CLIENT_ID,
            "client_secret": LINKEDIN_CLIENT_SECRET,
        },
        timeout=15,
    )
    resp.raise_for_status()
    access_token = resp.json()["access_token"]

    userinfo = requests.get(
        "https://api.linkedin.com/v2/userinfo",
        headers={"Authorization": f"Bearer {access_token}"},
        timeout=15,
    )
    userinfo.raise_for_status()
    info = userinfo.json()
    return {
        "provider_user_id": info["sub"],
        "email": info.get("email"),
        "profile_name": info.get("name"),
        "profile_picture_url": info.get("picture"),
    }


# Facebook (login only — public_profile + email, not the Page-publish scopes
# oauth_platforms.py's connector flow requests)

def facebook_login_authorize_url(state: str) -> str:
    return (
        "https://www.facebook.com/v21.0/dialog/oauth"
        f"?client_id={META_APP_ID}&redirect_uri={_redirect_uri('facebook')}&state={state}"
        "&scope=public_profile,email"
    )


def facebook_login_finish(code: str) -> dict:
    resp = requests.get(
        "https://graph.facebook.com/v21.0/oauth/access_token",
        params={
            "client_id": META_APP_ID,
            "redirect_uri": _redirect_uri("facebook"),
            "client_secret": META_APP_SECRET,
            "code": code,
        },
        timeout=15,
    )
    resp.raise_for_status()
    access_token = resp.json()["access_token"]

    profile = requests.get(
        "https://graph.facebook.com/me",
        params={"fields": "id,name,email,picture", "access_token": access_token},
        timeout=15,
    )
    profile.raise_for_status()
    info = profile.json()
    return {
        "provider_user_id": info["id"],
        "email": info.get("email"),
        "profile_name": info.get("name"),
        "profile_picture_url": (info.get("picture") or {}).get("data", {}).get("url"),
    }


LOGIN_PROVIDERS = {
    "google": {"authorize_url": google_authorize_url, "finish": google_finish},
    "linkedin": {"authorize_url": linkedin_login_authorize_url, "finish": linkedin_login_finish},
    "facebook": {"authorize_url": facebook_login_authorize_url, "finish": facebook_login_finish},
}


# X / Twitter — special-cased (not folded into LOGIN_PROVIDERS) because X's
# OAuth2 login flow requires PKCE: a code_verifier generated at authorize-url
# time that must be handed back in at finish time. main.py stores it
# server-side keyed by `state` between the two calls.

def x_start(state: str) -> tuple[str, str]:
    """Returns (authorize_url, code_verifier). Caller must persist
    code_verifier (keyed by state) and pass it into x_finish later."""
    code_verifier = secrets.token_urlsafe(64)[:128]
    challenge = base64.urlsafe_b64encode(hashlib.sha256(code_verifier.encode()).digest()).decode().rstrip("=")
    url = (
        "https://twitter.com/i/oauth2/authorize"
        f"?response_type=code&client_id={X_CLIENT_ID}"
        f"&redirect_uri={_redirect_uri('x')}&state={state}"
        "&scope=tweet.read%20users.read"
        f"&code_challenge={challenge}&code_challenge_method=S256"
    )
    return url, code_verifier


def x_finish(code: str, code_verifier: str) -> dict:
    resp = requests.post(
        "https://api.twitter.com/2/oauth2/token",
        data={
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": _redirect_uri("x"),
            "code_verifier": code_verifier,
            "client_id": X_CLIENT_ID,
        },
        auth=(X_CLIENT_ID, X_CLIENT_SECRET),
        timeout=15,
    )
    resp.raise_for_status()
    access_token = resp.json()["access_token"]

    profile = requests.get(
        "https://api.twitter.com/2/users/me",
        headers={"Authorization": f"Bearer {access_token}"},
        params={"user.fields": "profile_image_url"},
        timeout=15,
    )
    profile.raise_for_status()
    data = profile.json()["data"]
    return {
        "provider_user_id": data["id"],
        "email": None,  # X's API doesn't expose email under this scope
        "profile_name": data.get("name"),
        "profile_picture_url": data.get("profile_image_url"),
    }