import os
import re
import json
import uuid
import requests
from dotenv import load_dotenv
from openai import OpenAI
from langchain_community.utilities import GoogleSerperAPIWrapper
from io import BytesIO
from PIL import Image
from pathlib import Path
import secrets
import hashlib
import base64

# config
load_dotenv(override=True)

openai_api_key = os.getenv("OPENAI_API_KEY")
google_api_key = os.getenv("GOOGLE_API_KEY")
IMGBB_API_KEY = os.environ.get("IMGBB_API_KEY")


def _raise_with_api_detail(resp):
    """Like resp.raise_for_status(), but folds the response body into the
    exception message. Meta's Graph API (Facebook/Instagram/Threads) returns
    a JSON body like {"error": {"message": "...", "code": ..., "type": ...}}
    on 4xx responses that explains *why* the request was rejected (expired
    token, missing permission, bad media URL, etc.) — plain raise_for_status()
    discards that and just says "400 Client Error: Bad Request for url: ...",
    which isn't enough to diagnose anything.
    """
    try:
        resp.raise_for_status()
    except requests.exceptions.HTTPError as e:
        try:
            detail = resp.json()
        except ValueError:
            detail = resp.text
        raise requests.exceptions.HTTPError(f"{e} | response body: {detail}", response=resp) from e

FINTO_BASE = "https://finto.day"
finto_email = os.environ.get("FINTO_EMAIL")
finto_password = os.environ.get("FINTO_PASSWORD")

# LinkedIn's versioned REST API requires this header on every call. LinkedIn
# ships a new version monthly and supports each for ~12 months before sunset —
# override via env if this drifts stale rather than editing code.
LINKEDIN_API_VERSION = os.environ.get("LINKEDIN_API_VERSION", "202607")

GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/"
gemini = OpenAI(api_key=google_api_key, base_url=GEMINI_BASE_URL)

serper = GoogleSerperAPIWrapper()
serper_images = GoogleSerperAPIWrapper(type="images")

MODEL = "gemini-3.1-flash-lite"


def suggest_hashtags(text, category=None, max_tags=8):
    """Ask Gemini for a short list of relevant hashtags for a piece of post
    text. Returns a list of '#word' strings, no explanation - backs the
    manual-post composer's "# Hashtags" button (DraftReview never calls
    this; it's specific to the write-it-yourself flow in Form.jsx)."""
    prompt = (
        f"Suggest up to {max_tags} concise, relevant social-media hashtags for this post"
        + (f" in the '{category}' category" if category else "")
        + ". Respond with ONLY the hashtags separated by spaces, each starting "
        + "with #, no other text.\n\nPost:\n" + text
    )
    resp = gemini.chat.completions.create(model=MODEL, messages=[{"role": "user", "content": prompt}])
    raw = resp.choices[0].message.content or ""
    tags = re.findall(r"#\w+", raw)
    seen = set()
    unique = []
    for t in tags:
        if t.lower() not in seen:
            seen.add(t.lower())
            unique.append(t)
    return unique[:max_tags]


CATEGORY_MAP = {
    "Technology": 1, "Web Development": 2, "Artificial Intelligence": 3, "Gadgets": 4,
    "Business": 5, "Startups": 6, "Finance": 7,
    "Lifestyle": 8, "Health": 9, "Travel": 10,
}

VALID_CATEGORIES = list(CATEGORY_MAP.keys())


# prompt

PROMPT = """
You are a content agent responsible for producing and publishing content 
for our platform. Given a category and subtopic, follow this process 
IN ORDER, using the tools available to you:

Category must be exactly one of these (use the exact spelling/casing):
Technology, Web Development, Artificial Intelligence, Gadgets,
Business, Startups, Finance,
Lifestyle, Health, Travel

1. RESEARCH
   Call web_search tool with a short, specific query (4-6 words) to gather 
   current, factual context on the subtopic within the category. This is 
   to avoid generic or outdated filler — do not skip this step.
   You may call it up to 2 times if the first results are too broad or irrelevant.

2. WRITE CONTENT
   Using the research, write a piece with:
   - title (SEO-friendly, max 70 characters)
   - intro (2-3 sentences)
   - sections (5, each with a heading and body text)
   - conclusion (2-3 sentences)
   - tags (3-5 relevant SEO tags)
   - linkedin_post: a standalone LinkedIn-style post (120-200 words) summarizing 
    the key insight of this article. Write it specifically for LinkedIn's tone — 
    direct, conversational, a hook in the first line, no SEO-speak. End with 
    2-4 relevant hashtags on their own line. This is NOT a truncated version 
    of the intro — write it fresh for a LinkedIn audience.
   - facebook_post: a standalone Facebook post (80-150 words). Facebook posts 
    read like a short update or story shared with a broad, general audience — 
    more narrative and conversational than a punchy headline-style hook. Avoid 
    rhetorical questions as openers (that's a Twitter/X pattern) — instead, 
    open by stating the news/topic directly, then add context or why it 
    matters. Emojis, if used, should feel incidental (e.g. one at the end of 
    a sentence), not used as bullet-point-style separators. End with 1-3 
    relevant hashtags, not a hashtag cluster — Facebook posts are less 
    hashtag-heavy than Instagram or X.
   - instagram_caption: a standalone Instagram caption (max 150 words, since 
    Instagram truncates long captions in-feed — put the most important point 
    in the first 1-2 lines). Conversational, can use emojis naturally. End 
    with 5-8 relevant hashtags on their own line (Instagram posts perform 
    better with more hashtags than LinkedIn/Facebook).
   - threads_post: a standalone Threads post (max 500 characters including 
    spaces and hashtags). Threads' tone sits between Twitter/X (punchy, 
    conversational) and Instagram (personal, can use emojis) — casual and 
    direct, written for quick scrolling. 1-2 hashtags at most, used sparingly 
    since Threads culture leans away from heavy hashtag use. Not a copy of 
    the twitter_post or instagram_caption — write it fresh for Threads' 
    specific casual, conversational feel.
   None of these platform-specific posts should be truncated versions of the 
   intro — write each one fresh, in a tone suited to that platform's audience.
   Do not fabricate facts, statistics, or quotes not supported by the research.
   Word count target: word_count words total.
   

3. SOURCE IMAGES
    Call image_search tool once per needed image (3-5 total):
   - 1 hero/featured image — landscape orientation
   - 2-4 supporting images, one per relevant section - adjust accordingly that it do not end up taking more space the text content
   Only use royalty-free sources. Return the image URL and source name for each.
   If no suitable image is found for a section, skip it rather than 
   inventing a URL.
   - return the URL of each image used
    First, determine the nature of this content:
   
   - GENERAL/EVERGREEN topic (concepts, how-tos, trends, explainers, opinion, 
     no specific real people/events depicted): search royalty-free sources 
     (Unsplash, Pexels, Pixabay) as usual. 1 featured + 2-4 supporting images.
   
   - REAL-WORLD NEWS topic (involves specific real people, organizations, or 
     events — e.g. a named athlete, a company's product launch, a political 
     event, a specific news story): do NOT search generic stock photo sites, 
     since real people/events are almost never legitimately royalty-free.
     Instead:
       a) Search specifically for images from the event/organization's own 
          official website, press office, or verified social media account 
          (search query should include the entity's name + "official" or 
          "press release" or "media kit").
       b) If no clearly official/press source is found, leave featured_image 
          and all section images empty rather than using an unverified or 
          generic substitute.
       c) Note in your response which images (if any) still need human 
          verification before publishing, since automated searches cannot 
          reliably confirm licensing terms.
 
    For real-world news topics with multiple distinct visual moments (e.g. a 
   leader's multi-country visit, a multi-day event): call image_search once 
   per distinct moment/country with prefer_official=true, and collect up to 
   5-10 verified official images into a "carousel_images" array. Only include 
   images you're confident come from official government/press sources.
 
   - CONCEPTUAL/PROCESS topic (a roadmap, workflow, decision tree, career 
     path, step-by-step process, or any content whose "image" would need to 
     show the specific steps/structure of THIS article — e.g. "how to become 
     an AI engineer", "our onboarding process"): do NOT search for generic 
     terms like "flowchart", "roadmap", or "process diagram" and use whatever 
     stock image comes back. A keyword match like "flowchart" will return an 
     unrelated diagram (a random software dev lifecycle chart, a login flow, 
     someone else's roadmap) that does not depict this article's actual 
     content, which is just as misleading as an unverified photo of a real 
     event. For these sections:
       a) Only use image_search for genuinely photographable scenes related 
          to the topic (e.g. "developer working at laptop", "data center 
          servers") — never for the diagram/roadmap/process itself.
       b) Leave the image field empty for any section whose point is a 
          specific sequence of steps that only this article's own diagram 
          could represent correctly. Do not substitute a generic stock 
          "flowchart" image as a stand-in.
       c) Note in your response that a custom diagram (not a stock photo) 
          would be needed for those sections, since automated image search 
          cannot generate one.
 
   Only use royalty-free or verified official sources. Return the image URL 
   and source name for each. Never fabricate a URL.

4. ASSEMBLE DRAFT
   Combine the written content and images into a single JSON object 
   matching this structure:
   {
     "title": "", "slug": "", "category": "", "tags": [],
     "meta_description": "", "intro": "",
     "sections": [{"heading": "", "text": "", "image": {"url": "", "source": ""}}],
     "conclusion": "", "featured_image": {"url": "", "source": ""},
     "carousel_images": [{"url": "", "source": ""}],
     "facebook_post": "",
     "instagram_caption": "",
     "linkedin_post": "",
     "threads_post": "",
     "status": "draft"

   }

5. STOP FOR HUMAN APPROVAL
    After assembling the draft in step 4, your job is done for this turn.
   Present the assembled draft as your final response. Do not attempt to 
   publish it — publishing is handled separately, outside this conversation.


Rules:
- Follow the steps in order — do not skip research or jump straight to writing.
- If any tool call fails, report the error and stop — do not retry more than once.
- Do not fabricate image URLs, facts, or statistics.
"""

# Tool — web_search
def web_search(query: str) -> str:
    """Search the web for the current information on a given query."""
    return serper.run(query)


web_search_json = {
    "name": "web_search",
    "description": "Search the web for current information relevant to the topic",
    "parameters": {
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "A short, specific search query to search the web (4-6 words)"
            }
        },
        "required": ["query"],
        "additionalProperties": False
    }
}


# Tool — image_search
def image_search(query, prefer_official=False):
    """
    Search for images relevant to the query.
    If prefer_official is True, bias toward official/press sources rather 
    than generic stock photo sites — used when content involves real 
    people/events rather than general concepts.
    """
    BLOCKED_DOMAINS = [
        "lookaside.fbsbx.com", "lookaside.instagram.com", "scontent",
        "reuters.com", "apimages.com", "gettyimages.com", "shutterstock.com",
        "alamy.com", "ap.org", "afp.com", "bloomberg.com",
    ]

    if prefer_official:
        # Restrict to specific known-safe official government/press domains
        official_sites = "site:pib.gov.in OR site:mea.gov.in OR site:pmindia.gov.in OR site:pib.nic.in"
        search_query = f'{query} ({official_sites})'
    else:
        search_query = query

    results = serper_images.results(search_query)
    images = results.get("images", [])[:10]

    usable = [
        {"url": img.get("imageUrl"), "source": img.get("source", "Unknown")}
        for img in images
        if img.get("imageUrl") and not any(bad in img["imageUrl"] for bad in BLOCKED_DOMAINS)
    ]

    return usable[:5]


image_search_json = {
    "name": "image_search",
    "description": (
        "Search for images relevant to the query. For general/evergreen topics, "
        "this searches royalty-free stock sources like Unsplash, Pixabay, and Pexels. "
        "For content involving real, identifiable people or specific real-world events, "
        "set prefer_official=true to bias results toward official/press-released sources "
        "instead of generic stock photography, since real people/events are rarely "
        "legitimately royalty-free."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "A short, specific search query to search for images (4-6 words)"
            },
            "prefer_official": {
                "type": "boolean",
                "description": "True if this content involves real people/events, requiring official/press sources rather than generic stock imagery"
            }
        },
        "required": ["query", "prefer_official"],
        "additionalProperties": False
    }
}


# Tool — publish (finto.day)

def get_csrf_token(session: requests.Session, url: str) -> str:
    resp = session.get(url)
    match = re.search(r'name="_token" value="([^"]+)"', resp.text)
    if not match:
        raise ValueError(f"Could not find CSRF token on {url}")
    return match.group(1)


def login(session, email, password):
    login_url = f"{FINTO_BASE}/writer/login"
    token = get_csrf_token(session, login_url)
    resp = session.post(login_url, data={"_token": token, "email": email, "password": password})
    resp.raise_for_status()
    if "/writer/login" in resp.url:
        raise ValueError("Login failed — check credentials or CSRF handling")


def download_image(url: str, max_dimension: int = 1920, max_bytes: int = 3_000_000) -> bytes:
    """
    Download an image and re-encode it as JPEG, capped at max_dimension on its
    longest side. Tries high quality first (92) and only steps down if the
    result would exceed max_bytes — stock photo sources often serve multi-MB
    originals, and building several of those into one multipart upload can
    trip a platform's max request-body size (a 413 error). This keeps normal
    images visually sharp and only degrades when actually necessary.
    """
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        )
    }
 
    resp = requests.get(url, headers=headers, timeout=10)
    resp.raise_for_status()
 
    img = Image.open(BytesIO(resp.content)).convert("RGB")
    img.thumbnail((max_dimension, max_dimension))
 
    buf = BytesIO()
    for quality in (92, 85, 75, 65):
        buf = BytesIO()
        img.save(buf, format="JPEG", quality=quality, optimize=True)
        if buf.tell() <= max_bytes:
            return buf.getvalue()
    return buf.getvalue()  # fall back to the smallest size tried


def validate_and_prepare_instagram_image(image_url):
    """
    Downloads an image, crops it to Instagram's accepted aspect ratio range
    (0.8 to 1.91) if needed, and returns clean JPEG bytes. Returns None only
    if the image can't be fetched/opened at all.
    """
    try:
        headers = {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
            )
        }
        resp = requests.get(image_url, headers=headers, timeout=10)
        resp.raise_for_status()

        img = Image.open(BytesIO(resp.content)).convert("RGB")
        w, h = img.size
        ratio = w / h

        MIN_RATIO = 0.8
        MAX_RATIO = 1.91

        if ratio < MIN_RATIO:
            new_h = int(w / MIN_RATIO)
            top = (h - new_h) // 2
            img = img.crop((0, top, w, top + new_h))
        elif ratio > MAX_RATIO:
            new_w = int(h * MAX_RATIO)
            left = (w - new_w) // 2
            img = img.crop((left, 0, left + new_w, h))

        buf = BytesIO()
        img.save(buf, format="JPEG", quality=90)
        return buf.getvalue()

    except Exception:
        return None


def upload_to_imgbb(image_bytes, api_key):
    """Temporarily host an image on imgbb, returns a public URL Instagram can fetch."""
    resp = requests.post(
        "https://api.imgbb.com/1/upload",
        data={
            "key": api_key,
            "image": base64.b64encode(image_bytes).decode(),
        },
        timeout=15,
    )
    resp.raise_for_status()
    return resp.json()["data"]["url"]


def format_body_for_finto(payload):
    parts = [payload.get("intro", "")]
    for section in payload.get("sections", []):
        parts.append(f"<h2>{section['heading']}</h2><p>{section['text']}</p>")
    parts.append(f"<p>{payload.get('conclusion', '')}</p>")
    return "".join(parts)


def build_acknowledgement(payload):
    sources = set()
    if payload.get("featured_image", {}).get("source"):
        sources.add(payload["featured_image"]["source"])
    for s in payload.get("sections", []):
        if s.get("image", {}).get("source"):
            sources.add(s["image"]["source"])
    return f"Images sourced from {', '.join(sources)}" if sources else ""



# Central image resolution — the single source of truth for "what image(s)
# does this post actually have". Every platform adapter below consumes the
# output of this instead of reaching into payload["featured_image"] itself.

def build_carousel_images(payload):
    """
    Returns a normalized list of {"url", "source"} dicts for this draft.
    - If the agent already populated carousel_images (real-world-news,
      multi-moment case), use that as-is.
    - Otherwise derive it from featured_image + each section's image,
      in that order, so featured_image is always first (and therefore
      the one picked for single-image posts).
    """
    if payload.get("carousel_images"):
        return payload["carousel_images"]
    imgs = []
    if payload.get("featured_image", {}).get("url"):
        imgs.append(payload["featured_image"])
    for s in payload.get("sections", []):
        img = s.get("image")
        if img and img.get("url"):
            imgs.append(img)
    return imgs


def register_linkedin_image_upload(member_id, access_token):
    """Ask LinkedIn for a place to upload one image, returns (upload_url, image_urn)."""
    resp = requests.post(
        "https://api.linkedin.com/rest/images?action=initializeUpload",
        headers={
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
            "Linkedin-Version": LINKEDIN_API_VERSION,
            "X-Restli-Protocol-Version": "2.0.0",
        },
        json={"initializeUploadRequest": {"owner": f"urn:li:person:{member_id}"}},
        timeout=15,
    )
    resp.raise_for_status()
    value = resp.json()["value"]
    return value["uploadUrl"], value["image"]  # "image" is the urn:li:image:... URN


def upload_image_to_linkedin(image_url, member_id, access_token):
    """Downloads an image and uploads it to LinkedIn, returns the image URN to reference in a post."""
    upload_url, image_urn = register_linkedin_image_upload(member_id, access_token)
    img_bytes = download_image(image_url)
    put_resp = requests.put(
        upload_url,
        data=img_bytes,
        timeout=15,
    )
    put_resp.raise_for_status()
    return image_urn


def publish_finto(payload, user_credentials):
    """Publish the content draft to finto.day, using the specific user account."""
    try:
        if isinstance(payload, str):
            payload = json.loads(payload)

        session = requests.Session()
        login(session, user_credentials["email"], user_credentials["password"])

        new_article_url = f"{FINTO_BASE}/writer/articles/create"
        token = get_csrf_token(session, new_article_url)

        body_html = format_body_for_finto(payload)

        data = {
            "_token": token,
            "title": payload["title"][:150],
            "short_description": payload.get("meta_description", "")[:255],
            "category_id": CATEGORY_MAP.get(payload.get("category"), ""),
            "body": body_html,
            "meta_keywords": ", ".join(payload.get("tags", [])),
            "meta_description": payload.get("meta_description", "")[:255],
            "meta_content": payload.get("intro", "")[:500],
            "acknowledgement": build_acknowledgement(payload),
            "is_published": "1" if payload.get("status") == "live" else "0",
            "is_full_width_image": "0",
            "image_gallery_layout": "vertical",
            "default_image": "new:0",
        }
        for i, tag in enumerate(payload.get("tags", [])[:5]):
            data[f"tags[{i}]"] = tag

        files = {}
        images = build_carousel_images(payload)

        skipped_images = []
        file_index = 0
        for img in images[:5]:
            try:
                img_bytes = download_image(img["url"])
            except Exception as e:
                # One bad image (blocked, dead link, timeout, etc.) shouldn't
                # sink the whole publish — skip it and keep going.
                skipped_images.append({"url": img["url"], "error": str(e)})
                continue
            files[f"images[{file_index}]"] = (f"image{file_index}.jpg", img_bytes, "image/jpeg")
            data[f"images_alt[{file_index}]"] = img.get("source", "")
            file_index += 1

        resp = session.post(f"{FINTO_BASE}/writer/articles", data=data, files=files)
        resp.raise_for_status()

        return {"success": True, "url": resp.url, "skipped_images": skipped_images}

    except Exception as e:
        return {"success": False, "error": str(e)}


def format_for_linkedin(payload):
    """Use the agent's purpose-written LinkedIn post if available, else fall back to a truncated intro."""
    if payload.get("linkedin_post"):
        return payload["linkedin_post"]

    hook = payload.get("intro", "")[:200]
    tags = " ".join(f"#{t.replace(' ', '')}" for t in payload.get("tags", [])[:5])
    return f"{payload.get('title', '')}\n\n{hook}\n\n{tags}"


def publish_linkedin(payload, access_token, member_id, image=None):
    """Publish a single-image (or text-only) post to LinkedIn.
    `image` is the resolved {"url", "source"} dict from build_carousel_images."""
    try:
        if isinstance(payload, str):
            payload = json.loads(payload)

        post_text = format_for_linkedin(payload)
        image_url = image.get("url") if image else None

        body = {
            "author": f"urn:li:person:{member_id}",
            "commentary": post_text,
            "visibility": "PUBLIC",
            "distribution": {"feedDistribution": "MAIN_FEED", "targetEntities": [], "thirdPartyDistributionChannels": []},
            "lifecycleState": "PUBLISHED",
            "isReshareDisabledByAuthor": False,
        }
        if image_url:
            image_urn = upload_image_to_linkedin(image_url, member_id, access_token)
            body["content"] = {"media": {"id": image_urn}}

        resp = requests.post(
            "https://api.linkedin.com/rest/posts",
            headers={
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json",
                "Linkedin-Version": LINKEDIN_API_VERSION,
                "X-Restli-Protocol-Version": "2.0.0",
            },
            json=body,
            timeout=15,
        )
        resp.raise_for_status()
        return {"success": True, "post_id": resp.headers.get("x-restli-id")}
    except Exception as e:
        return {"success": False, "error": str(e)}


def publish_linkedin_carousel(payload, access_token, member_id, carousel_images):
    """Publish a multi-image post to LinkedIn."""
    try:
        if isinstance(payload, str):
            payload = json.loads(payload)

        post_text = format_for_linkedin(payload)
        if not carousel_images:
            return {"success": False, "error": "No carousel images provided."}

        image_ids = []
        image_errors = []
        for img in carousel_images[:9]:  # LinkedIn allows up to 9 images per post
            try:
                image_ids.append(upload_image_to_linkedin(img["url"], member_id, access_token))
            except Exception as e:
                # Keep the real reason instead of throwing it away — a bare
                # "no images uploaded" gives no way to tell a dead image URL
                # apart from an expired LinkedIn token or a 403 from scope.
                image_errors.append(f"{img.get('url', '?')}: {e}")
                continue  # skip any image that fails to upload, keep going

        if not image_ids:
            detail = "; ".join(image_errors) if image_errors else "unknown reason"
            return {"success": False, "error": f"No images could be uploaded to LinkedIn ({detail})."}

        body = {
            "author": f"urn:li:person:{member_id}",
            "commentary": post_text,
            "visibility": "PUBLIC",
            "distribution": {"feedDistribution": "MAIN_FEED", "targetEntities": [], "thirdPartyDistributionChannels": []},
            "content": {"multiImage": {"images": [{"id": urn} for urn in image_ids]}},
            "lifecycleState": "PUBLISHED",
            "isReshareDisabledByAuthor": False,
        }

        resp = requests.post(
            "https://api.linkedin.com/rest/posts",
            headers={
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json",
                "Linkedin-Version": LINKEDIN_API_VERSION,
                "X-Restli-Protocol-Version": "2.0.0",
            },
            json=body,
            timeout=20,
        )
        resp.raise_for_status()
        return {"success": True, "post_id": resp.headers.get("x-restli-id")}
    except Exception as e:
        return {"success": False, "error": str(e)}


def publish_facebook(payload, page_access_token, page_id, image=None):
    """Publish a post to a Facebook Page. Supports text-only or text-image.
    `image` is the resolved image dict passed in by publish_dispatch."""
    try:
        if isinstance(payload, str):
            payload = json.loads(payload)

        message = payload.get("facebook_post") or payload.get("intro", "")
        image_url = image.get("url") if image else None

        if image_url:
            # photos posts an image with a caption in one call
            resp = requests.post(
                f"https://graph.facebook.com/v21.0/{page_id}/photos",
                data={
                    "url": image_url,
                    "caption": message,
                    "access_token": page_access_token,
                },
            )
        else:
            resp = requests.post(
                f"https://graph.facebook.com/v21.0/{page_id}/feed",
                data={
                    "message": message,
                    "access_token": page_access_token,
                },
            )
        resp.raise_for_status()
        return {"success": True, "post_id": resp.json().get("id")}

    except Exception as e:
        return {"success": False, "error": str(e)}


def publish_facebook_carousel(payload, page_access_token, page_id, carousel_images):
    """Publish a multi-photo post to a Facebook Page."""
    try:
        if isinstance(payload, str):
            payload = json.loads(payload)

        message = payload.get("facebook_post") or payload.get("intro", "")
        image_urls = carousel_images

        if not image_urls:
            return {"success": False, "error": "No carousel images provided."}

        # Step 1: upload each photo unpublished, collect their IDs
        photo_ids = []
        for img in image_urls[:10]:  # Facebook allows up to 10 in a multi-photo post
            resp = requests.post(
                f"https://graph.facebook.com/v21.0/{page_id}/photos",
                data={
                    "url": img["url"],
                    "published": "false",   # don't publish individually
                    "access_token": page_access_token,
                },
            )
            resp.raise_for_status()
            photo_ids.append({"media_fbid": resp.json()["id"]})

        # Step 2: create one feed post referencing all uploaded photos
        resp = requests.post(
            f"https://graph.facebook.com/v21.0/{page_id}/feed",
            json={
                "message": message,
                "attached_media": photo_ids,
                "access_token": page_access_token,
            },
        )
        resp.raise_for_status()
        return {"success": True, "post_id": resp.json().get("id")}

    except Exception as e:
        return {"success": False, "error": str(e)}


def publish_instagram(payload, page_access_token, ig_user_id, image=None):
    """Publish a post to an Instagram Business account (image required).
    `image` is the resolved image dict passed in by publish_dispatch."""
    try:
        if isinstance(payload, str):
            payload = json.loads(payload)

        original_url = image.get("url") if image else None
        if not original_url:
            return {"success": False, "error": "Instagram requires an image."}

        prepared_bytes = validate_and_prepare_instagram_image(original_url)
        if prepared_bytes is None:
            return {"success": False, "error": "Could not process featured image for Instagram."}

        hosted_url = upload_to_imgbb(prepared_bytes, IMGBB_API_KEY)

        caption = payload.get("instagram_caption") or payload.get("facebook_post") or payload.get("intro", "")

        container_resp = requests.post(
            f"https://graph.facebook.com/v21.0/{ig_user_id}/media",
            data={"image_url": hosted_url, "caption": caption, "access_token": page_access_token},
            timeout=15,
        )
        _raise_with_api_detail(container_resp)
        creation_id = container_resp.json()["id"]

        publish_resp = requests.post(
            f"https://graph.facebook.com/v21.0/{ig_user_id}/media_publish",
            data={"creation_id": creation_id, "access_token": page_access_token},
            timeout=15,
        )
        _raise_with_api_detail(publish_resp)
        return {"success": True, "post_id": publish_resp.json().get("id")}

    except Exception as e:
        return {"success": False, "error": str(e)}


def publish_instagram_carousel(payload, page_access_token, ig_user_id, carousel_images):
    """Publish a multi-image carousel post to Instagram."""
    try:
        if isinstance(payload, str):
            payload = json.loads(payload)

        caption = payload.get("instagram_caption") or payload.get("facebook_post") or payload.get("intro", "")
        image_urls = carousel_images

        if not image_urls:
            return {"success": False, "error": "No carousel images provided."}
        if len(image_urls) < 2:
            return {"success": False, "error": "Instagram carousels need at least 2 images."}

        item_ids = []
        for img in image_urls[:10]:
            prepared_bytes = validate_and_prepare_instagram_image(img["url"])
            if prepared_bytes is None:
                continue  # skip images that can't be processed
            hosted_url = upload_to_imgbb(prepared_bytes, IMGBB_API_KEY)

            resp = requests.post(
                f"https://graph.facebook.com/v21.0/{ig_user_id}/media",
                data={
                    "image_url": hosted_url,
                    "is_carousel_item": "true",
                    "access_token": page_access_token,
                },
                timeout=15,
            )
            _raise_with_api_detail(resp)
            item_ids.append(resp.json()["id"])

        if len(item_ids) < 2:
            return {"success": False, "error": "Fewer than 2 images survived processing — cannot create carousel."}

        resp = requests.post(
            f"https://graph.facebook.com/v21.0/{ig_user_id}/media",
            data={
                "media_type": "CAROUSEL",
                "children": ",".join(item_ids),
                "caption": caption,
                "access_token": page_access_token,
            },
            timeout=15,
        )
        _raise_with_api_detail(resp)
        creation_id = resp.json()["id"]

        publish_resp = requests.post(
            f"https://graph.facebook.com/v21.0/{ig_user_id}/media_publish",
            data={"creation_id": creation_id, "access_token": page_access_token},
            timeout=15,
        )
        _raise_with_api_detail(publish_resp)
        return {"success": True, "post_id": publish_resp.json().get("id")}

    except Exception as e:
        return {"success": False, "error": str(e)}


def publish_threads(payload, access_token, threads_user_id, image=None):
    """Publish a post to Threads — text-only, or with an image if one is available.
    `image` is the resolved image dict passed in by publish_dispatch."""
    try:
        if isinstance(payload, str):
            payload = json.loads(payload)

        text = (
            payload.get("threads_post")
            or payload.get("instagram_caption", "")
            or payload.get("intro", "")
        )[:500]

        image_url = image.get("url") if image else None

        if image_url:
            prepared_bytes = validate_and_prepare_instagram_image(image_url)
            if prepared_bytes is not None:
                hosted_url = upload_to_imgbb(prepared_bytes, IMGBB_API_KEY)  # re-host, same as Instagram
                container_data = {
                    "media_type": "IMAGE",
                    "image_url": hosted_url,
                    "text": text,
                    "access_token": access_token,
                }
            else:
                # image failed validation — fall back to text-only rather than failing the whole post
                container_data = {
                    "media_type": "TEXT",
                    "text": text,
                    "access_token": access_token,
                }
        else:
            container_data = {
                "media_type": "TEXT",
                "text": text,
                "access_token": access_token,
            }

        container_resp = requests.post(
            f"https://graph.threads.net/v1.0/{threads_user_id}/threads",
            data=container_data,
            timeout=15,
        )
        _raise_with_api_detail(container_resp)
        creation_id = container_resp.json()["id"]

        publish_resp = requests.post(
            f"https://graph.threads.net/v1.0/{threads_user_id}/threads_publish",
            data={"creation_id": creation_id, "access_token": access_token},
            timeout=15,
        )
        _raise_with_api_detail(publish_resp)
        return {"success": True, "post_id": publish_resp.json().get("id")}

    except Exception as e:
        return {"success": False, "error": str(e)}


def publish_threads_carousel(payload, access_token, threads_user_id, carousel_images):
    """Publish a multi-image carousel post to Threads."""
    try:
        if isinstance(payload, str):
            payload = json.loads(payload)

        text = (
            payload.get("threads_post")
            or payload.get("instagram_caption", "")
            or payload.get("intro", "")
        )[:500]
        image_urls = carousel_images

        if not image_urls:
            return {"success": False, "error": "No carousel images provided."}
        if len(image_urls) < 2:
            return {"success": False, "error": "Threads carousels need at least 2 images."}

        item_ids = []
        for img in image_urls[:10]:
            prepared_bytes = validate_and_prepare_instagram_image(img["url"])
            if prepared_bytes is None:
                continue
            hosted_url = upload_to_imgbb(prepared_bytes, IMGBB_API_KEY)

            resp = requests.post(
                f"https://graph.threads.net/v1.0/{threads_user_id}/threads",
                data={
                    "media_type": "IMAGE",
                    "image_url": hosted_url,
                    "is_carousel_item": "true",
                    "access_token": access_token,
                },
                timeout=15,
            )
            _raise_with_api_detail(resp)
            item_ids.append(resp.json()["id"])

        if len(item_ids) < 2:
            return {"success": False, "error": "Fewer than 2 images survived processing — cannot create carousel."}

        resp = requests.post(
            f"https://graph.threads.net/v1.0/{threads_user_id}/threads",
            data={
                "media_type": "CAROUSEL",
                "children": ",".join(item_ids),
                "text": text,
                "access_token": access_token,
            },
            timeout=15,
        )
        _raise_with_api_detail(resp)
        creation_id = resp.json()["id"]

        publish_resp = requests.post(
            f"https://graph.threads.net/v1.0/{threads_user_id}/threads_publish",
            data={"creation_id": creation_id, "access_token": access_token},
            timeout=15,
        )
        _raise_with_api_detail(publish_resp)
        return {"success": True, "post_id": publish_resp.json().get("id")}

    except Exception as e:
        return {"success": False, "error": str(e)}


# X(TWITTER)

TWITTER_MAX_IMAGES = 4

TWITTER_CHAR_LIMIT = 280

def _twitter_auth(credentials):
    return OAuth1(
        credentials["api_key"],
        credentials["api_secret"],
        credentials["access_token"],
        credentials["access_token_secret"],
    )

def format_for_twitter(payload):
    """ Use the agent's purpose-written X post if available, else fall back to a truncated intro. """
    if payload.get("twitter_post"):
        return payload["twitter_post"][:TWITTER_CHAR_LIMIT]

    hook = payload.get("intro", "")[:200]
    tags = " ".join(f"#{t.replace(' ', '')}" for t in payload.get("tags", [])[:2])
    text = f"{payload.get('title','')}\n\n{hook}\n\n{tags}"
    return text[:TWITTER_CHAR_LIMIT]

def upload_media_to_twitter(image_bytes, credentials):
    """ Uploads one image via X's v1.1 media endpoint, returns a media_id string to attach to a tweet.
        This endpoint is OAuth 1.0 a only - bearer tokens are not accepted here even though v2 endpoints elsewhere accept them. """

    resp = requests.post(
        "https://upload.twitter.com/1.1/media/upload.json",
        auth = _twitter_auth(credentials),
        files = {"media": image_bytes},
        timeout=15,
    )
    resp.raise_for_status()
    return resp.json()["media_id_string"]


def publish_twitter(payload, credentials, image=None):
    """ Publish a single-image (or text-only) post to X.
    `image` is the resolved {"url", "source"} dict passed in by publish_dispatch. """

    try:
        if isinstance(payload, str):
            payload = json.loads(payload)
 
        text = format_for_twitter(payload)
        image_url = image.get("url") if image else None
 
        media_ids = []
        if image_url:
            try:
                img_bytes = download_image(image_url)
                media_id = upload_media_to_twitter(img_bytes, credentials)
                media_ids.append(media_id)
            except Exception:
                # One failed image shouldn't sink a text-capable post —
                # fall back to text-only rather than failing outright.
                pass
 
        body = {"text": text}
        if media_ids:
            body["media"] = {"media_ids": media_ids}
 
        resp = requests.post(
            "https://api.twitter.com/2/tweets",
            auth=_twitter_auth(credentials),
            json=body,
            timeout=15,
        )
        resp.raise_for_status()
        return {"success": True, "post_id": resp.json().get("data", {}).get("id")}
 
    except Exception as e:
        return {"success": False, "error": str(e)}
 
 
def publish_twitter_carousel(payload, credentials, carousel_images):
    """Publish a multi-image post to X. X allows a maximum of 4 images per tweet,
    so this uploads up to TWITTER_MAX_IMAGES and skips any beyond that."""
    try:
        if isinstance(payload, str):
            payload = json.loads(payload)
 
        text = format_for_twitter(payload)
        image_urls = carousel_images
 
        if not image_urls:
            return {"success": False, "error": "No carousel images provided."}
 
        media_ids = []
        media_errors = []
        for img in image_urls[:TWITTER_MAX_IMAGES]:
            try:
                img_bytes = download_image(img["url"])
                media_id = upload_media_to_twitter(img_bytes, credentials)
                media_ids.append(media_id)
            except Exception as e:
                media_errors.append(f"{img.get('url', '?')}: {e}")
                continue  # skip any image that fails to upload, keep going
 
        if not media_ids:
            detail = "; ".join(media_errors) if media_errors else "unknown reason"
            return {"success": False, "error": f"No images could be uploaded to X ({detail})."}
 
        body = {"text": text, "media": {"media_ids": media_ids}}
 
        resp = requests.post(
            "https://api.twitter.com/2/tweets",
            auth=_twitter_auth(credentials),
            json=body,
            timeout=20,
        )
        resp.raise_for_status()
        return {"success": True, "post_id": resp.json().get("data", {}).get("id")}
 
    except Exception as e:
        return {"success": False, "error": str(e)}



def publish_dispatch(payload, platform, user_credentials):
    """Route a publish request to the correct platform adapter.

    build_carousel_images() is the single place that decides what image(s)
    a draft has. Every branch below either passes the whole resolved list
    (carousel path) or its first entry (single-image path) into the
    adapter — none of the adapters read payload["featured_image"] directly
    anymore, so there's no chance of them disagreeing about which image to use.
    """
    carousel_images = build_carousel_images(payload)
    single_image = carousel_images[0] if carousel_images else None

    if platform == "finto":
        if not user_credentials or "email" not in user_credentials or "password" not in user_credentials:
            return {"success": False, "error": "Missing finto.day credentials for this user."}
        return publish_finto(payload, user_credentials)

    elif platform == "linkedin":
        if not user_credentials or "access_token" not in user_credentials or "member_id" not in user_credentials:
            return {"success": False, "error": "Missing LinkedIn credentials for this user."}
        if len(carousel_images) > 1:
            return publish_linkedin_carousel(payload, user_credentials["access_token"], user_credentials["member_id"], carousel_images)
        return publish_linkedin(payload, user_credentials["access_token"], user_credentials["member_id"], single_image)

    elif platform == "facebook":
        if not user_credentials or "page_access_token" not in user_credentials or "page_id" not in user_credentials:
            return {"success": False, "error": "Missing Facebook credentials for this user."}
        if len(carousel_images) > 1:
            return publish_facebook_carousel(payload, user_credentials["page_access_token"], user_credentials["page_id"], carousel_images)
        return publish_facebook(payload, user_credentials["page_access_token"], user_credentials["page_id"], single_image)

    elif platform == "instagram":
        if not user_credentials or "page_access_token" not in user_credentials or "ig_page_id" not in user_credentials:
            return {"success": False, "error": "Missing Instagram credentials for this user."}
        if len(carousel_images) > 1:
            return publish_instagram_carousel(payload, user_credentials["page_access_token"], user_credentials["ig_page_id"], carousel_images)
        return publish_instagram(payload, user_credentials["page_access_token"], user_credentials["ig_page_id"], single_image)

    elif platform == "threads":
        if not user_credentials or "access_token" not in user_credentials or "threads_user_id" not in user_credentials:
            return {"success": False, "error": "Missing Threads credentials for this user."}
        if len(carousel_images) > 1:
            return publish_threads_carousel(payload, user_credentials["access_token"], user_credentials["threads_user_id"], carousel_images)
        return publish_threads(payload, user_credentials["access_token"], user_credentials["threads_user_id"], single_image)

    elif platform == "twitter":
        required = ("api_key", "api_secret", "access_token", "access_token_secret")
        if not user_credentials or any(k not in user_credentials for k in required):
            return {"success": False, "error": "Missing X/Twitter credentials for this user."}
        if len(carousel_images) > 1:
            return publish_twitter_carousel(payload, user_credentials, carousel_images)
        return publish_twitter(payload, user_credentials, single_image)

    
    else:
        return {"success": False, "error": f"Unknown platform: {platform}"}


publish_json = {
    "name": "publish",
    "description": "Publish the finished content draft to the platform.",
    "parameters": {
        "type": "object",
        "properties": {
            "payload": {
                "type": "object",
                "description": "The final content draft + images to publish"
            },
            "platform": {
                "type": "string",
                'enum': ["finto", "linkedin"],
                "description": "Where platform to publish this content to"
            }
        },
        "required": ["payload", "platform"],
        "additionalProperties": False
    }
}


tools = [
    {"type": "function", "function": web_search_json},
    {"type": "function", "function": image_search_json},
]

tools_flow = {
    "web_search": web_search,
    "image_search": image_search,
}


# Agent loop

def agent01(category, subtopic, word_count):
    filled_prompt = PROMPT.replace("word_count", str(word_count))
    messages = [
        {"role": "system", "content": filled_prompt},
        {"role": "user", "content": f"category: {category}, subtopic: {subtopic}"}
    ]
    response = gemini.chat.completions.create(model=MODEL, messages=messages, tools=tools)

    while response.choices[0].finish_reason == "tool_calls":
        message = response.choices[0].message
        # .model_dump() so this is a plain JSON-serializable dict, not the SDK's
        # ChatCompletionMessage object — the DB's messages column is JSON, and
        # the raw object crashes json.dumps. exclude_none keeps the payload the
        # API expects on the next call (it's still valid as message history).
        messages.append(message.model_dump(exclude_none=True))
        for tool_call in message.tool_calls:
            function_name = tool_call.function.name
            args = json.loads(tool_call.function.arguments)
            result = tools_flow[function_name](**args)
            messages.append({"role": "tool", "content": json.dumps(result), "tool_call_id": tool_call.id})
        response = gemini.chat.completions.create(model=MODEL, messages=messages, tools=tools)

    return response.choices[0].message.content, messages


def revise_draft(messages, feedback):
    if not feedback:
        raise ValueError("Feedback is required to revise a draft.")
    user_msg = f"Not approved. Please revise the draft based on this feedback: {feedback}"
    messages.append({"role": "user", "content": user_msg})
    response = gemini.chat.completions.create(model=MODEL, messages=messages, tools=tools)

    while response.choices[0].finish_reason == "tool_calls":
        message = response.choices[0].message
        messages.append(message.model_dump(exclude_none=True))
        for tool_call in message.tool_calls:
            fn_name = tool_call.function.name
            args = json.loads(tool_call.function.arguments)
            result = tools_flow[fn_name](**args)
            messages.append({"role": "tool", "content": json.dumps(result), "tool_call_id": tool_call.id})
        response = gemini.chat.completions.create(model=MODEL, messages=messages, tools=tools)

    return response.choices[0].message.content, messages


def approve_and_publish(draft_json_str, platform, user_credentials=None, live=False):
    """Approval path — no LLM involved. Publishes the exact reviewed draft."""
    payload = json.loads(clean_json_string(draft_json_str))
    payload["status"] = "live" if live else "draft"
    return publish_dispatch(payload, platform, user_credentials)


# Display helpers
def clean_json_string(s):
    s = s.strip()
    if s.startswith("```"):
        s = s.split("\n", 1)[1]
        s = s.rsplit("```", 1)[0]
        s = s.strip()
    match = re.search(r'\{.*\}', s, re.DOTALL)
    if match:
        s = match.group(0)
    return s.strip()


# Helper to extract the result of a specific tool from the message history
def get_last_tool_result(messages, tool_name):
    tool_call_id = None

    # Find the ID of the last call to the requested tool
    for msg in reversed(messages):
        if isinstance(msg, dict):
            role = msg.get("role")
            tool_calls = msg.get("tool_calls")
        else:
            role = getattr(msg, "role", None)
            tool_calls = getattr(msg, "tool_calls", None)

        if role == "assistant" and tool_calls:
            for tc in tool_calls:
                if isinstance(tc, dict):
                    tc_name = tc["function"]["name"]
                    tc_id = tc["id"]
                else:
                    tc_name = tc.function.name
                    tc_id = tc.id

                if tc_name == tool_name:
                    tool_call_id = tc_id
                    break
        if tool_call_id:
            break

    if not tool_call_id:
        return None

    # Find the tool result matching that ID
    for msg in reversed(messages):
        if isinstance(msg, dict):
            role = msg.get("role")
            msg_tc_id = msg.get("tool_call_id")
            content = msg.get("content")
        else:
            role = getattr(msg, "role", None)
            msg_tc_id = getattr(msg, "tool_call_id", None)
            content = getattr(msg, "content", None)

        if role == "tool" and msg_tc_id == tool_call_id:
            return json.loads(content)

    return None


# result = approve_and_publish(draft_json_str, platform=selected_platform, user_credentials=creds, live=is_live)