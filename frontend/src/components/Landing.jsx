// Landing.jsx
import { PLATFORMS } from "./platforms";
import NavBar from "./NavBar";

const STEPS = [
  { label: "Generate", desc: "Give it a category and subtopic — the agent researches and drafts a full post, with sourced images." },
  { label: "Review", desc: "Read it, approve it, or send it back with feedback. Nothing publishes without a human saying so." },
  { label: "Publish", desc: "Pick which connected platforms it goes to. One review, published everywhere at once." },
];


export default function Landing({ onGetStarted }) {
  return (
    <div style={{ width: "100%", maxWidth: 720 }}>
        <NavBar />

      <p className="eyebrow" style={{ margin: "0 0 6px" }}>startTrack</p>
      <h1 className="masthead" style={{ fontSize: 56 }}>
        Write once. Publish everywhere. Approve every word.
      </h1>
      <hr className="masthead-rule" />

      <p style={{ fontSize: 17, color: "var(--text-secondary)", maxWidth: 520, margin: "0 0 2rem" }}>
        An agent drafts your content, you review it, startTrack publishes it —
        to every platform you've connected, from one approval.
      </p>

      <button className="primary" onClick={onGetStarted} style={{ marginBottom: "3rem" }}>
        Get started
      </button>

      <div style={{ display: "flex", flexDirection: "column", gap: 24, marginBottom: "3rem" }}>
        {STEPS.map((s, i) => (
          <div key={s.label} style={{ display: "flex", gap: 16 }}>
            <span
              style={{
                fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--accent)",
                border: "1.5px solid var(--accent)", borderRadius: "50%",
                width: 28, height: 28, flexShrink: 0,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}
            >
              {i + 1}
            </span>
            <div>
              <p style={{ fontWeight: 500, fontSize: 15, margin: "0 0 4px" }}>{s.label}</p>
              <p style={{ fontSize: 14, color: "var(--text-secondary)", margin: 0 }}>{s.desc}</p>
            </div>
          </div>
        ))}
      </div>

      <div style={{ borderTop: "1px solid var(--border)", paddingTop: "1.5rem", marginBottom: "3rem" }}>
        <p className="eyebrow" style={{ marginBottom: 12 }}>Publishes to</p>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          {PLATFORMS.map((p) => (
            <span key={p.key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14 }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: p.color }} />
              {p.label}
            </span>
          ))}
        </div>
      </div>

      <div style={{ textAlign: "center", paddingTop: "1rem" }}>
        <button className="primary" onClick={onGetStarted}>
          Get started
        </button>
      </div>
    </div>
  );
}