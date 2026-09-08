import { useState, useRef, useEffect, forwardRef, useImperativeHandle } from "react";

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

// CSS approximation of each effect for the live preview. The canvas export
// (see flatten()) implements the same five effects properly with stroke/
// shadow/gradient drawing so the exported JPEG matches this, but a couple
// of these (text-stroke, background-clip:text) rely on browser support
// that's universal in practice but not literally guaranteed by spec.
function textEffectStyle(layer) {
  const effect = layer.effect || "none";
  if (effect === "outline") {
    return { WebkitTextStroke: `${Math.max(1, layer.fontSize * 40)}px ${layer.effectColor || "#000000"}`, color: layer.color, textShadow: "none" };
  }
  if (effect === "glow") {
    const c = layer.effectColor || layer.color;
    return { color: layer.color, textShadow: `0 0 8px ${c}, 0 0 18px ${c}` };
  }
  if (effect === "gradient") {
    return {
      backgroundImage: `linear-gradient(90deg, ${layer.color}, ${layer.gradientTo || "#ffffff"})`,
      WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent", textShadow: "none",
    };
  }
  if (effect === "shadow") {
    const off = Math.max(1, layer.fontSize * 30);
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
const StoryComposer = forwardRef(function StoryComposer({ image, onImageChange }, ref) {
  const [layers, setLayers] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [fontPickerOpen, setFontPickerOpen] = useState(false);

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
  const stickerInputRef = useRef(null);
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

  function undo() {
    setPast((p) => {
      if (p.length === 0) return p;
      const prevState = p[p.length - 1];
      setFuture((f) => [layersRef.current, ...f]);
      setLayers(prevState);
      setActiveId(null);
      return p.slice(0, -1);
    });
  }

  function redo() {
    setFuture((f) => {
      if (f.length === 0) return f;
      const nextState = f[0];
      setPast((p) => [...p, layersRef.current]);
      setLayers(nextState);
      setActiveId(null);
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
          const displayText = layer.uppercase ? (layer.text || "").toUpperCase() : (layer.text || "");
          ctx.save();
          ctx.translate(px, py);
          ctx.rotate(rad);
          ctx.font = `700 ${fontPx}px ${fontOpt.css}`;
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
            ctx.lineWidth = fontPx * 0.09;
            ctx.strokeText(displayText, 0, 0);
            ctx.shadowColor = "transparent";
            ctx.fillStyle = layer.color;
            ctx.fillText(displayText, 0, 0);
          } else if (effect === "glow") {
            ctx.shadowColor = layer.effectColor || layer.color;
            ctx.shadowBlur = fontPx * 0.6;
            ctx.fillStyle = layer.color;
            ctx.fillText(displayText, 0, 0);
            ctx.fillText(displayText, 0, 0); // second pass — a single-pass canvas glow reads faint
          } else if (effect === "shadow") {
            const offset = fontPx * 0.06;
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
      { id, type: "text", text: "Tap to edit", x: 0.5, y: 0.5, rotation: 0, fontSize: 0.07, color: "#ffffff", fontFamily: "classic", align: "center", effect: "none", effectColor: "#000000", gradientTo: "#ffd700", uppercase: false },
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

  // Adds an uploaded image as a sticker/prop layer. Reads its natural
  // dimensions so resizing later preserves aspect ratio — this is the
  // same slot a future curated prop library would populate, just with
  // file always coming from the user's own upload for now.
  async function addStickerFile(file) {
    if (!file) return;
    const img = await loadImageFromFile(file);
    commitHistory();
    const id = nextLayerId();
    const aspect = img.naturalHeight / img.naturalWidth;
    setLayers((prev) => [
      ...prev,
      { id, type: "image", file, previewUrl: img.src, x: 0.5, y: 0.5, rotation: 0, width: 0.3, aspect },
    ]);
    setActiveId(id);
  }

  function updateLayer(id, patch) {
    setLayers((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }

  function removeLayer(id) {
    commitHistory();
    setLayers((prev) => prev.filter((l) => l.id !== id));
    setActiveId(null);
  }

  // Moves a layer one step toward the top (end) of the stacking order.
  function bringForward(id) {
    commitHistory();
    setLayers((prev) => {
      const i = prev.findIndex((l) => l.id === id);
      if (i < 0 || i === prev.length - 1) return prev;
      const next = [...prev];
      [next[i], next[i + 1]] = [next[i + 1], next[i]];
      return next;
    });
  }

  // Moves a layer one step toward the bottom (start) of the stacking order.
  function sendBackward(id) {
    commitHistory();
    setLayers((prev) => {
      const i = prev.findIndex((l) => l.id === id);
      if (i <= 0) return prev;
      const next = [...prev];
      [next[i], next[i - 1]] = [next[i - 1], next[i]];
      return next;
    });
  }

  function resetRotation(id) {
    commitHistory();
    updateLayer(id, { rotation: 0 });
  }

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
      } else if (layer.type === "image") {
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
      const inField = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
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
  const activeIndex = layers.findIndex((l) => l.id === activeId);

  useEffect(() => { setFontPickerOpen(false); }, [activeId]);

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
            border: "2px solid #fff", cursor: "grab", boxShadow: "0 1px 3px rgba(0,0,0,0.4)",
          }}
        />
        <div
          onPointerDown={(e) => startResize(e, layer)}
          title="Drag to resize"
          style={{
            position: "absolute", bottom: -10, right: -10,
            width: 14, height: 14, borderRadius: "50%", background: "var(--accent)",
            border: "2px solid #fff", cursor: "nwse-resize", boxShadow: "0 1px 3px rgba(0,0,0,0.4)",
          }}
        />
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
        <input
          ref={stickerInputRef}
          type="file"
          accept="image/*"
          onChange={(e) => { addStickerFile(e.target.files?.[0] || null); e.target.value = ""; }}
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
              <div
                onPointerDown={(e) => startMove(e, layer.id)}
                style={{
                  cursor: "grab", fontWeight: 700, fontSize: layer.fontSize * 200,
                  fontFamily: fontOptionFor(layer.fontFamily).css,
                  textAlign: layer.align || "center", padding: 4, whiteSpace: "nowrap",
                  textTransform: layer.uppercase ? "uppercase" : "none",
                  ...textEffectStyle(layer),
                  outline: activeId === layer.id ? "1px dashed var(--accent)" : "none",
                  maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis",
                }}
              >
                {layer.text || "Tap to edit"}
              </div>
            )}
            {layer.type === "mention" && (
              <div
                onPointerDown={(e) => startMove(e, layer.id)}
                style={{
                  cursor: "grab", background: "rgba(0,0,0,0.55)", color: "#fff", borderRadius: 999,
                  padding: "4px 10px", fontSize: 11 * (layer.scale || 1), fontWeight: 600, whiteSpace: "nowrap",
                  outline: activeId === layer.id ? "1px dashed var(--accent)" : "none",
                }}
              >
                @{layer.username || "username"}
              </div>
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
            {renderHandles(layer)}
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap", margin: "10px 0" }}>
        <button type="button" onClick={addTextLayer}>+ Text</button>
        <button type="button" onClick={addMention} disabled={layers.some((l) => l.type === "mention")}>+ Mention</button>
        <button type="button" onClick={() => stickerInputRef.current?.click()}>+ Sticker</button>
        {image && (
          <button type="button" onClick={() => fileInputRef.current?.click()}>Change image</button>
        )}
        <button type="button" onClick={undo} disabled={past.length === 0} title="Ctrl+Z">↶ Undo</button>
        <button type="button" onClick={redo} disabled={future.length === 0} title="Ctrl+Shift+Z">↷ Redo</button>
      </div>

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
                <label style={{ fontSize: 11, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 4, marginLeft: 8, whiteSpace: "nowrap" }}>
                  <input
                    type="checkbox"
                    checked={!!activeLayer.uppercase}
                    onChange={(e) => { commitHistory(); updateLayer(activeLayer.id, { uppercase: e.target.checked }); }}
                  />
                  CAPS
                </label>
              </div>

              <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
                <label htmlFor="story-effect-select" style={{ fontSize: 11, color: "var(--text-muted)" }}>Effect</label>
                <select
                  id="story-effect-select"
                  value={activeLayer.effect || "none"}
                  onChange={(e) => { commitHistory(); updateLayer(activeLayer.id, { effect: e.target.value }); }}
                >
                  {EFFECT_OPTIONS.map((f) => (
                    <option key={f.id} value={f.id}>{f.label}</option>
                  ))}
                </select>

                {(activeLayer.effect === "outline" || activeLayer.effect === "glow" || activeLayer.effect === "shadow") && (
                  <ColorSwatches
                    value={activeLayer.effectColor || "#000000"}
                    title={activeLayer.effect === "glow" ? "Glow color" : activeLayer.effect === "shadow" ? "Shadow color" : "Outline color"}
                    commit={commitHistory}
                    update={(c) => updateLayer(activeLayer.id, { effectColor: c })}
                  />
                )}
                {activeLayer.effect === "gradient" && (
                  <ColorSwatches
                    value={activeLayer.gradientTo || "#ffd700"}
                    title="Gradient second color"
                    commit={commitHistory}
                    update={(c) => updateLayer(activeLayer.id, { gradientTo: c })}
                  />
                )}
              </div>

              <div style={{ marginTop: 8 }}>
                <label style={{ fontSize: 11, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>
                  Text color{activeLayer.effect === "gradient" ? " (gradient start)" : ""}
                </label>
                <ColorSwatches
                  value={activeLayer.color}
                  commit={commitHistory}
                  update={(c) => updateLayer(activeLayer.id, { color: c })}
                />
              </div>

              <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
                <label style={{ fontSize: 11, color: "var(--text-muted)" }}>Size</label>
                <input
                  type="range" min="0.03" max="0.14" step="0.005"
                  value={activeLayer.fontSize}
                  onFocus={commitHistory}
                  onChange={(e) => updateLayer(activeLayer.id, { fontSize: Number(e.target.value) })}
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

          <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
            <button type="button" onClick={() => bringForward(activeLayer.id)} disabled={activeIndex === layers.length - 1}>
              Bring forward
            </button>
            <button type="button" onClick={() => sendBackward(activeLayer.id)} disabled={activeIndex === 0}>
              Send backward
            </button>
            <button type="button" onClick={() => resetRotation(activeLayer.id)}>Reset rotation</button>
            <button type="button" onClick={() => removeLayer(activeLayer.id)} style={{ marginLeft: "auto" }}>Remove</button>
          </div>
        </div>
      )}

      <p style={{ fontSize: 12, color: "var(--text-muted)", textAlign: "center", margin: "6px 0 0" }}>
        Drag a layer to move it, the top handle to rotate, the corner handle to resize.
        Ctrl+Z to undo, Delete to remove the selected layer. Facebook Stories don&apos;t support
        mentions — this tag only applies when posting to Instagram.
      </p>
    </div>
  );
});

export default StoryComposer;