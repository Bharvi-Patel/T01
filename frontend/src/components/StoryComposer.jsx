import { useState, useRef, useEffect, forwardRef, useImperativeHandle } from "react";
import { getTrendingGifs, searchGifs } from "../api";

// Standard Instagram/Facebook Story canvas size — the flatten() export
// always renders at this resolution regardless of the on-screen preview
// box size, since every layer's x/y/fontSize/width is stored as a 0-1
// fraction of the box rather than raw pixels.
const OUT_W = 1080;
const OUT_H = 1920;
const MAX_HISTORY = 50;

// Curated font presets rather than free-text font entry: a canvas export
// can only reliably draw a font that's actually finished loading, so we
// keep this list small, load all of them once up front via a single
// Google Fonts stylesheet, and confirm each is ready (see
// ensureFontLoaded) right before drawing it into the exported JPEG.
const FONT_OPTIONS = [
  { id: "modern", label: "Modern", css: '"Poppins", sans-serif', google: "Poppins:wght@700" },
  { id: "classic", label: "Classic", css: '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif' },
  { id: "signature", label: "Signature", css: '"Dancing Script", cursive', google: "Dancing+Script:wght@700" },
  { id: "editor", label: "Editor", css: '"Grandstander", sans-serif', google: "Grandstander:wght@700" },
  { id: "poster", label: "Poster", css: '"Anton", sans-serif', google: "Anton" },
  { id: "bubble", label: "Bubble", css: '"Baloo 2", sans-serif', google: "Baloo+2:wght@700" },
  { id: "deco", label: "Deco", css: '"Cinzel Decorative", serif', google: "Cinzel+Decorative:wght@700" },
  { id: "squeeze", label: "Squeeze", css: '"Oswald", sans-serif', google: "Oswald:wght@700" },
  { id: "typewriter", label: "Typewriter", css: '"Courier Prime", monospace', google: "Courier+Prime:wght@700" },
  { id: "strong", label: "Strong", css: '"Archivo Black", sans-serif', google: "Archivo+Black" },
  { id: "meme", label: "Meme", css: 'Impact, Haettenschweiler, "Franklin Gothic Bold", Charcoal, sans-serif' },
  { id: "elegant", label: "Elegant", css: '"Playfair Display", serif', google: "Playfair+Display:wght@700" },
  { id: "directional", label: "Directional", css: '"Staatliches", sans-serif', google: "Staatliches" },
  { id: "literature", label: "Literature", css: '"Libre Baskerville", serif', google: "Libre+Baskerville:wght@700" },
  { id: "gothic", label: "Gothic", css: '"UnifrakturCook", cursive', google: "UnifrakturCook:wght@700" },
  { id: "arcade", label: "Arcade", css: '"Press Start 2P", monospace', google: "Press+Start+2P" },
  { id: "headline", label: "Headline", css: '"Bebas Neue", sans-serif', google: "Bebas+Neue" },
];
function fontOptionFor(id) {
  return FONT_OPTIONS.find((f) => f.id === id) || FONT_OPTIONS.find((f) => f.id === "classic");
}

// A "style" in Instagram's own text sticker picker isn't just a font — it's
// a font PLUS a color treatment (outline, glow, gradient, hard shadow).
// These are layered on top of whichever FONT_OPTIONS choice is active, so
// any font can be combined with any effect rather than baking 17x5 fixed
// combinations.
const EFFECT_OPTIONS = [
  { id: "none", label: "None" },
  { id: "outline", label: "Outline" },
  { id: "glow", label: "Glow" },
  { id: "gradient", label: "Gradient" },
  { id: "shadow", label: "Pop shadow" },
];

// Shared with flatten()'s canvas drawing below, so the live preview and the
// exported JPEG always agree on how thick/offset/blurred each effect is.
// Preview text is rendered at layer.fontSize*200 (the on-screen box width);
// the export is rendered at layer.fontSize*OUT_W (1080) — using the same
// fraction against each one's own font size keeps them visually identical
// even though the raw pixel numbers differ.
const OUTLINE_WIDTH_FRACTION = 0.06; // thinner than the original 0.09 — a
// heavier stroke fills in the thin connecting strokes of script/cursive
// fonts and turns the whole word into an illegible blob.
const SHADOW_OFFSET_FRACTION = 0.06;
const GLOW_BLUR_FRACTION = 0.5;

// CSS approximation of each effect for the live preview. The canvas export
// (see flatten()) implements the same five effects properly with stroke/
// shadow/gradient drawing so the exported JPEG matches this, but a couple
// of these (text-stroke, background-clip:text) rely on browser support
// that's universal in practice but not literally guaranteed by spec.
function textEffectStyle(layer) {
  const effect = layer.effect || "none";
  const previewFontPx = layer.fontSize * 200;
  if (effect === "outline") {
    const w = Math.max(0.5, previewFontPx * OUTLINE_WIDTH_FRACTION);
    return { WebkitTextStroke: `${w}px ${layer.effectColor || "#000000"}`, color: layer.color, textShadow: "none" };
  }
  if (effect === "glow") {
    const c = layer.effectColor || layer.color;
    const inner = previewFontPx * GLOW_BLUR_FRACTION * 0.4;
    const outer = previewFontPx * GLOW_BLUR_FRACTION * 0.8;
    return { color: layer.color, textShadow: `0 0 ${inner}px ${c}, 0 0 ${outer}px ${c}` };
  }
  if (effect === "gradient") {
    return {
      backgroundImage: `linear-gradient(90deg, ${layer.color}, ${layer.gradientTo || "#ffffff"})`,
      WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent", textShadow: "none",
    };
  }
  if (effect === "shadow") {
    const off = Math.max(0.5, previewFontPx * SHADOW_OFFSET_FRACTION);
    return { color: layer.color, textShadow: `${off}px ${off}px 0 ${layer.effectColor || "#000000"}` };
  }
  return { color: layer.color, textShadow: "0 1px 4px rgba(0,0,0,0.5)" };
}
// Where the text anchor point (layer.x, layer.y) sits relative to the
// text itself — matches canvas's own textAlign semantics, so the preview
// (CSS transform) and the export (ctx.textAlign) agree on where the text
// grows from.
const ALIGN_TRANSLATE_X = { left: "0%", center: "-50%", right: "-100%" };

// Curated quick-pick colors, similar in spirit to the swatch row in
// Instagram's own text sticker editor — a fast path for common choices,
// with the native color input alongside for anything more exact.
const PALETTE = [
  "#ffffff", "#000000", "#ff3040", "#ff8a00", "#ffd400", "#3ddc84",
  "#00c2ff", "#3b5bfe", "#a259ff", "#ff2d95", "#ffd700", "#c0c0c0",
];

// Curated static sticker pack. Emoji glyphs rather than image assets on
// purpose: they render crisply at any size with zero asset hosting/
// licensing to manage, and both canvas fillText and every OS emoji font
// draw them identically enough for preview/export parity. Grouped loosely
// by theme so the picker grid doesn't feel like a random dump.
const STICKER_PACK = [
  "🔥", "✨", "💯", "🎉", "🎊", "❤️", "💕", "⭐", "🌟", "☀️",
  "😂", "😍", "🥳", "😎", "🙌", "👏", "👍", "🤝", "💪", "🙏",
  "📍", "📸", "🎵", "🎬", "🚀", "☕", "🍕", "🎂", "🏆", "💡",
];

// `commit` fires once per discrete pick (a swatch click, or the moment the
// native picker opens) so each color change is one undo step — not one
// per frame while dragging inside the browser's own color wheel.
function ColorSwatches({ value, commit, update, title }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
      {PALETTE.map((c) => (
        <button
          key={c}
          type="button"
          title={c}
          onClick={() => { commit(); update(c); }}
          style={{
            width: 18, height: 18, borderRadius: "50%", background: c, padding: 0, cursor: "pointer",
            border: value?.toLowerCase() === c ? "2px solid var(--accent)" : "1px solid var(--border-strong)",
          }}
        />
      ))}
      <input
        type="color"
        title={title || "Custom color"}
        value={value}
        onFocus={commit}
        onChange={(e) => update(e.target.value)}
        style={{ width: 22, height: 22, padding: 0, border: "none", background: "none", cursor: "pointer" }}
      />
    </div>
  );
}

let layerIdCounter = 0;
function nextLayerId() {
  layerIdCounter += 1;
  return `layer-${layerIdCounter}-${Date.now()}`;
}

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

// Same as loadImageFromFile but for a remote URL (GIF stickers come from
// Giphy's CDN, not a local File). crossOrigin is required for a cross-
// origin image to be drawable into a canvas that's later read back via
// toBlob/toDataURL — without it, flatten() would throw a tainted-canvas
// SecurityError the first time a story with a GIF sticker is exported.
function loadImageFromUrl(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

// Confirms a font is actually loaded before canvas draws with it — canvas
// silently falls back to a default font if you draw with one that hasn't
// finished loading yet, with no error. Failures (offline, blocked
// stylesheet) are swallowed on purpose: worst case the export falls back
// to the system font rather than the story failing to generate.
async function ensureFontLoaded(cssFamily, pxSize) {
  if (!document?.fonts?.load) return;
  try {
    await document.fonts.load(`700 ${pxSize}px ${cssFamily}`);
  } catch {
    // fall back silently
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Every draggable thing on the canvas — text, the mention pin, and image
// stickers/props — lives in one ordered `layers` array. Array order IS
// stacking order: index 0 paints first (bottom), the last entry paints
// last (top). This shared shape is deliberate: a future curated prop/
// sticker library slots into the same "image" layer type used below for
// user-uploaded stickers, without touching the resize/rotate/reorder
// machinery.
//
// Common fields on every layer: id, type, x, y (0-1 fractions, center-
// anchored), rotation (degrees).
// type: "text"    adds: text, fontSize (0-1 fraction of box width), color,
//                  fontFamily (id from FONT_OPTIONS), align ("left" |
//                  "center" | "right")
// type: "mention" adds: username, scale (multiplier, default 1)
// type: "image"   adds: file (the File, used at export time), previewUrl
//                  (object URL for on-screen display), width (0-1 fraction
//                  of box width), aspect (naturalHeight/naturalWidth, kept
//                  constant while resizing)
// type: "sticker" adds: sourceKind ("static" | "gif"), width (0-1 fraction
//                  of box width), aspect (kept constant while resizing).
//                  sourceKind "static": emoji (glyph from STICKER_PACK) —
//                  aspect is always 1 (square glyph box).
//                  sourceKind "gif": previewUrl (picker thumbnail), gifUrl
//                  (animated GIF, used for the live preview), mp4Url
//                  (Giphy's pre-transcoded MP4 rendition — see flatten()'s
//                  TODO for why this is captured but not exported as
//                  motion yet), aspect from the GIF's natural dimensions.
const StoryComposer = forwardRef(function StoryComposer({ image, onImageChange, token }, ref) {
  const [layers, setLayers] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [fontPickerOpen, setFontPickerOpen] = useState(false);
  const [effectPickerOpen, setEffectPickerOpen] = useState(false);
  // Sticker/GIF picker panel: which tab is showing, the GIF search box's
  // current text, the last-fetched results for that text, and load/config
  // state. GIF results start as the trending feed (fetched once when the
  // panel first opens) so the tab never opens empty before the user types.
  const [stickerPickerOpen, setStickerPickerOpen] = useState(false);
  const [stickerTab, setStickerTab] = useState("stickers");
  const [gifQuery, setGifQuery] = useState("");
  const [gifResults, setGifResults] = useState([]);
  const [gifLoading, setGifLoading] = useState(false);
  const [gifConfigured, setGifConfigured] = useState(true);
  const gifFetchSeq = useRef(0);
  // Which layer (if any) is currently being edited inline via double-click,
  // instead of through the side panel's text field.
  const [editingId, setEditingId] = useState(null);
  const editRef = useRef(null);

  // Undo/redo history. Each entry is a full snapshot of `layers` taken
  // right BEFORE a change is applied, so undo restores it and pushes the
  // pre-undo state onto `future` for redo. Snapshots are taken once per
  // discrete action (see commitHistory call sites) — never on every
  // pointermove or keystroke — so one Ctrl+Z reverses one whole edit,
  // not one pixel of a drag or one typed character.
  const [past, setPast] = useState([]);
  const [future, setFuture] = useState([]);
  const layersRef = useRef(layers);
  useEffect(() => { layersRef.current = layers; }, [layers]);

  const boxRef = useRef(null);
  const fileInputRef = useRef(null);
  const dragState = useRef(null); // { kind: "move"|"resize"|"rotate", id, ... }

  // Loads every preset's webfont once via a single combined stylesheet
  // request, so switching the font dropdown never triggers a new network
  // request mid-edit. Guarded by element id in case of remounts.
  useEffect(() => {
    const id = "story-composer-fonts";
    if (document.getElementById(id)) return;
    const families = FONT_OPTIONS.filter((f) => f.google).map((f) => `family=${f.google}`).join("&");
    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href = `https://fonts.googleapis.com/css2?${families}&display=swap`;
    document.head.appendChild(link);
  }, []);

  function commitHistory() {
    setPast((p) => [...p.slice(-(MAX_HISTORY - 1)), layersRef.current]);
    setFuture([]);
  }

  // Undo/redo should only clear the selection when the selected layer no
  // longer exists in the restored state (e.g. undoing the "add" that
  // created it) — not on every undo, or the control panel below would
  // vanish even when reverting something small like a color or font.
  function undo() {
    setPast((p) => {
      if (p.length === 0) return p;
      const prevState = p[p.length - 1];
      setFuture((f) => [layersRef.current, ...f]);
      setLayers(prevState);
      setActiveId((current) => (prevState.some((l) => l.id === current) ? current : null));
      return p.slice(0, -1);
    });
  }

  function redo() {
    setFuture((f) => {
      if (f.length === 0) return f;
      const nextState = f[0];
      setPast((p) => [...p, layersRef.current]);
      setLayers(nextState);
      setActiveId((current) => (nextState.some((l) => l.id === current) ? current : null));
      return f.slice(1);
    });
  }

  useImperativeHandle(ref, () => ({
    // Renders the base image + every layer (in stacking order) onto an
    // offscreen canvas and exports one flattened JPEG — this is what
    // actually gets uploaded, since neither platform's Story API accepts
    // separate text/sticker layers.
    async flatten() {
      if (!image) return null;
      const img = await loadImageFromFile(image);
      const canvas = document.createElement("canvas");
      canvas.width = OUT_W;
      canvas.height = OUT_H;
      const ctx = canvas.getContext("2d");

      const scale = Math.max(OUT_W / img.width, OUT_H / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      ctx.drawImage(img, (OUT_W - w) / 2, (OUT_H - h) / 2, w, h);

      for (const layer of layers) {
        const px = layer.x * OUT_W;
        const py = layer.y * OUT_H;
        const rad = ((layer.rotation || 0) * Math.PI) / 180;

        if (layer.type === "text") {
          const fontPx = layer.fontSize * OUT_W;
          const fontOpt = fontOptionFor(layer.fontFamily);
          await ensureFontLoaded(fontOpt.css, fontPx);
          const displayText = layer.text || "";
          const weight = (layer.bold ?? true) ? "700" : "400";
          const style = layer.italic ? "italic" : "normal";
          ctx.save();
          ctx.translate(px, py);
          ctx.rotate(rad);
          ctx.font = `${style} ${weight} ${fontPx}px ${fontOpt.css}`;
          ctx.textAlign = layer.align || "center";
          ctx.textBaseline = "middle";

          const effect = layer.effect || "none";
          if (effect === "gradient") {
            const textW = Math.max(1, ctx.measureText(displayText).width);
            let gx0, gx1;
            if (ctx.textAlign === "left") { gx0 = 0; gx1 = textW; }
            else if (ctx.textAlign === "right") { gx0 = -textW; gx1 = 0; }
            else { gx0 = -textW / 2; gx1 = textW / 2; }
            const grad = ctx.createLinearGradient(gx0, 0, gx1, 0);
            grad.addColorStop(0, layer.color);
            grad.addColorStop(1, layer.gradientTo || "#ffffff");
            ctx.fillStyle = grad;
            ctx.shadowColor = "rgba(0,0,0,0.35)";
            ctx.shadowBlur = fontPx * 0.12;
            ctx.fillText(displayText, 0, 0);
          } else if (effect === "outline") {
            ctx.lineJoin = "round";
            ctx.miterLimit = 2;
            ctx.strokeStyle = layer.effectColor || "#000000";
            ctx.lineWidth = fontPx * OUTLINE_WIDTH_FRACTION;
            ctx.strokeText(displayText, 0, 0);
            ctx.shadowColor = "transparent";
            ctx.fillStyle = layer.color;
            ctx.fillText(displayText, 0, 0);
          } else if (effect === "glow") {
            ctx.shadowColor = layer.effectColor || layer.color;
            ctx.shadowBlur = fontPx * GLOW_BLUR_FRACTION;
            ctx.fillStyle = layer.color;
            ctx.fillText(displayText, 0, 0);
            ctx.fillText(displayText, 0, 0); // second pass — a single-pass canvas glow reads faint
          } else if (effect === "shadow") {
            const offset = fontPx * SHADOW_OFFSET_FRACTION;
            ctx.shadowColor = "transparent";
            ctx.fillStyle = layer.effectColor || "#000000";
            ctx.fillText(displayText, offset, offset);
            ctx.fillStyle = layer.color;
            ctx.fillText(displayText, 0, 0);
          } else {
            ctx.fillStyle = layer.color;
            ctx.shadowColor = "rgba(0,0,0,0.45)";
            ctx.shadowBlur = fontPx * 0.15;
            ctx.fillText(displayText, 0, 0);
          }
          ctx.restore();
        } else if (layer.type === "mention" && layer.username?.trim()) {
          const layerScale = layer.scale || 1;
          const fontPx = 0.032 * OUT_W * layerScale;
          ctx.save();
          ctx.translate(px, py);
          ctx.rotate(rad);
          ctx.font = `600 ${fontPx}px -apple-system, Helvetica, Arial, sans-serif`;
          const label = `@${layer.username.trim()}`;
          const metrics = ctx.measureText(label);
          const padX = fontPx * 0.7;
          const padY = fontPx * 0.5;
          const boxW = metrics.width + padX * 2;
          const boxH = fontPx + padY * 2;
          ctx.fillStyle = "rgba(0,0,0,0.55)";
          roundRect(ctx, -boxW / 2, -boxH / 2, boxW, boxH, boxH / 2);
          ctx.fill();
          ctx.fillStyle = "#fff";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(label, 0, 0);
          ctx.restore();
        } else if (layer.type === "image" && layer.file) {
          const stickerImg = await loadImageFromFile(layer.file);
          const dw = layer.width * OUT_W;
          const dh = dw * layer.aspect;
          ctx.save();
          ctx.translate(px, py);
          ctx.rotate(rad);
          ctx.drawImage(stickerImg, -dw / 2, -dh / 2, dw, dh);
          ctx.restore();
        } else if (layer.type === "sticker" && layer.sourceKind === "static") {
          const size = layer.width * OUT_W;
          ctx.save();
          ctx.translate(px, py);
          ctx.rotate(rad);
          ctx.font = `${size}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(layer.emoji, 0, 0);
          ctx.restore();
        } else if (layer.type === "sticker" && layer.sourceKind === "gif") {
          // TODO(video export): this draws only the GIF's first frame, so
          // a Story with a GIF sticker currently exports as a JPEG with
          // that sticker frozen — it does NOT yet animate in the posted
          // Story, even though layer.mp4Url (Giphy's transcoded MP4) is
          // already captured and ready to use. Making it actually animate
          // needs flatten() to branch into a server-side render job
          // (composite every other layer once, overlay the MP4 frame-by-
          // frame via ffmpeg, encode to MP4) instead of this single-canvas
          // path, plus a new publish flow on the backend for video Story
          // media. That's a separate piece of work — see the next step.
          const gifImg = await loadImageFromUrl(layer.gifUrl);
          const dw = layer.width * OUT_W;
          const dh = dw * layer.aspect;
          ctx.save();
          ctx.translate(px, py);
          ctx.rotate(rad);
          ctx.drawImage(gifImg, -dw / 2, -dh / 2, dw, dh);
          ctx.restore();
        }
      }

      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
      return blob ? new File([blob], "story.jpg", { type: "image/jpeg" }) : null;
    },
    // Matches the user_tags shape the Instagram Graph API expects on a
    // Story media container: [{ username, x, y }], x/y as 0-1 fractions.
    // Empty when there's no mention layer or it was left blank.
    getUserTags() {
      const mention = layers.find((l) => l.type === "mention");
      if (!mention?.username?.trim()) return [];
      return [{ username: mention.username.trim(), x: Number(mention.x.toFixed(3)), y: Number(mention.y.toFixed(3)) }];
    },
  }), [image, layers]);

  function addTextLayer() {
    commitHistory();
    const id = nextLayerId();
    setLayers((prev) => [
      ...prev,
      { id, type: "text", text: "Tap to edit", x: 0.5, y: 0.5, rotation: 0, fontSize: 0.07, color: "#ffffff", fontFamily: "classic", align: "center", effect: "none", effectColor: "#000000", gradientTo: "#ffd700", bold: true, italic: false },
    ]);
    setActiveId(id);
  }

  function addMention() {
    if (layers.some((l) => l.type === "mention")) return;
    commitHistory();
    const id = nextLayerId();
    setLayers((prev) => [...prev, { id, type: "mention", username: "", x: 0.5, y: 0.85, rotation: 0, scale: 1 }]);
    setActiveId(id);
  }

  // Adds a curated emoji sticker. aspect is fixed at 1 (square) since a
  // glyph's own box is square regardless of which character it is.
  function addEmojiSticker(emoji) {
    commitHistory();
    const id = nextLayerId();
    setLayers((prev) => [
      ...prev,
      { id, type: "sticker", sourceKind: "static", emoji, x: 0.5, y: 0.5, rotation: 0, width: 0.18, aspect: 1 },
    ]);
    setActiveId(id);
    setStickerPickerOpen(false);
  }

  // Adds a GIF sticker from a normalized Giphy result (see api.js's
  // searchGifs/getTrendingGifs). aspect comes from the GIF's own natural
  // dimensions so it doesn't look stretched at any width.
  function addGifSticker(gif) {
    commitHistory();
    const id = nextLayerId();
    const aspect = gif.width && gif.height ? gif.height / gif.width : 1;
    setLayers((prev) => [
      ...prev,
      {
        id, type: "sticker", sourceKind: "gif", gifUrl: gif.gifUrl, mp4Url: gif.mp4Url,
        x: 0.5, y: 0.5, rotation: 0, width: 0.35, aspect,
      },
    ]);
    setActiveId(id);
    setStickerPickerOpen(false);
  }

  function updateLayer(id, patch) {
    setLayers((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }

  function removeLayer(id) {
    commitHistory();
    setLayers((prev) => prev.filter((l) => l.id !== id));
    setActiveId(null);
  }

  // Double-click on a text/mention layer switches it into inline editing —
  // the same div is swapped for a contentEditable version (see rendering
  // below) so what you type appears exactly where and how it will look.
  function startEditing(id) {
    commitHistory();
    setActiveId(id);
    setEditingId(id);
  }

  // Reads the final text out of the contentEditable DOM node (never held
  // in React state while typing — see the effect below for why) and
  // commits it to the layer once editing ends.
  function finishEditing(layer, rawText) {
    if (layer.type === "mention") {
      updateLayer(layer.id, { username: rawText.replace(/^@+/, "").trim() });
    } else {
      updateLayer(layer.id, { text: rawText });
    }
    setEditingId(null);
  }

  // Focuses the contentEditable node and selects all its text the moment
  // editing starts, so typing immediately replaces the placeholder/old
  // text rather than appending to it.
  useEffect(() => {
    if (!editingId || !editRef.current) return;
    const el = editRef.current;
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }, [editingId]);

  // Loads the trending feed once, the first time the GIF tab is opened
  // with an empty search box — not on every open, so re-opening the panel
  // doesn't refetch if the user already has trending results loaded.
  useEffect(() => {
    if (!stickerPickerOpen || stickerTab !== "gifs" || gifQuery.trim() || gifResults.length > 0) return;
    let cancelled = false;
    setGifLoading(true);
    getTrendingGifs({ token })
      .then((res) => {
        if (cancelled) return;
        setGifConfigured(res.configured);
        setGifResults(res.results || []);
      })
      .catch(() => { if (!cancelled) setGifResults([]); })
      .finally(() => { if (!cancelled) setGifLoading(false); });
    return () => { cancelled = true; };
  }, [stickerPickerOpen, stickerTab]); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced search: waits 400ms after the last keystroke before firing,
  // and gifFetchSeq guards against an older, slower request overwriting a
  // newer one's results if responses arrive out of order.
  useEffect(() => {
    if (!stickerPickerOpen || stickerTab !== "gifs") return;
    const q = gifQuery.trim();
    if (!q) return;
    const seq = ++gifFetchSeq.current;
    setGifLoading(true);
    const timer = setTimeout(() => {
      searchGifs({ token, query: q })
        .then((res) => {
          if (gifFetchSeq.current !== seq) return;
          setGifConfigured(res.configured);
          setGifResults(res.results || []);
        })
        .catch(() => { if (gifFetchSeq.current === seq) setGifResults([]); })
        .finally(() => { if (gifFetchSeq.current === seq) setGifLoading(false); });
    }, 400);
    return () => clearTimeout(timer);
  }, [gifQuery, stickerPickerOpen, stickerTab]); // eslint-disable-line react-hooks/exhaustive-deps

  function setFontFamily(id, fontFamily) {
    commitHistory();
    updateLayer(id, { fontFamily });
  }

  function setAlign(id, align) {
    commitHistory();
    updateLayer(id, { align });
  }

  function boxCenterPx(layer) {
    const rect = boxRef.current.getBoundingClientRect();
    return { cx: rect.left + layer.x * rect.width, cy: rect.top + layer.y * rect.height, rect };
  }

  function onDrag(e) {
    const d = dragState.current;
    if (!d) return;
    const layer = layers.find((l) => l.id === d.id);
    if (!layer) return;

    if (d.kind === "move") {
      let x = (e.clientX - d.rectX) / d.rectW;
      let y = (e.clientY - d.rectY) / d.rectH;
      x = Math.min(1, Math.max(0, x));
      y = Math.min(1, Math.max(0, y));
      updateLayer(d.id, { x, y });
    } else if (d.kind === "resize") {
      const dist = Math.hypot(e.clientX - d.cx, e.clientY - d.cy);
      const ratio = dist / d.initialDist;
      if (layer.type === "text") {
        const next = Math.min(0.3, Math.max(0.02, d.initialFontSize * ratio));
        updateLayer(d.id, { fontSize: next });
      } else if (layer.type === "mention") {
        const next = Math.min(3, Math.max(0.5, d.initialScale * ratio));
        updateLayer(d.id, { scale: next });
      } else if (layer.type === "image" || layer.type === "sticker") {
        const next = Math.min(0.9, Math.max(0.05, d.initialWidth * ratio));
        updateLayer(d.id, { width: next });
      }
    } else if (d.kind === "rotate") {
      const angle = (Math.atan2(e.clientY - d.cy, e.clientX - d.cx) * 180) / Math.PI;
      updateLayer(d.id, { rotation: angle - d.angleOffset });
    }
  }

  function endDrag() {
    dragState.current = null;
    window.removeEventListener("pointermove", onDrag);
    window.removeEventListener("pointerup", endDrag);
  }

  // Each start* function commits history exactly once, before the drag's
  // first mutation — so the whole drag (however many pointermove events
  // it generates) undoes as a single step.
  function startMove(e, id) {
    e.stopPropagation();
    commitHistory();
    const rect = boxRef.current.getBoundingClientRect();
    dragState.current = { kind: "move", id, rectW: rect.width, rectH: rect.height, rectX: rect.left, rectY: rect.top };
    setActiveId(id);
    window.addEventListener("pointermove", onDrag);
    window.addEventListener("pointerup", endDrag);
  }

  function startResize(e, layer) {
    e.stopPropagation();
    commitHistory();
    const { cx, cy } = boxCenterPx(layer);
    dragState.current = {
      kind: "resize", id: layer.id, cx, cy,
      initialDist: Math.max(1, Math.hypot(e.clientX - cx, e.clientY - cy)),
      initialFontSize: layer.fontSize, initialScale: layer.scale, initialWidth: layer.width,
    };
    setActiveId(layer.id);
    window.addEventListener("pointermove", onDrag);
    window.addEventListener("pointerup", endDrag);
  }

  function startRotate(e, layer) {
    e.stopPropagation();
    commitHistory();
    const { cx, cy } = boxCenterPx(layer);
    const startAngle = (Math.atan2(e.clientY - cy, e.clientX - cx) * 180) / Math.PI;
    dragState.current = { kind: "rotate", id: layer.id, cx, cy, angleOffset: startAngle - (layer.rotation || 0) };
    setActiveId(layer.id);
    window.addEventListener("pointermove", onDrag);
    window.addEventListener("pointerup", endDrag);
  }

  // Safety net if the component unmounts mid-drag (e.g. switching modes)
  useEffect(() => () => {
    window.removeEventListener("pointermove", onDrag);
    window.removeEventListener("pointerup", endDrag);
  }, []);

  // Ctrl/Cmd+Z to undo, Ctrl/Cmd+Shift+Z (or Ctrl+Y) to redo, Delete/
  // Backspace to remove the selected layer. All skipped while focus is
  // inside a text input so normal typing, backspacing, and the browser's
  // own field-level undo still work as expected.
  useEffect(() => {
    function onKeyDown(e) {
      const tag = document.activeElement?.tagName;
      const inField = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || document.activeElement?.isContentEditable;
      if (inField) return;

      if ((e.key === "Delete" || e.key === "Backspace") && activeId) {
        e.preventDefault();
        removeLayer(activeId);
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeId]);

  const activeLayer = layers.find((l) => l.id === activeId);

  useEffect(() => { setFontPickerOpen(false); setEffectPickerOpen(false); }, [activeId]);

  // Eight resize handles (corners + edge midpoints) around the layer's own
  // auto-sized box, plus one rotate handle above it. All eight resize dots
  // drive the same distance-from-center scale math in onDrag — this is a
  // uniform (aspect-preserving) resize from any handle, not independent
  // width/height stretching, which would need each layer to carry an
  // explicit box size rather than a single font-size/scale/width value.
  const RESIZE_HANDLE_POS = [
    { left: "0%", top: "0%" }, { left: "50%", top: "0%" }, { left: "100%", top: "0%" },
    { left: "100%", top: "50%" },
    { left: "100%", top: "100%" }, { left: "50%", top: "100%" }, { left: "0%", top: "100%" },
    { left: "0%", top: "50%" },
  ];

  function renderHandles(layer) {
    if (activeId !== layer.id) return null;
    return (
      <>
        <div
          onPointerDown={(e) => startRotate(e, layer)}
          title="Drag to rotate"
          style={{
            position: "absolute", top: -26, left: "50%", transform: "translateX(-50%)",
            width: 14, height: 14, borderRadius: "50%", background: "var(--accent)",
            border: "2px solid #fff", cursor: "grab", boxShadow: "0 1px 3px rgba(0,0,0,0.4)", zIndex: 2,
          }}
        />
        {RESIZE_HANDLE_POS.map((pos, i) => (
          <div
            key={i}
            onPointerDown={(e) => startResize(e, layer)}
            title="Drag to resize"
            style={{
              position: "absolute", left: pos.left, top: pos.top, transform: "translate(-50%, -50%)",
              width: 10, height: 10, borderRadius: "50%", background: "#fff",
              border: "2px solid var(--accent)", cursor: "nwse-resize", boxShadow: "0 1px 2px rgba(0,0,0,0.35)",
            }}
          />
        ))}
      </>
    );
  }

  return (
    <div className="composer-fields">
      <div
        ref={boxRef}
        onClick={() => setActiveId(null)}
        style={{
          width: 200, aspectRatio: "9 / 16", margin: "0 auto", position: "relative",
          border: "1px solid var(--border-strong)", borderRadius: 12, overflow: "hidden",
          background: "var(--paper-raised)", userSelect: "none", touchAction: "none",
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={(e) => onImageChange(e.target.files?.[0] || null)}
          style={{ display: "none" }}
        />
        {image ? (
          <img
            src={URL.createObjectURL(image)}
            alt=""
            style={{ width: "100%", height: "100%", objectFit: "cover", position: "absolute", inset: 0, pointerEvents: "none" }}
          />
        ) : (
          <div
            onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
            style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
          >
            <p style={{ margin: 0, fontSize: 12.5, color: "var(--text-muted)", textAlign: "center", padding: "0 14px" }}>
              Click to choose a base image
            </p>
          </div>
        )}

        {layers.map((layer) => (
          <div
            key={layer.id}
            onClick={(e) => { e.stopPropagation(); setActiveId(layer.id); }}
            style={{
              position: "absolute", left: `${layer.x * 100}%`, top: `${layer.y * 100}%`,
              transform: layer.type === "text"
                ? `translate(${ALIGN_TRANSLATE_X[layer.align || "center"]}, -50%) rotate(${layer.rotation || 0}deg)`
                : `translate(-50%, -50%) rotate(${layer.rotation || 0}deg)`,
            }}
          >
            {layer.type === "text" && (
              editingId === layer.id ? (
                <div
                  ref={editRef}
                  contentEditable
                  suppressContentEditableWarning
                  onBlur={(e) => finishEditing(layer, e.currentTarget.textContent)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === "Escape") { e.preventDefault(); e.currentTarget.blur(); }
                  }}
                  style={{
                    fontWeight: (layer.bold ?? true) ? 700 : 400, fontStyle: layer.italic ? "italic" : "normal",
                    fontSize: layer.fontSize * 200,
                    fontFamily: fontOptionFor(layer.fontFamily).css,
                    textAlign: layer.align || "center", padding: 4, whiteSpace: "nowrap",
                    ...textEffectStyle(layer),
                    outline: "2px solid var(--accent)", cursor: "text", minWidth: 20,
                  }}
                >
                  {layer.text || ""}
                </div>
              ) : (
                <div
                  onPointerDown={(e) => startMove(e, layer.id)}
                  onDoubleClick={(e) => { e.stopPropagation(); startEditing(layer.id); }}
                  style={{
                    cursor: "grab", fontWeight: (layer.bold ?? true) ? 700 : 400, fontStyle: layer.italic ? "italic" : "normal",
                    fontSize: layer.fontSize * 200,
                    fontFamily: fontOptionFor(layer.fontFamily).css,
                    textAlign: layer.align || "center", padding: 4, whiteSpace: "nowrap",
                    ...textEffectStyle(layer),
                    outline: activeId === layer.id ? "1px solid var(--accent)" : "none",
                    maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis",
                  }}
                >
                  {layer.text || "Double-tap to edit"}
                </div>
              )
            )}
            {layer.type === "mention" && (
              editingId === layer.id ? (
                <div
                  ref={editRef}
                  contentEditable
                  suppressContentEditableWarning
                  onBlur={(e) => finishEditing(layer, e.currentTarget.textContent)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === "Escape") { e.preventDefault(); e.currentTarget.blur(); }
                  }}
                  style={{
                    background: "rgba(0,0,0,0.55)", color: "#fff", borderRadius: 999,
                    padding: "4px 10px", fontSize: 11 * (layer.scale || 1), fontWeight: 600, whiteSpace: "nowrap",
                    outline: "2px solid var(--accent)", cursor: "text", minWidth: 20,
                  }}
                >
                  {`@${layer.username || ""}`}
                </div>
              ) : (
                <div
                  onPointerDown={(e) => startMove(e, layer.id)}
                  onDoubleClick={(e) => { e.stopPropagation(); startEditing(layer.id); }}
                  style={{
                    cursor: "grab", background: "rgba(0,0,0,0.55)", color: "#fff", borderRadius: 999,
                    padding: "4px 10px", fontSize: 11 * (layer.scale || 1), fontWeight: 600, whiteSpace: "nowrap",
                    outline: activeId === layer.id ? "1px solid var(--accent)" : "none",
                  }}
                >
                  @{layer.username || "username"}
                </div>
              )
            )}
            {layer.type === "image" && (
              <img
                src={layer.previewUrl}
                alt=""
                onPointerDown={(e) => startMove(e, layer.id)}
                draggable={false}
                style={{
                  cursor: "grab", width: layer.width * 200, height: layer.width * 200 * layer.aspect,
                  display: "block", outline: activeId === layer.id ? "1px dashed var(--accent)" : "none",
                }}
              />
            )}
            {layer.type === "sticker" && layer.sourceKind === "static" && (
              <div
                onPointerDown={(e) => startMove(e, layer.id)}
                style={{
                  cursor: "grab", fontSize: layer.width * 200, lineHeight: 1, userSelect: "none",
                  outline: activeId === layer.id ? "1px dashed var(--accent)" : "none",
                }}
              >
                {layer.emoji}
              </div>
            )}
            {layer.type === "sticker" && layer.sourceKind === "gif" && (
              // Native <img> for an animated GIF autoplays in every browser
              // with zero extra code — no <video> tag needed for preview,
              // even though export uses the mp4Url (see flatten()).
              <img
                src={layer.gifUrl}
                alt=""
                onPointerDown={(e) => startMove(e, layer.id)}
                draggable={false}
                style={{
                  cursor: "grab", width: layer.width * 200, height: layer.width * 200 * layer.aspect,
                  display: "block", outline: activeId === layer.id ? "1px dashed var(--accent)" : "none",
                }}
              />
            )}
            {renderHandles(layer)}
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap", margin: "10px 0" }}>
        <button type="button" onClick={addTextLayer}>+ Text</button>
        <button type="button" onClick={addMention} disabled={layers.some((l) => l.type === "mention")}>+ Mention</button>
        <button type="button" onClick={() => setStickerPickerOpen((o) => !o)}>+ Sticker/GIF</button>
        {image && (
          <button type="button" onClick={() => fileInputRef.current?.click()}>Change image</button>
        )}
        <button type="button" onClick={undo} disabled={past.length === 0} title="Ctrl+Z">↶ Undo</button>
        <button type="button" onClick={redo} disabled={future.length === 0} title="Ctrl+Shift+Z">↷ Redo</button>
      </div>

      {stickerPickerOpen && (
        <div className="composer-field" style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 10, marginBottom: 10 }}>
          <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
            {[{ id: "stickers", label: "Stickers" }, { id: "gifs", label: "GIFs" }].map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setStickerTab(t.id)}
                aria-pressed={stickerTab === t.id}
                style={{
                  flex: 1, fontWeight: stickerTab === t.id ? 700 : 400,
                  background: stickerTab === t.id ? "var(--accent)" : undefined,
                  color: stickerTab === t.id ? "#fff" : undefined,
                }}
              >
                {t.label}
              </button>
            ))}
          </div>

          {stickerTab === "stickers" && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 4 }}>
              {STICKER_PACK.map((emoji, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => addEmojiSticker(emoji)}
                  title="Add sticker"
                  style={{ fontSize: 22, padding: 4, background: "transparent", border: "1px solid var(--border)", borderRadius: 6 }}
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}

          {stickerTab === "gifs" && (
            <>
              <input
                type="text"
                placeholder="Search GIFs…"
                value={gifQuery}
                onChange={(e) => setGifQuery(e.target.value)}
                style={{ width: "100%", marginBottom: 8 }}
              />
              {!gifConfigured ? (
                <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>
                  GIF search isn't set up yet — add a Giphy API key on the backend to enable this tab.
                </p>
              ) : gifLoading ? (
                <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>Loading…</p>
              ) : gifResults.length === 0 ? (
                <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>
                  {gifQuery.trim() ? "No GIFs found." : "No trending GIFs right now."}
                </p>
              ) : (
                <div
                  style={{
                    display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6,
                    maxHeight: 220, overflowY: "auto",
                  }}
                >
                  {gifResults.map((gif) => (
                    <button
                      key={gif.id}
                      type="button"
                      onClick={() => addGifSticker(gif)}
                      title={gif.title || "Add GIF"}
                      style={{
                        padding: 0, border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden",
                        background: "transparent", aspectRatio: "1 / 1", display: "block",
                      }}
                    >
                      <img
                        src={gif.previewUrl}
                        alt=""
                        style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "center", display: "block" }}
                      />
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {activeLayer && (
        <div className="composer-field" style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 10 }}>
          {activeLayer.type === "text" && (
            <>
              <label htmlFor="story-text-input">Text</label>
              <input
                id="story-text-input"
                type="text"
                value={activeLayer.text}
                onFocus={commitHistory}
                onChange={(e) => updateLayer(activeLayer.id, { text: e.target.value })}
              />

              <div style={{ position: "relative", marginTop: 8 }}>
                <button
                  type="button"
                  onClick={() => setFontPickerOpen((o) => !o)}
                  style={{
                    width: "100%", textAlign: "left", display: "flex", justifyContent: "space-between", alignItems: "center",
                    fontFamily: fontOptionFor(activeLayer.fontFamily).css, fontSize: 14,
                  }}
                >
                  <span>{fontOptionFor(activeLayer.fontFamily).label}</span>
                  <span aria-hidden="true">{fontPickerOpen ? "▲" : "▼"}</span>
                </button>
                {fontPickerOpen && (
                  <div
                    style={{
                      position: "absolute", top: "100%", left: 0, right: 0, zIndex: 20, marginTop: 4,
                      maxHeight: 220, overflowY: "auto", background: "var(--paper-raised)",
                      border: "1px solid var(--border-strong)", borderRadius: 8, boxShadow: "0 4px 16px rgba(0,0,0,0.15)",
                    }}
                  >
                    {FONT_OPTIONS.map((f) => (
                      <div
                        key={f.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => { setFontFamily(activeLayer.id, f.id); setFontPickerOpen(false); }}
                        style={{
                          padding: "8px 12px", cursor: "pointer", fontFamily: f.css, fontSize: 16,
                          background: activeLayer.fontFamily === f.id ? "var(--accent)" : "transparent",
                          color: activeLayer.fontFamily === f.id ? "#fff" : "inherit",
                        }}
                      >
                        {f.label}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <p style={{ fontSize: 10, color: "var(--text-muted)", margin: "4px 0 0" }}>
                If every font above still looks identical, your browser or network is blocking the
                Google Fonts stylesheet this component loads — check the browser console/network
                tab for a request to fonts.googleapis.com and whether it failed.
              </p>

              <div style={{ display: "flex", gap: 4, marginTop: 8, alignItems: "center" }}>
                {["left", "center", "right"].map((a) => (
                  <button
                    key={a}
                    type="button"
                    onClick={() => setAlign(activeLayer.id, a)}
                    aria-pressed={(activeLayer.align || "center") === a}
                    title={`Align ${a}`}
                    style={{
                      flex: 1, fontWeight: (activeLayer.align || "center") === a ? 700 : 400,
                      background: (activeLayer.align || "center") === a ? "var(--accent)" : undefined,
                      color: (activeLayer.align || "center") === a ? "#fff" : undefined,
                    }}
                  >
                    {a === "left" ? "⟸" : a === "right" ? "⟹" : "⇔"}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => { commitHistory(); updateLayer(activeLayer.id, { bold: !(activeLayer.bold ?? true) }); }}
                  aria-pressed={activeLayer.bold ?? true}
                  title="Bold"
                  style={{
                    flex: 1, marginLeft: 8, fontWeight: 700,
                    background: (activeLayer.bold ?? true) ? "var(--accent)" : undefined,
                    color: (activeLayer.bold ?? true) ? "#fff" : undefined,
                  }}
                >
                  B
                </button>
                <button
                  type="button"
                  onClick={() => { commitHistory(); updateLayer(activeLayer.id, { italic: !activeLayer.italic }); }}
                  aria-pressed={!!activeLayer.italic}
                  title="Italic"
                  style={{
                    flex: 1, fontStyle: "italic",
                    background: activeLayer.italic ? "var(--accent)" : undefined,
                    color: activeLayer.italic ? "#fff" : undefined,
                  }}
                >
                  I
                </button>
              </div>

              <div>
                <label style={{ fontSize: 11, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Effect</label>
                <div style={{ position: "relative" }}>
                  <button
                    type="button"
                    onClick={() => setEffectPickerOpen((o) => !o)}
                    style={{ width: "100%", textAlign: "left", display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 14 }}
                  >
                    <span>{(EFFECT_OPTIONS.find((f) => f.id === (activeLayer.effect || "none")) || EFFECT_OPTIONS[0]).label}</span>
                    <span aria-hidden="true">{effectPickerOpen ? "▲" : "▼"}</span>
                  </button>
                  {effectPickerOpen && (
                    <div
                      style={{
                        position: "absolute", top: "100%", left: 0, right: 0, zIndex: 20, marginTop: 4,
                        maxHeight: 220, overflowY: "auto", background: "var(--paper-raised)",
                        border: "1px solid var(--border-strong)", borderRadius: 8, boxShadow: "0 4px 16px rgba(0,0,0,0.15)",
                      }}
                    >
                      {EFFECT_OPTIONS.map((f) => (
                        <div
                          key={f.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => {
                            commitHistory();
                            updateLayer(activeLayer.id, { effect: f.id });
                            setEffectPickerOpen(false);
                          }}
                          style={{
                            padding: "8px 12px", cursor: "pointer", fontSize: 14,
                            background: (activeLayer.effect || "none") === f.id ? "var(--accent)" : "transparent",
                            color: (activeLayer.effect || "none") === f.id ? "#fff" : "inherit",
                          }}
                        >
                          {f.label}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {(activeLayer.effect === "outline" || activeLayer.effect === "glow" || activeLayer.effect === "shadow") && (
                <div style={{ marginTop: 8 }}>
                  <label style={{ fontSize: 11, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>
                    {activeLayer.effect === "glow" ? "Glow color" : activeLayer.effect === "shadow" ? "Shadow color" : "Outline color"}
                  </label>
                  <ColorSwatches
                    value={activeLayer.effectColor || "#000000"}
                    commit={commitHistory}
                    update={(c) => updateLayer(activeLayer.id, { effectColor: c })}
                  />
                </div>
              )}
              {activeLayer.effect === "gradient" && (
                <div style={{ marginTop: 8 }}>
                  <label style={{ fontSize: 11, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>
                    Gradient end color
                  </label>
                  <ColorSwatches
                    value={activeLayer.gradientTo || "#ffd700"}
                    commit={commitHistory}
                    update={(c) => updateLayer(activeLayer.id, { gradientTo: c })}
                  />
                </div>
              )}

              <div style={{ marginTop: 8 }}>
                <label style={{ fontSize: 11, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>
                  {activeLayer.effect === "gradient" ? "Gradient start color" : "Text color"}
                </label>
                <ColorSwatches
                  value={activeLayer.color}
                  commit={commitHistory}
                  update={(c) => updateLayer(activeLayer.id, { color: c })}
                />
              </div>

            </>
          )}

          {activeLayer.type === "mention" && (
            <>
              <label htmlFor="story-mention-input">Mention (Instagram only)</label>
              <input
                id="story-mention-input"
                type="text"
                placeholder="username"
                value={activeLayer.username}
                onFocus={commitHistory}
                onChange={(e) => updateLayer(activeLayer.id, { username: e.target.value.replace(/^@/, "") })}
              />
            </>
          )}

          {activeLayer.type === "image" && (
            <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)" }}>
              Sticker — drag to move, use the handles to resize or rotate.
            </p>
          )}

          {activeLayer.type === "sticker" && (
            <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)" }}>
              {activeLayer.sourceKind === "gif" ? "GIF" : "Sticker"} — drag to move, use the handles to
              resize or rotate.
              {activeLayer.sourceKind === "gif" && " Note: the posted Story currently freezes this on its first frame — full motion export is still in progress."}
            </p>
          )}
        </div>
      )}

      <p style={{ fontSize: 12, color: "var(--text-muted)", textAlign: "center", margin: "6px 0 0" }}>
        Drag a layer to move it, the ring of dots to resize, the top handle to rotate. Double-tap
        text or a mention to edit it in place. Ctrl+Z to undo, Delete to remove the selected layer.
        Facebook Stories don&apos;t support mentions — this tag only applies when posting to Instagram.
      </p>
    </div>
  );
});

export default StoryComposer;