// DraftReview.jsx
import { useState, useEffect } from "react";
import { PLATFORMS, PlatformLogo } from "./platforms";

export default function DraftReview({ draft, connections, onApprove, onSchedule, onReject, onSaveAsDraft, loading, error }) {
  const [activePlatform, setActivePlatform] = useState("finto");
  const [selected, setSelected] = useState(new Set());
  const [showReject, setShowReject] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [live, setLive] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const [closingSchedule, setClosingSchedule] = useState(false);
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleTime, setScheduleTime] = useState("09:00");
  const [lightboxIndex, setLightboxIndex] = useState(null);

  function closeSchedulePanel() {
    setClosingSchedule(true);
    setTimeout(() => {
      setShowSchedule(false);
      setClosingSchedule(false);
    }, 300);
  }

  useEffect(() => {
    setShowReject(false);
    setFeedback("");
    setShowSchedule(false);
    setLightboxIndex(null);
  }, [draft]);

  useEffect(() => {
    setLightboxIndex(null);
  }, [activePlatform]);

  useEffect(() => {
    const connectedKeys = PLATFORMS.filter((p) => connections?.[p.key]).map((p) => p.key);
    setSelected(new Set(connectedKeys.includes("finto") ? ["finto"] : connectedKeys.slice(0, 1)));
    setActivePlatform(connectedKeys[0] || "finto");
  }, [connections, draft]);

  if (!draft) return null;

  const { title, meta_description, intro, sections = [], conclusion, featured_image, carousel_images, video } = draft;
  const postText = {
    finto: intro, linkedin: draft.linkedin_post, facebook: draft.facebook_post,
    instagram: draft.instagram_caption, threads: draft.threads_post,
  };
  const available = PLATFORMS.filter((p) => connections?.[p.key]);

  // Mirrors build_carousel_images() in Agent.py — that function (not
  // featured_image alone) is what actually decides which image(s) go out
  // to every platform at publish time, so the preview needs to show the
  // same set or "approve" doesn't reflect what's really being approved.
  const publishImages = (carousel_images && carousel_images.length > 0)
    ? carousel_images
    : [
        ...(featured_image?.url ? [featured_image] : []),
        ...sections.map((s) => s.image).filter((img) => img?.url),
      ];

  function togglePlatform(key) {
    const next = new Set(selected);
    next.has(key) ? next.delete(key) : next.add(key);
    setSelected(next);
    setActivePlatform(key);
  }

  function handleScheduleSubmit() {
    if (!scheduleDate || !scheduleTime) return;
    const local = new Date(`${scheduleDate}T${scheduleTime}`);
    if (Number.isNaN(local.getTime())) return;
    onSchedule(local.toISOString(), Array.from(selected), live);
  }

  const todayStr = new Date().toISOString().slice(0, 10);

  return (
    <div>
      <p className="eyebrow">Review</p>
      <h1 className="masthead">{title || "(untitled)"}</h1>
      <div className="masthead-rule" />

      <p style={{ fontSize: 15, color: "var(--text-secondary)", margin: "0 0 1.5rem" }}>
        {meta_description || intro}
      </p>

      {featured_image?.url && (
        <img
          src={featured_image.url} alt={title}
          style={{ width: "100%", borderRadius: "var(--radius)", marginBottom: "1.5rem" }}
        />
      )}

      {video?.url && (
        <div style={{ marginBottom: "1.5rem" }}>
          <video
            src={video.url} controls
            style={{ width: "100%", borderRadius: "var(--radius)", display: "block" }}
          />
          <p style={{ fontSize: 12, color: "var(--text-secondary)", margin: "6px 0 0" }}>
            This video will be published in place of the images on platforms that support video
            (finto.day doesn't yet, so it still gets the images).
          </p>
        </div>
      )}

      <div style={{ fontFamily: "var(--font-display)", fontSize: 17, lineHeight: 1.7 }}>
        {sections.map((s, i) => (
          <div key={i} style={{ marginBottom: 20 }}>
            <p style={{ fontWeight: 500, margin: "0 0 6px" }}>{s.heading}</p>
            <p style={{ color: "var(--text-secondary)", margin: 0, fontFamily: "var(--font-sans)", fontSize: 15 }}>
              {s.text}
            </p>
          </div>
        ))}
        <p style={{ fontFamily: "var(--font-sans)", fontSize: 15, color: "var(--text-secondary)" }}>
          {conclusion}
        </p>
      </div>

      <div style={{ borderTop: "1px solid var(--border)", marginTop: "1.5rem", paddingTop: "1.5rem" }}>
        <p className="eyebrow" style={{ marginBottom: 10 }}>Publish to</p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
          {available.map((p) => {
            const on = selected.has(p.key);
            const active = activePlatform === p.key;
            return (
              <button
                key={p.key}
                onClick={() => togglePlatform(p.key)}
                style={{
                  display: "flex", alignItems: "center", gap: 8, height: 36,
                  borderColor: active ? "var(--accent)" : "var(--border-strong)",
                  background: on ? "var(--paper-raised)" : "transparent",
                  opacity: on ? 1 : 0.55,
                }}
              >
                <PlatformLogo platform={p} size={14} />
                {p.label}
              </button>
            );
          })}
        </div>

        {postText[activePlatform] && (
          <div style={{
            background: "var(--paper-raised)", border: "1px solid var(--border)",
            borderRadius: "var(--radius)", padding: "12px 14px", marginBottom: 16,
          }}>
            <p className="eyebrow" style={{ marginBottom: 8 }}>
              {PLATFORMS.find((p) => p.key === activePlatform)?.label} preview
            </p>
            {!video?.url && publishImages.length > 0 && (
              <div style={{ display: "flex", gap: 6, overflowX: "auto", marginBottom: 10 }}>
                {publishImages.map((img, i) => (
                  <img
                    key={i} src={img.url} alt="" onClick={() => setLightboxIndex(i)}
                    style={{ width: 76, height: 76, objectFit: "cover", borderRadius: 6, flexShrink: 0, cursor: "zoom-in" }}
                  />
                ))}
              </div>
            )}
            <p style={{ fontSize: 14, whiteSpace: "pre-wrap", margin: 0 }}>
              {postText[activePlatform]}
            </p>
          </div>
        )}

        {error && (
          <p style={{
            fontSize: 13, color: "var(--danger)", background: "var(--danger-bg)",
            borderRadius: "var(--radius)", padding: "8px 12px", margin: "0 0 1rem",
          }}>{error}</p>
        )}

        {showReject ? (
          <>
            <label htmlFor="feedback">What should change</label>
            <textarea id="feedback" rows={3} value={feedback} onChange={(e) => setFeedback(e.target.value)} style={{ marginBottom: 10 }} />
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setShowReject(false)} disabled={loading}>Cancel</button>
              <button className="primary" onClick={() => onReject(feedback.trim())} disabled={loading || !feedback.trim()}>
                {loading ? "Revising…" : "Send feedback"}
              </button>
            </div>
          </>
        ) : (
          <>
            <style>{`
              @keyframes dr-fade-in {
                from { opacity: 0; transform: translateY(-6px); filter: blur(4px); }
                to   { opacity: 1; transform: translateY(0);    filter: blur(0);  }
              }
              @keyframes dr-fade-out {
                from { opacity: 1; transform: translateY(0);    filter: blur(0);  }
                to   { opacity: 0; transform: translateY(-6px); filter: blur(4px); }
              }
              .dr-fade-in-el  { animation: dr-fade-in 0.35s ease-out; }
              .dr-fade-in-buttons { animation: dr-fade-in 0.35s ease-out; }
              .dr-fade-out-el { animation: dr-fade-out 0.3s ease-in forwards; }
              .dr-schedule-pill {
                display: flex; align-items: center; gap: 0;
                border: 1px solid var(--border-strong); border-radius: 999px;
                overflow: hidden; background: var(--paper-raised); margin-bottom: 10px;
              }
              .dr-schedule-pill input {
                border: none; border-radius: 0; background: transparent;
                height: 40px; font-size: 14px;
              }
              .dr-schedule-pill input[type="date"] {
                flex: 1.3; border-right: 1px solid var(--border);
              }
              .dr-schedule-pill input[type="time"] { flex: 1; }
              .dr-schedule-close {
                width: 40px; height: 40px; flex-shrink: 0; border: none; border-radius: 0;
                background: transparent; display: flex; align-items: center; justify-content: center;
                color: var(--text-secondary); cursor: pointer;
              }
              .dr-schedule-close:hover { color: var(--text); }
              .dr-schedule-summary {
                font-size: 12px; color: var(--text-secondary); text-align: center;
                margin: 10px 0 0; animation: dr-fade-in 0.3s ease-out;
              }
            `}</style>

            {(showSchedule || closingSchedule) ? (
              <div className={closingSchedule ? "dr-fade-out-el" : "dr-fade-in-el"}>
                <p className="eyebrow" style={{ marginBottom: 10 }}>Schedule for</p>
                <div className="dr-schedule-pill">
                  <input
                    type="date" min={todayStr} value={scheduleDate}
                    onChange={(e) => setScheduleDate(e.target.value)}
                  />
                  <input
                    type="time" value={scheduleTime}
                    onChange={(e) => setScheduleTime(e.target.value)}
                  />
                  <button
                    type="button" title="Cancel" className="dr-schedule-close"
                    onClick={closeSchedulePanel} disabled={loading}
                  >
                    ✕
                  </button>
                </div>
                <button
                  className="primary" style={{ width: "100%" }}
                  onClick={handleScheduleSubmit}
                  disabled={loading || selected.size === 0 || !scheduleDate}
                >
                  {loading ? "Scheduling…" : "Confirm schedule"}
                </button>

                {scheduleDate && scheduleTime && (
                  <p className="dr-schedule-summary">
                    Will be posted on{" "}
                    {new Date(`${scheduleDate}T${scheduleTime}`).toLocaleString(undefined, {
                      dateStyle: "medium", timeStyle: "short",
                    })}
                  </p>
                )}
              </div>
            ) : (
              <div className="dr-fade-in-buttons" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button onClick={() => setShowReject(true)} disabled={loading}>Reject</button>
                {onSaveAsDraft && (
                  <button onClick={onSaveAsDraft} disabled={loading}>
                    Save as draft
                  </button>
                )}
                <button
                  onClick={() => { setScheduleDate(todayStr); setShowSchedule(true); }}
                  disabled={loading || selected.size === 0}
                >
                  Schedule
                </button>
                <button
                  className="primary"
                  onClick={() => onApprove(live, Array.from(selected))}
                  disabled={loading || selected.size === 0}
                >
                  {loading ? "Publishing…" : "Approve & publish"}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {lightboxIndex !== null && publishImages[lightboxIndex] && (
        <div
          onClick={() => setLightboxIndex(null)}
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 1000,
            display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
          }}
        >
          <button
            onClick={() => setLightboxIndex(null)}
            aria-label="Close"
            style={{
              position: "absolute", top: 16, right: 16, width: 36, height: 36, padding: 0,
              borderRadius: "50%", border: "none", background: "rgba(255,255,255,0.15)",
              color: "#fff", fontSize: 16,
            }}
          >
            ✕
          </button>

          {publishImages.length > 1 && (
            <button
              onClick={(e) => { e.stopPropagation(); setLightboxIndex((lightboxIndex - 1 + publishImages.length) % publishImages.length); }}
              aria-label="Previous image"
              style={{
                position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)",
                width: 40, height: 40, padding: 0, borderRadius: "50%", border: "none",
                background: "rgba(255,255,255,0.15)", color: "#fff", fontSize: 18,
              }}
            >
              ‹
            </button>
          )}

          <img
            src={publishImages[lightboxIndex].url} alt=""
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: "90%", maxHeight: "85vh", borderRadius: 8, display: "block" }}
          />

          {publishImages.length > 1 && (
            <button
              onClick={(e) => { e.stopPropagation(); setLightboxIndex((lightboxIndex + 1) % publishImages.length); }}
              aria-label="Next image"
              style={{
                position: "absolute", right: 16, top: "50%", transform: "translateY(-50%)",
                width: 40, height: 40, padding: 0, borderRadius: "50%", border: "none",
                background: "rgba(255,255,255,0.15)", color: "#fff", fontSize: 18,
              }}
            >
              ›
            </button>
          )}

          {publishImages.length > 1 && (
            <p style={{ position: "absolute", bottom: 20, color: "#fff", fontSize: 12.5, margin: 0 }}>
              {lightboxIndex + 1} / {publishImages.length}
            </p>
          )}
        </div>
      )}
    </div>
  );
}