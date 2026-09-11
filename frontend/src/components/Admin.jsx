// Admin.jsx — site-wide (every workspace, all-time) post totals. Gated
// server-side by require_admin in main.py (GET /admin/platform-stats
// 403s for anyone but the bootstrap admin) and gated client-side in
// App.jsx/Sidebar.jsx by profile.is_admin, so non-admins never even see
// the nav item. Deliberately separate from Analytics.jsx - that page is
// per-workspace and date-ranged, open to any workspace member; this one
// is a totally different scope and audience.
import { useEffect, useState } from "react";
import { getAdminPlatformStats } from "../api";
import { PLATFORMS, PlatformLogo } from "./platforms";

function platformByKey(key) {
  return PLATFORMS.find((p) => p.key === key);
}

export default function Admin({ token, onAuthError }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getAdminPlatformStats({ token })
      .then((res) => { if (!cancelled) setData(res); })
      .catch((e) => {
        if (cancelled) return;
        if (e.status === 401) return onAuthError?.();
        setError(e.message || "Failed to load platform stats");
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [token]);

  if (loading) {
    return <div style={{ padding: 24, color: "var(--text-secondary)" }}>Loading…</div>;
  }

  if (error) {
    return <div style={{ padding: 24, color: "var(--danger)" }}>{error}</div>;
  }

  const byPlatform = data?.by_platform || {};
  const platformEntries = Object.entries(byPlatform).sort((a, b) => b[1] - a[1]);

  return (
    <div style={{ padding: 24, maxWidth: 720 }}>
      <h2 style={{ fontFamily: "var(--font-display)", fontSize: 20, marginBottom: 4 }}>
        Platform stats
      </h2>
      <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 20 }}>
        Successful posts published across every workspace, all-time.
      </p>

      <div
        style={{
          background: "var(--paper-raised)", border: "0.5px solid var(--border-strong)",
          borderRadius: 8, padding: "18px 20px", marginBottom: 16,
        }}
      >
        <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 6 }}>
          Total posts made using startTrack
        </div>
        <div style={{ fontFamily: "var(--font-display)", fontSize: 32, color: "var(--ink)" }}>
          {data?.total ?? 0}
        </div>
      </div>

      <div
        style={{
          background: "var(--paper-raised)", border: "0.5px solid var(--border-strong)",
          borderRadius: 8, padding: "8px 0",
        }}
      >
        {platformEntries.length === 0 && (
          <div style={{ padding: "12px 20px", fontSize: 13, color: "var(--text-secondary)" }}>
            No published posts yet.
          </div>
        )}
        {platformEntries.map(([key, count]) => {
          const platform = platformByKey(key);
          return (
            <div
              key={key}
              style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "10px 20px",
              }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--ink)" }}>
                {platform && <PlatformLogo platform={platform} size={14} />}
                {platform?.label || key}
              </span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--text-secondary)" }}>
                {count}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}