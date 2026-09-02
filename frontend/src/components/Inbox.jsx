import { useEffect, useMemo, useState } from "react";
import { getInbox, markInboxItemRead, replyToInboxItem } from "../api";
import { PLATFORMS, PlatformLogo } from "./platforms";

// LinkedIn has no comment/message API access (see engineering notes) so it
// never appears in inbox data — filtered out of the platform picker rather
// than showing a filter for a platform that can never have items.
const INBOX_PLATFORMS = PLATFORMS.filter((p) => p.key !== "linkedin");

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
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString();
}

function dayTimeLabel(iso) {
  const d = new Date(iso);
  return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}, ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}

function sameDay(a, b) {
  const da = new Date(a), db = new Date(b);
  return da.toDateString() === db.toDateString();
}

function initials(name) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  const chars = (parts[0]?.[0] || "") + (parts[1]?.[0] || "");
  return (chars || name[0] || "?").toUpperCase();
}

// A conversation's thread_id groups a DM thread or a post's comment thread
// (see backend InboxItem docs). Items without one (shouldn't normally
// happen) fall back to being their own single-item conversation rather
// than getting silently merged together.
function threadKey(item) {
  return item.thread_id ? `${item.platform}:${item.thread_id}` : `single:${item.id}`;
}

function Avatar({ name, platform, size = 36 }) {
  const platformMeta = INBOX_PLATFORMS.find((p) => p.key === platform);
  const badgeSize = Math.max(14, Math.round(size * 0.5));
  return (
    <span style={{ position: "relative", flexShrink: 0, width: size, height: size }}>
      <span
        style={{
          width: size, height: size, borderRadius: "50%",
          background: "var(--border)", color: "var(--text-secondary)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: size * 0.38, fontWeight: 500,
        }}
      >
        {initials(name)}
      </span>
      {platformMeta && (
        <span
          style={{
            position: "absolute", right: -2, bottom: -2, width: badgeSize, height: badgeSize,
            borderRadius: "50%", background: platformMeta.key === "threads" ? "#000000" : platformMeta.color,
            border: "2px solid var(--paper-raised)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          <PlatformLogo platform={platformMeta} size={badgeSize * 0.58} color="#ffffff" />
        </span>
      )}
    </span>
  );
}

export default function Inbox({ token, connections, onAuthError, kindFilter: kindFilterProp, onKindFilterChange }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const kindFilter = kindFilterProp ?? "all";
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedKey, setSelectedKey] = useState(null);
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);
  const [replyError, setReplyError] = useState(null);

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

  function handleReply(itemId, text) {
    return replyToInboxItem({ token, itemId, text }).then((reply) => {
      setItems((prev) => [reply, ...prev]);
    });
  }

  // Group flat inbox items into conversations by thread_id so the left
  // panel can show one row per person/thread instead of one row per event.
  const conversations = useMemo(() => {
    const byKindItems = kindFilter === "all" ? items : items.filter((i) => i.kind === kindFilter);
    const map = new Map();
    for (const item of byKindItems) {
      const key = threadKey(item);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(item);
    }
    return Array.from(map.entries())
      .map(([key, groupItems]) => {
        const sorted = [...groupItems].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
        const latest = sorted[sorted.length - 1];
        const lastInbound = [...sorted].reverse().find((i) => !i.is_outbound);
        const platformLabel = INBOX_PLATFORMS.find((p) => p.key === latest.platform)?.label || latest.platform;
        // Meta doesn't always hand back a display name for a DM sender
        // (Facebook Messenger in particular locks this down for most
        // apps) - falling back to "Unknown" reads like something broke,
        // so this names the platform instead: honest about what we do
        // and don't know about this contact.
        const senderName = lastInbound?.sender_name || latest.sender_name || `${platformLabel} contact`;
        const unread = groupItems.filter((i) => !i.is_read && !i.is_outbound).length;
        const canReply = Boolean(lastInbound) && (lastInbound.kind === "message" || (lastInbound.platform === "threads" && (lastInbound.kind === "comment" || lastInbound.kind === "mention")));
        return { key, platform: latest.platform, kind: latest.kind, senderName, items: sorted, latest, unread, canReply };
      })
      .sort((a, b) => new Date(b.latest.created_at) - new Date(a.latest.created_at));
  }, [items, kindFilter]);

  const filteredConversations = useMemo(() => {
    const q = search.trim().toLowerCase();
    return conversations.filter((c) => {
      if (unreadOnly && c.unread === 0) return false;
      if (q && !c.senderName.toLowerCase().includes(q) && !(c.latest.body || "").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [conversations, unreadOnly, search]);

  const selected = conversations.find((c) => c.key === selectedKey) || null;
  const unreadCount = items.filter((i) => !i.is_read && !i.is_outbound).length;

  function selectConversation(conv) {
    setSelectedKey(conv.key);
    setReplyText("");
    setReplyError(null);
    conv.items.filter((i) => !i.is_read && !i.is_outbound).forEach((i) => handleMarkRead(i.id));
  }

  function handleSend() {
    const text = replyText.trim();
    if (!text || sending || !selected) return;
    const target = [...selected.items].reverse().find((i) => !i.is_outbound);
    if (!target) return;
    setSending(true);
    setReplyError(null);
    handleReply(target.id, text)
      .then(() => setReplyText(""))
      .catch((e) => setReplyError(e.message || "Failed to send reply"))
      .finally(() => setSending(false));
  }

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
            <span style={{ fontSize: 12.5, color: "var(--text-muted)", fontFamily: "var(--font-sans)", marginLeft: 8 }}>
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

      {items.length === 0 ? (
        <div
          style={{
            textAlign: "center", padding: "4.5rem 1rem", color: "var(--text-muted)",
            background: "var(--paper-raised)", border: "0.5px solid var(--border-strong)", borderRadius: 12,
            display: "flex", flexDirection: "column", alignItems: "center", gap: 10,
          }}
        >
          <span style={{ fontSize: 28 }} aria-hidden="true">✉</span>
          <p style={{ margin: 0, fontSize: 15, fontWeight: 500, color: "var(--ink)" }}>Nothing here yet</p>
          <p style={{ margin: 0, fontSize: 13, maxWidth: 360 }}>
            Comments and messages from your connected accounts will show up here as they come in.
          </p>
        </div>
      ) : (
        <div
          style={{
            display: "flex", height: 620, border: "0.5px solid var(--border-strong)",
            borderRadius: 12, overflow: "hidden", background: "var(--paper-raised)",
          }}
        >
          {/* Left: conversation list */}
          <div style={{ width: 300, flexShrink: 0, borderRight: "0.5px solid var(--border)", display: "flex", flexDirection: "column", minHeight: 0 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", borderBottom: "0.5px solid var(--border)", flexShrink: 0 }}>
              <span style={{ fontSize: 13.5, fontWeight: 500, color: "var(--ink)" }}>DMs</span>
              <select
                value={unreadOnly ? "unread" : "all"}
                onChange={(e) => setUnreadOnly(e.target.value === "unread")}
                style={{
                  width: "auto", fontSize: 12, padding: "3px 6px", height: 26,
                  border: "0.5px solid var(--border-strong)", borderRadius: 5,
                  background: "transparent", color: "var(--text-secondary)",
                }}
              >
                <option value="all">All</option>
                <option value="unread">Unread</option>
              </select>
            </div>
            <div style={{ overflowY: "auto", flex: 1, minHeight: 0 }}>
              {filteredConversations.length === 0 ? (
                <p style={{ fontSize: 12.5, color: "var(--text-muted)", padding: "1.5rem 1rem", textAlign: "center", margin: 0 }}>
                  No conversations match.
                </p>
              ) : (
                filteredConversations.map((conv) => {
                  const isActive = conv.key === selectedKey;
                  return (
                    <button
                      key={conv.key}
                      onClick={() => selectConversation(conv)}
                      style={{
                        width: "100%", height: "auto", display: "flex", alignItems: "flex-start", gap: 10,
                        padding: "10px 14px", border: "none", borderRadius: 0,
                        borderLeft: isActive ? "2.5px solid var(--accent)" : "2.5px solid transparent",
                        borderBottom: "0.5px solid var(--border)",
                        background: isActive ? "var(--paper)" : "transparent",
                        textAlign: "left", cursor: "pointer",
                      }}
                    >
                      <Avatar name={conv.senderName} platform={conv.platform} size={34} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 6 }}>
                          <span style={{ fontSize: 13, fontWeight: conv.unread > 0 ? 600 : 500, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {conv.senderName}
                          </span>
                          <span style={{ fontSize: 10.5, color: "var(--text-muted)", flexShrink: 0 }}>{timeAgo(conv.latest.created_at)}</span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, marginTop: 2 }}>
                          <span style={{ fontSize: 12, color: "var(--text-secondary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {conv.latest.is_outbound ? "You: " : ""}{conv.latest.body || "No text content"}
                          </span>
                          {conv.unread > 0 && (
                            <span
                              style={{
                                fontSize: 10.5, fontWeight: 600, color: "var(--accent-ink)", background: "var(--accent)",
                                borderRadius: 999, minWidth: 16, height: 16, padding: "0 5px",
                                display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                              }}
                            >
                              {conv.unread}
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Right: selected conversation thread */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}>
            {!selected ? (
              <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: 13.5 }}>
                Select a conversation to view it here.
              </div>
            ) : (
              <>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "10px 16px", borderBottom: "0.5px solid var(--border)", flexShrink: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                    <Avatar name={selected.senderName} platform={selected.platform} size={30} />
                    <span style={{ fontSize: 14.5, fontWeight: 500, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {selected.senderName}
                    </span>
                  </div>
                </div>

                <div style={{ flex: 1, overflowY: "auto", padding: "18px 16px", display: "flex", flexDirection: "column", gap: 4, minHeight: 0 }}>
                  {selected.items.map((item, idx) => {
                    const showDivider = idx === 0 || !sameDay(item.created_at, selected.items[idx - 1].created_at);
                    return (
                      <div key={item.id}>
                        {showDivider && (
                          <p style={{ textAlign: "center", fontSize: 11.5, color: "var(--text-muted)", margin: "10px 0" }}>
                            {dayTimeLabel(item.created_at)}
                          </p>
                        )}
                        <div style={{ display: "flex", justifyContent: item.is_outbound ? "flex-end" : "flex-start", marginBottom: 8 }}>
                          <div
                            style={{
                              maxWidth: "70%", padding: "8px 12px", borderRadius: 14,
                              background: item.is_outbound ? "var(--accent)" : "var(--paper)",
                              color: item.is_outbound ? "var(--accent-ink)" : "var(--ink)",
                              border: item.is_outbound ? "none" : "0.5px solid var(--border)",
                              fontSize: 13.5, wordBreak: "break-word",
                            }}
                          >
                            {item.body || <em>No text content</em>}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {selected.canReply ? (
                  <div style={{ padding: "12px 16px", borderTop: "0.5px solid var(--border)", flexShrink: 0 }}>
                    <div style={{ display: "flex", gap: 8 }}>
                      <input
                        type="text"
                        placeholder="Type a reply…"
                        value={replyText}
                        onChange={(e) => setReplyText(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") handleSend(); }}
                        disabled={sending}
                        style={{
                          flex: 1, fontSize: 13, padding: "8px 10px",
                          border: "0.5px solid var(--border-strong)", borderRadius: 6,
                          background: "var(--paper)", color: "var(--ink)",
                        }}
                      />
                      <button onClick={handleSend} disabled={sending || !replyText.trim()} style={{ width: "auto", fontSize: 12.5, padding: "0 16px" }}>
                        {sending ? "Sending…" : "Send"}
                      </button>
                    </div>
                    {replyError && <p style={{ fontSize: 12, color: "var(--danger)", margin: "8px 0 0" }}>{replyError}</p>}
                  </div>
                ) : (
                  <div style={{ padding: "10px 16px", borderTop: "0.5px solid var(--border)", flexShrink: 0 }}>
                    <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>This type of item can't be replied to here yet.</p>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}