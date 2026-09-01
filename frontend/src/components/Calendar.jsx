// Calendar.jsx — month-grid view of scheduled drafts (Planable-style):
// each day cell shows small draggable chips for drafts scheduled that day;
// click a chip to see details / reschedule / unschedule / open the draft;
// drag a chip onto another day to reschedule it (same time of day, new date).
import { useState, useEffect, useCallback } from "react";
import { getDrafts, rescheduleDraft, unscheduleDraft, getDraft, getPlatformHistory } from "../api";
import { PLATFORMS, PlatformLogo } from "./platforms";

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MAX_CHIPS_PER_DAY = 2;
// Platforms the /connect/{platform}/history endpoint actually supports —
// LinkedIn only grants this app publish-only access, so its pre-existing
// posts can never be fetched (see main.py's platform_post_history).
const HISTORY_SUPPORTED_PLATFORMS = ["instagram", "facebook", "threads"];


function platformByKey(key) {
  return PLATFORMS.find((p) => p.key === key);
}

// The date a draft belongs on: upcoming posts use scheduled_at, past posts
// use published_at (scheduled_at gets cleared the moment a draft publishes).
function effectiveDate(d) {
  return d.scheduled_at || d.published_at;
}

// Which platform logos to show on a chip/panel. While a post is still
// scheduled, scheduled_platforms is the source of truth; once it's
// published, that field is cleared, so fall back to whichever platforms
// actually appear in its publish history.
function chipPlatforms(d) {
  if (d.scheduled_platforms?.length) return d.scheduled_platforms;
  const seen = new Set();
  (d.publish_results || []).forEach((r) => seen.add(r.platform));
  return Array.from(seen);
}

function isPublished(d) {
  return !d.scheduled_at && !!d.published_at;
}

// Full post text lives on the draft's content, keyed per platform — pick
// whichever matches the platforms this chip is scheduled/published to,
// falling back to the general intro/meta description.
function pickBodyText(content, platformKeys) {
  if (!content) return "";
  const byPlatform = {
    linkedin: content.linkedin_post,
    facebook: content.facebook_post,
    instagram: content.instagram_caption,
    threads: content.threads_post,
  };
  for (const key of platformKeys) {
    if (byPlatform[key]) return byPlatform[key];
  }
  return content.intro || content.meta_description || "";
}

function startOfDay(d) {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function dateKey(d) {
  // Local yyyy-mm-dd — used purely as a lookup key, never sent to the backend.
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function isSameDay(a, b) {
  return dateKey(a) === dateKey(b);
}

function formatTime(d) {
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

// Builds the 6-week (42 day) grid for the month containing `viewDate`,
// including the trailing/leading days from adjacent months.
function buildMonthGrid(viewDate) {
  const first = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1);
  const gridStart = new Date(first);
  gridStart.setDate(gridStart.getDate() - first.getDay());
  const days = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    days.push(d);
  }
  return days;
}

// Builds the 7-day grid (Sun–Sat) for the week containing `viewDate`.
function buildWeekGrid(viewDate) {
  const start = new Date(viewDate);
  start.setDate(start.getDate() - start.getDay());
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    days.push(d);
  }
  return days;
}

function buildGrid(viewDate, viewMode) {
  return viewMode === "week" ? buildWeekGrid(viewDate) : buildMonthGrid(viewDate);
}

// Normalizes a platform-history entry (fetched live from Instagram/Facebook/
// Threads, not from T01's own drafts table) into the same shape the chip/
// panel rendering already expects, so it can slot into the calendar next to
// T01-created drafts without any special-casing there.
function externalPostToDraft(platform, post) {
  const text = post.text || "";
  return {
    draft_id: `external:${platform}:${post.id}`,
    is_external: true,
    external_post_id: post.id,
    permalink: post.permalink,
    category: "Posted on " + platform,
    subtopic: text.slice(0, 80) || "(no caption)",
    title: null,
    meta_description: text,
    featured_image: post.image ? { url: post.image } : null,
    scheduled_at: null,
    scheduled_platforms: null,
    scheduled_live: null,
    published_at: post.published_at || null,
    publish_results: [{ platform, success: true, detail: null, published_at: post.published_at || null }],
  };
}

function DraftDetailPanel({ draft, onClose, onReschedule, onUnschedule, onOpen, busy, connections }) {
  const published = isPublished(draft);
  const external = !!draft.is_external;
  const scheduledAt = draft.scheduled_at ? new Date(draft.scheduled_at) : null;
  const [date, setDate] = useState(scheduledAt ? dateKey(scheduledAt) : "");
  const [time, setTime] = useState(
    scheduledAt
      ? `${String(scheduledAt.getHours()).padStart(2, "0")}:${String(scheduledAt.getMinutes()).padStart(2, "0")}`
      : "09:00"
  );
  // Plays the exit animation before actually unmounting (onClose), so
  // closing eases out instead of cutting instantly - mirrors the open
  // animation added alongside this. Skips straight to onClose for
  // prefers-reduced-motion, since the exit CSS animation is disabled there
  // and would otherwise never fire the animationend that triggers onClose.
  const [closing, setClosing] = useState(false);
  function handleClose() {
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) { onClose(); return; }
    setClosing(true);
  }

  function submitReschedule() {
    const local = new Date(`${date}T${time}`);
    if (Number.isNaN(local.getTime())) return;
    onReschedule(draft.draft_id, local.toISOString());
  }

  const platforms = chipPlatforms(draft);
  // Most recent result per platform, in case a platform was retried.
  const resultByPlatform = {};
  (draft.publish_results || []).forEach((r) => { resultByPlatform[r.platform] = r; });

  return (
    <div
      className={closing ? "modal-overlay-exit" : "modal-overlay-enter"}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
        display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100,
      }}
      onClick={handleClose}
      onAnimationEnd={() => { if (closing) onClose(); }}
    >
      <div
        className={closing ? "modal-panel-exit" : "modal-panel-enter"}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#16222A", border: "0.5px solid #22303A", borderRadius: 12,
          padding: "1.5rem", width: "100%", maxWidth: 420, margin: "0 1rem",
        }}
      >
        <p style={{ fontWeight: 500, fontSize: 15, margin: "0 0 4px", color: "#ECEFEA" }}>
          {draft.title || draft.subtopic}
        </p>
        <p style={{ fontSize: 12, color: "#66716C", margin: "0 0 16px", textTransform: "capitalize" }}>
          {draft.category} · {external ? "Posted outside T01" : published ? "Published" : "Scheduled"}
        </p>

        {published ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
            {platforms.length === 0 && (
              <p style={{ fontSize: 12.5, color: "#66716C", margin: 0 }}>No publish attempts recorded.</p>
            )}
            {platforms.map((key) => {
              const p = platformByKey(key);
              const r = resultByPlatform[key];
              if (!p) return null;
              return (
                <div
                  key={key}
                  style={{
                    display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "#ECEFEA",
                    background: "#101A20", border: "0.5px solid #22303A", borderRadius: 6, padding: "6px 10px",
                  }}
                >
                  <PlatformLogo platform={p} size={13} />
                  <span style={{ flex: 1 }}>{connections?.[key]?.profile_name || p.label}</span>
                  <span style={{ color: r?.success ? "#4CAF7D" : "#E88A8A", fontSize: 11.5 }}>
                    {r?.success ? "Published" : r ? "Failed" : "Unknown"}
                  </span>
                </div>
              );
            })}
            {draft.published_at && (
              <p style={{ fontSize: 11.5, color: "#66716C", margin: "4px 0 0" }}>
                First went out {new Date(draft.published_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
              </p>
            )}
          </div>
        ) : (
          <>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
              {platforms.map((key) => {
                const p = platformByKey(key);
                if (!p) return null;
                return (
                  <span
                    key={key}
                    style={{
                      display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#ECEFEA",
                      background: "#101A20", border: "0.5px solid #22303A", borderRadius: 6, padding: "4px 8px",
                    }}
                  >
                    <PlatformLogo platform={p} size={13} />
                    {connections?.[key]?.profile_name || p.label}
                  </span>
                );
              })}
            </div>

            <p style={{ fontSize: 12, color: "#9BA79E", margin: "0 0 6px" }}>Scheduled for</p>
            <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ flex: 1 }} />
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} style={{ flex: 1 }} />
            </div>
          </>
        )}

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={handleClose} disabled={busy}>Close</button>
          {external ? (
            draft.permalink && (
              <a
                href={draft.permalink}
                target="_blank"
                rel="noreferrer"
                className="primary"
                style={{ width: "auto", padding: "0 16px", display: "inline-flex", alignItems: "center", justifyContent: "center", textDecoration: "none" }}
              >
                View on platform
              </a>
            )
          ) : (
            <>
              <button onClick={() => onOpen(draft.draft_id)} disabled={busy}>Open draft</button>
              {!published && (
                <>
                  <button onClick={() => onUnschedule(draft.draft_id)} disabled={busy} style={{ color: "#E88A8A" }}>
                    Unschedule
                  </button>
                  <button className="primary" onClick={submitReschedule} disabled={busy} style={{ width: "auto", padding: "0 16px" }}>
                    {busy ? "Saving…" : "Save new time"}
                  </button>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ImageLightbox({ src, onClose }) {
  return (
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)",
        display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200,
        padding: "2rem",
      }}
      onClick={onClose}
    >
      <img
        src={src}
        alt=""
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: "100%", maxHeight: "100%", borderRadius: 10, boxShadow: "0 12px 40px rgba(0,0,0,0.5)" }}
      />
      <button
        onClick={onClose}
        aria-label="Close image"
        style={{
          position: "absolute", top: 20, right: 20, width: 34, height: 34, padding: 0,
          borderRadius: "50%", background: "rgba(255,255,255,0.12)", border: "0.5px solid rgba(255,255,255,0.3)",
          color: "#fff", fontSize: 16,
        }}
      >
        ✕
      </button>
    </div>
  );
}

export default function Calendar({ token, connections, onOpenDraft, onAuthError }) {
  const [viewDate, setViewDate] = useState(() => startOfDay(new Date()));
  const [viewMode, setViewMode] = useState("month"); // "month" | "week" | "list"
  const [drafts, setDrafts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedDraftId, setSelectedDraftId] = useState(null);
  const [dragOverKey, setDragOverKey] = useState(null);
  const [busy, setBusy] = useState(false);
  const [expandedIds, setExpandedIds] = useState(() => new Set());
  const [expandedContent, setExpandedContent] = useState({});
  const [expandLoadingId, setExpandLoadingId] = useState(null);
  const [lightboxSrc, setLightboxSrc] = useState(null);
  // Day cells (keyed the same way as `key` below) whose "+N more" has been
  // clicked, so every post for that day renders inline instead of being
  // truncated to maxChipsPerDay.
  const [expandedDays, setExpandedDays] = useState(() => new Set());
  // Which connected account to show full post history for ("all" = normal,
  // date-bounded calendar view). Picking a platform switches to loading every
  // post ever scheduled/published on that account, regardless of the month/
  // week currently in view.
  const [accountFilter, setAccountFilter] = useState("all");
  const [historyNotice, setHistoryNotice] = useState("");

  const grid = buildGrid(viewDate, viewMode);
  const connectedPlatforms = PLATFORMS.filter((p) => connections?.[p.key]);

  const isListView = viewMode === "list";

  const refresh = useCallback(() => {
    setLoading(true);
    setError("");
    setHistoryNotice("");
    const params = { token };
    if (accountFilter === "all" && !isListView) {
      const from = grid[0];
      const to = new Date(grid[grid.length - 1]);
      to.setDate(to.getDate() + 1); // cover the whole last day
      params.scheduledFrom = from.toISOString();
      params.scheduledTo = to.toISOString();
    }
    // else: no date bounds at all — pull the account's (or, in list view,
    // every connected account's) entire post history, archive-style.
    const draftsPromise = getDrafts(params).then((res) => {
      let list = res.drafts.filter((d) => effectiveDate(d));
      if (accountFilter !== "all") {
        list = list.filter((d) => chipPlatforms(d).includes(accountFilter));
      }
      return list;
    });

    // Also pull real post history straight from each connected platform —
    // this is the only way to show posts made before the account was ever
    // connected to T01, since those never had a T01 draft to begin with.
    // In the "All" view this runs for every connected, history-capable
    // platform at once and failures are skipped quietly (one platform
    // erroring shouldn't block the rest); filtered to one account, a
    // failure is surfaced via historyNotice since it's the only thing
    // that view is showing beyond T01's own drafts.
    const historyPromise = accountFilter === "all"
      ? Promise.all(
          connectedPlatforms
            .filter((p) => HISTORY_SUPPORTED_PLATFORMS.includes(p.key))
            .map((p) =>
              getPlatformHistory({ token, platform: p.key })
                .then((res) => (res.posts || []).map((post) => externalPostToDraft(p.key, post)))
                .catch(() => [])
            )
        ).then((lists) => lists.flat())
      : getPlatformHistory({ token, platform: accountFilter })
          .then((res) => (res.posts || []).map((p) => externalPostToDraft(accountFilter, p)))
          .catch((e) => {
            setHistoryNotice(
              e.message || `Couldn't load ${accountFilter}'s post history from the platform directly — showing only what T01 knows about.`
            );
            return [];
          });

    Promise.all([draftsPromise, historyPromise])
      .then(([t01Drafts, externalPosts]) => {
        // Dedup: a post published through T01 shows up in both the drafts
        // table AND the platform's own history. T01's publish_results[].detail
        // is a JSON string on success — for Facebook/Instagram/Threads (the
        // only platforms whose history we ever fetch) that's always
        // {"success": true, "post_id": "..."}, never a "url" key (only
        // LinkedIn's publish result has "url", and LinkedIn history is never
        // fetched at all — see HISTORY_SUPPORTED_PLATFORMS) — so dedup has
        // to match on post_id, not url/permalink.
        const knownPostIds = new Set();
        t01Drafts.forEach((d) => {
          (d.publish_results || []).forEach((r) => {
            if (!r.success || !r.detail) return;
            try {
              const parsed = JSON.parse(r.detail);
              if (parsed?.post_id) knownPostIds.add(String(parsed.post_id));
            } catch {
              // detail wasn't JSON - nothing to key dedup off of for this result.
            }
          });
        });
        let newExternal = externalPosts.filter((p) => !knownPostIds.has(String(p.external_post_id)));
        if (accountFilter === "all" && !isListView) {
          const from = grid[0];
          const to = new Date(grid[grid.length - 1]);
          to.setDate(to.getDate() + 1); // cover the whole last day
          newExternal = newExternal.filter((p) => {
            const d = effectiveDate(p);
            if (!d) return false;
            const dt = new Date(d);
            return dt >= from && dt < to;
          });
        }
        setDrafts([...t01Drafts, ...newExternal]);
      })
      .catch((e) => {
        if (e.status === 401) return onAuthError?.();
        setError(e.message || "Could not load the calendar.");
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, accountFilter, connections, viewMode, viewDate.getFullYear(), viewDate.getMonth(), viewDate.getDate()]);

  useEffect(refresh, [refresh]);

  const byDay = {};
  drafts.forEach((d) => {
    const key = dateKey(new Date(effectiveDate(d)));
    (byDay[key] ||= []).push(d);
  });
  Object.values(byDay).forEach((list) => list.sort((a, b) => new Date(effectiveDate(a)) - new Date(effectiveDate(b))));

  const selectedDraft = drafts.find((d) => d.draft_id === selectedDraftId) || null;
  const maxChipsPerDay = viewMode === "week" ? 6 : MAX_CHIPS_PER_DAY;

  function navigate(delta) {
    setViewDate((prev) => {
      if (viewMode === "week") {
        const next = new Date(prev);
        next.setDate(next.getDate() + delta * 7);
        return startOfDay(next);
      }
      return startOfDay(new Date(prev.getFullYear(), prev.getMonth() + delta, 1));
    });
  }

  async function handleReschedule(draftId, scheduledAtISO) {
    setBusy(true);
    try {
      await rescheduleDraft({ token, draftId, scheduledAt: scheduledAtISO });
      setSelectedDraftId(null);
      refresh();
    } catch (e) {
      if (e.status === 401) return onAuthError?.();
      setError(e.message || "Could not reschedule that post.");
    } finally {
      setBusy(false);
    }
  }

  async function handleUnschedule(draftId) {
    setBusy(true);
    try {
      await unscheduleDraft({ token, draftId });
      setSelectedDraftId(null);
      refresh();
    } catch (e) {
      if (e.status === 401) return onAuthError?.();
      setError(e.message || "Could not unschedule that post.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleExpand(e, draftId) {
    e.stopPropagation();
    if (expandedIds.has(draftId)) {
      setExpandedIds((prev) => {
        const next = new Set(prev);
        next.delete(draftId);
        return next;
      });
      return;
    }
    setExpandedIds((prev) => new Set(prev).add(draftId));
    const draft = drafts.find((d) => d.draft_id === draftId);
    if (!draft?.is_external && !expandedContent[draftId]) {
      setExpandLoadingId(draftId);
      try {
        const res = await getDraft({ token, draftId });
        setExpandedContent((prev) => ({ ...prev, [draftId]: res.draft }));
      } catch {
        // If the fetch fails, the chip just falls back to its title/summary.
      } finally {
        setExpandLoadingId(null);
      }
    }
  }

  function handleDrop(e, day) {
    e.preventDefault();
    setDragOverKey(null);
    const draftId = e.dataTransfer.getData("text/draft-id");
    if (!draftId) return;
    const dragged = drafts.find((d) => d.draft_id === draftId);
    if (!dragged || !dragged.scheduled_at) return; // published posts aren't reschedulable
    const original = new Date(dragged.scheduled_at);
    if (isSameDay(original, day)) return;
    const next = new Date(day);
    next.setHours(original.getHours(), original.getMinutes(), 0, 0);
    if (next <= new Date()) return; // silently ignore drops into the past
    handleReschedule(draftId, next.toISOString());
  }

  const periodLabel = isListView
    ? "All posts"
    : viewMode === "week"
    ? (() => {
        const start = grid[0];
        const end = grid[grid.length - 1];
        const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
        const startMonth = start.toLocaleDateString(undefined, { month: "short" });
        if (sameMonth) {
          return `${startMonth} ${start.getDate()} – ${end.getDate()}, ${end.getFullYear()}`;
        }
        const endStr = end.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
        return `${startMonth} ${start.getDate()} – ${endStr}`;
      })()
    : viewDate.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const today = startOfDay(new Date());
  // Newest-first, Instagram-archive-style ordering for the list view.
  const listItems = [...drafts].sort((a, b) => new Date(effectiveDate(b)) - new Date(effectiveDate(a)));

  function accountNamesForDraft(d) {
    return chipPlatforms(d).map((key) => connections?.[key]?.profile_name || platformByKey(key)?.label || key);
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: "1.25rem" }}>
        <p style={{ fontFamily: "var(--font-display)", fontSize: "clamp(20px, 3vw, 26px)", color: "var(--ink)", margin: 0 }}>
          {periodLabel}
        </p>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {connectedPlatforms.length > 0 && (
            <div style={{ display: "flex", alignItems: "stretch", border: "0.5px solid var(--border-strong)", borderRadius: 6, overflow: "hidden" }}>
              <button
                onClick={() => setAccountFilter("all")}
                style={{
                  width: "auto", padding: "0 12px", border: "none", borderRadius: 0,
                  background: accountFilter === "all" ? "var(--accent)" : "transparent",
                  color: accountFilter === "all" ? "#fff" : "var(--text-secondary)",
                }}
              >
                All
              </button>
              {connectedPlatforms.map((p) => {
                const accountName = connections?.[p.key]?.profile_name || p.label;
                return (
                  <div key={p.key} style={{ display: "flex", alignItems: "center" }}>
                    <span style={{ width: 1, alignSelf: "center", height: "60%", background: "var(--border-strong)", flexShrink: 0 }} />
                    <button
                      onClick={() => setAccountFilter(p.key)}
                      title={`${p.label} · ${accountName}`}
                      style={{
                        width: "auto", padding: "0 10px", border: "none", borderRadius: 0,
                        display: "flex", alignItems: "center", gap: 6,
                        background: accountFilter === p.key ? "var(--accent)" : "transparent",
                        color: accountFilter === p.key ? "#fff" : "var(--text-secondary)",
                      }}
                    >
                      <PlatformLogo platform={p} size={13} />
                      {accountName}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div style={{ display: "flex", flex: "1 1 260px", gap: 8, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
          {!isListView && (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button onClick={() => setViewDate(startOfDay(new Date()))} style={{ width: "auto", padding: "0 14px" }}>Today</button>
              <button onClick={() => navigate(-1)} style={{ width: "auto", padding: "0 14px" }} aria-label={viewMode === "week" ? "Previous week" : "Previous month"}>‹</button>
              <button onClick={() => navigate(1)} style={{ width: "auto", padding: "0 14px" }} aria-label={viewMode === "week" ? "Next week" : "Next month"}>›</button>
            </div>
          )}
          <div style={{ display: "flex", border: "0.5px solid var(--border-strong)", borderRadius: 6, overflow: "hidden" }}>
            <button
              onClick={() => setViewMode("month")}
              style={{
                width: "auto", padding: "0 14px", border: "none", borderRadius: 0,
                background: viewMode === "month" ? "var(--accent)" : "transparent",
                color: viewMode === "month" ? "#fff" : "var(--text-secondary)",
              }}
            >
              Month
            </button>
            <button
              onClick={() => setViewMode("week")}
              style={{
                width: "auto", padding: "0 14px", border: "none", borderRadius: 0,
                background: viewMode === "week" ? "var(--accent)" : "transparent",
                color: viewMode === "week" ? "#fff" : "var(--text-secondary)",
              }}
            >
              Week
            </button>
            <button
              onClick={() => setViewMode("list")}
              style={{
                width: "auto", padding: "0 14px", border: "none", borderRadius: 0,
                background: viewMode === "list" ? "var(--accent)" : "transparent",
                color: viewMode === "list" ? "#fff" : "var(--text-secondary)",
              }}
            >
              List
            </button>
          </div>
        </div>
        </div>
      </div>

      {error && (
        <p style={{ fontSize: 13, color: "var(--danger)", background: "var(--danger-bg)", borderRadius: "var(--radius)", padding: "8px 12px", marginBottom: 16 }}>          {error}
        </p>
      )}

      {historyNotice && (
        <p style={{ fontSize: 12.5, color: "var(--text-muted)", background: "var(--paper-raised)", border: "0.5px solid var(--border)", borderRadius: "var(--radius)", padding: "8px 12px", marginBottom: 16 }}>
          {historyNotice}
        </p>
      )}

      {isListView ? (
        <div style={{ opacity: loading ? 0.6 : 1 }}>
          {listItems.length === 0 && !loading && (
            <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0, padding: "24px 16px", textAlign: "center" }}>
              No posts yet.
            </p>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 3 }}>
            {listItems.map((d) => {
              const thumb = d.featured_image?.url;
              const published = isPublished(d);
              const dt = new Date(effectiveDate(d));
              const dayNum = dt.getDate();
              const monthAbbrev = dt.toLocaleDateString(undefined, { month: "short" });
              return (
                <div
                  key={d.draft_id}
                  onClick={() => setSelectedDraftId(d.draft_id)}
                  style={{
                    position: "relative", cursor: "pointer", aspectRatio: "1", overflow: "hidden",
                    background: "var(--paper-raised)", borderRadius: 4,
                  }}
                >
                  {thumb ? (
                    <img src={thumb} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                  ) : (
                    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <span style={{ fontSize: 11, color: "var(--text-muted)", padding: "0 10px", textAlign: "center", lineHeight: 1.3 }}>
                        {d.title || d.subtopic}
                      </span>
                    </div>
                  )}
                  {/* date badge - mirrors the day/month tile in an Instagram stories archive */}
                  <div
                    style={{
                      position: "absolute", top: 6, left: 6, background: "rgba(0,0,0,0.6)", color: "#fff",
                      borderRadius: 4, padding: "3px 6px", textAlign: "center", lineHeight: 1.15, minWidth: 26,
                    }}
                  >
                    <div style={{ fontSize: 12, fontWeight: 700 }}>{dayNum}</div>
                    <div style={{ fontSize: 9, textTransform: "capitalize" }}>{monthAbbrev}</div>
                  </div>
                  {!d.is_external && (
                    <div
                      style={{
                        position: "absolute", bottom: 6, left: 6, fontSize: 9.5, fontWeight: 600,
                        color: "#fff", background: "rgba(0,0,0,0.6)", borderRadius: 4, padding: "2px 6px",
                      }}
                    >
                      {published ? "Published" : "Scheduled"}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
      <div style={{ border: "0.5px solid var(--border)", borderRadius: 10, overflow: "hidden", opacity: loading ? 0.6 : 1 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", background: "var(--paper-raised)" }}>
          {WEEKDAY_LABELS.map((w) => (
            <div key={w} style={{ padding: "8px 10px", fontSize: 11, fontWeight: 500, color: "var(--text-muted)", textTransform: "uppercase", borderBottom: "0.5px solid var(--border)" }}>
              {w}
            </div>
          ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)" }}>
          {grid.map((day, i) => {
            const key = dateKey(day);
            const inMonth = viewMode === "week" ? true : day.getMonth() === viewDate.getMonth();
            const items = byDay[key] || [];
            const isToday = isSameDay(day, today);
            const isDragOver = dragOverKey === key;

            return (
              <div
                key={key}
                onDragOver={(e) => { e.preventDefault(); setDragOverKey(key); }}
                onDragLeave={() => setDragOverKey((k) => (k === key ? null : k))}
                onDrop={(e) => handleDrop(e, day)}
                style={{
                  minHeight: viewMode === "week" ? 420 : 190, padding: "6px 6px 8px", borderRight: "0.5px solid var(--border)",
                  borderBottom: "0.5px solid var(--border)", background: isDragOver ? "var(--paper)" : "transparent",
                  opacity: inMonth ? 1 : 0.45,
                }}
              >
                <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 4 }}>
                  <span
                    style={{
                      fontSize: 12, fontWeight: isToday ? 700 : 500, color: isToday ? "#fff" : "var(--text-secondary)",
                      background: isToday ? "var(--accent)" : "transparent",
                      borderRadius: "50%", width: 20, height: 20, display: "flex", alignItems: "center", justifyContent: "center",
                    }}
                  >
                    {day.getDate()}
                  </span>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {items.slice(0, expandedDays.has(key) ? items.length : maxChipsPerDay).map((d) => {
                    const chipKeys = chipPlatforms(d);
                    const published = isPublished(d);
                    const thumb = d.featured_image?.url;
                    const isExpanded = expandedIds.has(d.draft_id);
                    const fullContent = expandedContent[d.draft_id];
                    const isLoadingExpand = expandLoadingId === d.draft_id;
                    const expandedText = fullContent
                      ? pickBodyText(fullContent, chipKeys)
                      : d.meta_description || d.title || d.subtopic;
                    return (
                      <div
                        key={d.draft_id}
                        draggable={!published}
                        onDragStart={(e) => e.dataTransfer.setData("text/draft-id", d.draft_id)}
                        onClick={() => setSelectedDraftId(d.draft_id)}
                        style={{
                          cursor: "pointer", background: "var(--paper-raised)",
                          border: "0.5px solid var(--border-strong)", borderRadius: 8,
                          padding: "8px 9px", color: "var(--ink)", overflow: "hidden",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 6 }}>
                          <span style={{ display: "flex", gap: 3, flexShrink: 0 }}>
                            {chipKeys.slice(0, 3).map((key) => {
                              const p = platformByKey(key);
                              return p ? <PlatformLogo key={key} platform={p} size={12} /> : null;
                            })}
                          </span>
                          <span style={{ fontSize: 11, fontWeight: 500, color: "var(--text-secondary)" }}>
                            {formatTime(new Date(effectiveDate(d)))}
                          </span>
                        </div>

                        {isExpanded ? (
                          <p style={{ margin: "0 0 4px", fontSize: 12.5, lineHeight: 1.5, color: "var(--ink)", whiteSpace: "pre-wrap" }}>
                            {isLoadingExpand ? "Loading…" : expandedText}
                          </p>
                        ) : (
                          <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                            <p
                              style={{
                                flex: 1, margin: 0, fontSize: 12.5, lineHeight: 1.35, color: "var(--ink)",
                                display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
                              }}
                            >
                              {d.title || d.subtopic}
                            </p>
                            {thumb && (
                              <img
                                src={thumb}
                                alt=""
                                onClick={(e) => { e.stopPropagation(); setLightboxSrc(thumb); }}
                                style={{ width: 34, height: 34, borderRadius: 6, objectFit: "cover", flexShrink: 0, cursor: "zoom-in" }}
                              />
                            )}
                          </div>
                        )}

                        {isExpanded && thumb && (
                          <img
                            src={thumb}
                            alt=""
                            onClick={(e) => { e.stopPropagation(); setLightboxSrc(thumb); }}
                            style={{ width: "100%", maxHeight: 120, borderRadius: 6, objectFit: "cover", marginBottom: 6, cursor: "zoom-in" }}
                          />
                        )}

                        <button
                          onClick={(e) => toggleExpand(e, d.draft_id)}
                          style={{
                            width: "auto", background: "transparent", border: "none", padding: 0,
                            fontSize: 11, color: "var(--accent)", textAlign: "left", margin: "4px 0 0",
                          }}
                        >
                          {isExpanded ? "Show Less" : "Show More"}
                        </button>

                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 6 }}>
                          <span style={{ fontSize: 13, color: "var(--text-muted)", letterSpacing: 1 }}>•••</span>
                          {!d.is_external && published && (
                            <span
                              style={{
                                fontSize: 10, fontWeight: 500, borderRadius: 4, padding: "2px 6px",
                                color: "#4CAF7D", background: "rgba(76,175,125,0.12)",
                              }}
                            >
                              Published
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {items.length > maxChipsPerDay && (
                    expandedDays.has(key) ? (
                      <button
                        onClick={() => {
                          const next = new Set(expandedDays);
                          next.delete(key);
                          setExpandedDays(next);
                        }}
                        style={{ width: "auto", background: "transparent", border: "none", padding: 0, fontSize: 11, color: "var(--text-muted)", textAlign: "left" }}
                      >
                        Show less
                      </button>
                    ) : (
                      <button
                        onClick={() => setExpandedDays(new Set(expandedDays).add(key))}
                        style={{ width: "auto", background: "transparent", border: "none", padding: 0, fontSize: 11, color: "var(--text-muted)", textAlign: "left" }}
                      >
                        +{items.length - maxChipsPerDay} more
                      </button>
                    )
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      )}

      {selectedDraft && (                                          
        <DraftDetailPanel                                    
          draft={selectedDraft}                           
          busy={busy}                                 
          connections={connections}
          onClose={() => setSelectedDraftId(null)}
          onReschedule={handleReschedule}    
          onUnschedule={handleUnschedule}
          onOpen={onOpenDraft}
        />               
      )}       

      {lightboxSrc && (
        <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
      )}
    </div>
  );
}