import { useState, useEffect } from "react";
import { connectFinto, getAuthorizeUrl, getPendingPages, selectPage, disconnectPlatform } from "../api";

const PLATFORM_LABELS = { linkedin: "LinkedIn", facebook: "Facebook", instagram: "Instagram", threads: "Threads", canva: "Canva" };

// Real brand marks (simplified path data), each on its brand color.
const PLATFORM_BRAND = {
  linkedin: {
    bg: "#0A66C2",
    viewBox: "0 0 24 24",
    path: "M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 1 1 0-4.124 2.062 2.062 0 0 1 0 4.124zM7.119 20.452H3.555V9h3.564v11.452z",
  },
  facebook: {
    bg: "#1877F2",
    viewBox: "0 0 24 24",
    path: "M9.101 23.691v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978.401 0 .955.042 1.468.103a8.68 8.68 0 0 1 1.141.195v3.325a8.623 8.623 0 0 0-.653-.036 26.805 26.805 0 0 0-.733-.009c-.707 0-1.259.096-1.675.309a1.686 1.686 0 0 0-.679.622c-.258.42-.374.995-.374 1.752v1.297h3.919l-.386 2.103-.287 1.564h-3.246v8.245C19.396 23.238 24 18.179 24 12.044c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.628 3.874 10.35 9.101 11.647Z",
  },
  instagram: {
    bg: "linear-gradient(135deg,#f58529,#dd2a7b,#8134af,#515bd4)",
    viewBox: "0 0 24 24",
    path: "M12 2.163c3.204 0 3.584.012 4.849.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.07 1.645.07 4.849 0 3.204-.012 3.584-.07 4.849-.148 3.225-1.664 4.771-4.919 4.919-1.265.058-1.644.069-4.849.069s-3.584-.011-4.849-.069c-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072c-4.358.2-6.78 2.618-6.98 6.98C.014 8.333 0 8.741 0 12s.014 3.667.072 4.948c.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24s3.668-.014 4.948-.072c4.354-.2 6.782-2.618 6.979-6.98.059-1.281.073-1.689.073-4.948s-.014-3.667-.072-4.947c-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z",
  },
  threads: {
    bg: "#000000",
    viewBox: "0 0 24 24",
    path: "M12.186 24h-.007c-3.581-.024-6.334-1.205-8.184-3.509C2.35 18.44 1.5 15.586 1.472 12.01v-.017c.03-3.579.879-6.43 2.525-8.482C5.845 1.205 8.6.024 12.18 0h.014c2.746.02 5.043.725 6.826 2.098 1.677 1.29 2.858 3.13 3.509 5.467l-2.04.569c-1.104-3.96-3.898-5.984-8.304-6.015-2.91.022-5.11.936-6.54 2.717-1.34 1.673-2.03 4.08-2.058 7.16.028 3.079.718 5.486 2.058 7.159 1.43 1.783 3.63 2.698 6.54 2.717 2.623-.017 4.358-.645 5.8-2.098 1.638-1.65 1.606-3.671 1.086-4.923-.303-.732-.85-1.34-1.582-1.783-.187 1.335-.607 2.396-1.255 3.169-.87 1.038-2.107 1.605-3.687 1.629-1.201-.017-2.27-.336-3.007-.94-.868-.708-1.316-1.723-1.297-2.94.02-1.187.63-2.148 1.716-2.703.867-.443 2.006-.679 3.297-.679.71 0 1.464.043 2.232.128-.09-.55-.278-.99-.556-1.31-.377-.436-.947-.657-1.696-.66h-.009c-.632 0-1.505.174-2.06.994l-1.734-1.185c.72-1.077 1.923-1.671 3.393-1.671h.028c1.312.008 2.398.402 3.14 1.14.723.72 1.135 1.708 1.229 2.94.098.01.196.02.293.032 1.436.169 2.639.671 3.485 1.454 1.166 1.083 1.766 2.64 1.735 4.505-.036 2.148-.905 4.049-2.451 5.35C16.4 23.302 14.55 24 12.186 24z",
  },
  // No verbatim logo path here (unlike the others) - Canva's mark is more
  // detailed and this is deliberately left as just their brand gradient
  // rather than risk an inaccurate reproduction. PlatformBadge below
  // renders fine with just a bg color and no path - a plain colored square.
  canva: {
    bg: "linear-gradient(135deg,#8B3DFF,#00C4CC)",
  },
};

function PlatformBadge({ platform, connected }) {
  const brand = PLATFORM_BRAND[platform];
  return (
    <span style={{ position: "relative", flexShrink: 0 }}>
      <span
        style={{
          width: 30, height: 30, borderRadius: 8,
          background: brand?.bg || "var(--border)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}
      >
        {brand && (
          <svg width={16} height={16} viewBox={brand.viewBox} fill="#fff">
            <path d={brand.path} />
          </svg>
        )}
      </span>
      {connected && (
        <span
          style={{
            position: "absolute", right: -2, bottom: -2, width: 10, height: 10,
            borderRadius: "50%", background: "var(--accent)",
            border: "2px solid var(--surface-2)",
          }}
        />
      )}
    </span>
  );
}

export default function Settings({ token, connections = {}, connectStatus, onDismissStatus, onDone, onAuthError, pagePicker, onPagePickerDone, onConnectionsChanged }) {
  const [fintoEmail, setFintoEmail] = useState("");
  const [fintoPassword, setFintoPassword] = useState("");
  const [fintoStatus, setFintoStatus] = useState("");
  const [fintoLoading, setFintoLoading] = useState(false);

  const [pages, setPages] = useState(null);
  const [pageSelectLoading, setPageSelectLoading] = useState(false);
  const [pageSelectError, setPageSelectError] = useState("");

  useEffect(() => {
    if (!pagePicker) { setPages(null); return; }
    getPendingPages({ token, platform: pagePicker.platform, pendingId: pagePicker.pendingId })
      .then((res) => setPages(res.pages))
      .catch((err) => setPageSelectError(err.message || "Could not load pages."));
  }, [pagePicker, token]);

  async function handleSelectPage(pageId) {
    setPageSelectLoading(true);
    setPageSelectError("");
    try {
      await selectPage({ token, platform: pagePicker.platform, pendingId: pagePicker.pendingId, pageId });
      onPagePickerDone();
    } catch (err) {
      setPageSelectError(err.message || "Failed to connect that page.");
    } finally {
      setPageSelectLoading(false);
    }
  }

  if (pagePicker) {
    return (
      <div style={{ background: "var(--surface-2)", borderRadius: 12, border: "0.5px solid var(--border)", padding: "1.5rem" }}>
        <p style={{ fontWeight: 500, fontSize: 15, margin: "0 0 4px" }}>Choose a Page</p>
        <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 1rem" }}>
          This account manages more than one Facebook Page{pagePicker.platform === "instagram" ? " — pick the one whose linked Instagram account you want" : ""}.
        </p>
        {pageSelectError && <p style={{ fontSize: 13, color: "var(--danger)", background: "var(--danger-bg)", borderRadius: "var(--radius)", padding: "8px 12px", margin: "0 0 1rem" }}>{pageSelectError}</p>}
        {pages === null ? (
          <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>Loading pages…</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {pages.map((p) => (
              <button key={p.id} className="primary" style={{ width: "100%" }} disabled={pageSelectLoading} onClick={() => handleSelectPage(p.id)}>
                {p.name}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  async function handleFintoSubmit(e) {
    e.preventDefault();
    setFintoLoading(true);
    setFintoStatus("");
    try {
      await connectFinto({ token, email: fintoEmail, password: fintoPassword });
      setFintoStatus("Connected.");
    } catch (err) {
      setFintoStatus(err.message || "Failed to connect finto.day.");
    } finally {
      setFintoLoading(false);
    }
  }

  const [oauthError, setOauthError] = useState("");
  const [disconnectingPlatform, setDisconnectingPlatform] = useState(null);

  async function handleOAuthConnect(platform) {
    setOauthError("");
    try {
      const { authorize_url } = await getAuthorizeUrl({ token, platform });
      window.location.href = authorize_url;
    } catch (err) {
      if (String(err.message).includes("Not authenticated")) return onAuthError?.();
      setOauthError(err.message || `Failed to start ${platform} connect.`);
    }
  }

  async function handleDisconnect(platform) {
    setOauthError("");
    setDisconnectingPlatform(platform);
    try {
      await disconnectPlatform({ token, platform });
      onConnectionsChanged?.();
    } catch (err) {
      if (String(err.message).includes("Not authenticated")) return onAuthError?.();
      setOauthError(err.message || `Failed to disconnect ${platform}.`);
    } finally {
      setDisconnectingPlatform(null);
    }
  }

  function handleToggleConnect(platform, connected) {
    connected ? handleDisconnect(platform) : handleOAuthConnect(platform);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      {oauthError && (
        <p style={{ fontSize: 13, color: "var(--danger)", background: "var(--danger-bg)", borderRadius: "var(--radius)", padding: "8px 12px", margin: 0 }}>
          {oauthError}
        </p>
      )}
      {connectStatus?.type === "error" && (
        <div
          style={{
            display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
            fontSize: 13, borderRadius: "var(--radius)", padding: "10px 14px",
            color: "var(--danger)", background: "var(--danger-bg)",
            border: "0.5px solid var(--border)",
          }}
        >
          <span>{`Couldn't connect: ${(connectStatus.detail || "oauth_failed").replace(/_/g, " ")}`}</span>
          <button onClick={onDismissStatus} style={{ background: "transparent", border: "none", color: "inherit", cursor: "pointer" }}>
            ✕
          </button>
        </div>
      )}

      {/* <div style={{ background: "var(--surface-2)", borderRadius: 12, border: "0.5px solid var(--border)", padding: "1.5rem" }}>
        <p style={{ fontWeight: 500, fontSize: 15, margin: "0 0 1rem" }}>Connect finto.day</p>
        <form onSubmit={handleFintoSubmit}>
          <div style={{ marginBottom: "1rem" }}>
            <label htmlFor="finto-email">Email</label>
            <input id="finto-email" type="email" value={fintoEmail} onChange={(e) => setFintoEmail(e.target.value)} required />
          </div>
          <div style={{ marginBottom: "1rem" }}>
            <label htmlFor="finto-password">Password</label>
            <input id="finto-password" type="password" value={fintoPassword} onChange={(e) => setFintoPassword(e.target.value)} required />
          </div>
          {fintoStatus && <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: "0 0 1rem" }}>{fintoStatus}</p>}
          <button type="submit" className="primary" style={{ width: "100%" }} disabled={fintoLoading}>
            {fintoLoading ? "Connecting…" : "Connect"}
          </button>
        </form>
      </div> */}

      <div>
        <h1 style={{ margin: "0 0 4px", fontFamily: "var(--font-display)", fontWeight: 500, fontSize: 24, color: "var(--ink)" }}>
          Social accounts
        </h1>
        <p style={{ margin: 0, fontSize: 14, color: "var(--text-secondary)" }}>
          Manage which platforms Agent01 can publish to on your behalf.
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "1rem" }}>
        {["linkedin", "facebook", "instagram", "threads", "canva"].map((platform) => {
          const connection = connections?.[platform];
          const connected = Boolean(connection);
          const profileName = connection?.profile_name;
          const profilePictureUrl = connection?.profile_picture_url;
          return (
            <div
              key={platform}
              style={{
                background: "var(--paper-raised)", borderRadius: 12,
                border: connected ? "0.5px solid var(--border-strong)" : "0.5px solid var(--border)",
                padding: "1.25rem", display: "flex", flexDirection: "column", gap: 14,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                  <PlatformBadge platform={platform} connected={connected} />
                  <div style={{ minWidth: 0 }}>
                    <p style={{ margin: 0, fontWeight: 500, fontSize: 14, color: "var(--ink)" }}>
                      {PLATFORM_LABELS[platform] || platform}
                    </p>
                    {connected ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                        {profilePictureUrl ? (
                          <img
                            src={profilePictureUrl}
                            alt=""
                            style={{ width: 16, height: 16, borderRadius: "50%", objectFit: "cover", display: "block", flexShrink: 0 }}
                          />
                        ) : (
                          <span style={{ width: 16, height: 16, borderRadius: "50%", background: "var(--border)", flexShrink: 0 }} />
                        )}
                        <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)" }}>
                          {profileName || "Account connected"}
                        </p>
                      </div>
                    ) : (
                      <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--text-muted)" }}>Not connected</p>
                    )}
                  </div>
                </div>
              </div>
              <button
                onClick={() => handleToggleConnect(platform, connected)}
                disabled={disconnectingPlatform === platform}
                style={{
                  width: "100%", height: 34,
                  background: connected ? "transparent" : "var(--accent)",
                  color: connected ? "var(--text-secondary)" : "var(--accent-ink)",
                  border: connected ? "0.5px solid var(--border-strong)" : "none",
                  borderRadius: "var(--radius)",
                  fontSize: 12, fontFamily: "var(--font-mono)", cursor: "pointer", fontWeight: 600,
                }}
              >
                {disconnectingPlatform === platform ? "Disconnecting…" : connected ? "Connected" : "Connect"}
              </button>
            </div>
          );
        })}
      </div>

    </div>
  );
}