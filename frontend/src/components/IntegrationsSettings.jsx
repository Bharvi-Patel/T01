// IntegrationsSettings.jsx — a read-only overview of the accounts that are
// actually connected right now. Deliberately separate from settings.jsx
// (the "Social Accounts" page, which handles the full connect/disconnect
// flow for every platform whether connected or not) - this page exists
// purely to answer "what's connected?" at a glance, reached from the
// profile/account dropdown rather than the main sidebar nav.
import { PLATFORMS, PlatformLogo } from "./platforms";

// Same Feather-style gear used in Dashboard.jsx's Integrations Settings
// card - kept as its own small component here too rather than importing
// across component files for a single icon.
function GearIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

export default function IntegrationsSettings({ connections, onNavigate, onOpenDetails }) {
  const connectedPlatforms = PLATFORMS.filter((p) => connections?.[p.key]);

  return (
    <div style={{ padding: "2rem 0", maxWidth: 640 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 20 }}>
        <div>
          <h1 style={{ margin: "0 0 4px", fontFamily: "var(--font-display)", fontWeight: 500, fontSize: 24, color: "var(--ink)" }}>
            Integrations Settings
          </h1>
          <p style={{ margin: 0, fontSize: 14, color: "var(--text-secondary)" }}>
            The accounts you currently have connected.
          </p>
        </div>
        <button
          onClick={() => onNavigate?.("settings")}
          style={{
            fontSize: 12.5, padding: "7px 12px", borderRadius: 6, whiteSpace: "nowrap",
            border: "0.5px solid var(--border-strong)", background: "var(--paper-raised)",
            color: "var(--ink)", cursor: "pointer", flexShrink: 0,
          }}
        >
          Manage connections
        </button>
      </div>

      {connectedPlatforms.length === 0 ? (
        <div style={{
          background: "var(--paper-raised)", border: "0.5px solid var(--border-strong)",
          borderRadius: 8, padding: "16px 18px",
        }}>
          <p style={{ margin: 0, fontSize: 13.5, color: "var(--text-secondary)" }}>
            Nothing connected yet — head to Manage connections to link an account.
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {connectedPlatforms.map((p) => {
            const connection = connections[p.key];
            return (
              <div
                key={p.key}
                style={{
                  display: "flex", alignItems: "center", gap: 12,
                  background: "var(--paper-raised)", border: "0.5px solid var(--border-strong)",
                  borderRadius: 8, padding: "12px 16px",
                }}
              >
                {connection.profile_picture_url ? (
                  <img
                    src={connection.profile_picture_url}
                    alt=""
                    style={{ width: 32, height: 32, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }}
                  />
                ) : (
                  <span style={{
                    width: 32, height: 32, borderRadius: "50%", background: "var(--paper)",
                    display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                  }}>
                    <PlatformLogo platform={p} size={16} />
                  </span>
                )}
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <PlatformLogo platform={p} size={13} />
                    <span style={{ fontSize: 13.5, fontWeight: 500, color: "var(--ink)" }}>{p.label}</span>
                  </div>
                  <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {connection.profile_name || "Connected"}
                    {connection.category ? ` · ${connection.category}` : ""}
                  </p>
                </div>
                <button
                  onClick={() => onOpenDetails?.(p.key)}
                  title={`${p.label} details`}
                  aria-label={`${p.label} details`}
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "center",
                    width: 28, height: 28, borderRadius: 6, flexShrink: 0,
                    border: "0.5px solid var(--border)", background: "transparent",
                    color: "var(--text-secondary)", cursor: "pointer",
                  }}
                >
                  <GearIcon size={14} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}