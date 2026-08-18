// Landing.jsx
import { useState, useRef, useEffect } from "react";
import { PLATFORMS, PlatformLogo } from "./platforms";

const STEPS = [
  {
    n: "01",
    label: "Generate",
    desc: "Give it a category and subtopic — the agent researches and drafts a full post, with sourced images.",
  },
  {
    n: "02",
    label: "Review",
    desc: "Read it, approve it, or send it back with feedback. Nothing publishes without a human saying so.",
  },
  {
    n: "03",
    label: "Publish",
    desc: "Pick which connected platforms it goes to. One review, published everywhere at once.",
  },
];

function LandingNav({ onGetStarted }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function scrollTo(id) {
    setOpen(false);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  }

  return (
    <nav className="landing-nav">
      <div className="landing-nav-inner">
        <span className="landing-logo">
          <span className="landing-logo-mark" aria-hidden="true">◆</span>
          startTrack
        </span>

        <div className="landing-nav-links">
          <button className="landing-nav-link" onClick={() => scrollTo("hero")}>Product</button>
          <button className="landing-nav-link" onClick={() => scrollTo("features")}>Features</button>
          <span className="landing-nav-link landing-nav-link--soon">Pricing</span>
          <button className="landing-nav-link" onClick={() => scrollTo("platforms")}>Platforms</button>
        </div>

        <div className="landing-nav-actions">
          <button className="text-link landing-nav-login" onClick={onGetStarted}>Log in</button>
          <button className="primary" onClick={onGetStarted}>Get started</button>
        </div>

        <div ref={ref} className="landing-nav-mobile">
          <button onClick={() => setOpen((o) => !o)} aria-label="Menu">
            {open ? "✕" : "☰"}
          </button>
          {open && (
            <div className="landing-nav-mobile-menu">
              <button className="landing-nav-link" onClick={() => scrollTo("hero")}>Product</button>
              <button className="landing-nav-link" onClick={() => scrollTo("features")}>Features</button>
              <span className="landing-nav-link landing-nav-link--soon">Pricing</span>
              <button className="landing-nav-link" onClick={() => scrollTo("platforms")}>Platforms</button>
              <button className="text-link" onClick={onGetStarted}>Log in</button>
              <button className="primary" onClick={onGetStarted}>Get started</button>
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}

export default function Landing({ onGetStarted }) {
  return (
    <div className="landing-page">
      <LandingNav onGetStarted={onGetStarted} />

      {/* HERO */}
      <section id="hero" className="landing-section landing-hero">
        {/* <span className="landing-pill">⚡ AI‑DRAFTED, HUMAN‑APPROVED</span> */}

        <h1 className="landing-headline">
          Draft it once. <span className="landing-underline">Review</span> it once.<br />
          Publish everywhere.
        </h1>

        <p className="landing-subtext">
          Give it a category and subtopic — it researches and writes a full post with
          sourced images. You read it, approve it, or send it back with notes.
          Nothing goes out until you say so.
        </p>

        <div className="landing-hero-ctas">
          <button className="primary" onClick={onGetStarted}>Get started</button>
          <button onClick={() => document.getElementById("features")?.scrollIntoView({ behavior: "smooth" })}>
            See how it works
          </button>
        </div>

        <div className="landing-logos-strip">
          <p className="eyebrow" style={{ marginBottom: 14 }}>Publishes to</p>
          <div className="landing-logos-row">
            {PLATFORMS.map((p) => (
              <span key={p.key} className="landing-logo-chip">
                <PlatformLogo platform={p} size={18} />
                {p.label}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* FEATURES — bento */}
      <section id="features" className="landing-section">
        <span className="landing-pill">☰ FEATURES</span>
        <h2 className="landing-h2">Three steps, and a human in the loop</h2>
        <p className="landing-subtext" style={{ margin: "0 auto 2.5rem" }}>
          No content ever ships without your approval. Drafting is automated.
          Approval isn't.
        </p>

        <div className="landing-bento">
          <div className="landing-bento-card landing-bento-card--large">
            <span className="landing-card-step">{STEPS[0].n}</span>
            <h3>{STEPS[0].label}</h3>
            <p>{STEPS[0].desc}</p>
            <div className="landing-mock-draft" aria-hidden="true">
              <div className="landing-mock-draft-bar">
                <span /><span /><span />
              </div>
              <div className="landing-mock-draft-line landing-mock-draft-line--title" />
              <div className="landing-mock-draft-line" />
              <div className="landing-mock-draft-line" />
              <div className="landing-mock-draft-line" style={{ width: "60%" }} />
              <div className="landing-mock-draft-thumb" />
            </div>
          </div>

          <div className="landing-bento-card">
            <span className="landing-card-step">{STEPS[1].n}</span>
            <h3>{STEPS[1].label}</h3>
            <p>{STEPS[1].desc}</p>
            <div className="landing-mock-review" aria-hidden="true">
              <span className="landing-mock-btn landing-mock-btn--reject">Send back</span>
              <span className="landing-mock-btn landing-mock-btn--approve">Approve</span>
            </div>
          </div>

          <div className="landing-bento-card">
            <span className="landing-card-step">{STEPS[2].n}</span>
            <h3>{STEPS[2].label}</h3>
            <p>{STEPS[2].desc}</p>
            <div className="landing-mock-publish" aria-hidden="true">
              {PLATFORMS.slice(0, 4).map((p) => (
                <span key={p.key} className="landing-mock-publish-icon">
                  <PlatformLogo platform={p} size={14} />
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* INTEGRATIONS — dark band */}
      <section id="platforms" className="landing-dark-band">
        <div className="landing-section">
          <span className="landing-pill landing-pill--dark">⚙ PLATFORMS</span>
          <h2 className="landing-h2 landing-h2--dark">Don't duplicate the work. Integrate.</h2>
          <p className="landing-subtext landing-subtext--dark">
            Connect each platform once. Posting to it happens from there.
          </p>

          <div className="landing-integrations-grid">
            {PLATFORMS.map((p) => (
              <div key={p.key} className="landing-integration-tile">
                <PlatformLogo platform={p} size={26} />
                <span>{p.label}</span>
              </div>
            ))}
            <div className="landing-integration-tile landing-integration-tile--muted">
              <span className="landing-integration-plus">+</span>
              <span>More soon</span>
            </div>
          </div>
        </div>
      </section>

      {/* PULL QUOTE */}
      <section className="landing-section landing-quote-section">
        <p className="landing-quote">
          “Nothing publishes without a human saying so.”
        </p>
        <p className="landing-quote-caption">The one rule that never gets skipped.</p>
      </section>

      {/* CTA + FOOTER — dark band */}
      <section className="landing-dark-band landing-cta-band">
        <div className="landing-section landing-cta">
          <div>
            <h2 className="landing-h2 landing-h2--dark" style={{ margin: 0 }}>
              Ready to put your content<br />on autopilot?
            </h2>
          </div>
          <div className="landing-cta-buttons">
            <button className="primary" onClick={onGetStarted}>Get started</button>
            <button className="landing-btn-ghost-dark" onClick={onGetStarted}>Log in</button>
          </div>
        </div>

        <footer className="landing-footer">
          <div className="landing-section landing-footer-inner">
            <div className="landing-footer-brand">
              <span className="landing-logo landing-logo--dark">
                <span className="landing-logo-mark" aria-hidden="true">◆</span>
                startTrack
              </span>
              <p>Draft with AI. Publish with approval.</p>
            </div>

            <div className="landing-footer-col">
              <p className="eyebrow" style={{ color: "#7FA687" }}>Product</p>
              <button className="landing-footer-link" onClick={() => document.getElementById("features")?.scrollIntoView({ behavior: "smooth" })}>Features</button>
              <button className="landing-footer-link" onClick={() => document.getElementById("platforms")?.scrollIntoView({ behavior: "smooth" })}>Platforms</button>
              <span className="landing-footer-link landing-footer-link--soon">Pricing</span>
            </div>

            <div className="landing-footer-col">
              <p className="eyebrow" style={{ color: "#7FA687" }}>Account</p>
              <button className="landing-footer-link" onClick={onGetStarted}>Log in</button>
              <button className="landing-footer-link" onClick={onGetStarted}>Sign up</button>
            </div>
          </div>
          <div className="landing-section landing-footer-bottom">
            <span>© {new Date().getFullYear()} startTrack</span>
          </div>
        </footer>
      </section>
    </div>
  );
}