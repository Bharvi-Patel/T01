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

// image: File | null, onImageChange: (File|null) => void — base image lives
// in the parent (Form) since it also gates whether submit is allowed.
// Everything else (text layers, the mention marker) is local to the
// composer and only leaves it through the imperative flatten()/getUserTags()
// handle below, called by Form on submit.
const StoryComposer = forwardRef(function StoryComposer({ image, onImageChange }, ref) {
  const [textLayers, setTextLayers] = useState([]); // { id, text, x, y, fontSize, color }
  const [mention, setMention] = useState(null); // { username, x, y } | null — Instagram only
  const [activeId, setActiveId] = useState(null); // layer id | "mention" | null

  const boxRef = useRef(null);
  const fileInputRef = useRef(null);
  const dragState = useRef(null);

  useImperativeHandle(ref, () => ({
    // Renders the base image + every layer onto an offscreen canvas and
    // exports one flattened JPEG — this is what actually gets uploaded,
    // since neither platform's Story API accepts separate text/sticker
    // layers.
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

      textLayers.forEach((layer) => {
        const px = layer.x * OUT_W;
        const py = layer.y * OUT_H;
        const fontPx = layer.fontSize * OUT_W;
        ctx.font = `700 ${fontPx}px -apple-system, Helvetica, Arial, sans-serif`;
        ctx.fillStyle = layer.color;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.shadowColor = "rgba(0,0,0,0.45)";
        ctx.shadowBlur = fontPx * 0.15;
        ctx.fillText(layer.text || "", px, py);
        ctx.shadowBlur = 0;
      });

      if (mention?.username.trim()) {
        const px = mention.x * OUT_W;
        const py = mention.y * OUT_H;
        const fontPx = 0.032 * OUT_W;
        ctx.font = `600 ${fontPx}px -apple-system, Helvetica, Arial, sans-serif`;
        const label = `@${mention.username.trim()}`;
        const metrics = ctx.measureText(label);
        const padX = fontPx * 0.7;
        const padY = fontPx * 0.5;
        const boxW = metrics.width + padX * 2;
        const boxH = fontPx + padY * 2;
        ctx.fillStyle = "rgba(0,0,0,0.55)";
        roundRect(ctx, px - boxW / 2, py - boxH / 2, boxW, boxH, boxH / 2);
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(label, px, py);
      }

      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
      return blob ? new File([blob], "story.jpg", { type: "image/jpeg" }) : null;
    },
    // Matches the user_tags shape the Instagram Graph API expects on a
    // Story media container: [{ username, x, y }], x/y as 0-1 fractions.
    // Empty when there's no mention or it was left blank.
    getUserTags() {
      if (!mention?.username.trim()) return [];
      return [{ username: mention.username.trim(), x: Number(mention.x.toFixed(3)), y: Number(mention.y.toFixed(3)) }];
    },
  }), [image, textLayers, mention]);

  function addTextLayer() {
    const id = nextLayerId();
    setTextLayers((prev) => [...prev, { id, text: "Tap to edit", x: 0.5, y: 0.5, fontSize: 0.07, color: "#ffffff" }]);
    setActiveId(id);
  }

  function addMention() {
    if (mention) return;
    setMention({ username: "", x: 0.5, y: 0.85 });
    setActiveId("mention");
  }

  function updateActiveText(patch) {
    setTextLayers((prev) => prev.map((l) => (l.id === activeId ? { ...l, ...patch } : l)));
  }

  function removeActiveText() {
    setTextLayers((prev) => prev.filter((l) => l.id !== activeId));
    setActiveId(null);
  }

  function removeMention() {
    setMention(null);
    setActiveId(null);
  }

  function onDrag(e) {
    const d = dragState.current;
    if (!d) return;
    let x = (e.clientX - d.rectX) / d.rectW;
    let y = (e.clientY - d.rectY) / d.rectH;
    x = Math.min(1, Math.max(0, x));
    y = Math.min(1, Math.max(0, y));
    if (d.kind === "mention") {
      setMention((prev) => (prev ? { ...prev, x, y } : prev));
    } else {
      setTextLayers((prev) => prev.map((l) => (l.id === d.id ? { ...l, x, y } : l)));
    }
  }

  function endDrag() {
    dragState.current = null;
    window.removeEventListener("pointermove", onDrag);
    window.removeEventListener("pointerup", endDrag);
  }

  function startDrag(e, id, kind) {
    e.stopPropagation();
    const rect = boxRef.current.getBoundingClientRect();
    dragState.current = { id, kind, rectW: rect.width, rectH: rect.height, rectX: rect.left, rectY: rect.top };
    setActiveId(kind === "mention" ? "mention" : id);
    window.addEventListener("pointermove", onDrag);
    window.addEventListener("pointerup", endDrag);
  }

  // Safety net if the component unmounts mid-drag (e.g. switching modes)
  useEffect(() => () => {
    window.removeEventListener("pointermove", onDrag);
    window.removeEventListener("pointerup", endDrag);
  }, []);

  const activeText = textLayers.find((l) => l.id === activeId);

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

        {textLayers.map((layer) => (
          <div
            key={layer.id}
            onPointerDown={(e) => startDrag(e, layer.id, "text")}
            onClick={(e) => { e.stopPropagation(); setActiveId(layer.id); }}
            style={{
              position: "absolute", left: `${layer.x * 100}%`, top: `${layer.y * 100}%`,
              transform: "translate(-50%, -50%)", cursor: "grab", fontWeight: 700,
              color: layer.color, fontSize: layer.fontSize * 200, textAlign: "center",
              textShadow: "0 1px 4px rgba(0,0,0,0.5)", padding: 4, whiteSpace: "nowrap",
              outline: activeId === layer.id ? "1px dashed var(--accent)" : "none",
              maxWidth: "92%", overflow: "hidden", textOverflow: "ellipsis",
            }}
          >
            {layer.text || "Tap to edit"}
          </div>
        ))}

        {mention && (
          <div
            onPointerDown={(e) => startDrag(e, "mention", "mention")}
            onClick={(e) => { e.stopPropagation(); setActiveId("mention"); }}
            style={{
              position: "absolute", left: `${mention.x * 100}%`, top: `${mention.y * 100}%`,
              transform: "translate(-50%, -50%)", cursor: "grab",
              background: "rgba(0,0,0,0.55)", color: "#fff", borderRadius: 999,
              padding: "4px 10px", fontSize: 11, fontWeight: 600, whiteSpace: "nowrap",
              outline: activeId === "mention" ? "1px dashed var(--accent)" : "none",
            }}
          >
            @{mention.username || "username"}
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap", margin: "10px 0" }}>
        <button type="button" onClick={addTextLayer}>+ Text</button>
        <button type="button" onClick={addMention} disabled={!!mention}>+ Mention</button>
        {image && (
          <button type="button" onClick={() => fileInputRef.current?.click()}>Change image</button>
        )}
      </div>

      {activeText && (
        <div className="composer-field" style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 10 }}>
          <label htmlFor="story-text-input">Text</label>
          <input
            id="story-text-input"
            type="text"
            value={activeText.text}
            onChange={(e) => updateActiveText({ text: e.target.value })}
          />
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
            <label style={{ fontSize: 11, color: "var(--text-muted)" }}>Size</label>
            <input
              type="range" min="0.03" max="0.14" step="0.005"
              value={activeText.fontSize}
              onChange={(e) => updateActiveText({ fontSize: Number(e.target.value) })}
            />
            <input
              type="color" value={activeText.color}
              onChange={(e) => updateActiveText({ color: e.target.value })}
              style={{ width: 28, height: 28, padding: 0, border: "none", background: "none" }}
            />
            <button type="button" onClick={removeActiveText} style={{ marginLeft: "auto" }}>Remove</button>
          </div>
        </div>
      )}

      {mention && activeId === "mention" && (
        <div className="composer-field" style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 10 }}>
          <label htmlFor="story-mention-input">Mention (Instagram only)</label>
          <input
            id="story-mention-input"
            type="text"
            placeholder="username"
            value={mention.username}
            onChange={(e) => setMention((prev) => ({ ...prev, username: e.target.value.replace(/^@/, "") }))}
          />
          <button type="button" onClick={removeMention} style={{ marginTop: 8 }}>Remove mention</button>
        </div>
      )}

      <p style={{ fontSize: 12, color: "var(--text-muted)", textAlign: "center", margin: "6px 0 0" }}>
        Drag text or the mention pin to reposition. Facebook Stories don&apos;t support mentions — this tag only applies when posting to Instagram.
      </p>
    </div>
  );
});

export default StoryComposer;