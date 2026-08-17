// ConnectorsPanel.jsx
const PLATFORMS = [
  { key: "finto", label: "finto.day", color: "#0F6E56" },
  { key: "linkedin", label: "LinkedIn", color: "#0A66C2" },
  { key: "facebook", label: "Facebook", color: "#1877F2" },
  { key: "instagram", label: "Instagram", color: "#C13584" },
  { key: "threads", label: "Threads", color: "#ECEFEA" },
];

export default function ConnectorsPanel({ connections, onConnect, onLogout }) {
  return (
    <div
      style={{
        width: 260,
        flexShrink: 0,
        background: "var(--paper-raised)",
        color: "var(--ink)",
        borderRight: "1px solid var(--border)",
        minHeight: "100vh",
        padding: "1.75rem 1.25rem",
        display: "flex",
        flexDirection: "column",
      }}
    >

      <p
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 12,
          fontWeight: 500,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          margin: "0 0 32px",
        }}
      >
        hehe
      </p>

      <p
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          opacity: 0.55,
          margin: "0 0 20px",
        }}
      >
        Connected platforms
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
        {PLATFORMS.map((p) => {
          const connected = Boolean(connections?.[p.key]);
          return (
            <button
              key={p.key}
              onClick={() => onConnect(p.key)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                background: "transparent",
                border: "1px solid transparent",
                borderRadius: "var(--radius)",
                color: "var(--ink)",
                height: 44,
                padding: "0 10px",
                justifyContent: "flex-start",
                fontWeight: 400,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.borderColor = "rgba(255,255,255,0.15)")}
              onMouseLeave={(e) => (e.currentTarget.style.borderColor = "transparent")}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: connected ? p.color : "transparent",
                  border: connected ? "none" : "1.5px solid rgba(255,255,255,0.35)",
                  flexShrink: 0,
                }}
              />
              <span style={{ fontSize: 14, flex: 1, textAlign: "left" }}>{p.label}</span>
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 10,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                  opacity: connected ? 0.9 : 0.4,
                }}
              >
                {connected ? "on" : "off"}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}