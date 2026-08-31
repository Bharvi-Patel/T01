import { useEffect, useMemo, useState } from "react";
import { getInbox, markInboxItemRead, replyToInboxItem, deleteInboxItem } from "../api";
import { PLATFORMS, PlatformLogo } from "./platforms";

// LinkedIn has no comment/message API access (see engineering notes) so it
// never appears in inbox data — filtered out of the platform picker rather
// than showing a filter for a platform that can never have items.
const INBOX_PLATFORMS = PLATFORMS.filter((p) => p.key !== "linkedin");

const KIND_LABELS = {
  comment: "Comment",
  message: "Message",
  mention: "Mention",
  story_reply: "Story reply",
};

export const KIND_TABS = [
  { key: "all", label: "All" },
  { key: "comment", label: "Comments" },
  { key: "message", label: "Messages" },
  { key: "mention", label: "Mentions" },
  { key: "story_reply", label: "Story replies" },
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

function InboxItemCard({ item, isExpanded, onToggleExpand, onDelete, onReply }) {
  const platform = INBOX_PLATFORMS.find((p) => p.key === item.platform);
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);
  const [replyError, setReplyError] = useState(null);

  // Matches the backend's POST /inbox/{id}/reply restriction exactly, so
  // there's never a Send button here that would just 400 if clicked:
  // inbound messages (any platform) are reply-able via Meta's Send API,
  // and inbound comments/mentions on Threads specifically are reply-able
  // too (a public reply, via Threads' own container/publish flow) -
  // Threads has no DMs, so "message" never applies there. Other platforms'
  // comments/mentions/story replies, and any outbound item, aren't
  // reply-able yet.
  const isThreadsReply = item.platform === "threads" && (item.kind === "comment" || item.kind === "mention");
  const canReply = !item.is_outbound && (item.kind === "message" || isThreadsReply);

  function handleSend() {
    const text = replyText.trim();
    if (!text || sending) return;
    setSending(true);
    setReplyError(null);
    onReply(item.id, text)
      .then(() => setReplyText(""))
      .catch((e) => setReplyError(e.message || "Failed to send reply"))
      .finally(() => setSending(false));
  }

  return (
    <div
      style={{
        borderRadius: 8,
        background: item.is_outbound ? "var(--accent-subtle, var(--paper-raised))" : (item.is_read ? "var(--paper-raised)" : "var(--paper)"),
        border: item.is_read || item.is_outbound ? "0.5px solid var(--border)" : "1.5px solid var(--accent)",
        overflow: "hidden",
      }}
    >
      <div
        onClick={() => { if (!item.is_read) onToggleExpand(item.id, true); else onToggleExpand(item.id); }}
        style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: "12px 14px", cursor: "pointer" }}
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
              {item.is_outbound ? "Reply sent" : (KIND_LABELS[item.kind] || item.kind)}
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

      {isExpanded && (
        <div style={{ padding: "0 14px 14px 56px", display: "flex", flexDirection: "column", gap: 8 }}>
          {canReply && (
            <div style={{ display: "flex", gap: 8 }}>
              <input
                type="text"
                placeholder="Type a reply…"
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleSend(); }}
                disabled={sending}
                style={{
                  flex: 1, fontSize: 13, padding: "7px 10px",
                  border: "0.5px solid var(--border-strong)", borderRadius: 6,
                  background: "var(--paper)", color: "var(--ink)",
                }}
              />
              <button
                onClick={handleSend}
                disabled={sending || !replyText.trim()}
                style={{ width: "auto", fontSize: 12.5, padding: "0 14px" }}
              >
                {sending ? "Sending…" : "Send"}
              </button>
            </div>
          )}
          {replyError && (
            <p style={{ fontSize: 12, color: "var(--danger)", margin: 0 }}>{replyError}</p>
          )}
          <button
            onClick={() => onDelete(item.id)}
            style={{
              width: "auto", alignSelf: "flex-start", fontSize: 12, padding: "4px 10px",
              border: "0.5px solid var(--border-strong)", borderRadius: 6,
              background: "transparent", color: "var(--text-muted)",
            }}
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

export default function Inbox({ token, connections, onAuthError, kindFilter: kindFilterProp, onKindFilterChange }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [kindFilterState, setKindFilterState] = useState("all");
  const kindFilter = kindFilterProp ?? kindFilterState;
  const setKindFilter = onKindFilterChange ?? setKindFilterState;
  const [platformFilter, setPlatformFilter] = useState("all");
  const [pendingOnly, setPendingOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState(null);

  // Same segmented "All / [connected account]" pill bar Calendar uses,
  // scoped to platforms that can actually appear in inbox data.
  const connectedPlatforms = INBOX_PLATFORMS.filter((p) => connections?.[p.key]);

  // showSpinner is false for background polls so the list doesn't flash a
  // full loading state every 15s - only the very first load (and token
  // changes) show the spinner.
  function load(showSpinner = true) {
    if (showSpinner) setLoading(true);
    setError(null);
    getInbox({ token })
      .then((res) => setItems(res.items || []))
      .catch((e) => {
        if (e.status === 401) return onAuthError?.();
        // Background polls fail silently rather than replacing a working
        // inbox view with an error banner over a transient network hiccup.
        if (showSpinner) setError(e.message || "Failed to load inbox");
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

  function handleMarkRead(itemId) {
    // Optimistic — flip locally right away, reconcile silently if it fails.
    setItems((prev) => prev.map((i) => (i.id === itemId ? { ...i, is_read: true } : i)));
    markInboxItemRead({ token, itemId }).catch(() => load());
  }

  // markRead=true is passed the first time an unread item is clicked, so
  // opening it both expands the card and clears its unread dot in one
  // click, instead of needing a second click to mark it read.
  function handleToggleExpand(itemId, markRead = false) {
    if (markRead) handleMarkRead(itemId);
    setExpandedId((prev) => (prev === itemId ? null : itemId));
  }

  function handleReply(itemId, text) {
    return replyToInboxItem({ token, itemId, text }).then((reply) => {
      setItems((prev) => [reply, ...prev]);
    });
  }

  function handleDelete(itemId) {
    // Optimistic — remove locally right away, reconcile silently if it fails.
    setItems((prev) => prev.filter((i) => i.id !== itemId));
    setExpandedId((prev) => (prev === itemId ? null : prev));
    deleteInboxItem({ token, itemId }).catch(() => load());
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((item) => {
      if (kindFilter !== "all" && item.kind !== kindFilter) return false;
      if (platformFilter !== "all" && item.platform !== platformFilter) return false;
      if (pendingOnly && item.is_read) return false;
      if (q && !(item.body || "").toLowerCase().includes(q) && !(item.sender_name || "").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [items, kindFilter, platformFilter, pendingOnly, search]);

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
        {connectedPlatforms.length > 0 && (
          <div style={{ display: "flex", alignItems: "stretch", border: "0.5px solid var(--border-strong)", borderRadius: 6, overflow: "hidden" }}>
            <button
              onClick={() => setPlatformFilter("all")}
              style={{
                width: "auto", padding: "0 12px", border: "none", borderRadius: 0,
                background: platformFilter === "all" ? "var(--accent)" : "transparent",
                color: platformFilter === "all" ? "#fff" : "var(--text-secondary)",
              }}
            >
              All
            </button>
            {connectedPlatforms.map((p) => {
              const accountName = connections?.[p.key]?.profile_name || p.label;
              return (
                <div key={p.key} style={{ display: "flex", alignItems: "center" }}>
                  <span style={{ width: 1, alignSelf: "center", height: "60%", background: "var(--border-strong)", flexShrink: 0 }} />
                  <button
                    onClick={() => setPlatformFilter(p.key)}
                    title={`${p.label} · ${accountName}`}
                    style={{
                      width: "auto", padding: "0 10px", border: "none", borderRadius: 0,
                      display: "flex", alignItems: "center", gap: 6,
                      background: platformFilter === p.key ? "var(--accent)" : "transparent",
                      color: platformFilter === p.key ? "#fff" : "var(--text-secondary)",
                    }}
                  >
                    <PlatformLogo platform={p} size={13} />
                    {accountName}
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <div style={{ display: "flex", alignItems: "stretch", border: "0.5px solid var(--border-strong)", borderRadius: 6, overflow: "hidden" }}>
          <button
            onClick={() => setPendingOnly(false)}
            style={{
              width: "auto", padding: "0 12px", border: "none", borderRadius: 0,
              background: !pendingOnly ? "var(--accent)" : "transparent",
              color: !pendingOnly ? "#fff" : "var(--text-secondary)",
            }}
          >
            All
          </button>
          <span style={{ width: 1, alignSelf: "center", height: "60%", background: "var(--border-strong)", flexShrink: 0 }} />
          <button
            onClick={() => setPendingOnly(true)}
            style={{
              width: "auto", padding: "0 12px", border: "none", borderRadius: 0,
              background: pendingOnly ? "var(--accent)" : "transparent",
              color: pendingOnly ? "#fff" : "var(--text-secondary)",
            }}
          >
            Pending{unreadCount > 0 ? ` (${unreadCount})` : ""}
          </button>
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
            <InboxItemCard
              key={item.id}
              item={item}
              isExpanded={expandedId === item.id}
              onToggleExpand={handleToggleExpand}
              onReply={handleReply}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}