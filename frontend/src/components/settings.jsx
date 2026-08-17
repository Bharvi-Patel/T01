import { useState, useEffect } from "react";
import { connectFinto, getAuthorizeUrl, getPendingPages, selectPage } from "../api";

export default function Settings({ token, onDone, pagePicker, onPagePickerDone }) {
  const [fintoEmail, setFintoEmail] = useState("");
  const [fintoPassword, setFintoPassword] = useState("");
  const [fintoStatus, setFintoStatus] = useState("");
  const [fintoLoading, setFintoLoading] = useState(false);

  const [pages, setPages] = useState(null);
  const [pageSelectLoading, setPageSelectLoading] = useState(false);
  const [pageSelectError, setPageSelectError] = useState("");

  useEffect(() => {
    if (!pagePicker) { setPages(null); return; }
    getPendingPages({ token, platform: pagePicker.platform, pendingId: pagePicker.pendingId })
      .then((res) => setPages(res.pages))
      .catch((err) => setPageSelectError(err.message || "Could not load pages."));
  }, [pagePicker, token]);

  async function handleSelectPage(pageId) {
    setPageSelectLoading(true);
    setPageSelectError("");
    try {
      await selectPage({ token, platform: pagePicker.platform, pendingId: pagePicker.pendingId, pageId });
      onPagePickerDone();
    } catch (err) {
      setPageSelectError(err.message || "Failed to connect that page.");
    } finally {
      setPageSelectLoading(false);
    }
  }

  if (pagePicker) {
    return (
      <div style={{ background: "var(--surface-2)", borderRadius: 12, border: "0.5px solid var(--border)", padding: "1.5rem" }}>
        <p style={{ fontWeight: 500, fontSize: 15, margin: "0 0 4px" }}>Choose a Page</p>
        <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 1rem" }}>
          This account manages more than one Facebook Page{pagePicker.platform === "instagram" ? " — pick the one whose linked Instagram account you want" : ""}.
        </p>
        {pageSelectError && <p style={{ fontSize: 13, color: "var(--danger)", background: "var(--danger-bg)", borderRadius: "var(--radius)", padding: "8px 12px", margin: "0 0 1rem" }}>{pageSelectError}</p>}
        {pages === null ? (
          <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>Loading pages…</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {pages.map((p) => (
              <button key={p.id} className="primary" style={{ width: "100%" }} disabled={pageSelectLoading} onClick={() => handleSelectPage(p.id)}>
                {p.name}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  async function handleFintoSubmit(e) {
    e.preventDefault();
    setFintoLoading(true);
    setFintoStatus("");
    try {
      await connectFinto({ token, email: fintoEmail, password: fintoPassword });
      setFintoStatus("Connected.");
    } catch (err) {
      setFintoStatus(err.message || "Failed to connect finto.day.");
    } finally {
      setFintoLoading(false);
    }
  }

  async function handleOAuthConnect(platform) {
    const { authorize_url } = await getAuthorizeUrl({ token, platform });
    window.location.href = authorize_url;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      <div style={{ background: "var(--surface-2)", borderRadius: 12, border: "0.5px solid var(--border)", padding: "1.5rem" }}>
        <p style={{ fontWeight: 500, fontSize: 15, margin: "0 0 1rem" }}>Connect finto.day</p>
        <form onSubmit={handleFintoSubmit}>
          <div style={{ marginBottom: "1rem" }}>
            <label htmlFor="finto-email">Email</label>
            <input id="finto-email" type="email" value={fintoEmail} onChange={(e) => setFintoEmail(e.target.value)} required />
          </div>
          <div style={{ marginBottom: "1rem" }}>
            <label htmlFor="finto-password">Password</label>
            <input id="finto-password" type="password" value={fintoPassword} onChange={(e) => setFintoPassword(e.target.value)} required />
          </div>
          {fintoStatus && <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: "0 0 1rem" }}>{fintoStatus}</p>}
          <button type="submit" className="primary" style={{ width: "100%" }} disabled={fintoLoading}>
            {fintoLoading ? "Connecting…" : "Connect"}
          </button>
        </form>
      </div>

      {["linkedin", "facebook", "instagram", "threads"].map((platform) => (
        <div key={platform} style={{ background: "var(--surface-2)", borderRadius: 12, border: "0.5px solid var(--border)", padding: "1.5rem" }}>
          <p style={{ fontWeight: 500, fontSize: 15, margin: "0 0 1rem", textTransform: "capitalize" }}>Connect {platform}</p>
          <button className="primary" style={{ width: "100%" }} onClick={() => handleOAuthConnect(platform)}>
            Connect via {platform}
          </button>
        </div>
      ))}

      {onDone && (
        <button style={{ width: "100%" }} onClick={onDone}>
          Back
        </button>
      )}
    </div>
  );
}