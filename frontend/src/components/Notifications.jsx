import { useEffect, useMemo, useState } from "react";
import { getNotifications, markAllNotificationsRead, markNotificationRead } from "../api";

const KIND_LABELS = {
  before_publish: "Reminder",
  needs_approval: "Approval",
  publish_failed: "Publish failed",
  weekly_digest: "Weekly digest",
  announcement: "Announcement",
};

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

function NotificationCard({ item, onOpen }) {
  return (
    <div
      onClick={() => onOpen(item)}
      style={{
        display: "flex",
        gap: 12,
        alignItems: "flex-start",
        padding: "12px 14px",
        borderRadius: 8,
        background: item.is_read ? "var(--paper-raised)" : "var(--paper)",
        border: item.is_read ? "0.5px solid var(--border)" : "1.5px solid var(--accent)",
        cursor: !item.is_read || item.url ? "pointer" : "default",
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
          <span style={{ fontSize: 13, fontWeight: item.is_read ? 400 : 600, color: "var(--ink)" }}>
            {item.title}
          </span>
          <span
            style={{
              fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.3,
              color: "var(--text-muted)", background: "var(--border)",
              borderRadius: 4, padding: "1px 6px",
            }}
          >
            {KIND_LABELS[item.kind] || item.kind}
          </span>
          {!item.is_read && (
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--accent)", flexShrink: 0 }} />
          )}
        </div>
        <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: 0, wordBreak: "break-word" }}>
          {item.body}
        </p>
      </div>

      <span style={{ fontSize: 11, color: "var(--text-muted)", flexShrink: 0, whiteSpace: "nowrap" }}>
        {timeAgo(item.created_at)}
      </span>
    </div>
  );
}

export default function Notifications({ token, onAuthError, onUnreadCountChange }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [unreadOnly, setUnreadOnly] = useState(false);

  function load(showSpinner = true) {
    if (showSpinner) setLoading(true);
    setError(null);
    getNotifications({ token })
      .then((res) => {
        setItems(res.items || []);
        onUnreadCountChange?.(res.unread_count ?? 0);
      })
      .catch((e) => {
        if (e.status === 401) return onAuthError?.();
        // Background polls fail silently rather than replacing a working
        // view with an error banner over a transient network hiccup.
        if (showSpinner) setError(e.message || "Failed to load notifications");
      })
      .finally(() => {
        if (showSpinner) setLoading(false);
      });
  }

  useEffect(() => {
    load(true);
    const interval = setInterval(() => load(false), 15000);
    return () => clearInterval(interval);
  }, [token]);

  function handleOpen(item) {
    if (!item.is_read) {
      // Optimistic — flip locally right away, reconcile silently if it fails.
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, is_read: true } : i)));
      onUnreadCountChange?.((c) => Math.max(0, (c ?? 1) - 1));
      markNotificationRead({ token, notificationId: item.id }).catch(() => load());
    }
    if (item.url) window.location.href = item.url;
  }

  function handleMarkAllRead() {
    setItems((prev) => prev.map((i) => ({ ...i, is_read: true })));
    onUnreadCountChange?.(0);
    markAllNotificationsRead({ token }).catch(() => load());
  }

  const unreadCount = items.filter((i) => !i.is_read).length;
  const filtered = useMemo(() => (unreadOnly ? items.filter((i) => !i.is_read) : items), [items, unreadOnly]);

  if (loading) {
    return <div style={{ padding: "3rem 0", textAlign: "center", color: "var(--text-secondary)" }}>Loading notifications…</div>;
  }
  if (error) {
    return <div style={{ padding: "2rem", color: "var(--danger)" }}>{error}</div>;
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
        <p style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "var(--ink)", margin: 0 }}>
          Notifications
          {unreadCount > 0 && (
            <span style={{ fontSize: 12.5, color: "var(--text-muted)", fontFamily: "var(--font-body, inherit)", marginLeft: 8 }}>
              {unreadCount} unread
            </span>
          )}
        </p>

        {unreadCount > 0 && (
          <button
            onClick={handleMarkAllRead}
            style={{
              width: "auto", fontSize: 12.5, padding: "6px 12px",
              border: "0.5px solid var(--border-strong)", borderRadius: 6,
              background: "var(--paper-raised)", color: "var(--text-secondary)",
            }}
          >
            Mark all read
          </button>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "stretch", border: "0.5px solid var(--border-strong)", borderRadius: 6, overflow: "hidden", width: "fit-content", marginBottom: 18 }}>
        <button
          onClick={() => setUnreadOnly(false)}
          style={{
            width: "auto", padding: "0 12px", border: "none", borderRadius: 0,
            background: !unreadOnly ? "var(--accent)" : "transparent",
            color: !unreadOnly ? "#fff" : "var(--text-secondary)",
          }}
        >
          All
        </button>
        <span style={{ width: 1, alignSelf: "center", height: "60%", background: "var(--border-strong)", flexShrink: 0 }} />
        <button
          onClick={() => setUnreadOnly(true)}
          style={{
            width: "auto", padding: "0 12px", border: "none", borderRadius: 0,
            background: unreadOnly ? "var(--accent)" : "transparent",
            color: unreadOnly ? "#fff" : "var(--text-secondary)",
          }}
        >
          Unread{unreadCount > 0 ? ` (${unreadCount})` : ""}
        </button>
      </div>

      {filtered.length === 0 ? (
        <div
          style={{
            textAlign: "center", padding: "3rem 1rem", color: "var(--text-muted)",
            background: "var(--paper-raised)", border: "0.5px solid var(--border-strong)", borderRadius: 8,
          }}
        >
          {items.length === 0
            ? "Nothing here yet — updates about your drafts and posts will show up as they happen."
            : "No unread notifications."}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {filtered.map((item) => (
            <NotificationCard key={item.id} item={item} onOpen={handleOpen} />
          ))}
        </div>
      )}
    </div>
  );
}