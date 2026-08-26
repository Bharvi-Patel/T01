import os
import re
import sys
import requests
from dotenv import load_dotenv

# Defensive: guarantees .env is loaded even if this module gets imported
# before main.py's load_dotenv() call (that ordering bug is exactly what
# caused every OAuth provider to read client_id as None).
load_dotenv(override=False)

LINKEDIN_CLIENT_ID = os.environ.get("LINKEDIN_CLIENT_ID")
LINKEDIN_CLIENT_SECRET = os.environ.get("LINKEDIN_CLIENT_SECRET")
LINKEDIN_API_VERSION = os.environ.get("LINKEDIN_API_VERSION", "202607")
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
    info = userinfo.json()
    return {
        "access_token": access_token,
        "member_id": info["sub"],
        "profile_name": info.get("name"),
        "profile_picture_url": info.get("picture"),
    }


# Facebook 

def facebook_authorize_url(state: str) -> str:
    return (
        "https://www.facebook.com/v21.0/dialog/oauth"
        f"?client_id={META_APP_ID}&redirect_uri={_redirect_uri('facebook')}&state={state}"
        "&scope=pages_manage_posts,pages_read_engagement,pages_show_list,business_management,"
        "pages_messaging,pages_manage_metadata"
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


def _facebook_page_picture_url(page_id: str, page_access_token: str) -> str | None:
    try:
        resp = requests.get(
            f"https://graph.facebook.com/v21.0/{page_id}/picture",
            params={"redirect": "false", "access_token": page_access_token},
            timeout=15,
        )
        resp.raise_for_status()
        return resp.json().get("data", {}).get("url")
    except requests.RequestException:
        return None


def _subscribe_page_to_webhooks(page_id: str, page_access_token: str, fields: str) -> None:
    """Toggling fields on in the App Dashboard only tells Meta which events
    your app is *capable* of receiving - it does not enroll any particular
    Page/IG account to actually send them. That enrollment is this call,
    and it has to happen once per connected account (safe to repeat -
    resubscribing just overwrites the field list). Without it, webhooks
    the app is otherwise correctly configured for will never fire, with no
    error surfaced anywhere - the events are simply never sent.

    Meta validates subscribed_fields as one atomic list: if ANY field name
    in the request isn't in the account's currently-permitted set (e.g.
    "comments"/"mentions" plural aren't valid here even though the
    matching webhook payload later arrives under those same names - Meta's
    Page-level subscription endpoint wants "mention" singular, and some
    fields simply aren't grantable until the right permission/product is
    approved), the WHOLE call is rejected with a 400 - including fields
    that would have been perfectly valid on their own, e.g. "messages".
    So a single bad field name silently blocks every other field too. To
    avoid that, on a "must be one of {...}" 400 we parse the allowed set
    Meta just told us about, keep only our requested fields that are in
    it, and retry once with that trimmed list rather than giving up
    entirely on a single typo/unsupported field.

    Best-effort: the account connection itself has already succeeded by
    the time this runs, so a failure here shouldn't undo that - it just
    means comments/DMs/mentions won't reach the inbox until retried.
    """
    requested = [f.strip() for f in fields.split(",") if f.strip()]

    def _attempt(field_list: list[str]) -> bool:
        """Returns True on success, False on failure (already logged)."""
        if not field_list:
            print(f"[oauth_platforms] subscribed_apps for page {page_id}: no valid fields left to subscribe, giving up", file=sys.stderr)
            return False
        try:
            resp = requests.post(
                f"https://graph.facebook.com/v21.0/{page_id}/subscribed_apps",
                params={"subscribed_fields": ",".join(field_list), "access_token": page_access_token},
                timeout=15,
            )
            if resp.ok and resp.json().get("success"):
                print(f"[oauth_platforms] subscribed_apps for page {page_id} succeeded with fields: {field_list}", file=sys.stderr)
                return True
            if not resp.ok:
                print(f"[oauth_platforms] subscribed_apps for page {page_id} failed "
                      f"({resp.status_code}): {resp.text}", file=sys.stderr)
                # Meta's error spells out the full valid set in single
                # quotes inside a {comma, separated, list} - extract it and
                # keep only our requested fields that are actually in it.
                try:
                    err_msg = resp.json().get("error", {}).get("message", "")
                    m = re.search(r"must be one of \{([^}]*)\}", err_msg)
                    if m:
                        allowed = {f.strip() for f in m.group(1).split(",")}
                        retry_fields = [f for f in field_list if f in allowed]
                        if retry_fields and retry_fields != field_list:
                            print(f"[oauth_platforms] retrying page {page_id} subscribed_apps "
                                  f"with only Meta-accepted fields: {retry_fields}", file=sys.stderr)
                            return _attempt(retry_fields)
                except (ValueError, KeyError):
                    pass
            else:
                print(f"[oauth_platforms] subscribed_apps for page {page_id} returned success=false: {resp.text}", file=sys.stderr)
            return False
        except requests.RequestException as e:
            print(f"[oauth_platforms] subscribed_apps failed for page {page_id}: {e}", file=sys.stderr)
            return False

    _attempt(requested)


def facebook_credentials_from_page(page: dict) -> dict:
    _subscribe_page_to_webhooks(page["id"], page["access_token"], "feed,messages")
    return {
        "page_access_token": page["access_token"],
        "page_id": page["id"],
        "profile_name": page.get("name"),
        "profile_picture_url": _facebook_page_picture_url(page["id"], page["access_token"]),
    }


def instagram_credentials_from_page(page: dict) -> dict:
    ig_resp = requests.get(
        f"https://graph.facebook.com/v21.0/{page['id']}",
        params={
            "fields": "instagram_business_account{id,username,profile_picture_url}",
            "access_token": page["access_token"],
        },
        timeout=15,
    )
    ig_resp.raise_for_status()
    ig_payload = ig_resp.json()
    ig_account = ig_payload.get("instagram_business_account")
    if not ig_account:
        raise ValueError(f"The Page '{page.get('name', page['id'])}' has no linked Instagram Business account.")

    # Instagram webhooks (comments/mentions/messages) route through the
    # linked Facebook Page's subscription, same endpoint as the Facebook
    # case above, just with IG-specific fields. Note this endpoint's
    # accepted field names don't always match the names Meta uses in the
    # actual delivered webhook payload - "mention" (singular) is what this
    # call accepts to enable it, even though the event itself later
    # arrives tagged field="mentions" (see meta_webhook_receive). "comments"
    # isn't in this account's currently-permitted set at all yet (Meta
    # rejects it outright), so it's left out here for now - the
    # auto-retry in _subscribe_page_to_webhooks will still salvage
    # "mention"/"messages" even if this list is ever widened again and one
    # entry turns out to be invalid for a given account.
    _subscribe_page_to_webhooks(page["id"], page["access_token"], "mention,messages")

    return {
        "page_access_token": page["access_token"],
        "ig_page_id": ig_account["id"],
        # The Facebook Page ID (NOT ig_page_id) is what /subscribed_apps and
        # any other Page-scoped Graph API call need - Meta rejects those
        # calls with the IG business account id ("(#3) Application does not
        # have the capability to make this API call", easy to misread as a
        # permissions problem when it's actually just the wrong id type).
        # Stored here so a later resubscribe/backfill never has to guess it.
        "fb_page_id": page["id"],
        "profile_name": ig_account.get("username"),
        "profile_picture_url": ig_account.get("profile_picture_url"),
    }


def instagram_fetch_media(page_access_token: str, ig_page_id: str, limit: int = 50, debug: bool = False) -> tuple[list[dict], dict | None]:
    """Pull the account's real post history straight from Instagram, including
    everything posted before this account was ever connected to T01 (there's
    no local record of those - they only exist on Instagram's side).
    Returns (posts, first_raw_response) — the raw response is only populated
    when debug=True, for troubleshooting an unexpectedly-empty result.
    """
    posts, url = [], f"https://graph.facebook.com/v21.0/{ig_page_id}/media"
    params = {
        "fields": "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp",
        "access_token": page_access_token,
        "limit": min(limit, 100),
    }
    first_raw = None
    while url and len(posts) < limit:
        resp = requests.get(url, params=params, timeout=15)
        resp.raise_for_status()
        payload = resp.json()
        if first_raw is None and debug:
            first_raw = payload
        posts.extend(payload.get("data", []))
        url = payload.get("paging", {}).get("next")
        params = None
    return posts[:limit], first_raw


def facebook_fetch_posts(page_access_token: str, page_id: str, limit: int = 50) -> list[dict]:
    """Same idea as instagram_fetch_media, but for a Facebook Page's feed."""
    posts, url = [], f"https://graph.facebook.com/v21.0/{page_id}/posts"
    params = {
        "fields": "id,message,full_picture,permalink_url,created_time",
        "access_token": page_access_token,
        "limit": min(limit, 100),
    }
    while url and len(posts) < limit:
        resp = requests.get(url, params=params, timeout=15)
        resp.raise_for_status()
        payload = resp.json()
        posts.extend(payload.get("data", []))
        url = payload.get("paging", {}).get("next")
        params = None
    return posts[:limit]


def facebook_finish(code: str) -> dict:
    long_token = facebook_exchange(code)
    pages = list_pages(long_token)
    return facebook_credentials_from_page(pages[0])


# Instagram 

def instagram_authorize_url(state: str) -> str:
    return (
        "https://www.facebook.com/v21.0/dialog/oauth"
        f"?client_id={META_APP_ID}&redirect_uri={_redirect_uri('instagram')}&state={state}"
        "&scope=pages_show_list,pages_read_engagement,business_management,instagram_basic,"
        "instagram_content_publish,instagram_manage_messages,pages_messaging,pages_manage_metadata"
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

    # The user id is required - the connection can't be saved without it, so
    # that call stays unguarded. Username/profile picture are nice-to-have
    # display data only, so a field-name or permissions hiccup there must
    # never take down the whole connect flow.
    me_resp = requests.get(
        "https://graph.threads.net/v1.0/me",
        params={"fields": "id", "access_token": long_token},
        timeout=15,
    )
    me_resp.raise_for_status()
    threads_user_id = me_resp.json()["id"]

    profile_name, profile_picture_url = None, None
    try:
        profile_resp = requests.get(
            "https://graph.threads.net/v1.0/me",
            params={"fields": "username,threads_profile_picture_url", "access_token": long_token},
            timeout=15,
        )
        profile_resp.raise_for_status()
        profile = profile_resp.json()
        profile_name = profile.get("username")
        profile_picture_url = profile.get("threads_profile_picture_url")
    except requests.RequestException:
        pass

    return {
        "access_token": long_token,
        "threads_user_id": threads_user_id,
        "profile_name": profile_name,
        "profile_picture_url": profile_picture_url,
    }


def threads_fetch_posts(access_token: str, threads_user_id: str, limit: int = 50) -> list[dict]:
    """Real Threads post history, including anything posted before this
    account was connected to T01."""
    posts, url = [], f"https://graph.threads.net/v1.0/{threads_user_id}/threads"
    params = {
        "fields": "id,text,media_type,media_url,permalink,timestamp",
        "access_token": access_token,
        "limit": min(limit, 100),
    }
    while url and len(posts) < limit:
        resp = requests.get(url, params=params, timeout=15)
        resp.raise_for_status()
        payload = resp.json()
        posts.extend(payload.get("data", []))
        url = payload.get("paging", {}).get("next")
        params = None
    return posts[:limit]


# --- Analytics: follower counts + per-post engagement ----------------------
# Everything below is best-effort by design: a permissions gap or a transient
# API error on one platform must never break analytics for the others, so
# every function here catches request failures and returns None rather than
# raising. Called from POST /analytics/refresh in main.py.

def facebook_fetch_follower_count(page_access_token: str, page_id: str) -> int | None:
    try:
        resp = requests.get(
            f"https://graph.facebook.com/v21.0/{page_id}",
            params={"fields": "fan_count", "access_token": page_access_token},
            timeout=15,
        )
        resp.raise_for_status()
        return resp.json().get("fan_count")
    except requests.RequestException:
        return None


def instagram_fetch_follower_count(page_access_token: str, ig_page_id: str) -> int | None:
    try:
        resp = requests.get(
            f"https://graph.facebook.com/v21.0/{ig_page_id}",
            params={"fields": "followers_count", "access_token": page_access_token},
            timeout=15,
        )
        resp.raise_for_status()
        return resp.json().get("followers_count")
    except requests.RequestException:
        return None


def threads_fetch_follower_count(access_token: str, threads_user_id: str) -> int | None:
    try:
        resp = requests.get(
            f"https://graph.threads.net/v1.0/{threads_user_id}",
            params={"fields": "followers_count", "access_token": access_token},
            timeout=15,
        )
        resp.raise_for_status()
        return resp.json().get("followers_count")
    except requests.RequestException:
        return None


# LinkedIn has no follower-count endpoint for a personal member profile at
# all — organizationalEntityFollowerStatistics only exists for Company
# Pages, which this app doesn't publish as. Deliberately not implemented,
# not a bug: there is nothing to call here.


def facebook_fetch_post_engagement(page_access_token: str, post_id: str) -> dict | None:
    try:
        resp = requests.get(
            f"https://graph.facebook.com/v21.0/{post_id}",
            params={
                "fields": "likes.summary(true).limit(0),comments.summary(true).limit(0)",
                "access_token": page_access_token,
            },
            timeout=15,
        )
        resp.raise_for_status()
        data = resp.json()
        return {
            "likes": data.get("likes", {}).get("summary", {}).get("total_count", 0),
            "comments": data.get("comments", {}).get("summary", {}).get("total_count", 0),
        }
    except requests.RequestException:
        return None


def instagram_fetch_post_engagement(page_access_token: str, media_id: str) -> dict | None:
    try:
        resp = requests.get(
            f"https://graph.facebook.com/v21.0/{media_id}",
            params={"fields": "like_count,comments_count", "access_token": page_access_token},
            timeout=15,
        )
        resp.raise_for_status()
        data = resp.json()
        return {"likes": data.get("like_count", 0), "comments": data.get("comments_count", 0)}
    except requests.RequestException:
        return None


def threads_fetch_post_engagement(access_token: str, media_id: str) -> dict | None:
    # Threads has no direct like/comment-count field on the media object
    # itself (unlike Instagram) — only the separate /insights endpoint,
    # which needs threads_manage_insights and reports "likes"/"replies" as
    # named metrics rather than plain counts.
    try:
        resp = requests.get(
            f"https://graph.threads.net/v1.0/{media_id}/insights",
            params={"metric": "likes,replies", "access_token": access_token},
            timeout=15,
        )
        resp.raise_for_status()
        values = {m["name"]: m["values"][0]["value"] for m in resp.json().get("data", []) if m.get("values")}
        return {"likes": values.get("likes", 0), "comments": values.get("replies", 0)}
    except (requests.RequestException, KeyError, IndexError):
        return None


def linkedin_fetch_post_engagement(access_token: str, post_urn: str) -> dict | None:
    # Best-effort: the socialActions summary endpoint works for the
    # authenticated member's own posts on a standard member-scope app;
    # it 403s under stricter API products. A failure here must not break
    # engagement refresh for the other platforms — return None, not raise.
    try:
        resp = requests.get(
            f"https://api.linkedin.com/v2/socialActions/{post_urn}",
            headers={"Authorization": f"Bearer {access_token}", "Linkedin-Version": LINKEDIN_API_VERSION},
            timeout=15,
        )
        resp.raise_for_status()
        data = resp.json()
        return {
            "likes": data.get("likesSummary", {}).get("totalLikes", 0),
            "comments": data.get("commentsSummary", {}).get("totalFirstLevelComments", 0),
        }
    except requests.RequestException:
        return None


OAUTH_PROVIDERS = {
    "linkedin": {"authorize_url": linkedin_authorize_url, "finish": linkedin_finish},
    "facebook": {"authorize_url": facebook_authorize_url, "finish": facebook_finish},
    "instagram": {"authorize_url": instagram_authorize_url, "finish": instagram_finish},
    "threads": {"authorize_url": threads_authorize_url, "finish": threads_finish},
}