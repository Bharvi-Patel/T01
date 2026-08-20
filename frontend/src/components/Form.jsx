import { useState, useRef, useEffect, useMemo } from "react";
import { suggestHashtags } from "../api";
import { EMOJI_CATEGORIES, EMOJI_RECENTS_KEY, DEFAULT_RECENT_EMOJIS } from "../emojiCategories";

// Many systems (especially Windows, and Linux without Noto Color Emoji
// installed) don't have a full color-emoji font, so a lot of emoji render
// as blank "tofu" squares instead of pictures — no CSS font-family fallback
// can fix that if the glyph just isn't installed anywhere on the OS.
// To guarantee every emoji renders identically everywhere, we render them
// as small images from the Twemoji CDN instead of relying on system fonts.
// (Same rule Twemoji itself uses: codepoints joined by "-", dropping the
// variation selector U+FE0F *except* inside ZWJ sequences.)
function twemojiCodepoints(str) {
  const chars = Array.from(str).map((c) => c.codePointAt(0));
  const isZwjSequence = chars.includes(0x200d);
  const filtered = isZwjSequence ? chars : chars.filter((cp) => cp !== 0xfe0f);
  return filtered.map((cp) => cp.toString(16)).join("-");
}

function EmojiGlyph({ emoji, size = 15 }) {
  const [imgFailed, setImgFailed] = useState(false);
  const codepoints = useMemo(() => twemojiCodepoints(emoji), [emoji]);

  if (!imgFailed) {
    return (
      <img
        src={`https://cdn.jsdelivr.net/gh/jdecked/twemoji@latest/assets/72x72/${codepoints}.png`}
        alt={emoji}
        draggable={false}
        onError={() => setImgFailed(true)}
        style={{ width: size + 3, height: size + 3, verticalAlign: "middle" }}
      />
    );
  }
  // Last-resort fallback if the CDN image itself fails (e.g. offline)
  return <span className="emoji-glyph" style={{ fontSize: size }}>{emoji}</span>;
}

const CATEGORIES = [
  "Technology",
  "Web Development",
  "Artificial Intelligence",
  "Gadgets",
  "Business",
  "Startups",
  "Finance",
  "Lifestyle",
  "Health",
  "Travel",
];

const MAX_IMAGES = 9; // matches LinkedIn's per-post carousel cap, the tightest of the connected platforms
const CHAR_LIMIT = 5000; // soft limit shown under the composer — finto.day's field, the loosest of the destinations
const MANUAL_CATEGORY = "Business"; // manual posts skip the category picker — finto.day still needs one to file under

// Networks the "customize post per network" toggle can override. finto.day
// isn't in PLATFORMS (frontend/src/components/platforms.jsx) since it isn't
// an OAuth connector, but it's still a publish destination, so it's added
// here by hand alongside the shared list.
const NETWORKS = [
  { key: "finto", label: "finto.day" },
  { key: "linkedin", label: "LinkedIn" },
  { key: "facebook", label: "Facebook" },
  { key: "instagram", label: "Instagram" },
  { key: "threads", label: "Threads" },
];

export default function Form({ onSubmit, loading, error, token }) {
  const [mode, setMode] = useState("ai"); // "ai" | "manual"

  const [category, setCategory] = useState("Business");
  const [subtopic, setSubtopic] = useState("");
  const [wordCount, setWordCount] = useState(100);

  const [body, setBody] = useState("");
  const [images, setImages] = useState([]); // File[]
  const [video, setVideo] = useState(null); // File | null
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);
  const bodyRef = useRef(null);

  const [customizePerNetwork, setCustomizePerNetwork] = useState(false);
  const [networkText, setNetworkText] = useState({}); // { [key]: string } — falls back to `body` when blank

  const [hashtagLoading, setHashtagLoading] = useState(false);
  const [hashtagError, setHashtagError] = useState("");

  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [emojiQuery, setEmojiQuery] = useState("");
  const [recentEmojis, setRecentEmojis] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(EMOJI_RECENTS_KEY) || "null");
      return Array.isArray(saved) && saved.length ? saved : DEFAULT_RECENT_EMOJIS;
    } catch {
      return DEFAULT_RECENT_EMOJIS;
    }
  });
  const emojiPickerRef = useRef(null);
  const emojiScrollRef = useRef(null);
  const emojiSectionRefs = useRef({});

  useEffect(() => {
    if (!showEmojiPicker) return;
    function handleClickOutside(e) {
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(e.target)) {
        setShowEmojiPicker(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showEmojiPicker]);

  // Search runs across every category at once. With no query, every
  // category is shown stacked in one continuous scroll (matching a
  // standard emoji picker) instead of switching one category at a time —
  // the tabs just jump-scroll to that section.
  const emojiSearchResults = useMemo(() => {
    const q = emojiQuery.trim().toLowerCase();
    if (!q) return null;
    const hits = [];
    for (const cat of EMOJI_CATEGORIES) {
      for (const item of cat.emojis) {
        if (item.char.includes(q) || item.keywords.includes(q)) hits.push(item.char);
      }
    }
    return hits;
  }, [emojiQuery]);

  // Sections rendered when not searching: "Frequently used" (from recents)
  // followed by every real category, each with its full emoji list.
  const emojiSections = [
    { key: "frequent", label: "Frequently used", icon: "🕘", emojis: recentEmojis },
    ...EMOJI_CATEGORIES.filter((c) => c.key !== "frequent").map((c) => ({
      ...c,
      emojis: c.emojis.map((e) => e.char),
    })),
  ];

  function jumpToSection(key) {
    setEmojiQuery("");
    const el = emojiSectionRefs.current[key];
    if (el && emojiScrollRef.current) {
      emojiScrollRef.current.scrollTop = el.offsetTop - emojiScrollRef.current.offsetTop - 4;
    }
  }

  function pickEmoji(emoji) {
    insertAtCursor(emoji);
    setRecentEmojis((prev) => {
      const next = [emoji, ...prev.filter((e) => e !== emoji)].slice(0, 24);
      try { localStorage.setItem(EMOJI_RECENTS_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }

  function addFiles(fileList) {
    const files = Array.from(fileList || []);
    const newImages = files.filter((f) => f.type.startsWith("image/"));
    const newVideo = files.find((f) => f.type.startsWith("video/"));
    if (newImages.length) {
      setImages((prev) => [...prev, ...newImages].slice(0, MAX_IMAGES));
    }
    if (newVideo) setVideo(newVideo);
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    addFiles(e.dataTransfer.files);
  }

  function removeImage(index) {
    setImages((prev) => prev.filter((_, i) => i !== index));
  }

  // Plain-text formatting helpers — there's no rich-text editor here, so
  // Bold/Italic wrap the current selection in markdown-style markers and
  // Hashtag/Emoji insert at the cursor. All operate on the textarea directly.
  function wrapSelection(marker) {
    const el = bodyRef.current;
    if (!el) return;
    const { selectionStart: s, selectionEnd: e } = el;
    const next = body.slice(0, s) + marker + body.slice(s, e) + marker + body.slice(e);
    setBody(next.slice(0, CHAR_LIMIT));
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(s + marker.length, e + marker.length); });
  }

  async function handleSuggestHashtags() {
    if (!body.trim() || hashtagLoading) return;
    setHashtagLoading(true);
    setHashtagError("");
    try {
      const res = await suggestHashtags({ token, text: body, category: mode === "manual" ? MANUAL_CATEGORY : category });
      const tags = res.hashtags || [];
      if (tags.length) {
        insertAtCursor((body.trim().endsWith("\n") || !body ? "" : "\n\n") + tags.join(" "));
      }
    } catch (e) {
      setHashtagError(e.message || "Couldn't generate hashtags right now.");
    } finally {
      setHashtagLoading(false);
    }
  }

  function insertAtCursor(text) {
    const el = bodyRef.current;
    if (!el) return;
    const s = el.selectionStart ?? body.length;
    const e = el.selectionEnd ?? body.length;
    const next = body.slice(0, s) + text + body.slice(e);
    setBody(next.slice(0, CHAR_LIMIT));
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(s + text.length, s + text.length); });
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (mode === "ai") {
      if (!subtopic.trim()) return;
      onSubmit({ mode: "ai", category, subtopic: subtopic.trim(), wordCount });
    } else {
      const trimmedBody = body.trim();
      if (!trimmedBody) return;
      // No title/subtopic/category fields in manual mode — derive a title
      // from the post's first line (finto.day and the draft list still
      // want something to show), and file everything under one fixed
      // category since there's no picker to choose from here.
      const derivedTitle = trimmedBody.split("\n")[0].slice(0, 80) || "Untitled post";
      onSubmit({
        mode: "manual",
        category: MANUAL_CATEGORY,
        subtopic: derivedTitle,
        title: derivedTitle,
        body: trimmedBody,
        images,
        video,
        platformBodies: customizePerNetwork
          ? Object.fromEntries(
              NETWORKS.map((n) => [n.key, (networkText[n.key] ?? "").trim() || trimmedBody])
            )
          : undefined,
      });
    }
  }

  return (
    <form className="composer" onSubmit={handleSubmit}>
      <div className="composer-head">
        <h2 className="composer-title">Generate a new post</h2>
        {/* <span className="stamp composer-stamp">{mode === "ai" ? "AI Draft" : "Manual Draft"}</span> */}
      </div>

      <div className="composer-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "ai"}
          onClick={() => setMode("ai")}
          className={`composer-tab ${mode === "ai" ? "is-active" : ""}`}
        >
          Generate with AI
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "manual"}
          onClick={() => setMode("manual")}
          className={`composer-tab ${mode === "manual" ? "is-active" : ""}`}
        >
          Write it myself
        </button>
      </div>

      {mode === "ai" ? (
        <div className="composer-fields">
          <div className="composer-field">
            <label htmlFor="category">Category</label>
            <select id="category" value={category} onChange={(e) => setCategory(e.target.value)}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div className="composer-field">
            <label htmlFor="subtopic">Subtopic</label>
            <input
              id="subtopic"
              type="text"
              value={subtopic}
              onChange={(e) => setSubtopic(e.target.value)}
              required
            />
          </div>

          <div className="composer-field">
            <label htmlFor="wordcount">Word count</label>
            <input
              id="wordcount"
              type="number"
              min={100}
              value={wordCount}
              onChange={(e) => setWordCount(e.target.value)}
            />
          </div>
        </div>
      ) : (
        <>
          {/* Composer card: textarea, toolbar, full-width dropzone button — laid out like a social-post composer */}
          <div style={{ marginBottom: "0.5rem" }}>
            <label htmlFor="body" style={{ fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)", display: "block", marginBottom: 8 }}>
              Post text
            </label>
            <div className="composer-writer">
              <textarea
                ref={bodyRef}
                id="body"
                rows={5}
                value={body}
                onChange={(e) => setBody(e.target.value.slice(0, CHAR_LIMIT))}
                placeholder="Write something..."
                required
              />

              {hashtagError && (
                <p style={{ fontSize: 12, color: "var(--text-danger)", margin: "0 0 8px" }}>{hashtagError}</p>
              )}

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    type="button"
                    onClick={handleSuggestHashtags}
                    disabled={hashtagLoading || !body.trim()}
                    className="composer-toolbar-btn"
                    title="Generate hashtags with AI for what you've written"
                  >
                    {hashtagLoading ? "Generating…" : "✨ Write hashtags with AI"}
                  </button>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 12, fontFamily: "var(--font-mono)", color: "var(--text-muted)", marginRight: 4 }}>
                    {body.length}/{CHAR_LIMIT}
                  </span>
                  <button type="button" onClick={() => wrapSelection("**")} className="composer-toolbar-btn" title="Bold">
                    <strong>B</strong>
                  </button>
                  <button type="button" onClick={() => wrapSelection("_")} className="composer-toolbar-btn" title="Italic">
                    <em>I</em>
                  </button>
                  <div ref={emojiPickerRef} style={{ position: "relative" }}>
                    <button
                      type="button"
                      onClick={() => setShowEmojiPicker((v) => !v)}
                      className="composer-toolbar-btn"
                      title="Insert emoji"
                    >
                      <EmojiGlyph emoji="🙂" size={16} />
                    </button>
                    {showEmojiPicker && (
                      <div
                        style={{
                          position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 20,
                          width: 300,
                          background: "var(--paper-raised)", border: "1px solid var(--border)",
                          borderRadius: 8, boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
                          overflow: "hidden",
                        }}
                      >
                        <div style={{ display: "flex", gap: 2, padding: "6px 6px 0", borderBottom: "1px solid var(--border)" }}>
                          {emojiSections.map((cat) => (
                            <button
                              key={cat.key}
                              type="button"
                              title={cat.label}
                              onClick={() => jumpToSection(cat.key)}
                              className="emoji-glyph"
                              style={{
                                flex: 1, background: "transparent", border: "none",
                                borderBottom: "2px solid transparent",
                                borderRadius: 0, padding: "5px 0 7px", display: "flex", alignItems: "center", justifyContent: "center",
                                opacity: emojiQuery ? 0.5 : 1,
                              }}
                            >
                              <EmojiGlyph emoji={cat.icon} size={14} />
                            </button>
                          ))}
                        </div>

                        <div style={{ padding: 6 }}>
                          <input
                            type="text"
                            value={emojiQuery}
                            onChange={(e) => setEmojiQuery(e.target.value)}
                            placeholder="Search"
                            style={{ width: "100%", fontSize: 12, padding: "5px 8px" }}
                          />
                        </div>

                        {emojiSearchResults && (
                          <div style={{ padding: "0 10px 4px", fontSize: 11, color: "var(--text-muted)" }}>
                            {emojiSearchResults.length} result{emojiSearchResults.length === 1 ? "" : "s"}
                          </div>
                        )}

                        <div
                          ref={emojiScrollRef}
                          style={{ padding: "0 6px 8px", maxHeight: 300, overflowY: "auto" }}
                        >
                          {emojiSearchResults ? (
                            emojiSearchResults.length === 0 ? (
                              <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "6px 0" }}>No emoji found.</p>
                            ) : (
                              <div style={{ display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gap: 2 }}>
                                {emojiSearchResults.map((emoji, i) => (
                                  <button
                                    key={`${emoji}-${i}`}
                                    type="button"
                                    onClick={() => pickEmoji(emoji)}
                                    title={emoji}
                                    style={{ height: 28, width: 28, padding: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "transparent", border: "1px solid transparent", borderRadius: 4 }}
                                  >
                                    <EmojiGlyph emoji={emoji} />
                                  </button>
                                ))}
                              </div>
                            )
                          ) : (
                            emojiSections.map((cat) => (
                              cat.emojis.length === 0 ? null : (
                                <div
                                  key={cat.key}
                                  ref={(el) => { emojiSectionRefs.current[cat.key] = el; }}
                                  style={{ marginBottom: 10 }}
                                >
                                  <div style={{ fontSize: 11, color: "var(--text-muted)", padding: "4px 4px 4px" }}>
                                    {cat.label}
                                  </div>
                                  <div style={{ display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gap: 2 }}>
                                    {cat.emojis.map((emoji, i) => (
                                      <button
                                        key={`${cat.key}-${emoji}-${i}`}
                                        type="button"
                                        onClick={() => pickEmoji(emoji)}
                                        title={emoji}
                                        style={{ height: 28, width: 28, padding: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "transparent", border: "1px solid transparent", borderRadius: 4 }}
                                      >
                                        <EmojiGlyph emoji={emoji} />
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              )
                            ))
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`composer-dropzone ${dragOver ? "is-over" : ""} ${images.length || video ? "has-media" : ""}`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,video/*"
                  multiple
                  onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }}
                  style={{ display: "none" }}
                />

                {images.length === 0 && !video ? (
                  <p style={{ margin: 0, fontSize: 13, color: "var(--text-muted)" }}>
                    Click or Drag &amp; Drop media
                  </p>
                ) : (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-start" }}>
                    {images.map((file, i) => (
                      <div key={i} style={{ position: "relative" }} onClick={(e) => e.stopPropagation()}>
                        <img
                          src={URL.createObjectURL(file)}
                          alt={file.name}
                          style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 8, border: "1px solid var(--border)" }}
                        />
                        <button
                          type="button"
                          onClick={() => removeImage(i)}
                          aria-label={`Remove ${file.name}`}
                          style={{
                            position: "absolute", top: -6, right: -6, width: 18, height: 18,
                            borderRadius: "50%", padding: 0, lineHeight: "16px", fontSize: 11,
                          }}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                    {video && (
                      <div
                        onClick={(e) => e.stopPropagation()}
                        style={{
                          display: "flex", alignItems: "center", gap: 6,
                          border: "1px solid var(--border)", borderRadius: 8,
                          padding: "6px 10px", fontSize: 12, color: "var(--text-secondary)",
                        }}
                      >
                        🎬 {video.name}
                        <button
                          type="button"
                          onClick={() => setVideo(null)}
                          aria-label="Remove video"
                          style={{ width: 16, height: 16, borderRadius: "50%", padding: 0, lineHeight: "14px", fontSize: 10 }}
                        >
                          ×
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
            <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "8px 0 0" }}>
              Up to {MAX_IMAGES} images plus one video. 
            </p>
          </div>

          <label className="composer-network-toggle">
            <span>Customize post per network</span>
            <span
              onClick={() => setCustomizePerNetwork((v) => !v)}
              style={{
                width: 36, height: 20, borderRadius: 999,
                background: customizePerNetwork ? "var(--accent)" : "var(--border-strong)",
                position: "relative", transition: "background 0.15s", flexShrink: 0,
              }}
            >
              <span
                style={{
                  position: "absolute", top: 2, left: customizePerNetwork ? 18 : 2,
                  width: 16, height: 16, borderRadius: "50%", background: "#fff",
                  transition: "left 0.15s",
                }}
              />
            </span>
          </label>

          {customizePerNetwork && (
            <div className="composer-fields" style={{ marginBottom: "1rem" }}>
              {NETWORKS.map((n) => (
                <div key={n.key} className="composer-field">
                  <label htmlFor={`net-${n.key}`}>{n.label}</label>
                  <textarea
                    id={`net-${n.key}`}
                    rows={2}
                    value={networkText[n.key] ?? body}
                    onChange={(e) => setNetworkText((prev) => ({ ...prev, [n.key]: e.target.value }))}
                    style={{ background: "transparent", border: "1px solid var(--border)", borderRadius: 6, color: "var(--ink)", padding: 8 }}
                  />
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {error && (
        <p
          style={{
            fontSize: 13,
            color: "var(--text-danger)",
            background: "var(--bg-danger)",
            borderRadius: 6,
            padding: "8px 12px",
            margin: "1rem 0",
          }}
        >
          {error}
        </p>
      )}

      <button type="submit" className="composer-submit" disabled={loading}>
        {loading
          ? mode === "ai" ? "Generating…" : "Creating draft…"
          : mode === "ai" ? "Generate draft" : "Create draft"}
      </button>
    </form>
  );
}