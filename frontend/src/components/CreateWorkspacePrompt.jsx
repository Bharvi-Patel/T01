// CreateWorkspacePrompt.jsx — shown once, right after signup/login, when
// the caller doesn't have a workspace yet (GET /workspace came back 404
// "no_workspace" - see App.jsx). Workspaces are never auto-generated
// server-side any more; this screen is the only way a brand new account
// gets its first one, same real estate as ChooseUsernameModal.
import { useState } from "react";
import { createWorkspace } from "../api";

export default function CreateWorkspacePrompt({ token }) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    const value = name.trim();
    if (!value) return;
    setSaving(true);
    setError("");
    try {
      await createWorkspace({ token, name: value });
      // Every other piece of workspace-scoped state in the app (drafts,
      // members, connections, calendar...) is fetched independently and
      // has no reason to refire just because a workspace now exists - a
      // full reload is the simplest way to have everything pick it up
      // at once, same approach TopBar's own create/switch use.
      window.location.reload();
    } catch (err) {
      setError(err.message || "Could not create that workspace.");
      setSaving(false);
    }
  }

  return (
    <div style={{ width: "100%", maxWidth: 380 }}>
      <h1 className="masthead">Name your workspace</h1>
      <hr className="masthead-rule" />
      <form
        onSubmit={handleSubmit}
        style={{ background: "var(--paper-raised)", borderRadius: "var(--radius)", border: "1px solid var(--border)", padding: "1.5rem" }}
      >
        <p style={{ margin: "0 0 1rem" }}>
          Create a workspace to get started. You can invite teammates and create more workspaces later.
        </p>
        <div style={{ marginBottom: 8 }}>
          <label htmlFor="ws-title">Workspace name</label>
          <input
            id="ws-title"
            type="text"
            autoFocus
            autoComplete="off"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            required
          />
        </div>
        {error && (
          <p style={{ fontSize: 13, color: "var(--danger)", background: "var(--danger-bg)", borderRadius: "var(--radius)", padding: "8px 12px", margin: "0 0 1rem" }}>
            {error}
          </p>
        )}
        <button type="submit" className="primary" style={{ width: "100%" }} disabled={saving || !name.trim()}>
          {saving ? "Creating…" : "Create workspace"}
        </button>
      </form>
    </div>
  );
}