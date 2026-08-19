// Calendar.jsx — month-grid view of scheduled drafts (Planable-style):
// each day cell shows small draggable chips for drafts scheduled that day;
// click a chip to see details / reschedule / unschedule / open the draft;
// drag a chip onto another day to reschedule it (same time of day, new date).
import { useState, useEffect, useCallback } from "react";
import { getDrafts, rescheduleDraft, unscheduleDraft } from "../api";
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
function buildGrid(viewDate) {
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

function PlatformFilterBar({ connections, activePlatform, onSelect, counts }) {
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
      {PLATFORMS.map((p) => {
        const connected = !!connections?.[p.key];
        const active = activePlatform === p.key;
        const count = counts[p.key] || 0;
        return (
          <button
            key={p.key}
            onClick={() => onSelect(active ? null : p.key)}
            title={`${p.label} — ${connected ? "connected" : "not connected"}${active ? " (selected)" : ""}`}
            style={{
              display: "flex", alignItems: "center", gap: 7, height: 34,
              width: "auto", padding: "0 12px",
              border: active ? "1.5px solid #4CAF7D" : "0.5px solid var(--border-strong)",
              background: active ? "var(--paper-raised)" : "transparent",
              opacity: connected ? 1 : 0.5,
            }}
          >
            <PlatformLogo platform={p} size={14} />
            <span style={{ fontSize: 13 }}>{p.label}</span>
            {count > 0 && (
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{count}</span>
            )}
          </button>
        );
      })}
      {activePlatform && (
        <button
          onClick={() => onSelect(null)}
          style={{ width: "auto", padding: "0 12px", background: "transparent", border: "none", fontSize: 12.5, color: "var(--text-muted)" }}
        >
          Clear filter
        </button>
      )}
    </div>
  );
}

export default function Calendar({ token, connections, onOpenDraft, onAuthError }) {
  const [viewDate, setViewDate] = useState(() => startOfDay(new Date()));
  const [drafts, setDrafts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedDraftId, setSelectedDraftId] = useState(null);
  const [dragOverKey, setDragOverKey] = useState(null);
  const [busy, setBusy] = useState(false);
  const [activePlatform, setActivePlatform] = useState(null);

  const grid = buildGrid(viewDate);

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
  }, [token, viewDate.getFullYear(), viewDate.getMonth()]);

  useEffect(refresh, [refresh]);

  const byDay = {};
  const visibleDrafts = activePlatform
    ? drafts.filter((d) => chipPlatforms(d).includes(activePlatform))
    : drafts;
  visibleDrafts.forEach((d) => {
    const key = dateKey(new Date(effectiveDate(d)));
    (byDay[key] ||= []).push(d);
  });
  Object.values(byDay).forEach((list) => list.sort((a, b) => new Date(effectiveDate(a)) - new Date(effectiveDate(b))));

  const platformCounts = {};
  drafts.forEach((d) => {
    chipPlatforms(d).forEach((key) => {
      platformCounts[key] = (platformCounts[key] || 0) + 1;
    });
  });

  const selectedDraft = drafts.find((d) => d.draft_id === selectedDraftId) || null;

  function goToMonth(delta) {
    setViewDate((prev) => startOfDay(new Date(prev.getFullYear(), prev.getMonth() + delta, 1)));
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

  const monthLabel = viewDate.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const today = startOfDay(new Date());
  const activePlatformInfo = activePlatform ? platformByKey(activePlatform) : null;
  const activePlatformConnected = activePlatform ? !!connections?.[activePlatform] : false;

  return (
    <div>
      <PlatformFilterBar
        connections={connections}
        activePlatform={activePlatform}
        onSelect={setActivePlatform}
        counts={platformCounts}
      />

      {activePlatformInfo && (
        <p style={{ fontSize: 12.5, color: "var(--text-muted)", margin: "0 0 16px", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <PlatformLogo platform={activePlatformInfo} size={12} />
          {activePlatformInfo.label} — {activePlatformConnected ? "connected" : "not connected"}
          {" · "}
          {visibleDrafts.filter((d) => d.scheduled_at).length} upcoming
          {" · "}
          {visibleDrafts.filter((d) => isPublished(d)).length} published in view
        </p>
      )}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: "1.25rem" }}>
        <p style={{ fontFamily: "var(--font-display)", fontSize: "clamp(20px, 3vw, 26px)", color: "var(--ink)", margin: 0 }}>
          {monthLabel}
        </p>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => setViewDate(startOfDay(new Date()))} style={{ width: "auto", padding: "0 14px" }}>Today</button>
          <button onClick={() => goToMonth(-1)} style={{ width: "auto", padding: "0 14px" }} aria-label="Previous month">‹</button>
          <button onClick={() => goToMonth(1)} style={{ width: "auto", padding: "0 14px" }} aria-label="Next month">›</button>
        </div>
      </div>

      {error && (
        <p style={{ fontSize: 13, color: "var(--danger)", background: "var(--danger-bg)", borderRadius: "var(--radius)", padding: "8px 12px", marginBottom: 16 }}>
          {error}
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
            const inMonth = day.getMonth() === viewDate.getMonth();
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
                  minHeight: 190, padding: "6px 6px 8px", borderRight: "0.5px solid var(--border)",
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
                  {items.slice(0, MAX_CHIPS_PER_DAY).map((d) => {
                    const chipKeys = chipPlatforms(d);
                    const published = isPublished(d);
                    const thumb = d.featured_image?.url;
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
                              style={{ width: 34, height: 34, borderRadius: 6, objectFit: "cover", flexShrink: 0 }}
                            />
                          )}
                        </div>

                        <button
                          onClick={(e) => { e.stopPropagation(); setSelectedDraftId(d.draft_id); }}
                          style={{
                            width: "auto", background: "transparent", border: "none", padding: 0,
                            fontSize: 11, color: "var(--accent)", textAlign: "left", margin: "4px 0 0",
                          }}
                        >
                          Show More
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
                  {items.length > MAX_CHIPS_PER_DAY && (
                    <button
                      onClick={() => setSelectedDraftId(items[MAX_CHIPS_PER_DAY].draft_id)}
                      style={{ width: "auto", background: "transparent", border: "none", padding: 0, fontSize: 11, color: "var(--text-muted)", textAlign: "left" }}
                    >
                      +{items.length - MAX_CHIPS_PER_DAY} more
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
    </div>
  );
}