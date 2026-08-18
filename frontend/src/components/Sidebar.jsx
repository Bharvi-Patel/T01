// Sidebar.jsx
const NAV_ITEMS = [
  { key: "generate", label: "Home", icon: "home" },
  { key: "explore", label: "Explore", icon: "compass" },
  { key: "posts", label: "Posts", icon: "grid" },
  { key: "analytics", label: "Analytics", icon: "chart" },
  { key: "settings", label: "Social accounts", icon: "link" },
  { key: "workspace", label: "Workspace settings", icon: "gear" },
  { key: "help", label: "Help center", icon: "help" },
];

// Only these two map to real screens right now — everything else is a
// placeholder until that part of the app actually exists.
const WIRED_KEYS = new Set(["generate", "settings"]);

const ICON_PATHS = {
  home: "M3 11l9-8 9 8M5 10v10h14V10",
  compass: "M12 2a10 10 0 100 20 10 10 0 000-20zM15 9l-2 6-6 2 2-6z",
  grid: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
  chart: "M4 20V10M12 20V4M20 20v-7",
  link: "M9 15l6-6M8 12a4 4 0 010-5.66l2-2a4 4 0 015.66 5.66M16 12a4 4 0 010 5.66l-2 2a4 4 0 01-5.66-5.66",
  gear: "M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z",
  help: "M12 2a10 10 0 100 20 10 10 0 000-20zM9.5 9a2.5 2.5 0 015 0c0 1.5-2 2-2 3.5M12 17h.01",
};

function Icon({ name }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}

export default function Sidebar({ activeStep, onNavigate, onNewPost, onLogout, mobileOpen, onCloseMobile }) {
  return (
    <>
      <div className={`sidebar-backdrop${mobileOpen ? " open" : ""}`} onClick={onCloseMobile} />
      <div className={`sidebar${mobileOpen ? " open" : ""}`}>
        <p style={{ fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 500, letterSpacing: "0.06em", textTransform: "uppercase", margin: "0 0 24px" }}>
          startTrack
        </p>

        <button
          className="primary"
          style={{ width: "100%", marginBottom: 24, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
          onClick={onNewPost}
        >
          <Icon name="grid" /> New post
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
                  border: active ? "1px solid var(--accent)" : "1px solid transparent",
                  borderRadius: "var(--radius)",
                  color: wired ? "var(--ink)" : "var(--text-muted)",
                  height: 40, padding: "0 10px", fontWeight: 400,
                  cursor: wired ? "pointer" : "default",
                }}
                onMouseEnter={(e) => wired && !active && (e.currentTarget.style.background = "var(--paper)")}
                onMouseLeave={(e) => wired && !active && (e.currentTarget.style.background = "transparent")}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <Icon name={item.icon} />
                  <span style={{ fontSize: 14 }}>{item.label}</span>
                </span>
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
    </>
  );
}
