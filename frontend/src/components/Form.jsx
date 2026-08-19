import { useState, useRef } from "react";
import { suggestHashtags } from "../api";

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

  const toolbarBtnStyle = {
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    height: 28, minWidth: 28, padding: "0 8px", fontSize: 13,
    background: "transparent", border: "1px solid var(--border)",
  };

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        background: "var(--surface-2)",
        borderRadius: 12,
        border: "0.5px solid var(--border)",
        padding: "1.5rem",
      }}
    >
      <p style={{ fontWeight: 500, fontSize: 15, margin: "0 0 1rem", color: "var(--ink)" }}>
        Generate a new post
      </p>

      <div
        role="tablist"
        style={{
          display: "flex",
          gap: 8,
          marginBottom: "1.25rem",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
          padding: 4,
        }}
      >
        <button
          type="button"
          role="tab"
          aria-selected={mode === "ai"}
          onClick={() => setMode("ai")}
          className={mode === "ai" ? "primary" : ""}
          style={{ flex: 1 }}
        >
          Generate with AI
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "manual"}
          onClick={() => setMode("manual")}
          className={mode === "manual" ? "primary" : ""}
          style={{ flex: 1 }}
        >
          Write it myself
        </button>
      </div>

      {mode === "ai" ? (
        <>
          <div style={{ marginBottom: "1rem" }}>
            <label htmlFor="category">Category</label>
            <select
              id="category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div style={{ marginBottom: "1rem" }}>
            <label htmlFor="subtopic">Subtopic</label>
            <input
              id="subtopic"
              type="text"
              value={subtopic}
              onChange={(e) => setSubtopic(e.target.value)}
              required
            />
          </div>

          <div style={{ marginBottom: "1.5rem" }}>
            <label htmlFor="wordcount">Word count</label>
            <input
              id="wordcount"
              type="number"
              min={100}
              value={wordCount}
              onChange={(e) => setWordCount(e.target.value)}
            />
          </div>
        </>
      ) : (
        <>
          {/* Composer card: textarea, toolbar, full-width dropzone button — laid out like a social-post composer */}
          <div style={{ marginBottom: "0.5rem" }}>
            <label htmlFor="body">Post text</label>
            <div
              style={{
                background: "var(--paper-raised, var(--surface-1, var(--surface-2)))",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius)",
                padding: 12,
              }}
            >
              <textarea
                ref={bodyRef}
                id="body"
                rows={5}
                value={body}
                onChange={(e) => setBody(e.target.value.slice(0, CHAR_LIMIT))}
                placeholder="Write something..."
                required
                style={{ border: "none", borderRadius: 0, padding: 0, resize: "vertical", marginBottom: 12 }}
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
                    style={{ ...toolbarBtnStyle, opacity: hashtagLoading || !body.trim() ? 0.5 : 1 }}
                    title="Generate hashtags with AI for what you've written"
                  >
                    {hashtagLoading ? "Generating…" : "✨ Write hashtags with AI"}
                  </button>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 12, color: "var(--text-secondary)", marginRight: 4 }}>
                    {body.length}/{CHAR_LIMIT}
                  </span>
                  <button type="button" onClick={() => wrapSelection("**")} style={toolbarBtnStyle} title="Bold">
                    <strong>B</strong>
                  </button>
                  <button type="button" onClick={() => wrapSelection("_")} style={toolbarBtnStyle} title="Italic">
                    <em>I</em>
                  </button>
                  <button type="button" onClick={() => insertAtCursor("🙂")} style={toolbarBtnStyle} title="Insert emoji">
                    🙂
                  </button>
                </div>
              </div>

              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                style={{
                  border: `1px dashed ${dragOver ? "var(--accent)" : "var(--border-strong)"}`,
                  borderRadius: "var(--radius)",
                  cursor: "pointer",
                  background: dragOver ? "var(--surface-2)" : "transparent",
                  padding: images.length || video ? 10 : "12px 10px",
                  textAlign: "center",
                }}
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
                  <p style={{ margin: 0, fontSize: 13, color: "var(--text-secondary)" }}>
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
            <p style={{ fontSize: 12, color: "var(--text-secondary)", margin: "6px 0 0" }}>
              Up to {MAX_IMAGES} images plus one video. If a video is attached, it's published in place
              of the images on platforms that support video — finto.day doesn't yet, so it still gets
              the images there.
            </p>
          </div>

          <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", margin: "1rem 0 1.5rem" }}>
            <span style={{ fontSize: 13 }}>Customize post per network</span>
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
            <div style={{ marginBottom: "1.5rem", display: "flex", flexDirection: "column", gap: 10 }}>
              {NETWORKS.map((n) => (
                <div key={n.key}>
                  <label htmlFor={`net-${n.key}`}>{n.label}</label>
                  <textarea
                    id={`net-${n.key}`}
                    rows={2}
                    value={networkText[n.key] ?? body}
                    onChange={(e) => setNetworkText((prev) => ({ ...prev, [n.key]: e.target.value }))}
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
            borderRadius: "var(--radius)",
            padding: "8px 12px",
            margin: "0 0 1rem",
          }}
        >
          {error}
        </p>
      )}

      <button type="submit" className="primary" style={{ width: "100%" }} disabled={loading}>
        {loading
          ? mode === "ai" ? "Generating…" : "Creating draft…"
          : mode === "ai" ? "Generate draft" : "Create draft"}
      </button>
    </form>
  );
}