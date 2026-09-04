// GeneratingProgress.jsx
// A rotating-label + shimmering progress bar shown while the AI draft is
// being generated. No new dependencies (no motion/react, no Tailwind) -
// built with plain CSS keyframes to match the rest of the app's inline-
// style + CSS-var approach.
//
// `loading` controls the two phases:
//   - true:  eases the bar toward ~92% and cycles the status labels
//   - false: swipes the bar the rest of the way to 100%, holds briefly,
//            then calls onComplete so the parent can unmount this
import { useState, useEffect, useRef } from "react";

const DEFAULT_LABELS = [
  "Researching your topic…",
  "Reading the sources…",
  "Drafting the article…",
  "Sourcing images…",
  "Writing platform posts…",
  "Polishing the copy…",
];

export default function GeneratingProgress({ labels = DEFAULT_LABELS, intervalMs = 2200, loading = true, onComplete }) {
  const [labelIndex, setLabelIndex] = useState(0);
  const [displayLabel, setDisplayLabel] = useState(labels[0]);
  const [flipKey, setFlipKey] = useState(0);
  const [progress, setProgress] = useState(6);

  // Cycle through the labels while still loading, replaying the flip
  // animation each time by bumping flipKey (forces React to remount the
  // span so the CSS animation restarts).
  useEffect(() => {
    if (!loading) return;
    const id = setInterval(() => {
      setLabelIndex((prev) => {
        const next = (prev + 1) % labels.length;
        setDisplayLabel(labels[next]);
        setFlipKey((k) => k + 1);
        return next;
      });
    }, intervalMs);
    return () => clearInterval(id);
  }, [labels, intervalMs, loading]);

  // Phase 1 (loading=true): simulated progress easing toward ~92% - no
  // real progress signal comes back from /generate (single request/
  // response, no streaming), so this never claims completion on its own.
  const rafRef = useRef(null);
  useEffect(() => {
    if (!loading) return;
    const start = Date.now();
    const CAP = 92;
    const FLOOR = 6;
    const TAU_MS = 3500;
    function tick() {
      const t = Date.now() - start;
      setProgress(FLOOR + (CAP - FLOOR) * (1 - Math.exp(-t / TAU_MS)));
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [loading]);

  // Phase 2 (loading=false): swipe the rest of the way to 100%, hold
  // briefly so it reads as "done" rather than just disappearing, then
  // hand control back to the parent.
  useEffect(() => {
    if (loading) return;
    cancelAnimationFrame(rafRef.current);
    setDisplayLabel("Done!");
    setFlipKey((k) => k + 1);
    setProgress(100);
    const t = setTimeout(() => onComplete?.(), 650);
    return () => clearTimeout(t);
  }, [loading]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 18, padding: "8px 0" }}>
      <style>{`
        @keyframes gp-flip-in {
          from { opacity: 0; transform: translateY(8px) scale(1.4) rotateX(-55deg); filter: blur(4px); }
          to   { opacity: 1; transform: translateY(0)   scale(1)   rotateX(0);      filter: blur(0);   }
        }
        @keyframes gp-shimmer {
          from { transform: translateX(-100%); }
          to   { transform: translateX(220%); }
        }
        .gp-label-wrap { perspective: 800px; }
        .gp-label {
          display: inline-block;
          animation: gp-flip-in 0.5s cubic-bezier(0.22, 1, 0.36, 1);
          transform-style: preserve-3d;
          will-change: transform;
        }
      `}</style>

      <div className="gp-label-wrap" style={{ minHeight: 28, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span
          key={flipKey}
          className="gp-label"
          style={{ fontSize: 17, fontWeight: 600, color: "var(--text-secondary)", textAlign: "center" }}
        >
          {displayLabel}
        </span>
      </div>

      <div
        style={{
          width: "100%", maxWidth: 320, height: 8, borderRadius: 999, overflow: "hidden",
          background: "var(--paper-raised)", border: "1px solid var(--border)",
        }}
      >
        <div
          style={{
            position: "relative", height: "100%", borderRadius: 999,
            width: `${progress}%`, background: "var(--accent)",
            transition: loading ? "width 0.4s ease-out" : "width 0.5s cubic-bezier(0.22, 1, 0.36, 1)",
            overflow: "hidden",
          }}
        >
          {loading && (
            <div
              style={{
                position: "absolute", inset: 0, width: "40%",
                background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.5), transparent)",
                animation: "gp-shimmer 1.6s linear infinite",
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
