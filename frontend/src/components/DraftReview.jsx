// DraftReview.jsx
import { useState, useEffect } from "react";
import { PLATFORMS, PlatformLogo } from "./platforms";

export default function DraftReview({ draft, connections, onApprove, onReject, loading, error }) {
  const [activePlatform, setActivePlatform] = useState("finto");
  const [selected, setSelected] = useState(new Set());
  const [showReject, setShowReject] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [live, setLive] = useState(false);

  useEffect(() => {
    setShowReject(false);
    setFeedback("");
  }, [draft]);

  useEffect(() => {
    const connectedKeys = PLATFORMS.filter((p) => connections?.[p.key]).map((p) => p.key);
    setSelected(new Set(connectedKeys.includes("finto") ? ["finto"] : connectedKeys.slice(0, 1)));
    setActivePlatform(connectedKeys[0] || "finto");
  }, [connections, draft]);

  if (!draft) return null;

  const { title, meta_description, intro, sections = [], conclusion, featured_image } = draft;
  const postText = {
    finto: intro, linkedin: draft.linkedin_post, facebook: draft.facebook_post,
    instagram: draft.instagram_caption, threads: draft.threads_post,
  };
  const available = PLATFORMS.filter((p) => connections?.[p.key]);

  function togglePlatform(key) {
    const next = new Set(selected);
    next.has(key) ? next.delete(key) : next.add(key);
    setSelected(next);
    setActivePlatform(key);
  }

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
            {!selected.has("linkedin") && !selected.has("facebook") && !selected.has("instagram") && !selected.has("threads") && (
              <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, cursor: "pointer" }}>
                <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} style={{ width: "auto", height: "auto" }} />
                <span style={{ fontSize: 13, fontFamily: "var(--font-sans)" }}>Publish live on finto.day</span>
              </label>
            )}
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setShowReject(true)} disabled={loading}>Reject</button>
              <button
                className="primary"
                onClick={() => onApprove(live, Array.from(selected))}
                disabled={loading || selected.size === 0}
              >
                {loading ? "Publishing…" : "Approve & publish"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}