const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000";

async function handle(res) {
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const message = body?.detail || `Request failed with status ${res.status}`;
    throw new Error(message);
  }
  return res.json();
}

function authHeaders(token) {
  return { Authorization: `Bearer ${token}` };
}

// create a new account
export async function signup({ username, password }) {
  const res = await fetch(`${API_BASE}/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  return handle(res);
}



export async function getLoginAuthorizeUrl({ provider }) {
  const res = await fetch(`${API_BASE}/auth/${provider}/authorize-url`, { method: "POST" });
  return handle(res);
}


/*
  Log in with username/password.
  Expected backend response: { token }
 */
export async function login({ username, password }) {
  const res = await fetch(`${API_BASE}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
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
  Approve or reject an existing draft.
  Expected backend response for reject: { draft_id, draft: {...revised draft...} }
  Expected backend response for approve: { draft_id, result: { success, url|error } }
 
  `platform` is required when decision === "approve" ("finto" | "linkedin").
 */
export async function reviewDraft({ token, draftId, decision, feedback, live, platform }) {
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