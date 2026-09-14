import { useState, useRef, useEffect } from "react";
import {
  sendChatMessage,
  createChatConversation,
  getChatConversations,
  getChatConversationMessages,
} from "../api";

/*
  The help-assistant widget: a floating bubble, present on every page, that
  opens into either a conversation LIST (like Claude's own chat list - past
  threads, named from their first message, most-recent first, plus a "New
  conversation" button) or a single conversation THREAD. Conversation
  history and titles are persisted server-side (see api.js) - reopening the
  widget or picking an old conversation restores it instead of starting
  blank.
*/
export default function ChatWidget({ token, onAuthError, openSignal }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState("list"); // "list" | "thread"
  const [conversations, setConversations] = useState([]);
  const [conversationsLoading, setConversationsLoading] = useState(false);
  const [activeConversationId, setActiveConversationId] = useState(null);
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState([]); // { role: "user" | "assistant" | "error", text }
  const [loading, setLoading] = useState(false);
  const inputRef = useRef(null);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (open && view === "thread") inputRef.current?.focus();
  }, [open, view]);

  // openSignal is a counter bumped by a parent (e.g. HelpCenter's "Chat with
  // us" button) to request the widget open from outside. Skip the initial
  // mount value so the widget doesn't pop open on page load.
  const openSignalRef = useRef(openSignal);
  useEffect(() => {
    if (openSignal !== undefined && openSignal !== openSignalRef.current) {
      openSignalRef.current = openSignal;
      setOpen(true);
    }
  }, [openSignal]);

  function handleAuthError(err) {
    if (err?.status === 401) {
      onAuthError?.();
      return true;
    }
    return false;
  }

  function loadConversations() {
    setConversationsLoading(true);
    getChatConversations({ token })
      .then((res) => setConversations(res.conversations || []))
      .catch((err) => {
        if (!handleAuthError(err)) setConversations([]);
      })
      .finally(() => setConversationsLoading(false));
  }

  // Refetch the list every time it's shown, not just on first widget open -
  // a conversation may have just gotten its title, or a new one may have
  // been created, since the last time the list was visible.
  useEffect(() => {
    if (open && view === "list") loadConversations();
  }, [open, view]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  function openConversation(conversationId) {
    setActiveConversationId(conversationId);
    setMessages([]);
    setView("thread");
    getChatConversationMessages({ token, conversationId })
      .then((res) => {
        const loaded = (res.messages || []).map((m) => ({ role: m.role, text: m.content }));
        setMessages(loaded);
      })
      .catch((err) => {
        handleAuthError(err);
        // Otherwise fail quietly - thread just opens empty, same as before
        // history existed; the person can still chat.
      });
  }

  async function startNewConversation() {
    try {
      const res = await createChatConversation({ token });
      setActiveConversationId(res.conversation_id);
      setMessages([]);
      setView("thread");
    } catch (err) {
      handleAuthError(err);
    }
  }

  function backToList() {
    setView("list");
    setActiveConversationId(null);
  }

  async function handleSend(e) {
    e.preventDefault();
    const text = message.trim();
    if (!text || loading || !activeConversationId) return;

    setMessages((prev) => [...prev, { role: "user", text }]);
    setMessage("");
    setLoading(true);

    try {
      const res = await sendChatMessage({ token, conversationId: activeConversationId, message: text });
      setMessages((prev) => [...prev, { role: "assistant", text: res.reply }]);
      if (res.title) {
        // Keep the list in sync locally so it doesn't show "Untitled" if the
        // person backs out right after their first message, before the
        // list view re-fetches on its own.
        setConversations((prev) =>
          prev.some((c) => c.conversation_id === activeConversationId)
            ? prev.map((c) => (c.conversation_id === activeConversationId ? { ...c, title: res.title } : c))
            : [{ conversation_id: activeConversationId, title: res.title, updated_at: new Date().toISOString() }, ...prev]
        );
      }
    } catch (err) {
      if (handleAuthError(err)) return;
      setMessages((prev) => [...prev, { role: "error", text: "Couldn't reach the assistant. Try again." }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ position: "fixed", right: 20, bottom: 20, zIndex: 1000 }}>
      {open && (
        <div
          style={{
            width: 320,
            marginBottom: 12,
            background: "var(--paper-raised)",
            border: "1px solid var(--border-strong)",
            borderRadius: "var(--radius)",
            boxShadow: "0 4px 20px rgba(0,0,0,0.18)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: "10px 14px",
              borderBottom: "1px solid var(--border)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
              {view === "thread" && (
                <button
                  onClick={backToList}
                  aria-label="Back to conversations"
                  style={{
                    background: "none",
                    border: "none",
                    color: "var(--text-secondary)",
                    cursor: "pointer",
                    fontSize: 16,
                    lineHeight: 1,
                    padding: 4,
                  }}
                >
                  ‹
                </button>
              )}
              <span
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: 15,
                  color: "var(--ink)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {view === "list"
                  ? "Ask startTrack"
                  : conversations.find((c) => c.conversation_id === activeConversationId)?.title || "New conversation"}
              </span>
            </div>
            <button
              onClick={() => setOpen(false)}
              aria-label="Close chat"
              style={{
                background: "none",
                border: "none",
                color: "var(--text-secondary)",
                cursor: "pointer",
                fontSize: 16,
                lineHeight: 1,
                padding: 4,
                flexShrink: 0,
              }}
            >
              ×
            </button>
          </div>

          {view === "list" ? (
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ padding: 10, borderBottom: "1px solid var(--border)" }}>
                <button
                  onClick={startNewConversation}
                  style={{
                    width: "100%",
                    border: "none",
                    background: "var(--primary)",
                    color: "var(--paper)",
                    borderRadius: "var(--radius)",
                    padding: "8px 12px",
                    fontSize: 13,
                    cursor: "pointer",
                  }}
                >
                  + New conversation
                </button>
              </div>

              <div style={{ maxHeight: 320, overflowY: "auto" }}>
                {conversationsLoading && (
                  <p style={{ color: "var(--text-muted)", fontSize: 13, margin: "14px" }}>Loading…</p>
                )}

                {!conversationsLoading && conversations.length === 0 && (
                  <p style={{ color: "var(--text-muted)", fontSize: 13, margin: "14px" }}>
                    No conversations yet. Start one to ask where to find something or how a feature works.
                  </p>
                )}

                {conversations.map((c) => (
                  <button
                    key={c.conversation_id}
                    onClick={() => openConversation(c.conversation_id)}
                    style={{
                      display: "block",
                      width: "100%",
                      textAlign: "left",
                      background: "none",
                      border: "none",
                      borderBottom: "1px solid var(--border)",
                      padding: "10px 14px",
                      cursor: "pointer",
                      color: "var(--ink)",
                      fontSize: 13,
                    }}
                  >
                    {c.title || "Untitled conversation"}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              <div
                ref={scrollRef}
                style={{
                  padding: 14,
                  minHeight: 160,
                  maxHeight: 320,
                  overflowY: "auto",
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                }}
              >
                {messages.length === 0 && !loading && (
                  <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0 }}>
                    Ask where to find something or how a feature works.
                  </p>
                )}

                {messages.map((m, i) => (
                  <div
                    key={i}
                    style={{
                      alignSelf: m.role === "user" ? "flex-end" : "flex-start",
                      maxWidth: "85%",
                      background:
                        m.role === "user"
                          ? "var(--primary)"
                          : m.role === "error"
                          ? "var(--danger-bg)"
                          : "var(--paper)",
                      color:
                        m.role === "user"
                          ? "var(--paper)"
                          : m.role === "error"
                          ? "var(--danger)"
                          : "var(--ink)",
                      border: m.role === "assistant" ? "1px solid var(--border)" : "none",
                      borderRadius: "var(--radius)",
                      padding: "7px 10px",
                      fontSize: 13,
                      whiteSpace: "pre-wrap",
                      lineHeight: 1.4,
                    }}
                  >
                    {m.text}
                  </div>
                ))}

                {loading && (
                  <div
                    style={{
                      alignSelf: "flex-start",
                      color: "var(--text-secondary)",
                      fontSize: 13,
                      fontStyle: "italic",
                    }}
                  >
                    Thinking…
                  </div>
                )}
              </div>

              <form onSubmit={handleSend} style={{ display: "flex", borderTop: "1px solid var(--border)" }}>
                <input
                  ref={inputRef}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Type a question…"
                  style={{
                    flex: 1,
                    border: "none",
                    padding: "10px 12px",
                    fontSize: 13,
                    fontFamily: "var(--font-sans)",
                    background: "transparent",
                    color: "var(--ink)",
                    outline: "none",
                  }}
                />
                <button
                  type="submit"
                  disabled={loading || !message.trim()}
                  style={{
                    border: "none",
                    background: "var(--primary)",
                    color: "var(--paper)",
                    padding: "0 16px",
                    fontSize: 13,
                    cursor: loading || !message.trim() ? "default" : "pointer",
                    opacity: loading || !message.trim() ? 0.6 : 1,
                  }}
                >
                  Send
                </button>
              </form>
            </>
          )}
        </div>
      )}

      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? "Close help assistant" : "Open help assistant"}
        style={{
          width: 56,
          height: 56,
          borderRadius: "50%",
          border: "1px solid var(--border-strong)",
          background: "var(--primary)",
          color: "var(--paper)",
          fontSize: 20,
          cursor: "pointer",
          boxShadow: "0 2px 10px rgba(0,0,0,0.2)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {open ? (
          "×"
        ) : (
          <svg style={{ width: 34, height: 34, flexShrink: 0 }} viewBox="0 0 24 24">
            <path fill="currentColor" d="M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2z" />
            <circle cx="8.5" cy="11" r="1.3" fill="var(--primary)" />
            <circle cx="12" cy="11" r="1.3" fill="var(--primary)" />
            <circle cx="15.5" cy="11" r="1.3" fill="var(--primary)" />
          </svg>
        )}
      </button>
    </div>
  );
}