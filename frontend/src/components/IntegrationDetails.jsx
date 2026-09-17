// IntegrationDetails.jsx — full metadata for one specific connected
// account, reached by clicking the gear icon on that account's row in
// IntegrationsSettings.jsx. Deliberately its own page rather than a
// section of the Social Accounts (settings.jsx) page - that page is about
// managing the connect/disconnect action across every platform; this page
// is about showing everything the app actually knows about ONE already-
// connected account.
import { PLATFORMS, PlatformLogo } from "./platforms";

function MetadataRow({ label, value }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 16, padding: "10px 0", borderBottom: "0.5px solid var(--border)" }}>
      <span style={{ fontSize: 12.5, color: "var(--text-secondary)", flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 12.5, color: "var(--ink)", textAlign: "right", wordBreak: "break-word" }}>{value}</span>
    </div>
  );
}

export default function IntegrationDetails({ platformKey, connections, onBack, onNavigate }) {
  const platform = PLATFORMS.find((p) => p.key === platformKey);
  const connection = connections?.[platformKey];

  if (!platform || !connection) {
    return (
      <div style={{ padding: "2rem 0", maxWidth: 640 }}>
        <button onClick={onBack} style={backButtonStyle}>&larr; Back to Integrations Settings</button>
        <p style={{ fontSize: 13.5, color: "var(--text-secondary)", marginTop: 16 }}>
          That account isn't connected anymore.
        </p>
      </div>
    );
  }

  return (
    <div style={{ padding: "2rem 0", maxWidth: 640 }}>
      <button onClick={onBack} style={backButtonStyle}>&larr; Back to Integrations Settings</button>

      <div style={{ display: "flex", alignItems: "center", gap: 14, margin: "20px 0 24px" }}>
        {connection.profile_picture_url ? (
          <img
            src={connection.profile_picture_url}
            alt=""
            style={{ width: 48, height: 48, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }}
          />
        ) : (
          <span style={{
            width: 48, height: 48, borderRadius: "50%", background: "var(--paper-raised)",
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          }}>
            <PlatformLogo platform={platform} size={22} />
          </span>
        )}
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <PlatformLogo platform={platform} size={15} />
            <h1 style={{ margin: 0, fontFamily: "var(--font-display)", fontWeight: 500, fontSize: 20, color: "var(--ink)" }}>
              {platform.label}
            </h1>
          </div>
          <p style={{ margin: "2px 0 0", fontSize: 13.5, color: "var(--text-secondary)" }}>
            {connection.profile_name || "Connected account"}
          </p>
        </div>
      </div>

      <div style={{
        background: "var(--paper-raised)", border: "0.5px solid var(--border-strong)",
        borderRadius: 8, padding: "4px 16px",
      }}>
        <MetadataRow label="Platform" value={platform.label} />
        <MetadataRow label="Connected account name" value={connection.profile_name} />
        <MetadataRow label="Category" value={connection.category} />
        <MetadataRow
          label="Category tags"
          value={connection.category_list?.length ? connection.category_list.join(", ") : null}
        />
        <MetadataRow label="Status" value="Connected" />
      </div>

      <button
        onClick={() => onNavigate?.("settings")}
        style={{
          marginTop: 16, fontSize: 12.5, padding: "8px 14px", borderRadius: 6,
          border: "0.5px solid var(--border-strong)", background: "var(--paper-raised)",
          color: "var(--ink)", cursor: "pointer",
        }}
      >
        Disconnect or reconnect in Social Accounts
      </button>
    </div>
  );
}

const backButtonStyle = {
  fontSize: 12.5, color: "var(--text-secondary)", background: "none",
  border: "none", padding: 0, cursor: "pointer",
};