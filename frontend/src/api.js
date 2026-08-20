const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000";

async function handle(res) {
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const message = body?.detail || `Request failed with status ${res.status}`;
    const err = new Error(message);
    err.status = res.status; // callers should check e.status === 401, not string-match the message
    throw err;
  }
  return res.json();
}

function authHeaders(token) {
  return { Authorization: `Bearer ${token}` };
}

// create a new account — the account is unverified until the emailed link is clicked
export async function signup({ username, email, password }) {
  const res = await fetch(`${API_BASE}/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, email, password }),
  });
  return handle(res);
}

// confirm the token from the "?verify_token=" link in the verification email
export async function verifyEmail({ token }) {
  const res = await fetch(`${API_BASE}/verify-email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  return handle(res);
}

// ask for a fresh verification email (e.g. the old link expired)
export async function resendVerification({ email }) {
  const res = await fetch(`${API_BASE}/resend-verification`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  return handle(res);
}



export async function getLoginAuthorizeUrl({ provider }) {
  const res = await fetch(`${API_BASE}/auth/${provider}/authorize-url`, { method: "POST" });
  return handle(res);
}


/*
  Log in with a username or email, plus password.
  Expected backend response: { token }
 */
export async function login({ identifier, password }) {
  const res = await fetch(`${API_BASE}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier, password }),
  });
  return handle(res);
}

/*
  Kick off a new draft.
  Expected backend response: { draft_id, draft: {...parsed draft json...} }
 */
export async function generateDraft({ token, category, subtopic, wordCount }) {
  const res = await fetch(`${API_BASE}/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({
      category,
      subtopic,
      word_count: Number(wordCount),
    }),
  });
  return handle(res);
}

/*
  Ask the agent for hashtag suggestions based on whatever's been written so
  far — backs the manual composer's "# Hashtags" button.
  Expected backend response: { hashtags: ["#foo", "#bar", ...] }
 */
export async function suggestHashtags({ token, text, category }) {
  const res = await fetch(`${API_BASE}/assist/hashtags`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({ text, category }),
  });
  return handle(res);
}

/*
  Create a draft from a post the user wrote themselves, instead of
  generating one with AI. `images` is an array of File objects, `video` is
  a single File or null/undefined. `platformBodies` is an optional
  { finto, linkedin, facebook, instagram, threads } object of per-network
  overrides — omit it (or leave it undefined) to use `body` everywhere.
  Expected backend response: { draft_id, draft: {...draft json...} }
  (same shape as generateDraft, so callers can treat the two identically)
 */
export async function createManualDraft({ token, category, subtopic, title, body, images, video, platformBodies }) {
  const form = new FormData();
  form.append("category", category);
  form.append("subtopic", subtopic);
  form.append("title", title);
  form.append("body", body);
  (images || []).forEach((file) => form.append("images", file));
  if (video) form.append("video", video);
  if (platformBodies) {
    if (platformBodies.finto) form.append("intro", platformBodies.finto);
    if (platformBodies.linkedin) form.append("linkedin_post", platformBodies.linkedin);
    if (platformBodies.facebook) form.append("facebook_post", platformBodies.facebook);
    if (platformBodies.instagram) form.append("instagram_caption", platformBodies.instagram);
    if (platformBodies.threads) form.append("threads_post", platformBodies.threads);
  }

  const res = await fetch(`${API_BASE}/drafts/manual`, {
    method: "POST",
    headers: authHeaders(token),
    body: form,
  });
  return handle(res);
}

/*
  Approve or reject an existing draft.
  Expected backend response for reject: { draft_id, draft: {...revised draft...} }
  Expected backend response for approve: { draft_id, results: { <platform>: {...} } }

  `platforms` is required when decision === "approve" — array of platform keys.
 */
export async function reviewDraft({ token, draftId, decision, feedback, live, platforms }) {
  const res = await fetch(`${API_BASE}/review`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({
      draft_id: draftId,
      decision,
      feedback,
      live: Boolean(live),
      platforms,
    }),
  });
  return handle(res);
}

/*
  Connect (or update) the user's finto.day account.
  Expected backend response: { success: true }
 */
export async function connectFinto({ token, email, password }) {
  const res = await fetch(`${API_BASE}/connect/finto`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({ email, password }),
  });
  return handle(res);
}

/*
  Connect (or update) the user's LinkedIn account.
  Manual paste-in of access_token/member_id for now, until the real
  OAuth redirect flow is wired up on the backend.
  Expected backend response: { success: true }
 */
export async function connectLinkedIn({ token, accessToken, memberId }) {
  const res = await fetch(`${API_BASE}/connect/linkedin`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({ access_token: accessToken, member_id: memberId }),
  });
  return handle(res);
}

/*
  Connect (or update) the user's Facebook Page account.
  Expected backend response: { success: true }
 */
export async function connectFacebook({ token, pageAccessToken, pageId }) {
  const res = await fetch(`${API_BASE}/connect/facebook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({ page_access_token: pageAccessToken, page_id: pageId }),
  });
  return handle(res);
}

/*
  Connect (or update) the user's Instagram Business account.
  Expected backend response: { success: true }
 */
export async function connectInstagram({ token, pageAccessToken, igPageId }) {
  const res = await fetch(`${API_BASE}/connect/instagram`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({ page_access_token: pageAccessToken, ig_page_id: igPageId }),
  });
  return handle(res);
}

/*
  Connect (or update) the user's Threads account.
  Expected backend response: { success: true }
 */
export async function connectThreads({ token, accessToken, threadsUserId }) {
  const res = await fetch(`${API_BASE}/connect/threads`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({ access_token: accessToken, threads_user_id: threadsUserId }),
  });
  return handle(res);
}

export async function getAuthorizeUrl({ token, platform }) {
  const res = await fetch(`${API_BASE}/connect/${platform}/authorize-url`, {
    method: "POST",
    headers: authHeaders(token),
  });
  return handle(res);
}

/*
  Disconnect a previously connected platform.
  Expected backend response: { success: true }
 */
export async function disconnectPlatform({ token, platform }) {
  const res = await fetch(`${API_BASE}/connect/${platform}`, {
    method: "DELETE",
    headers: authHeaders(token),
  });
  return handle(res);
}

/*
  List the current user's drafts, optionally filtered by status
  ("pending_review" | "scheduled" | "published" | "publish_failed" | "rejected"),
  and/or by a scheduled_at date range (for the calendar view).
  Expected backend response: { drafts: [{ draft_id, category, subtopic, title, status, created_at, updated_at, scheduled_at, scheduled_platforms, scheduled_live }] }
 */
export async function getDrafts({ token, status, excludeStatus, scheduledFrom, scheduledTo }) {
  const url = new URL(`${API_BASE}/drafts`);
  if (status) url.searchParams.set("status", status);
  if (excludeStatus) url.searchParams.set("exclude_status", excludeStatus);
  if (scheduledFrom) url.searchParams.set("scheduled_from", scheduledFrom);
  if (scheduledTo) url.searchParams.set("scheduled_to", scheduledTo);
  const res = await fetch(url, { headers: authHeaders(token) });
  return handle(res);
}

/*
  Real usage stats derived from PublishResult rows (no follower/reach data —
  T01 doesn't call any platform's insights API).
  Expected backend response: { range_days, total_drafts, total_words, currently_scheduled, total_attempts, successes, failures,
  success_rate, by_platform: {platform: {total, success}}, daily: [{date, success, failure}],
  cadence_by_weekday: [{weekday, count}], platform_reliability_daily: {platform: [{date, success, total}]},
  top_categories: [{category, count}], recent_failures: [{platform, detail, published_at}] }
 */
export async function getAnalyticsSummary({ token, days = 30 }) {
  const url = new URL(`${API_BASE}/analytics/summary`);
  url.searchParams.set("days", days);
  const res = await fetch(url, { headers: authHeaders(token) });
  return handle(res);
}

/*
  Fetch a single draft by id (e.g. to resume review from the Drafts list).
  Expected backend response: { draft_id, draft: {...}, status }
 */
export async function getDraft({ token, draftId }) {
  const res = await fetch(`${API_BASE}/drafts/${draftId}`, { headers: authHeaders(token) });
  return handle(res);
}

/*
  Queue a draft to auto-publish at a future date/time.
  scheduledAt should be an ISO 8601 string. Expected backend response:
  { draft_id, status, scheduled_at, scheduled_platforms }
 */
export async function scheduleDraft({ token, draftId, scheduledAt, platforms, live }) {
  const res = await fetch(`${API_BASE}/drafts/${draftId}/schedule`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({ scheduled_at: scheduledAt, platforms, live }),
  });
  return handle(res);
}

/*
  Move an already-scheduled draft to a new date/time (e.g. calendar drag & drop).
  Keeps its existing platforms/live choice. Expected backend response:
  { draft_id, scheduled_at }
 */
export async function rescheduleDraft({ token, draftId, scheduledAt }) {
  const res = await fetch(`${API_BASE}/drafts/${draftId}/schedule`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({ scheduled_at: scheduledAt }),
  });
  return handle(res);
}

/*
  Pull a scheduled draft off the calendar, back to pending_review.
  Expected backend response: { draft_id, status }
 */
export async function unscheduleDraft({ token, draftId }) {
  const res = await fetch(`${API_BASE}/drafts/${draftId}/schedule`, {
    method: "DELETE",
    headers: authHeaders(token),
  });
  return handle(res);
}

export async function getConnections({ token }) {
  const res = await fetch(`${API_BASE}/connections`, { headers: authHeaders(token) });
  return handle(res);
}


export async function getPendingPages({ token, platform, pendingId }) {
  const res = await fetch(`${API_BASE}/connect/${platform}/pending-pages/${pendingId}`, { headers: authHeaders(token) });
  return handle(res);
}

export async function selectPage({ token, platform, pendingId, pageId }) {
  const res = await fetch(`${API_BASE}/connect/${platform}/select-page`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({ pending_id: pendingId, page_id: pageId }),
  });
  return handle(res);
}