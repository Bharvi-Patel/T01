// Dashboard.jsx — replaces the old "Welcome back / + New" placeholder with
// four real sections: Ideas (festival/observance suggestions pulled from a
// calendar API), To Do (static prompt cards), Integrations (static grid,
// coming soon), and Your Recent Posts (real published-draft data).
import { useEffect, useState } from "react";
import { getDashboardIdeas, getDrafts } from "../api";
import { PLATFORMS, PlatformLogo } from "./platforms";

const card = {
  background: "var(--paper-raised)",
  border: "0.5px solid var(--border-strong)",
  borderRadius: 8,
  padding: "16px 18px",
};

const sectionTitle = {
  fontFamily: "var(--font-display)",
  fontSize: 18,
  color: "var(--ink)",
  margin: "0 0 14px 0",
};

function platformByKey(key) {
  return PLATFORMS.find((p) => p.key === key);
}

function IdeaCard({ idea }) {
  const date = new Date(idea.date + "T00:00:00");
  const monthDay = date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return (
    <div style={{ ...card, minWidth: 220, flex: "0 0 auto", display: "flex", flexDirection: "column", gap: 8 }}>
      <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--accent)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
        {monthDay}
      </span>
      <span style={{ fontSize: 14, fontWeight: 600, color: "var(--ink)" }}>{idea.name}</span>
      {idea.description && (
        <span style={{ fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.4 }}>
          {idea.description.length > 110 ? idea.description.slice(0, 110) + "…" : idea.description}
        </span>
      )}
    </div>
  );
}

function IdeasSection({ token, onNewPost }) {
  const [state, setState] = useState({ loading: true, error: null, configured: true, ideas: [] });

  useEffect(() => {
    let cancelled = false;
    getDashboardIdeas({ token })
      .then((res) => { if (!cancelled) setState({ loading: false, error: null, configured: res.configured, ideas: res.ideas || [] }); })
      .catch((e) => { if (!cancelled) setState({ loading: false, error: e.message || "Couldn't load ideas.", configured: true, ideas: [] }); });
    return () => { cancelled = true; };
  }, [token]);

  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <p style={sectionTitle}>Ideas</p>
        <button className="primary" onClick={onNewPost} style={{ height: 34, padding: "0 14px", fontSize: 13 }}>+ New</button>
      </div>
      {state.loading && <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>Loading upcoming ideas…</p>}
      {!state.loading && state.error && <p style={{ fontSize: 13, color: "var(--danger)" }}>{state.error}</p>}
      {!state.loading && !state.error && !state.configured && (
        <div style={card}>
          {/* <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: 0 }}>
            Ideas aren't set up yet — add a <code>CALENDARIFIC_API_KEY</code> to the backend's <code>.env</code> to surface upcoming festivals and observances here.
          </p> */}
        </div>
      )}
      {!state.loading && !state.error && state.configured && state.ideas.length === 0 && (
        <div style={card}>
          <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: 0 }}>No upcoming events found right now — check back soon.</p>
        </div>
      )}
      {!state.loading && !state.error && state.ideas.length > 0 && (
        <div style={{ display: "flex", gap: 12, overflowX: "auto", paddingBottom: 4 }}>
          {state.ideas.map((idea) => (
            <IdeaCard key={`${idea.name}-${idea.date}`} idea={idea} />
          ))}
        </div>
      )}
    </div>
  );
}

const TODO_ITEMS = [
  { key: "post_today", accent: "#4CAF7D", title: "Post something today", body: "Engage with your audience today. Create a post now!", nav: "generate" },
  { key: "plan_next", accent: "#C1447E", title: "Plan your next big post", body: "Keep your feed active with a post scheduled ahead.", nav: "calendar" },
  { key: "connect_account", accent: "#D9A441", title: "Connect an account", body: "Link a social account so drafts have somewhere to publish.", nav: "settings" },
];

function ToDoSection({ onNavigate }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <p style={sectionTitle}>To Do</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {TODO_ITEMS.map((item) => (
          <button
            key={item.key}
            onClick={() => onNavigate(item.nav)}
            style={{
              ...card, display: "flex", alignItems: "center", gap: 12, textAlign: "left",
              borderLeft: `3px solid ${item.accent}`, height: "auto", cursor: "pointer",
            }}
          >
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: "var(--ink)", marginBottom: 2 }}>{item.title}</div>
              <div style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>{item.body}</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// The app's real integrations are the platforms it can actually publish to
// (see platforms.jsx) — those get their real logo and no tag. Twitter/X
// isn't wired up yet, so it's the one "Soon" entry, with a plain monogram
// since there's no brand SVG for it in this codebase.
function IntegrationsSection() {
  return (
    <div style={{ marginBottom: 28 }}>
      <p style={sectionTitle}>Integrations</p>
      <div style={{ ...card }}>
        <p style={{ fontSize: 12.5, color: "var(--text-secondary)", margin: "0 0 14px 0" }}>
          Unify your workflow by connecting your tech stack.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {PLATFORMS.map((p) => (
            <div
              key={p.key}
              style={{
                display: "flex", alignItems: "center", gap: 8, border: "0.5px solid var(--border)",
                borderRadius: 6, padding: "6px 10px", fontSize: 12.5, color: "var(--ink)",
              }}
            >
              <PlatformLogo platform={p} size={15} />
              {p.label}
            </div>
          ))}
          <div
            style={{
              display: "flex", alignItems: "center", gap: 8, border: "0.5px solid var(--border)",
              borderRadius: 6, padding: "6px 10px", fontSize: 12.5, color: "var(--text-secondary)",
            }}
          >
            <span style={{
              width: 15, height: 15, borderRadius: 3, background: "var(--text-muted)", color: "var(--paper-raised)",
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              fontSize: 10, fontWeight: 700, fontFamily: "var(--font-mono)", flexShrink: 0,
            }}>
              X
            </span>
            Twitter
            <span style={{
              fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "0.03em", textTransform: "uppercase",
              color: "var(--text-muted)", border: "0.5px solid var(--border)", borderRadius: 3, padding: "1px 4px",
            }}>
              Soon
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function RecentPostCard({ draft, onOpenDraft }) {
  const successPlatforms = [...new Set((draft.publish_results || []).filter((r) => r.success).map((r) => r.platform))];
  const publishedDate = draft.published_at ? new Date(draft.published_at) : null;
  return (
    <button
      onClick={() => onOpenDraft(draft.draft_id)}
      style={{ ...card, textAlign: "left", cursor: "pointer", height: "auto", display: "flex", flexDirection: "column", gap: 10 }}
    >
      {draft.featured_image?.url ? (
        <img
          src={draft.featured_image.url}
          alt=""
          style={{ width: "100%", height: 130, objectFit: "cover", borderRadius: 6, border: "0.5px solid var(--border)" }}
        />
      ) : (
        <div style={{
          width: "100%", height: 130, borderRadius: 6, background: "var(--paper)",
          display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: "var(--text-muted)",
        }}>
          No image
        </div>
      )}
      <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
        {draft.title || draft.subtopic}
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", gap: 6 }}>
          {successPlatforms.map((key) => {
            const p = platformByKey(key);
            return p ? <PlatformLogo key={key} platform={p} size={13} /> : null;
          })}
        </div>
        {publishedDate && (
          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{publishedDate.toLocaleDateString()}</span>
        )}
      </div>
    </button>
  );
}

function RecentPostsSection({ token, onOpenDraft, onAuthError }) {
  const [state, setState] = useState({ loading: true, error: null, drafts: [] });

  useEffect(() => {
    let cancelled = false;
    getDrafts({ token, status: "published" })
      .then((res) => { if (!cancelled) setState({ loading: false, error: null, drafts: (res.drafts || []).slice(0, 4) }); })
      .catch((e) => {
        if (cancelled) return;
        if (e.status === 401) return onAuthError?.();
        setState({ loading: false, error: e.message || "Couldn't load recent posts.", drafts: [] });
      });
    return () => { cancelled = true; };
  }, [token]);

  return (
    <div>
      <p style={sectionTitle}>Your Recent Posts</p>
      {state.loading && <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>Loading recent posts…</p>}
      {!state.loading && state.error && <p style={{ fontSize: 13, color: "var(--danger)" }}>{state.error}</p>}
      {!state.loading && !state.error && state.drafts.length === 0 && (
        <div style={card}>
          <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: 0 }}>Nothing published yet — your posts will show up here once they go live.</p>
        </div>
      )}
      {!state.loading && !state.error && state.drafts.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }}>
          {state.drafts.map((d) => (
            <RecentPostCard key={d.draft_id} draft={d} onOpenDraft={onOpenDraft} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function Dashboard({ token, onNewPost, onNavigate, onOpenDraft, onAuthError }) {
  return (
    <div style={{ padding: "2rem 0" }}>
      <p style={{ fontFamily: "var(--font-display)", fontSize: "clamp(24px, 4vw, 32px)", color: "var(--ink)", marginBottom: 24 }}>
        Welcome back
      </p>
      <IdeasSection token={token} onNewPost={onNewPost} />
      <ToDoSection onNavigate={onNavigate} />
      <IntegrationsSection />
      <RecentPostsSection token={token} onOpenDraft={onOpenDraft} onAuthError={onAuthError} />
    </div>
  );
}