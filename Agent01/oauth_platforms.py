import os
import requests
from dotenv import load_dotenv

# Defensive: guarantees .env is loaded even if this module gets imported
# before main.py's load_dotenv() call (that ordering bug is exactly what
# caused every OAuth provider to read client_id as None).
load_dotenv(override=False)

LINKEDIN_CLIENT_ID = os.environ.get("LINKEDIN_CLIENT_ID")
LINKEDIN_CLIENT_SECRET = os.environ.get("LINKEDIN_CLIENT_SECRET")
META_APP_ID = os.environ.get("APP_ID") or os.environ.get("META_APP_ID")
META_APP_SECRET = os.environ.get("APP_SECRET") or os.environ.get("META_APP_SECRET")
THREADS_CLIENT_ID = os.environ.get("THREADS_APP_ID")
THREADS_CLIENT_SECRET = os.environ.get("THREADS_APP_SECRET")
BACKEND_BASE_URL = os.environ.get("BACKEND_BASE_URL", "http://localhost:8000")

# Threads rejects non-HTTPS redirect_uris outright, even for localhost -
# unlike LinkedIn/Facebook/Instagram, which tolerate plain http://localhost
# for local dev. Rather than force every platform onto an HTTPS ngrok
# tunnel (and having to re-register 4 dashboards every time ngrok restarts
# with a new URL), Threads gets its own overridable base. Point
# THREADS_BACKEND_BASE_URL at your current ngrok HTTPS URL and leave
# BACKEND_BASE_URL alone for everything else.
THREADS_BACKEND_BASE_URL = os.environ.get("THREADS_BACKEND_BASE_URL", BACKEND_BASE_URL)


def _redirect_uri(platform: str) -> str:
    base = THREADS_BACKEND_BASE_URL if platform == "threads" else BACKEND_BASE_URL
    return f"{base}/connect/{platform}/callback"


# LinkedIn 

def linkedin_authorize_url(state: str) -> str:
    return (
        "https://www.linkedin.com/oauth/v2/authorization"
        f"?response_type=code&client_id={LINKEDIN_CLIENT_ID}"
        f"&redirect_uri={_redirect_uri('linkedin')}&state={state}"
        "&scope=openid%20profile%20w_member_social"
    )


def linkedin_finish(code: str) -> dict:
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
    return {"access_token": access_token, "member_id": userinfo.json()["sub"]}


# Facebook 

def facebook_authorize_url(state: str) -> str:
    return (
        "https://www.facebook.com/v21.0/dialog/oauth"
        f"?client_id={META_APP_ID}&redirect_uri={_redirect_uri('facebook')}&state={state}"
        "&scope=pages_manage_posts,pages_read_engagement,pages_show_list,business_management"
    )


def _meta_exchange_long_lived(short_token: str) -> str:
    resp = requests.get(
        "https://graph.facebook.com/v21.0/oauth/access_token",
        params={"grant_type": "fb_exchange_token", "client_id": META_APP_ID,
                "client_secret": META_APP_SECRET, "fb_exchange_token": short_token},
        timeout=15,
    )
    resp.raise_for_status()
    return resp.json()["access_token"]


def list_pages(long_lived_user_token: str) -> list[dict]:
    resp = requests.get(
        "https://graph.facebook.com/v21.0/me/accounts",
        params={"access_token": long_lived_user_token},
        timeout=15,
    )
    resp.raise_for_status()
    pages = resp.json().get("data", [])
    if not pages:
        raise ValueError("No Facebook Pages found - a Page is required to publish.")
    return pages  # each: {"id", "name", "access_token", ...}


def facebook_exchange(code: str) -> str:
    """Code -> long-lived user token. Shared first step for Facebook + Instagram."""
    resp = requests.get(
        "https://graph.facebook.com/v21.0/oauth/access_token",
        params={"client_id": META_APP_ID, "redirect_uri": _redirect_uri("facebook"),
                "client_secret": META_APP_SECRET, "code": code},
        timeout=15,
    )
    resp.raise_for_status()
    return _meta_exchange_long_lived(resp.json()["access_token"])


def instagram_exchange(code: str) -> str:
    resp = requests.get(
        "https://graph.facebook.com/v21.0/oauth/access_token",
        params={"client_id": META_APP_ID, "redirect_uri": _redirect_uri("instagram"),
                "client_secret": META_APP_SECRET, "code": code},
        timeout=15,
    )
    resp.raise_for_status()
    return _meta_exchange_long_lived(resp.json()["access_token"])


def facebook_credentials_from_page(page: dict) -> dict:
    return {"page_access_token": page["access_token"], "page_id": page["id"]}


def instagram_credentials_from_page(page: dict) -> dict:
    ig_resp = requests.get(
        f"https://graph.facebook.com/v21.0/{page['id']}",
        params={"fields": "instagram_business_account", "access_token": page["access_token"]},
        timeout=15,
    )
    ig_resp.raise_for_status()
    ig_account = ig_resp.json().get("instagram_business_account")
    if not ig_account:
        raise ValueError(f"The Page '{page.get('name', page['id'])}' has no linked Instagram Business account.")
    return {"page_access_token": page["access_token"], "ig_page_id": ig_account["id"]}
def facebook_finish(code: str) -> dict:
    long_token = facebook_exchange(code)
    pages = list_pages(long_token)
    return facebook_credentials_from_page(pages[0])


# Instagram 

def instagram_authorize_url(state: str) -> str:
    return (
        "https://www.facebook.com/v21.0/dialog/oauth"
        f"?client_id={META_APP_ID}&redirect_uri={_redirect_uri('instagram')}&state={state}"
        "&scope=pages_show_list,business_management,instagram_basic,instagram_content_publish"
    )


def instagram_finish(code: str) -> dict:
    long_token = instagram_exchange(code)
    pages = list_pages(long_token)
    return instagram_credentials_from_page(pages[0])


# Threads 

def threads_authorize_url(state: str) -> str:
    # Meta made the threads.net -> threads.com migration permanent and
    # directional (.net now always bounces to .com). That's a bare
    # domain-level redirect, and it drops the query string (client_id,
    # redirect_uri, scope, state) along the way — landing on .com with no
    # params, which Threads reports as a generic "unknown error". Point
    # straight at threads.com so nothing gets lost in the hop.
    return (
        "https://www.threads.com/oauth/authorize"
        f"?client_id={THREADS_CLIENT_ID}&redirect_uri={_redirect_uri('threads')}"
        f"&scope=threads_basic,threads_content_publish&response_type=code&state={state}"
    )


def threads_finish(code: str) -> dict:
    resp = requests.post(
        "https://graph.threads.net/oauth/access_token",
        data={"client_id": THREADS_CLIENT_ID, "client_secret": THREADS_CLIENT_SECRET,
              "grant_type": "authorization_code", "redirect_uri": _redirect_uri("threads"), "code": code},
        timeout=15,
    )
    resp.raise_for_status()
    short_token = resp.json()["access_token"]

    long_resp = requests.get(
        "https://graph.threads.net/access_token",
        params={"grant_type": "th_exchange_token", "client_secret": THREADS_CLIENT_SECRET, "access_token": short_token},
        timeout=15,
    )
    long_resp.raise_for_status()
    long_token = long_resp.json()["access_token"]

    me_resp = requests.get(
        "https://graph.threads.net/v1.0/me",
        params={"fields": "id", "access_token": long_token},
        timeout=15,
    )
    me_resp.raise_for_status()
    return {"access_token": long_token, "threads_user_id": me_resp.json()["id"]}


OAUTH_PROVIDERS = {
    "linkedin": {"authorize_url": linkedin_authorize_url, "finish": linkedin_finish},
    "facebook": {"authorize_url": facebook_authorize_url, "finish": facebook_finish},
    "instagram": {"authorize_url": instagram_authorize_url, "finish": instagram_finish},
    "threads": {"authorize_url": threads_authorize_url, "finish": threads_finish},
}