import { useState, useRef, useEffect } from "react";
import { sendChatMessage, getChatHistory } from "../api";

/*
  Checkpoint 2 of the help-assistant chatbot: a floating bubble, present on
  every page, that opens into a chat panel. Conversation history is now
  persisted server-side (see api.js) - opening the widget loads whatever
  was said before instead of always starting blank. The assistant still
  has no grounding in startTrack's actual UI yet (Checkpoints 4-5, Qdrant
  + RAG).
*/
export default function ChatWidget({ token, onAuthError }) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState([]); // { role: "user" | "assistant" | "error", text }
  const [loading, setLoading] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const inputRef = useRef(null);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open || historyLoaded) return;
    setHistoryLoaded(true); // mark eagerly so a fast double-open can't double-fetch
    getChatHistory({ token })
      .then((res) => {
        const loaded = (res.messages || []).map((m) => ({ role: m.role, text: m.content }));
        setMessages(loaded);
      })
      .catch((err) => {
        if (err?.status === 401) {
          onAuthError?.();
        }
        // Otherwise fail quietly — widget just opens empty, same as before
        // history existed; the person can still chat.
      });
  }, [open, historyLoaded, token, onAuthError]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  async function handleSend(e) {
    e.preventDefault();
    const text = message.trim();
    if (!text || loading) return;

    setMessages((prev) => [...prev, { role: "user", text }]);
    setMessage("");
    setLoading(true);

    try {
      const res = await sendChatMessage({ token, message: text });
      setMessages((prev) => [...prev, { role: "assistant", text: res.reply }]);
    } catch (err) {
      if (err?.status === 401) {
        onAuthError?.();
        return;
      }
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
            }}
          >
            <span
              style={{
                fontFamily: "var(--font-display)",
                fontSize: 15,
                color: "var(--ink)",
              }}
            >
              Ask startTrack
            </span>
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
              }}
            >
              ×
            </button>
          </div>

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
        </div>
      )}

      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? "Close help assistant" : "Open help assistant"}
        style={{
          width: 48,
          height: 48,
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
        {open ? "×" : "?"}
      </button>
    </div>
  );
}