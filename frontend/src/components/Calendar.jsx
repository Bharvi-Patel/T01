// Calendar.jsx — month-grid view of scheduled drafts (Planable-style):
// each day cell shows small draggable chips for drafts scheduled that day;
// click a chip to see details / reschedule / unschedule / open the draft;
// drag a chip onto another day to reschedule it (same time of day, new date).
import { useState, useEffect, useCallback } from "react";
import { getDrafts, rescheduleDraft, unscheduleDraft, getDraft } from "../api";
import { PLATFORMS, PlatformLogo } from "./platforms";

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MAX_CHIPS_PER_DAY = 2;


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

function DraftDetailPanel({ draft, onClose, onReschedule, onUnschedule, onOpen, busy }) {
  const published = isPublished(draft);
  const scheduledAt = draft.scheduled_at ? new Date(draft.scheduled_at) : null;
  const [date, setDate] = useState(scheduledAt ? dateKey(scheduledAt) : "");
  const [time, setTime] = useState(
    scheduledAt
      ? `${String(scheduledAt.getHours()).padStart(2, "0")}:${String(scheduledAt.getMinutes()).padStart(2, "0")}`
      : "09:00"
  );

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
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
        display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100,
      }}
      onClick={onClose}
    >
      <div
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
          {draft.category} · {published ? "Published" : "Scheduled"}
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
                  <span style={{ flex: 1 }}>{p.label}</span>
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
                    {p.label}
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
          <button onClick={onClose} disabled={busy}>Close</button>
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
  const [viewMode, setViewMode] = useState("month"); // "month" | "week"
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

  const grid = buildGrid(viewDate, viewMode);

  const refresh = useCallback(() => {
    setLoading(true);
    setError("");
    const from = grid[0];
    const to = new Date(grid[grid.length - 1]);
    to.setDate(to.getDate() + 1); // cover the whole last day
    getDrafts({ token, scheduledFrom: from.toISOString(), scheduledTo: to.toISOString() })
      .then((res) => setDrafts(res.drafts.filter((d) => effectiveDate(d))))
      .catch((e) => {
        if (e.status === 401) return onAuthError?.();
        setError(e.message || "Could not load the calendar.");
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, viewMode, viewDate.getFullYear(), viewDate.getMonth(), viewDate.getDate()]);

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
    if (!expandedContent[draftId]) {
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

  const periodLabel = viewMode === "week"
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

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: "1.25rem" }}>
        <p style={{ fontFamily: "var(--font-display)", fontSize: "clamp(20px, 3vw, 26px)", color: "var(--ink)", margin: 0 }}>
          {periodLabel}
        </p>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
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
          </div>
          <button onClick={() => setViewDate(startOfDay(new Date()))} style={{ width: "auto", padding: "0 14px" }}>Today</button>
          <button onClick={() => navigate(-1)} style={{ width: "auto", padding: "0 14px" }} aria-label={viewMode === "week" ? "Previous week" : "Previous month"}>‹</button>
          <button onClick={() => navigate(1)} style={{ width: "auto", padding: "0 14px" }} aria-label={viewMode === "week" ? "Next week" : "Next month"}>›</button>
        </div>
      </div>

      {error && (
        <p style={{ fontSize: 13, color: "var(--danger)", background: "var(--danger-bg)", borderRadius: "var(--radius)", padding: "8px 12px", marginBottom: 16 }}>          {error}
        </p>
      )}

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
                  {items.slice(0, maxChipsPerDay).map((d) => {
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
                          {published && (
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
                    <button
                      onClick={() => setSelectedDraftId(items[maxChipsPerDay].draft_id)}
                      style={{ width: "auto", background: "transparent", border: "none", padding: 0, fontSize: 11, color: "var(--text-muted)", textAlign: "left" }}
                    >
                      +{items.length - maxChipsPerDay} more
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {selectedDraft && (                                          
        <DraftDetailPanel                                    
          draft={selectedDraft}                           
          busy={busy}                                 
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