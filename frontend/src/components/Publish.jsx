// Publish.jsx
import { useState, useEffect, useRef } from "react";
import { getDrafts, getMediaAssets, uploadMediaAsset, addMediaText, deleteMediaAsset } from "../api";

// Same feather-style stroke icon pattern used in Sidebar.jsx
const MENU_ICON_PATHS = {
  image: "M4 5h16a1 1 0 011 1v12a1 1 0 01-1 1H4a1 1 0 01-1-1V6a1 1 0 011-1zM8.5 10a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM3 16l5-5 4 4 3-3 6 6",
  video: "M4 6h11a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V7a1 1 0 011-1zM16 10l5-3v10l-5-3",
  text: "M4 6h16M4 12h16M4 18h10",
};

function MenuIcon({ name, size = 15 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={MENU_ICON_PATHS[name]} />
    </svg>
  );
}

const TABS = [
  { key: "new", label: "New Post" },
  { key: "drafts", label: "Drafts" },
  { key: "scheduled", label: "Scheduled" },
  { key: "media", label: "Media" },
  { key: "notifications", label: "Mobile Notifications" },
];

const STATUS_LABEL = {
  pending_review: "Pending review",
  scheduled: "Scheduled",
  published: "Published",
  publish_failed: "Publish failed",
  rejected: "Rejected",
};

// Green for anything on-track (pending, scheduled, published); red only for
// genuine failure states, so a red label still stands out as something to
// act on rather than everything looking the same.
const STATUS_COLOR = {
  pending_review: "var(--accent)",
  scheduled: "var(--accent)",
  published: "var(--accent)",
  publish_failed: "var(--danger)",
  rejected: "var(--danger)",
};

function formatDate(iso) {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return iso;
  }
}

function DraftList({ token, status, excludeStatus, wasScheduled, onOpenDraft, emptyLabel }) {
  const [drafts, setDrafts] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setDrafts(null);
    setError("");
    getDrafts({ token, status, excludeStatus, wasScheduled })
      .then((res) => { if (!cancelled) setDrafts(res.drafts); })
      .catch((e) => { if (!cancelled) setError(e.message || "Could not load drafts."); });
    return () => { cancelled = true; };
  }, [token, status, excludeStatus, wasScheduled]);

  if (error) {
    return <p style={{ fontSize: 13, color: "var(--danger)" }}>{error}</p>;
  }
  if (drafts === null) {
    return <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>Loading…</p>;
  }
  if (drafts.length === 0) {
    return <p style={{ fontSize: 13, color: "var(--text-muted)" }}>{emptyLabel}</p>;
  }

  return (
    <div style={{ background: "var(--paper-raised)", borderRadius: 12, border: "0.5px solid var(--border-strong)", padding: "0.5rem 1.25rem" }}>
      {drafts.map((d, i) => (
        <button
          key={d.draft_id}
          onClick={() => onOpenDraft(d.draft_id)}
          style={{
            display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
            width: "100%", textAlign: "left", background: "transparent", border: "none", borderRadius: 0,
            padding: "14px 0", borderBottom: i < drafts.length - 1 ? "0.5px solid var(--border)" : "none",
          }}
        >
          <div style={{ minWidth: 0 }}>
            <p style={{ margin: 0, fontWeight: 500, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--ink)" }}>
              {d.title || d.subtopic}
            </p>
            <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--text-muted)", textTransform: "capitalize" }}>
              {d.category} · {formatDate(d.created_at)}
            </p>
          </div>
          <span style={{ fontSize: 11, color: STATUS_COLOR[d.status] || "var(--text-secondary)", flexShrink: 0, fontFamily: "var(--font-mono)", fontWeight: 600 }}>
            {STATUS_LABEL[d.status] || d.status}
          </span>
        </button>
      ))}
    </div>
  );
}

function MediaTab({ token, onSendToCompose }) {
  const photoRef = useRef(null);
  const videoRef = useRef(null);
  // { id, type: "photo"|"video"|"text", name, previewUrl?, content? } —
  // loaded from and persisted to the user's media library on the backend,
  // so it's the same list every time this tab is opened.
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [textDraftOpen, setTextDraftOpen] = useState(false);
  const [textDraftName, setTextDraftName] = useState("");
  const [textDraft, setTextDraft] = useState("");
  const menuRef = useRef(null);

  function fromBackend(a) {
    return { id: a.id, type: a.kind, name: a.name, previewUrl: a.url, content: a.text_content };
  }

  async function loadAssets() {
    setLoading(true);
    setLoadError("");
    try {
      const { assets: fetched } = await getMediaAssets({ token });
      setAssets(fetched.map(fromBackend));
    } catch (err) {
      setLoadError(err.message || "Couldn't load your media library.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAssets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function handleClickOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  async function handleFiles(e, type) {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (!files.length) return;
    setUploading(true);
    setLoadError("");
    try {
      for (const f of files) {
        const asset = await uploadMediaAsset({ token, file: f, kind: type, name: f.name });
        setAssets((prev) => [fromBackend(asset), ...prev]);
      }
    } catch (err) {
      setLoadError(err.message || "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  async function addTextAsset() {
    if (!textDraft.trim()) return;
    try {
      const asset = await addMediaText({
        token,
        name: textDraftName.trim() || "Untitled text",
        content: textDraft.trim(),
      });
      setAssets((prev) => [fromBackend(asset), ...prev]);
      setTextDraftName("");
      setTextDraft("");
      setTextDraftOpen(false);
    } catch (err) {
      setLoadError(err.message || "Couldn't save that text.");
    }
  }

  async function removeAsset(i) {
    const removed = assets[i];
    setAssets((prev) => prev.filter((_, idx) => idx !== i));
    try {
      await deleteMediaAsset({ token, mediaId: removed.id });
    } catch (err) {
      setLoadError(err.message || "Couldn't delete that asset.");
      loadAssets(); // out of sync with the backend - reload to be safe
    }
  }

  const AddNewButton = (
    <div ref={menuRef} style={{ position: "relative", display: "inline-block" }}>
      <button
        className="primary"
        disabled={uploading}
        style={{ width: "auto", padding: "0 18px", display: "inline-flex", alignItems: "center", gap: 8, opacity: uploading ? 0.6 : 1 }}
        onClick={() => setMenuOpen((o) => !o)}
      >
        <span>{uploading ? "Uploading…" : "+ Add New"}</span>
      </button>
      {menuOpen && (
        <div
          style={{
            position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 50, minWidth: 170,
            background: "var(--paper-raised)", opacity: 1, border: "1px solid var(--border-strong)", borderRadius: 10,
            padding: 6, boxShadow: "0 8px 24px rgba(0,0,0,0.28)",
          }}
        >
          <button
            style={{ width: "100%", justifyContent: "flex-start", background: "transparent", border: "none", height: 36, fontSize: 13.5, color: "var(--ink)", display: "flex", alignItems: "center", gap: 10 }}
            onClick={() => { setMenuOpen(false); photoRef.current?.click(); }}
          >
            <MenuIcon name="image" />
            Upload photos
          </button>
          <button
            style={{ width: "100%", justifyContent: "flex-start", background: "transparent", border: "none", height: 36, fontSize: 13.5, color: "var(--ink)", display: "flex", alignItems: "center", gap: 10 }}
            onClick={() => { setMenuOpen(false); videoRef.current?.click(); }}
          >
            <MenuIcon name="video" />
            Upload videos
          </button>
          <button
            style={{ width: "100%", justifyContent: "flex-start", background: "transparent", border: "none", height: 36, fontSize: 13.5, color: "var(--ink)", display: "flex", alignItems: "center", gap: 10 }}
            onClick={() => { setMenuOpen(false); setTextDraftOpen(true); }}
          >
            <MenuIcon name="text" />
            Upload text
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      {/* <p style={{ fontSize: 12.5, color: "var(--text-muted)", margin: 0 }}>
        Photos, videos, and text saved here are stored on your account permanently — they'll be here the next
        time you visit, on any device you log in from.
      </p> */}
      {loadError && (
        <p style={{ fontSize: 12.5, color: "var(--error, #d33)", margin: 0 }}>{loadError}</p>
      )}

      <input ref={photoRef} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={(e) => handleFiles(e, "photo")} />
      <input ref={videoRef} type="file" accept="video/*" multiple style={{ display: "none" }} onChange={(e) => handleFiles(e, "video")} />

      {textDraftOpen && (
        <div style={{ background: "var(--paper-raised)", borderRadius: 12, border: "0.5px solid var(--border-strong)", padding: "1.25rem" }}>
          <p style={{ fontWeight: 500, fontSize: 14, margin: "0 0 10px", color: "var(--ink)" }}>Add text</p>
          <input
            type="text"
            value={textDraftName}
            onChange={(e) => setTextDraftName(e.target.value)}
            placeholder="Name (e.g. Product launch caption)"
            style={{ width: "100%", marginBottom: 10 }}
          />
          <textarea
            value={textDraft}
            onChange={(e) => setTextDraft(e.target.value)}
            placeholder="Paste or write text content to have on hand for a post…"
            rows={4}
            style={{ width: "100%", resize: "vertical", marginBottom: 10 }}
            autoFocus
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button className="primary" style={{ width: "auto", padding: "0 18px" }} onClick={addTextAsset}>Save</button>
            <button style={{ width: "auto", padding: "0 18px" }} onClick={() => { setTextDraftOpen(false); setTextDraftName(""); setTextDraft(""); }}>Cancel</button>
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: "center", padding: "3.5rem 0", color: "var(--text-muted)", fontSize: 13.5 }}>
          Loading your media…
        </div>
      ) : assets.length === 0 ? (
        <div style={{ textAlign: "center", padding: "3.5rem 0" }}>
          <p style={{ fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 600, margin: "0 0 16px" }}>
            No Media Found
          </p>
          {AddNewButton}
        </div>
      ) : (
        <div>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
            {AddNewButton}
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
              gap: "0.85rem",
            }}
          >
            {assets.map((a, i) => (
              <div key={a.id} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div
                  style={{
                    position: "relative", borderRadius: 10,
                    aspectRatio: "1 / 1",
                    background: "var(--paper-raised)", border: "0.5px solid var(--border-strong)",
                    overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center",
                  }}
                >
                  {a.type === "photo" && a.previewUrl ? (
                    <img
                      src={a.previewUrl}
                      alt={a.name}
                      style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                      onError={(e) => { e.currentTarget.style.display = "none"; }}
                    />
                  ) : a.type === "video" && a.previewUrl ? (
                    <video
                      src={a.previewUrl}
                      style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                      muted
                    />
                  ) : (
                    <MenuIcon name={a.type === "photo" ? "image" : a.type} size={a.type === "text" ? 16 : 24} />
                  )}
                  <button
                    onClick={() => removeAsset(i)}
                    aria-label="Remove"
                    style={{
                      position: "absolute", top: 6, right: 6, width: 20, height: 20, padding: 0,
                      borderRadius: "50%", background: "rgba(0,0,0,0.55)", border: "none",
                      color: "#fff", fontSize: 11, lineHeight: "20px", display: "flex",
                      alignItems: "center", justifyContent: "center",
                    }}
                  >
                    ✕
                  </button>
                </div>
                <p
                  style={{
                    margin: 0, fontSize: 12.5, color: "var(--ink)", textAlign: "center",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}
                  title={a.name}
                >
                  {a.name}
                </p>
                {onSendToCompose && (
                  <button
                    onClick={() => onSendToCompose(a)}
                    style={{
                      width: "auto", alignSelf: "center", background: "transparent", border: "none",
                      padding: 0, fontSize: 11.5, fontFamily: "var(--font-mono)", color: "var(--accent)",
                      cursor: "pointer",
                    }}
                  >
                    Send to composer →
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function NotificationsTab() {
  const [reminders, setReminders] = useState({
    beforePublish: true,
    needsApproval: true,
    publishFailed: true,
    weeklyDigest: false,
  });

  function toggle(key) {
    setReminders((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  const ITEMS = [
    { key: "beforePublish", label: "Remind me before a scheduled post goes live", hint: "15 minutes ahead" },
    { key: "needsApproval", label: "Notify me when a draft needs approval", hint: "As soon as it's generated" },
    { key: "publishFailed", label: "Notify me if a publish attempt fails", hint: "Immediately" },
    { key: "weeklyDigest", label: "Weekly performance digest", hint: "Every Monday morning" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      <p style={{ fontSize: 12.5, color: "var(--text-muted)", margin: 0 }}>
        These are mobile push reminders. Toggling them here just previews the setting — nothing is sent yet since
        there's no notification/scheduling backend behind it.
      </p>
      <div style={{ background: "var(--paper-raised)", borderRadius: 12, border: "0.5px solid var(--border-strong)", padding: "0.5rem 1.25rem" }}>
        {ITEMS.map((item, i) => (
          <div
            key={item.key}
            style={{
              display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
              padding: "14px 0", borderBottom: i < ITEMS.length - 1 ? "0.5px solid var(--border-strong)" : "none",
            }}
          >
            <div>
              <p style={{ margin: 0, fontSize: 14, fontWeight: 500, color: "var(--ink)" }}>{item.label}</p>
              <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--text-muted)" }}>{item.hint}</p>
            </div>
            <button
              onClick={() => toggle(item.key)}
              aria-pressed={reminders[item.key]}
              style={{
                flexShrink: 0, width: 40, height: 22, borderRadius: 11, border: "none", padding: 2,
                background: reminders[item.key] ? "var(--accent)" : "var(--border)",
                display: "flex", justifyContent: reminders[item.key] ? "flex-end" : "flex-start",
              }}
            >
              <span style={{ width: 18, height: 18, borderRadius: "50%", background: "#fff", display: "block" }} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Publish({ token, onNewPost, onOpenDraft, initialTab = "new", onSendMediaToCompose }) {
  const [tab, setTab] = useState(initialTab);

  return (
    <div>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", borderBottom: "0.5px solid var(--border)", marginBottom: "1.5rem" }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              width: "auto", background: "transparent", border: "none", borderRadius: 0,
              padding: "10px 14px", fontSize: 13.5, fontWeight: 500,
              color: tab === t.key ? "var(--ink)" : "var(--text-secondary)",
              borderBottom: tab === t.key ? "2px solid var(--accent)" : "2px solid transparent",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "new" && (
        <div style={{ padding: "1.5rem 0", textAlign: "center" }}>
          <p style={{ fontFamily: "var(--font-display)", fontSize: 20, margin: "0 0 8px" }}>Create a new post</p>
          
          <button className="primary" style={{ width: "auto", padding: "0 24px" }} onClick={onNewPost}>+ New</button>
        </div>
      )}

      {tab === "drafts" && (
        <DraftList token={token} status="pending_review" onOpenDraft={onOpenDraft} emptyLabel="No drafts pending review right now." />
      )}
      {tab === "scheduled" && (
        <DraftList
          token={token}
          wasScheduled={true}
          onOpenDraft={onOpenDraft}
          emptyLabel="Nothing scheduled yet — schedule a draft to see it here."
        />
      )}
      {tab === "media" && <MediaTab token={token} onSendToCompose={onSendMediaToCompose} />}
      {tab === "notifications" && <NotificationsTab />}
    </div>
  );
}