// Landing.jsx
import { useState, useRef, useEffect } from "react";
import { PLATFORMS, PlatformLogo } from "./platforms";

// A simple, custom geometric mark (an ascending line to a point) instead of
// a Unicode glyph — used everywhere the brand appears: nav, footer, and
// (via the matching favicon in index.html) the browser tab.
function LogoMark({ size = 16 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className="landing-logo-mark"
    >
      <path d="M3.5 16.5l5.5-6.5 4 3.5L20.5 4.5" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="20.5" cy="4.5" r="2" fill="currentColor" />
    </svg>
  );
}

const STEPS = [
  {
    n: "01",
    label: "Generate",
    desc: "Give it a category and subtopic and it researches the topic, drafts the post, and finds real sourced images to match. Or skip the AI and write it yourself, images and video included.",
  },
  {
    n: "02",
    label: "Review",
    desc: "Every draft — AI-written or your own — sits in Review until someone approves it. Reject sends it back with notes on what to fix.",
  },
  {
    n: "03",
    label: "Publish",
    desc: "Pick which connected accounts it should go out to. One click, live on all of them at once.",
  },
];

// Placeholder for the real screen recording of each step, until it's ready
// to drop in. To swap step N's placeholder for the real clip, replace its
// <div className="landing-screen landing-screen--video">...</div> with:
//   <video className="landing-screen landing-screen--video" controls poster="/demo-<step>-poster.jpg">
//     <source src="/demo-<step>.mp4" type="video/mp4" />
//   </video>
// e.g. /demo-generate.mp4, /demo-review.mp4, /demo-publish.mp4 in /public.
function StepVideoPlaceholder({ label }) {
  return (
    <div className="landing-screen landing-screen--video" aria-hidden="true">
      <span className="landing-video-play">▶</span>
      <p className="landing-video-label">{label} — video coming soon</p>
    </div>
  );
}

// Fades a section up into place the first time it scrolls into view. Kept
// for the hero only now — most of the page renders in place with no
// scroll-triggered motion, so nothing delays access to the content.
function Reveal({ as: Tag = "div", className = "", children, ...rest }) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -40px 0px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <Tag
      ref={ref}
      className={`reveal${visible ? " reveal--visible" : ""}${className ? " " + className : ""}`}
      {...rest}
    >
      {children}
    </Tag>
  );
}

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
          <LogoMark size={16} />
          startTrack
        </span>

        <div className="landing-nav-links">
          <button className="landing-nav-link" onClick={() => scrollTo("hero")}>Product</button>
          <button className="landing-nav-link" onClick={() => scrollTo("workflow")}>Workflow</button>
          <span className="landing-nav-link landing-nav-link--soon">Pricing</span>
          <button className="landing-nav-link" onClick={() => scrollTo("platforms")}>Platforms</button>
        </div>

        <div className="landing-nav-actions">
          <button className="text-link landing-nav-login" onClick={onGetStarted}>Log in</button>
          <button className="primary" onClick={onGetStarted}>Create workspace</button>
        </div>

        <div ref={ref} className="landing-nav-mobile">
          <button onClick={() => setOpen((o) => !o)} aria-label="Menu">
            {open ? "✕" : "☰"}
          </button>
          {open && (
            <div className="landing-nav-mobile-menu">
              <button className="landing-nav-link" onClick={() => scrollTo("hero")}>Product</button>
              <button className="landing-nav-link" onClick={() => scrollTo("workflow")}>Workflow</button>
              <span className="landing-nav-link landing-nav-link--soon">Pricing</span>
              <button className="landing-nav-link" onClick={() => scrollTo("platforms")}>Platforms</button>
              <button className="text-link" onClick={onGetStarted}>Log in</button>
              <button className="primary" onClick={onGetStarted}>Create workspace</button>
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
        <Reveal>
          <h1 className="landing-headline">
            Draft it once. <span className="landing-underline">Review</span> it once.<br />
            Publish everywhere.
          </h1>
          <p className="landing-subtext">
            Give your social team one place to draft, review, and approve posts
            across LinkedIn, Facebook, Instagram, and Threads — before any of it
            goes out.
          </p>
          <div className="landing-hero-ctas">
            <button className="primary" onClick={onGetStarted}>Create your first workspace</button>
            <button onClick={() => document.getElementById("workflow")?.scrollIntoView({ behavior: "smooth" })}>
              See the workflow
            </button>
          </div>
        </Reveal>
      </section>

      {/* WORKFLOW — real workflow example, not three generic feature cards.
          Each step below has a video placeholder — see StepVideoPlaceholder
          above for how to swap in the real recordings. */}
      <section id="workflow" className="landing-section">
        <h2 className="landing-h2">A post, from idea to approval</h2>
        <p className="landing-subtext">
          Give it a topic and it researches, drafts, and sources images. Write it
          yourself if you'd rather. Either way, someone on your team reviews it
          before it reaches an audience.
        </p>

        <div className="landing-workflow">
          {STEPS.map((step) => (
            <div key={step.n} className="landing-workflow-col">
              <span className="landing-card-step">{step.n}</span>
              <h3>{step.label}</h3>
              <p>{step.desc}</p>
              <StepVideoPlaceholder label={step.label} />
            </div>
          ))}
        </div>
      </section>

      {/* APPROVAL PRINCIPLE — what "review" actually means, mechanically */}
      <section className="landing-section landing-quote-section">
        <p className="landing-quote">
          A draft doesn't leave Review until someone taps Approve.
        </p>
        <p className="landing-quote-caption">Reject sends it back with notes. Nothing schedules or posts on its own.</p>
      </section>

      {/* PLATFORMS — dark band */}
      <section id="platforms" className="landing-dark-band">
        <div className="landing-section">
          <h2 className="landing-h2 landing-h2--dark">Don't duplicate the work. Integrate.</h2>
          <p className="landing-subtext landing-subtext--dark">
            Connect each account once. Every future post can publish to it from there.
          </p>

          <div className="landing-integrations-grid">
            {PLATFORMS.map((p) => (
              <div key={p.key} className="landing-integration-tile">
                <PlatformLogo platform={p} size={26} />
                <span>{p.label}</span>
              </div>
            ))}
          </div>
          <p className="landing-platforms-note">More platforms are added as they're requested.</p>
        </div>
      </section>

      {/* WHO IT'S FOR */}
      <section className="landing-section">
        <h2 className="landing-h2">Built for teams that need sign-off before anything posts</h2>

        <div className="landing-whofor">
          <div className="landing-whofor-row">
            <span className="landing-whofor-label">Social teams</span>
            <p>Draft once, review together, and publish to every connected account without copy-pasting between five tabs.</p>
          </div>
          <div className="landing-whofor-row">
            <span className="landing-whofor-label">Agencies</span>
            <p>Generate the draft, send it to your client for approval, and publish the moment they say yes.</p>
          </div>
          <div className="landing-whofor-row">
            <span className="landing-whofor-label">Founders &amp; solo operators</span>
            <p>Keep a consistent posting schedule without spending your morning writing captions from scratch.</p>
          </div>
        </div>
      </section>

      {/* HONEST SCOPE — what's automated vs. what's still yours */}
      <section className="landing-section">
        <h2 className="landing-h2">What it does. What you still do.</h2>

        <div className="landing-included">
          <div className="landing-included-col">
            <p className="eyebrow">Automated</p>
            <ul>
              <li>Researches the topic and drafts a full post</li>
              <li>Finds and sources real images to match</li>
              <li>Formats the post for each platform</li>
            </ul>
          </div>
          <div className="landing-included-col">
            <p className="eyebrow">Still yours</p>
            <ul>
              <li>Final review and approval before anything goes out</li>
              <li>Brand voice and tone edits</li>
              <li>Connecting each platform's account</li>
            </ul>
          </div>
        </div>
        <p className="landing-included-note">
          Currently supports LinkedIn, Facebook, Instagram, and Threads.
        </p>
      </section>

      {/* CTA + FOOTER — dark band */}
      <section className="landing-dark-band landing-cta-band">
        <div className="landing-section landing-cta">
          <h2 className="landing-h2 landing-h2--dark" style={{ margin: 0 }}>
            Ready to review your first draft?
          </h2>
          <div className="landing-cta-buttons">
            <button className="primary" onClick={onGetStarted}>Create your first workspace</button>
            <button className="landing-btn-ghost-dark" onClick={onGetStarted}>Log in</button>
          </div>
        </div>

        <footer className="landing-footer">
          <div className="landing-section landing-footer-inner">
            <div className="landing-footer-brand">
              <span className="landing-logo landing-logo--dark">
                <LogoMark size={16} />
                startTrack
              </span>
              <p>Draft with AI. Publish with approval.</p>
            </div>

            <div className="landing-footer-nav">
              <div className="landing-footer-col">
                <p className="eyebrow" style={{ color: "#6FA39A" }}>Product</p>
                <button className="landing-footer-link" onClick={() => document.getElementById("workflow")?.scrollIntoView({ behavior: "smooth" })}>Workflow</button>
                <button className="landing-footer-link" onClick={() => document.getElementById("platforms")?.scrollIntoView({ behavior: "smooth" })}>Platforms</button>
                <span className="landing-footer-link landing-footer-link--soon">Pricing</span>
              </div>

              <div className="landing-footer-col">
                <p className="eyebrow" style={{ color: "#6FA39A" }}>Account</p>
                <button className="landing-footer-link" onClick={onGetStarted}>Log in</button>
                <button className="landing-footer-link" onClick={onGetStarted}>Sign up</button>
              </div>
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