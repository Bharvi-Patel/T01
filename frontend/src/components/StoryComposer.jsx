import { useState, useRef, useEffect, forwardRef, useImperativeHandle } from "react";

// Standard Instagram/Facebook Story canvas size — the flatten() export
// always renders at this resolution regardless of the on-screen preview
// box size, since every layer's x/y/fontSize is stored as a 0-1 fraction
// of the box rather than raw pixels.
const OUT_W = 1080;
const OUT_H = 1920;

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

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Every draggable thing on the canvas — text, the mention pin, and (later)
// stickers/props/uploaded images — lives in one ordered `layers` array.
// Array order IS stacking order: index 0 paints first (bottom), the last
// entry paints last (top). This one shared shape is deliberate: it's the
// seam future layer types (e.g. type: "image" for a sticker/prop library)
// slot into without touching the resize/rotate/reorder machinery below.
//
// Common fields on every layer: id, type, x, y (0-1 fractions, center-
// anchored), rotation (degrees).
// type: "text"    adds: text, fontSize (0-1 fraction of box width), color
// type: "mention" adds: username, scale (multiplier, default 1)
const StoryComposer = forwardRef(function StoryComposer({ image, onImageChange }, ref) {
  const [layers, setLayers] = useState([]);
  const [activeId, setActiveId] = useState(null);

  const boxRef = useRef(null);
  const fileInputRef = useRef(null);
  const dragState = useRef(null); // { kind: "move"|"resize"|"rotate", id, ... }

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

      layers.forEach((layer) => {
        const px = layer.x * OUT_W;
        const py = layer.y * OUT_H;
        const rad = ((layer.rotation || 0) * Math.PI) / 180;

        if (layer.type === "text") {
          const fontPx = layer.fontSize * OUT_W;
          ctx.save();
          ctx.translate(px, py);
          ctx.rotate(rad);
          ctx.font = `700 ${fontPx}px -apple-system, Helvetica, Arial, sans-serif`;
          ctx.fillStyle = layer.color;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.shadowColor = "rgba(0,0,0,0.45)";
          ctx.shadowBlur = fontPx * 0.15;
          ctx.fillText(layer.text || "", 0, 0);
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
        }
      });

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
    const id = nextLayerId();
    setLayers((prev) => [
      ...prev,
      { id, type: "text", text: "Tap to edit", x: 0.5, y: 0.5, rotation: 0, fontSize: 0.07, color: "#ffffff" },
    ]);
    setActiveId(id);
  }

  function addMention() {
    if (layers.some((l) => l.type === "mention")) return;
    const id = nextLayerId();
    setLayers((prev) => [...prev, { id, type: "mention", username: "", x: 0.5, y: 0.85, rotation: 0, scale: 1 }]);
    setActiveId(id);
  }

  function updateLayer(id, patch) {
    setLayers((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }

  function removeLayer(id) {
    setLayers((prev) => prev.filter((l) => l.id !== id));
    setActiveId(null);
  }

  // Moves a layer one step toward the top (end) of the stacking order.
  function bringForward(id) {
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
    setLayers((prev) => {
      const i = prev.findIndex((l) => l.id === id);
      if (i <= 0) return prev;
      const next = [...prev];
      [next[i], next[i - 1]] = [next[i - 1], next[i]];
      return next;
    });
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

  function startMove(e, id) {
    e.stopPropagation();
    const rect = boxRef.current.getBoundingClientRect();
    dragState.current = { kind: "move", id, rectW: rect.width, rectH: rect.height, rectX: rect.left, rectY: rect.top };
    setActiveId(id);
    window.addEventListener("pointermove", onDrag);
    window.addEventListener("pointerup", endDrag);
  }

  function startResize(e, layer) {
    e.stopPropagation();
    const { cx, cy } = boxCenterPx(layer);
    dragState.current = {
      kind: "resize", id: layer.id, cx, cy,
      initialDist: Math.max(1, Math.hypot(e.clientX - cx, e.clientY - cy)),
      initialFontSize: layer.fontSize, initialScale: layer.scale,
    };
    setActiveId(layer.id);
    window.addEventListener("pointermove", onDrag);
    window.addEventListener("pointerup", endDrag);
  }

  function startRotate(e, layer) {
    e.stopPropagation();
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

  const activeLayer = layers.find((l) => l.id === activeId);
  const activeIndex = layers.findIndex((l) => l.id === activeId);

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
              transform: `translate(-50%, -50%) rotate(${layer.rotation || 0}deg)`,
            }}
          >
            {layer.type === "text" && (
              <div
                onPointerDown={(e) => startMove(e, layer.id)}
                style={{
                  cursor: "grab", fontWeight: 700, color: layer.color, fontSize: layer.fontSize * 200,
                  textAlign: "center", textShadow: "0 1px 4px rgba(0,0,0,0.5)", padding: 4, whiteSpace: "nowrap",
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
            {renderHandles(layer)}
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap", margin: "10px 0" }}>
        <button type="button" onClick={addTextLayer}>+ Text</button>
        <button type="button" onClick={addMention} disabled={layers.some((l) => l.type === "mention")}>+ Mention</button>
        {image && (
          <button type="button" onClick={() => fileInputRef.current?.click()}>Change image</button>
        )}
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
                onChange={(e) => updateLayer(activeLayer.id, { text: e.target.value })}
              />
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
                <label style={{ fontSize: 11, color: "var(--text-muted)" }}>Size</label>
                <input
                  type="range" min="0.03" max="0.14" step="0.005"
                  value={activeLayer.fontSize}
                  onChange={(e) => updateLayer(activeLayer.id, { fontSize: Number(e.target.value) })}
                />
                <input
                  type="color" value={activeLayer.color}
                  onChange={(e) => updateLayer(activeLayer.id, { color: e.target.value })}
                  style={{ width: 28, height: 28, padding: 0, border: "none", background: "none" }}
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
                onChange={(e) => updateLayer(activeLayer.id, { username: e.target.value.replace(/^@/, "") })}
              />
            </>
          )}

          <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
            <button type="button" onClick={() => bringForward(activeLayer.id)} disabled={activeIndex === layers.length - 1}>
              Bring forward
            </button>
            <button type="button" onClick={() => sendBackward(activeLayer.id)} disabled={activeIndex === 0}>
              Send backward
            </button>
            <button type="button" onClick={() => updateLayer(activeLayer.id, { rotation: 0 })}>Reset rotation</button>
            <button type="button" onClick={() => removeLayer(activeLayer.id)} style={{ marginLeft: "auto" }}>Remove</button>
          </div>
        </div>
      )}

      <p style={{ fontSize: 12, color: "var(--text-muted)", textAlign: "center", margin: "6px 0 0" }}>
        Drag a layer to move it, the top handle to rotate, the corner handle to resize. Facebook Stories don&apos;t support mentions — this tag only applies when posting to Instagram.
      </p>
    </div>
  );
});

export default StoryComposer;