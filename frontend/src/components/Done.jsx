export default function Done({ result, onRestart }) {
  const entries = Object.entries(result || {});
  const anySuccess = entries.some(([, r]) => r?.success);

  return (
    <div style={{ background: "#16222A", borderRadius: 12, border: "0.5px solid #22303A", padding: "1.5rem" }}>
      <p style={{ fontWeight: 500, fontSize: 15, margin: "0 0 12px", color: "#ECEFEA" }}>
        {anySuccess ? "Published" : "Publish failed"}
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: "1rem" }}>
        {entries.map(([platform, r]) => (
          <div key={platform} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#ECEFEA" }}>
              <span style={{ textTransform: "capitalize", color: "var(--ink)" }}>{platform}</span>
              {r?.success
                ? (r.url ? <a href={r.url} target="_blank" rel="noreferrer" style={{ color: "#7FA687" }}>View</a> : <span style={{ color: "#9BA79E" }}>Published</span>)
                : <span style={{ color: "#E88A8A" }}>{r?.error || "Failed"}</span>}
            </div>
            {Array.isArray(r?.skipped_images) && r.skipped_images.length > 0 && (
              <p style={{ fontSize: 12, color: "#66716C", margin: 0 }}>
                {r.skipped_images.length} image{r.skipped_images.length > 1 ? "s" : ""} skipped —{" "}
                {r.skipped_images.map((img) => img.error).join("; ")}
              </p>
            )}
          </div>
        ))}
      </div>
      <button className="primary" style={{ width: "100%" }} onClick={onRestart}>Generate another post</button>
    </div>
  );
}