// Sidebar.jsx
const NAV_ITEMS = [
    { key: "explore", label: "Explore" },
    { key: "analytics", label: "Analytics" },
    { key: "posts", label: "Posts" },
    { key: "settings", label: "Social accounts" },
    { key: "workspace", label: "Workspace settings" },
    { key: "help", label: "Help center" },
  ];
  
  // Only these two map to real screens right now — everything else is a
  // placeholder until that part of the app actually exists.
  const WIRED_KEYS = new Set(["settings"]);
  
  export default function Sidebar({ activeStep, onNavigate, onNewPost, onLogout }) {
    return (
      <div
        style={{
          width: 260, flexShrink: 0, background: "var(--paper-raised)", color: "var(--ink)",
          borderRight: "1px solid var(--border)", minHeight: "100vh",
          padding: "1.75rem 1.25rem", display: "flex", flexDirection: "column",
        }}
      >
        <p style={{ fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 500, letterSpacing: "0.06em", textTransform: "uppercase", margin: "0 0 24px" }}>
          startTrack
        </p>
  
        <button className="primary" style={{ width: "100%", marginBottom: 24 }} onClick={onNewPost}>
          + New
        </button>
  
        <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1 }}>
          {NAV_ITEMS.map((item) => {
            const wired = WIRED_KEYS.has(item.key);
            const active = activeStep === item.key;
            return (
              <button
                key={item.key}
                onClick={() => wired && onNavigate(item.key)}
                disabled={!wired}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  background: active ? "var(--paper)" : "transparent",
                  border: "1px solid transparent", borderRadius: "var(--radius)",
                  color: wired ? "var(--ink)" : "var(--text-muted)",
                  height: 40, padding: "0 10px", fontWeight: 400,
                  cursor: wired ? "pointer" : "default",
                }}
                onMouseEnter={(e) => wired && !active && (e.currentTarget.style.background = "var(--paper)")}
                onMouseLeave={(e) => wired && !active && (e.currentTarget.style.background = "transparent")}
              >
                <span style={{ fontSize: 14 }}>{item.label}</span>
                {!wired && (
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--text-muted)" }}>
                    soon
                  </span>
                )}
              </button>
            );
          })}
        </div>
  
        <button onClick={onLogout} style={{ background: "transparent", border: "1px solid var(--border)", color: "var(--ink)", marginTop: 20 }}>
          Log out
        </button>
      </div>
    );
  }