export default function Done({ result, onRestart }) {
  const entries = Object.entries(result || {});
  const anySuccess = entries.some(([, r]) => r?.success);

  return (
    <div style={{ background: "#0E3841", borderRadius: 12, border: "0.5px solid #163C44", padding: "1.5rem" }}>
      <p style={{ fontWeight: 500, fontSize: 15, margin: "0 0 12px", color: "#EDF3DC" }}>
        {anySuccess ? "Published" : "Publish failed"}
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: "1rem" }}>
        {entries.map(([platform, r]) => (
          <div key={platform} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#EDF3DC" }}>
              <span style={{ textTransform: "capitalize", color: "#fff" }}>{platform}</span>
              {r?.success
                ? (r.url ? <a href={r.url} target="_blank" rel="noreferrer" style={{ color: "#6FA39A" }}>View</a> : <span style={{ color: "#8FA9A5" }}>Published</span>)
                : <span style={{ color: "#E88A8A" }}>{r?.error || "Failed"}</span>}
            </div>
            {Array.isArray(r?.skipped_images) && r.skipped_images.length > 0 && (
              <p style={{ fontSize: 12, color: "#5C7A78", margin: 0 }}>
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