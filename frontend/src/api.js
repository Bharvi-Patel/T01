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

// request a "reset your password" email — always resolves the same way
// whether or not the address is registered, so this can't be used to probe
export async function forgotPassword({ email }) {
  const res = await fetch(`${API_BASE}/forgot-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  return handle(res);
}

// confirm the token from the "?reset_token=" link in the reset email and set a new password
export async function resetPassword({ token, newPassword }) {
  const res = await fetch(`${API_BASE}/reset-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, new_password: newPassword }),
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

// invalidate the current session on the backend (best-effort - the frontend
// clears its local token regardless of whether this succeeds)
export async function logout({ token }) {
  const res = await fetch(`${API_BASE}/logout`, {
    method: "POST",
    headers: authHeaders(token),
  });
  return handle(res);
}

// --- Profile settings (bottom-left account popup) ---------------------
// The user's own login identity - username/email/avatar/timezone/password -
// as opposed to getConnections()/connectX(), which are the social accounts
// a draft can be published to.

export async function getProfile({ token }) {
  const res = await fetch(`${API_BASE}/me`, { headers: authHeaders(token) });
  return handle(res);
}

export async function updateProfile({ token, username, fullName, email, timezone }) {
  const res = await fetch(`${API_BASE}/me`, {
    method: "PATCH",
    headers: { ...authHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({ username, full_name: fullName, email, timezone }),
  });
  return handle(res);
}

export async function uploadAvatar({ token, file }) {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${API_BASE}/me/avatar`, {
    method: "POST",
    headers: authHeaders(token),
    body: form,
  });
  return handle(res);
}

export async function changePassword({ token, currentPassword, newPassword }) {
  const res = await fetch(`${API_BASE}/me/change-password`, {
    method: "POST",
    headers: { ...authHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
  });
  return handle(res);
}

export async function deleteAccount({ token, password }) {
  const res = await fetch(`${API_BASE}/me`, {
    method: "DELETE",
    headers: { ...authHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
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

// Media library — backs the Publish page's "Media" tab. Photos/videos are
// stored permanently on the backend under the user's account; text assets
// are stored inline. Everything here persists across sessions.

export async function getMediaAssets({ token }) {
  const res = await fetch(`${API_BASE}/media`, {
    headers: authHeaders(token),
  });
  return handle(res);
}

// `kind` is "photo" | "video"
export async function uploadMediaAsset({ token, file, kind, name }) {
  const form = new FormData();
  form.append("file", file);
  form.append("kind", kind);
  if (name) form.append("name", name);

  const res = await fetch(`${API_BASE}/media`, {
    method: "POST",
    headers: authHeaders(token),
    body: form,
  });
  return handle(res);
}

export async function addMediaText({ token, name, content }) {
  const res = await fetch(`${API_BASE}/media/text`, {
    method: "POST",
    headers: { ...authHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({ name, content }),
  });
  return handle(res);
}

export async function deleteMediaAsset({ token, mediaId }) {
  const res = await fetch(`${API_BASE}/media/${mediaId}`, {
    method: "DELETE",
    headers: authHeaders(token),
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
  The account's real post history, fetched live from the platform itself
  (not from T01's drafts table) — this is what surfaces posts made before
  the account was ever connected here. Supported for instagram, facebook,
  threads; linkedin isn't supported (see backend for why).
  Expected backend response: { platform, posts: [{ id, text, image, permalink, published_at }] }
 */
export async function getPlatformHistory({ token, platform, limit, debug }) {
  const url = new URL(`${API_BASE}/connect/${platform}/history`);
  if (limit) url.searchParams.set("limit", limit);
  if (debug) url.searchParams.set("debug", "true");
  const res = await fetch(url, { headers: authHeaders(token) });
  return handle(res);
}

/*
  List the current user's drafts, optionally filtered by status
  ("pending_review" | "scheduled" | "published" | "publish_failed" | "rejected"),
  by exclude_status (comma-separated statuses to leave out), by was_scheduled
  (true = only drafts that are or were ever scheduled, for the Scheduled tab),
  and/or by a scheduled_at date range (for the calendar view).
  Expected backend response: { drafts: [{ draft_id, category, subtopic, title, status, created_at, updated_at, scheduled_at, scheduled_platforms, scheduled_live }] }
 */
export async function getDrafts({ token, status, excludeStatus, wasScheduled, savedAsDraft, scheduledFrom, scheduledTo }) {
  const url = new URL(`${API_BASE}/drafts`);
  if (status) url.searchParams.set("status", status);
  if (excludeStatus) url.searchParams.set("exclude_status", excludeStatus);
  if (wasScheduled !== undefined) url.searchParams.set("was_scheduled", wasScheduled);
  if (savedAsDraft !== undefined) url.searchParams.set("saved_as_draft", savedAsDraft);
  if (scheduledFrom) url.searchParams.set("scheduled_from", scheduledFrom);
  if (scheduledTo) url.searchParams.set("scheduled_to", scheduledTo);
  const res = await fetch(url, { headers: authHeaders(token) });
  return handle(res);
}

// Backs the review screen's "Save as draft" button - flips the existing
// pending_review draft's saved_as_draft flag so it shows up in the
// Publish page's Drafts tab, rather than trying to save something new.
export async function saveDraftAsDraft({ token, draftId }) {
  const res = await fetch(`${API_BASE}/drafts/${draftId}/save-as-draft`, {
    method: "POST",
    headers: authHeaders(token),
  });
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
/*
  Upcoming festivals/observances for the Dashboard's Ideas section, pulled
  server-side from Calendarific.
  Expected backend response: { configured: bool, ideas: [{ name, date, description, types }] }
  configured is false when the backend has no CALENDARIFIC_API_KEY set - the
  frontend should show a "not set up" state rather than an empty-forever list.
 */
export async function getDashboardIdeas({ token }) {
  const res = await fetch(`${API_BASE}/dashboard/ideas`, { headers: authHeaders(token) });
  return handle(res);
}

/*
  Save a user-entered idea from the Dashboard Ideas "+ New" button.
  description is optional free-text notes. Expected backend response:
  the saved idea as { id, name, date, description, types, custom: true, media: [] }.
 */
export async function createDashboardIdea({ token, name, description }) {
  const res = await fetch(`${API_BASE}/dashboard/ideas`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({ name, description }),
  });
  return handle(res);
}

// Remove a previously saved custom idea.
export async function deleteDashboardIdea({ token, ideaId }) {
  const res = await fetch(`${API_BASE}/dashboard/ideas/${ideaId}`, {
    method: "DELETE",
    headers: authHeaders(token),
  });
  return handle(res);
}

/*
  Attach a photo/video to a saved idea. Expected backend response:
  { id, name, content_type, url, file_size }.
 */
export async function addIdeaMedia({ token, ideaId, file }) {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(`${API_BASE}/dashboard/ideas/${ideaId}/media`, {
    method: "POST",
    headers: authHeaders(token),
    body: formData,
  });
  return handle(res);
}

// Remove a media attachment from a saved idea.
export async function deleteIdeaMedia({ token, ideaId, attachmentId }) {
  const res = await fetch(`${API_BASE}/dashboard/ideas/${ideaId}/media/${attachmentId}`, {
    method: "DELETE",
    headers: authHeaders(token),
  });
  return handle(res);
}

/*
  Dashboard "To Do" section. GET seeds the three starter tasks the first
  time a user has none, so the response is always a normal editable list -
  no distinction between "built-in" and "custom" items on the frontend.
  Expected response: { todos: [{ id, title, body, accent, nav }] }.
*/
export async function getDashboardTodos({ token }) {
  const res = await fetch(`${API_BASE}/dashboard/todos`, { headers: authHeaders(token) });
  return handle(res);
}

// Add a todo from the "+ New" button. Returns the saved todo.
export async function createDashboardTodo({ token, title, body }) {
  const res = await fetch(`${API_BASE}/dashboard/todos`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({ title, body }),
  });
  return handle(res);
}

// Edit an existing todo's title/body (built-in seeded ones included).
export async function updateDashboardTodo({ token, todoId, title, body }) {
  const res = await fetch(`${API_BASE}/dashboard/todos/${todoId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({ title, body }),
  });
  return handle(res);
}

export async function deleteDashboardTodo({ token, todoId }) {
  const res = await fetch(`${API_BASE}/dashboard/todos/${todoId}`, {
    method: "DELETE",
    headers: authHeaders(token),
  });
  return handle(res);
}

export async function getAnalyticsSummary({ token, days = 30 }) {
  const url = new URL(`${API_BASE}/analytics/summary`);
  url.searchParams.set("days", days);
  const res = await fetch(url, { headers: authHeaders(token) });
  return handle(res);
}

// Pulls current follower counts + per-post like/comment counts from every
// connected platform and caches them server-side (see POST /analytics/refresh).
// Call this, then re-fetch getAnalyticsSummary to see the update.
export async function refreshAnalytics({ token }) {
  const res = await fetch(`${API_BASE}/analytics/refresh`, {
    method: "POST",
    headers: authHeaders(token),
  });
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

/*
  Fetch the combined Social Inbox feed (Instagram/Facebook comments &
  messages, Threads replies/mentions). Expected backend response:
  { items: [{ id, platform, kind, thread_id, sender_name, body, is_read, created_at }] }
 */
export async function getInbox({ token }) {
  const res = await fetch(`${API_BASE}/inbox`, { headers: authHeaders(token) });
  return handle(res);
}

/*
  Mark a single inbox item as read. Expected backend response:
  { id, is_read: true }
 */
export async function markInboxItemRead({ token, itemId }) {
  const res = await fetch(`${API_BASE}/inbox/${itemId}/read`, {
    method: "PATCH",
    headers: authHeaders(token),
  });
  return handle(res);
}

/*
  Send a DM reply through the connected Page/Instagram account. Only valid
  for kind: "message" items - the backend rejects comments/mentions since
  those need a different (unbuilt) Graph API surface. Expected response:
  { id, platform, kind, thread_id, sender_name, body, is_read, is_outbound, created_at }
 */
export async function replyToInboxItem({ token, itemId, text }) {
  const res = await fetch(`${API_BASE}/inbox/${itemId}/reply`, {
    method: "POST",
    headers: { ...authHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  return handle(res);
}

/*
  Delete (soft-delete) a single inbox item. Expected response:
  { id, deleted: true }
 */
export async function deleteInboxItem({ token, itemId }) {
  const res = await fetch(`${API_BASE}/inbox/${itemId}`, {
    method: "DELETE",
    headers: authHeaders(token),
  });
  return handle(res);
}

/*
  Fetch the current user's in-app notifications (draft-ready, publish-failed,
  approval-granted, weekly digest, etc). Expected backend response:
  { items: [{ id, kind, title, body, url, is_read, created_at }], unread_count }
 */
export async function getNotifications({ token, unreadOnly = false } = {}) {
  const qs = unreadOnly ? "?unread_only=true" : "";
  const res = await fetch(`${API_BASE}/notifications${qs}`, { headers: authHeaders(token) });
  return handle(res);
}

/*
  Mark a single notification as read. Expected backend response:
  { id, is_read: true }
 */
export async function markNotificationRead({ token, notificationId }) {
  const res = await fetch(`${API_BASE}/notifications/${notificationId}/read`, {
    method: "PATCH",
    headers: authHeaders(token),
  });
  return handle(res);
}

/*
  Mark every unread notification as read. Expected backend response:
  { updated: <count> }
 */
export async function markAllNotificationsRead({ token }) {
  const res = await fetch(`${API_BASE}/notifications/read-all`, {
    method: "PATCH",
    headers: authHeaders(token),
  });
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

// --- Mobile notifications (Publish page's "Notifications" tab) ---

// Public - null publicKey means push isn't configured on this server yet.
export async function getVapidPublicKey() {
  const res = await fetch(`${API_BASE}/notifications/vapid-public-key`);
  return handle(res);
}

export async function getNotificationPreferences({ token }) {
  const res = await fetch(`${API_BASE}/notifications/preferences`, { headers: authHeaders(token) });
  return handle(res);
}

export async function updateNotificationPreferences({ token, beforePublish, needsApproval, publishFailed, weeklyDigest }) {
  const res = await fetch(`${API_BASE}/notifications/preferences`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({
      before_publish: beforePublish,
      needs_approval: needsApproval,
      publish_failed: publishFailed,
      weekly_digest: weeklyDigest,
    }),
  });
  return handle(res);
}

export async function registerPushSubscription({ token, subscription }) {
  const res = await fetch(`${API_BASE}/notifications/push-subscription`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify(subscription.toJSON ? subscription.toJSON() : subscription),
  });
  return handle(res);
}

export async function removePushSubscription({ token, endpoint }) {
  const res = await fetch(`${API_BASE}/notifications/push-subscription`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({ endpoint }),
  });
  return handle(res);
}

// --- Workspace / Members -----------------------------------------------

// Caller's workspace + their own role in it (admin vs member).
export async function getWorkspace({ token }) {
  const res = await fetch(`${API_BASE}/workspace`, { headers: authHeaders(token) });
  return handle(res);
}

export async function getWorkspaceMembers({ token }) {
  const res = await fetch(`${API_BASE}/workspace/members`, { headers: authHeaders(token) });
  return handle(res);
}

// Every workspace the caller belongs to, each tagged with their role
// there and an is_active flag for whichever one is currently selected.
export async function listWorkspaces({ token }) {
  const res = await fetch(`${API_BASE}/workspaces`, { headers: authHeaders(token) });
  return handle(res);
}

// Create a brand new workspace (caller becomes its sole admin) and
// switch into it immediately.
export async function createWorkspace({ token, name }) {
  const res = await fetch(`${API_BASE}/workspaces`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({ name }),
  });
  return handle(res);
}

// Switch the caller's active workspace to one they're already a member of.
export async function switchWorkspace({ token, workspaceId }) {
  const res = await fetch(`${API_BASE}/workspaces/${workspaceId}/switch`, {
    method: "POST",
    headers: authHeaders(token),
  });
  return handle(res);
}

// Rename a workspace. Admin-only server-side, scoped to workspaceId
// (not necessarily the caller's active workspace).
export async function renameWorkspace({ token, workspaceId, name }) {
  const res = await fetch(`${API_BASE}/workspaces/${workspaceId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({ name }),
  });
  return handle(res);
}

// Permanently delete a workspace (and everything in it - drafts, media,
// connections, members...). Admin-only server-side, scoped to
// workspaceId (not necessarily the caller's active workspace); name
// must match the workspace's actual name, retyped by the caller.
export async function deleteWorkspace({ token, workspaceId, name }) {
  const res = await fetch(`${API_BASE}/workspaces/${workspaceId}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({ name }),
  });
  return handle(res);
}

// Add an existing account (by username) to the workspace as a MEMBER.
// Admin-only server-side.
export async function addWorkspaceMember({ token, username, defaultAccess }) {
  const res = await fetch(`${API_BASE}/workspace/members`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({ username, default_access: defaultAccess }),
  });
  return handle(res);
}

// Change a member's fallback access level (used for any platform without
// its own override).
export async function updateWorkspaceMember({ token, memberId, defaultAccess }) {
  const res = await fetch(`${API_BASE}/workspace/members/${memberId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({ default_access: defaultAccess }),
  });
  return handle(res);
}

// Revoke a member's login to the workspace. Their existing drafts/media
// stay attributed to them - this only removes the membership row.
export async function removeWorkspaceMember({ token, memberId }) {
  const res = await fetch(`${API_BASE}/workspace/members/${memberId}`, {
    method: "DELETE",
    headers: authHeaders(token),
  });
  return handle(res);
}

// Override one platform's access for a member, independent of their
// default_access (e.g. full everywhere except needs-approval on LinkedIn).
export async function setMemberPlatformAccess({ token, memberId, platform, access }) {
  const res = await fetch(`${API_BASE}/workspace/members/${memberId}/access/${platform}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({ access }),
  });
  return handle(res);
}

// Remove a per-platform override, snapping that platform back to the
// member's default_access.
export async function clearMemberPlatformAccess({ token, memberId, platform }) {
  const res = await fetch(`${API_BASE}/workspace/members/${memberId}/access/${platform}`, {
    method: "DELETE",
    headers: authHeaders(token),
  });
  return handle(res);
}

// Drafts currently parked at PENDING_APPROVAL for any member of the
// caller's workspace - admin-only server-side.
export async function getPendingApprovals({ token }) {
  const res = await fetch(`${API_BASE}/workspace/pending-approvals`, { headers: authHeaders(token) });
  return handle(res);
}

// Grant or deny a parked publish/schedule request. feedback is shown to
// the requester only when decision is "deny".
export async function decideApprovalRequest({ token, draftId, decision, feedback }) {
  const res = await fetch(`${API_BASE}/drafts/${draftId}/approval`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({ decision, feedback }),
  });
  return handle(res);
}