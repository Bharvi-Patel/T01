import { useEffect, useMemo, useState } from "react";
import { getInbox, markInboxItemRead } from "../api";
import { PLATFORMS, PlatformLogo } from "./platforms";

// LinkedIn has no comment/message API access (see engineering notes) so it
// never appears in inbox data — filtered out of the platform picker rather
// than showing a filter for a platform that can never have items.
const INBOX_PLATFORMS = PLATFORMS.filter((p) => p.key !== "linkedin");

const KIND_TABS = [
  { key: "all", label: "All" },
  { key: "comment", label: "Comments" },
  { key: "message", label: "Messages" },
];

function timeAgo(iso) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function InboxItemCard({ item, onMarkRead }) {
  const platform = INBOX_PLATFORMS.find((p) => p.key === item.platform);
  return (
    <div
      onClick={() => !item.is_read && onMarkRead(item.id)}
      style={{
        display: "flex",
        gap: 12,
        alignItems: "flex-start",
        padding: "12px 14px",
        borderRadius: 8,
        background: item.is_read ? "var(--paper-raised)" : "var(--paper)",
        border: item.is_read ? "0.5px solid var(--border)" : "1.5px solid var(--accent)",
        cursor: item.is_read ? "default" : "pointer",
      }}
    >
      <div
        style={{
          width: 30, height: 30, borderRadius: "50%", flexShrink: 0,
          background: "var(--border)", display: "flex", alignItems: "center", justifyContent: "center",
        }}
      >
        {platform ? <PlatformLogo platform={platform} size={15} /> : null}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
          <span style={{ fontSize: 13, fontWeight: item.is_read ? 400 : 600, color: "var(--ink)" }}>
            {item.sender_name || "Unknown"}
          </span>
          <span
            style={{
              fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.3,
              color: "var(--text-muted)", background: "var(--border)",
              borderRadius: 4, padding: "1px 6px",
            }}
          >
            {item.kind}
          </span>
          {!item.is_read && (
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--accent)", flexShrink: 0 }} />
          )}
        </div>
        <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: 0, wordBreak: "break-word" }}>
          {item.body || <em>No text content</em>}
        </p>
      </div>

      <span style={{ fontSize: 11, color: "var(--text-muted)", flexShrink: 0, whiteSpace: "nowrap" }}>
        {timeAgo(item.created_at)}
      </span>
    </div>
  );
}

export default function Inbox({ token, onAuthError }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [kindFilter, setKindFilter] = useState("all");
  const [platformFilter, setPlatformFilter] = useState("all");
  const [search, setSearch] = useState("");

  function load() {
    setLoading(true);
    setError(null);
    getInbox({ token })
      .then((res) => setItems(res.items || []))
      .catch((e) => {
        if (e.status === 401) return onAuthError?.();
        setError(e.message || "Failed to load inbox");
      })
      .finally(() => setLoading(false));
  }

  useEffect(load, [token]);

  function handleMarkRead(itemId) {
    // Optimistic — flip locally right away, reconcile silently if it fails.
    setItems((prev) => prev.map((i) => (i.id === itemId ? { ...i, is_read: true } : i)));
    markInboxItemRead({ token, itemId }).catch(() => load());
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((item) => {
      if (kindFilter !== "all" && item.kind !== kindFilter) return false;
      if (platformFilter !== "all" && item.platform !== platformFilter) return false;
      if (q && !(item.body || "").toLowerCase().includes(q) && !(item.sender_name || "").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [items, kindFilter, platformFilter, search]);

  const unreadCount = items.filter((i) => !i.is_read).length;

  if (loading) {
    return <div style={{ padding: "3rem 0", textAlign: "center", color: "var(--text-secondary)" }}>Loading inbox…</div>;
  }
  if (error) {
    return <div style={{ padding: "2rem", color: "var(--danger)" }}>{error}</div>;
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
        <p style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "var(--ink)", margin: 0 }}>
          Social Inbox
          {unreadCount > 0 && (
            <span style={{ fontSize: 12.5, color: "var(--text-muted)", fontFamily: "var(--font-body, inherit)", marginLeft: 8 }}>
              {unreadCount} unread
            </span>
          )}
        </p>

        <input
          type="text"
          placeholder="Search messages…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            width: 220, fontSize: 13, padding: "7px 10px",
            border: "0.5px solid var(--border-strong)", borderRadius: 6,
            background: "var(--paper-raised)", color: "var(--ink)",
          }}
        />
      </div>

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 18 }}>
        <div style={{ display: "flex", gap: 6 }}>
          {KIND_TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setKindFilter(t.key)}
              style={{
                width: "auto", padding: "5px 12px", fontSize: 12.5,
                border: kindFilter === t.key ? "1.5px solid var(--accent)" : "0.5px solid var(--border-strong)",
                background: kindFilter === t.key ? "var(--paper-raised)" : "transparent", color: "var(--ink)",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <button
            onClick={() => setPlatformFilter("all")}
            style={{
              width: "auto", padding: "5px 10px", fontSize: 12.5,
              border: platformFilter === "all" ? "1.5px solid var(--accent)" : "0.5px solid var(--border-strong)",
              background: platformFilter === "all" ? "var(--paper-raised)" : "transparent", color: "var(--ink)",
            }}
          >
            All platforms
          </button>
          {INBOX_PLATFORMS.map((p) => (
            <button
              key={p.key}
              onClick={() => setPlatformFilter(p.key)}
              title={p.label}
              style={{
                width: 30, height: 30, padding: 0, display: "flex", alignItems: "center", justifyContent: "center",
                border: platformFilter === p.key ? "1.5px solid var(--accent)" : "0.5px solid var(--border-strong)",
                background: platformFilter === p.key ? "var(--paper-raised)" : "transparent", borderRadius: 6,
              }}
            >
              <PlatformLogo platform={p} size={14} />
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div
          style={{
            textAlign: "center", padding: "3rem 1rem", color: "var(--text-muted)",
            background: "var(--paper-raised)", border: "0.5px solid var(--border-strong)", borderRadius: 8,
          }}
        >
          {items.length === 0
            ? "Nothing here yet — comments and messages from your connected accounts will show up as they come in."
            : "No items match your filters."}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {filtered.map((item) => (
            <InboxItemCard key={item.id} item={item} onMarkRead={handleMarkRead} />
          ))}
        </div>
      )}
    </div>
  );
}