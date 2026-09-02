import { useState, useRef, useEffect, useMemo } from "react";
import { suggestHashtags } from "../api";
import { EMOJI_CATEGORIES, EMOJI_RECENTS_KEY, DEFAULT_RECENT_EMOJIS } from "../emojiCategories";
import GeneratingProgress from "./GeneratingProgress";

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

// Web Speech API is Chromium-only (Chrome/Edge) as of this writing - Firefox
// and Safari don't implement SpeechRecognition at all, so this is checked
// once at module load and the mic button simply doesn't render where it's
// unsupported, rather than showing a button that errors on click.
const SpeechRecognitionCtor =
  typeof window !== "undefined" ? window.SpeechRecognition || window.webkitSpeechRecognition : null;

// Dictation button for a single text field: tap to start listening, tap
// again (or the browser auto-stops on silence) to finish. Appends the
// transcript to whatever's already in the field rather than replacing it,
// so it composes with typing instead of fighting it.
function MicButton({ onTranscript, size = 15 }) {
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef(null);
  const cancelledRef = useRef(false); // true when X was clicked - tells onresult to discard the transcript

  useEffect(() => {
    return () => recognitionRef.current?.stop();
  }, []);

  if (!SpeechRecognitionCtor) return null;

  function start() {
    cancelledRef.current = false;
    const recognition = new SpeechRecognitionCtor();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (e) => {
      if (cancelledRef.current) return;
      const transcript = Array.from(e.results).map((r) => r[0].transcript).join(" ").trim();
      if (transcript) onTranscript(transcript);
    };
    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);
    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
  }

  function confirm() {
    cancelledRef.current = false;
    recognitionRef.current?.stop(); // fires onresult with whatever was captured so far, then onend
  }

  function cancel() {
    cancelledRef.current = true;
    recognitionRef.current?.stop(); // onresult still fires but is discarded above
  }

  if (listening) {
    return (
      <div
        style={{
          display: "flex", alignItems: "center", background: "var(--ink)", borderRadius: 999,
          boxShadow: "0 4px 12px rgba(0,0,0,0.18)", overflow: "hidden",
        }}
      >
        <button
          type="button"
          onClick={cancel}
          title="Cancel dictation"
          style={{
            width: 28, height: 26, border: "none", background: "none", color: "var(--paper)",
            display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
          }}
        >
          <svg width={size - 2} height={size - 2} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
        <div style={{ width: 1, height: 14, background: "var(--paper)", opacity: 0.25 }} />
        <button
          type="button"
          onClick={confirm}
          title="Use this text"
          style={{
            width: 28, height: 26, border: "none", background: "none", color: "var(--paper)",
            display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
          }}
        >
          <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 13l4 4L19 7" />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={start}
      title="Speak instead of typing"
      style={{
        width: 22, height: 22, flexShrink: 0, padding: 0, border: "none",
        background: "none", color: "var(--text-muted)",
        display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
      }}
    >
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" />
        <path d="M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8" />
      </svg>
    </button>
  );
}

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

export const MODE_TABS = [
  { key: "ai", label: "Generate with AI" },
  { key: "manual", label: "Write it myself" },
];

// Recovers unsubmitted composer text across a full page reload (see
// App.jsx's PERSISTABLE_STEPS for the same idea applied to nav position).
// Only plain text/serializable fields are covered - images/video are File
// objects the browser can't hand back after a reload, so those are left
// out and simply need re-selecting if lost. Cleared the moment a submit
// actually goes through, since at that point the content lives in a real
// server-side draft and re-showing stale local text next visit would be
// confusing, not helpful.
const COMPOSER_AUTOSAVE_KEY = "composer_draft_autosave";

function readComposerAutosave() {
  try {
    const raw = localStorage.getItem(COMPOSER_AUTOSAVE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function clearComposerAutosave() {
  try {
    localStorage.removeItem(COMPOSER_AUTOSAVE_KEY);
  } catch {
    // ignore - worst case the stale autosave lingers and gets overwritten later
  }
}

export default function Form({ onSubmit, loading, error, token, initialManualAsset, onConsumeInitialAsset, mode: modeProp, onModeChange }) {
  const [modeState, setModeState] = useState(() => readComposerAutosave().mode || "ai"); // "ai" | "manual" — used when mode isn't controlled from outside
  const mode = modeProp ?? modeState;
  const setMode = onModeChange ?? setModeState;

  // Kept true from the moment an AI generation starts until the
  // GeneratingProgress completion swipe finishes (not just while `loading`
  // is true), so the 100% swipe can actually play before switching back to
  // the plain submit button.
  const [showGenerating, setShowGenerating] = useState(false);
  useEffect(() => {
    if (loading && mode === "ai") setShowGenerating(true);
  }, [loading, mode]);

  const [category, setCategory] = useState(() => readComposerAutosave().category || "Business");
  const [subtopic, setSubtopic] = useState(() => readComposerAutosave().subtopic || "");
  const [wordCount, setWordCount] = useState(() => readComposerAutosave().wordCount || 100);

  const [body, setBody] = useState(() => readComposerAutosave().body || "");
  const [images, setImages] = useState([]); // File[] — not autosaved, see COMPOSER_AUTOSAVE_KEY note above
  const [video, setVideo] = useState(null); // File | null — not autosaved, see COMPOSER_AUTOSAVE_KEY note above
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);
  const bodyRef = useRef(null);

  const [customizePerNetwork, setCustomizePerNetwork] = useState(() => readComposerAutosave().customizePerNetwork || false);
  const [networkText, setNetworkText] = useState(() => readComposerAutosave().networkText || {}); // { [key]: string } — falls back to `body` when blank

  // Whether there was actual unsubmitted text sitting in the autosave when
  // this form mounted - drives the small "restored your draft" banner
  // below. Computed once at mount; doesn't re-check as the user types.
  const [hasRestoredDraft, setHasRestoredDraft] = useState(() => {
    const saved = readComposerAutosave();
    return Boolean((saved.subtopic || "").trim() || (saved.body || "").trim());
  });

  function discardRestoredDraft() {
    clearComposerAutosave();
    setCategory("Business");
    setSubtopic("");
    setWordCount(100);
    setBody("");
    setCustomizePerNetwork(false);
    setNetworkText({});
    setHasRestoredDraft(false);
  }

  // Debounced autosave of everything restorable above - runs on every
  // relevant change, not just unmount, since a hard reload gives no chance
  // to flush on the way out.
  useEffect(() => {
    const timeout = setTimeout(() => {
      try {
        localStorage.setItem(COMPOSER_AUTOSAVE_KEY, JSON.stringify({
          mode, category, subtopic, wordCount, body, customizePerNetwork, networkText,
        }));
      } catch {
        // localStorage full/unavailable (private browsing etc.) - autosave
        // just silently stops working rather than breaking the composer
      }
    }, 400);
    return () => clearTimeout(timeout);
  }, [mode, category, subtopic, wordCount, body, customizePerNetwork, networkText]);

  // A media/text asset handed off from the Media tab's "Send to composer" -
  // consumed once on mount only, then cleared in the parent so it doesn't
  // reapply on a later, unrelated visit to this form. Photo/video assets
  // now live in the user's permanent media library on the backend, so
  // there's no in-memory File object to reuse - fetch the stored file back
  // as a blob and wrap it in a File so the rest of the composer (and the
  // /drafts/manual upload) can treat it exactly like a fresh local upload.
  useEffect(() => {
    if (!initialManualAsset) return;
    setMode("manual");
    const { type, previewUrl, name, content } = initialManualAsset;

    async function attachFromUrl(setter, mime) {
      try {
        const res = await fetch(previewUrl);
        const blob = await res.blob();
        const file = new File([blob], name || "media", { type: blob.type || mime });
        setter(file);
      } catch {
        // media library asset couldn't be fetched (e.g. deleted, offline) -
        // just skip attaching it rather than breaking the rest of the form
      }
    }

    if (type === "photo" && previewUrl) {
      attachFromUrl((file) => setImages((prev) => [...prev, file].slice(0, MAX_IMAGES)), "image/jpeg");
    } else if (type === "video" && previewUrl) {
      attachFromUrl((file) => setVideo(file), "video/mp4");
    } else if (type === "text" && content) {
      setBody((prev) => (prev ? prev : content).slice(0, CHAR_LIMIT));
    }
    onConsumeInitialAsset?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      clearComposerAutosave();
      setHasRestoredDraft(false);
      onSubmit({ mode: "ai", category, subtopic: subtopic.trim(), wordCount });
    } else {
      const trimmedBody = body.trim();
      if (!trimmedBody) return;
      // No title/subtopic/category fields in manual mode — derive a title
      // from the post's first line (finto.day and the draft list still
      // want something to show), and file everything under one fixed
      // category since there's no picker to choose from here.
      const derivedTitle = trimmedBody.split("\n")[0].slice(0, 80) || "Untitled post";
      clearComposerAutosave();
      setHasRestoredDraft(false);
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

      {hasRestoredDraft && (
        <div
          style={{
            display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
            fontSize: 12.5, color: "var(--text-muted)", background: "var(--paper-raised)",
            border: "1px solid var(--border)", borderRadius: 8, padding: "8px 12px", marginBottom: 14,
          }}
        >
          <span>Restored your unsaved draft from last time.</span>
          <button
            type="button"
            onClick={discardRestoredDraft}
            style={{ background: "none", border: "none", color: "var(--text-muted)", textDecoration: "underline", cursor: "pointer", fontSize: 12.5, padding: 0 }}
          >
            Discard
          </button>
        </div>
      )}

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
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                id="subtopic"
                type="text"
                value={subtopic}
                onChange={(e) => setSubtopic(e.target.value)}
                required
                style={{ flex: 1 }}
              />
              <MicButton onTranscript={(text) => setSubtopic((prev) => (prev.trim() ? `${prev.trim()} ${text}` : text))} />
            </div>
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
                      🙂
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
                              style={{
                                flex: 1, background: "transparent", border: "none",
                                borderBottom: "2px solid transparent",
                                borderRadius: 0, padding: "5px 0 7px", fontSize: 14,
                                opacity: emojiQuery ? 0.5 : 1,
                              }}
                            >
                              {cat.icon}
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
                                    style={{ height: 28, width: 28, padding: 0, fontSize: 15, background: "transparent", border: "1px solid transparent", borderRadius: 4 }}
                                  >
                                    {emoji}
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
                                        style={{ height: 28, width: 28, padding: 0, fontSize: 15, background: "transparent", border: "1px solid transparent", borderRadius: 4 }}
                                      >
                                        {emoji}
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
              Up to {MAX_IMAGES} images plus one video. If a video is attached, it's published in place
              of the images on platforms that support video — finto.day doesn't yet, so it still gets
              the images there.
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

      {showGenerating && (
        <GeneratingProgress loading={loading} onComplete={() => setShowGenerating(false)} />
      )}

      {!showGenerating && (
        <button type="submit" className="composer-submit" disabled={loading}>
          {mode === "ai" ? "Generate draft" : loading ? "Creating draft…" : "Create draft"}
        </button>
      )}
    </form>
  );
}