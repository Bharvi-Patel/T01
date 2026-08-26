// WorkspaceSettingsModal.jsx — opened from the gear icon on the active
// workspace row in TopBar's switcher. Admin-only (the caller can't even
// open this for a workspace they don't own - see the gear's visibility
// check in TopBar). Reuses the same profile-modal-* CSS as
// ProfileSettingsModal.
import { useEffect, useState } from "react";
import { renameWorkspace, deleteWorkspace } from "../api";

export default function WorkspaceSettingsModal({ token, workspace, onClose, onWorkspaceRenamed, onWorkspaceDeleted }) {
  const [name, setName] = useState(workspace?.name || "");
  const [nameSaving, setNameSaving] = useState(false);
  const [nameMessage, setNameMessage] = useState(null); // { type, text }

  // workspace can still update (e.g. after a rename elsewhere) while this
  // modal is open - keep the field in sync rather than freezing on mount.
  useEffect(() => {
    setName(workspace?.name || "");
  }, [workspace?.name]);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  const savedName = workspace?.name || "";
  const plan = workspace?.plan ? workspace.plan[0].toUpperCase() + workspace.plan.slice(1) : "";
  const trimmedName = name.trim();
  const nameChanged = trimmedName.length > 0 && trimmedName !== savedName;

  async function handleSaveName(e) {
    e.preventDefault();
    if (!nameChanged) return;
    setNameSaving(true);
    setNameMessage(null);
    try {
      const updated = await renameWorkspace({ token, workspaceId: workspace.id, name: trimmedName });
      onWorkspaceRenamed(updated);
      setNameMessage({ type: "success", text: "Saved." });
    } catch (err) {
      setNameMessage({ type: "error", text: err.message || "Could not rename workspace." });
    } finally {
      setNameSaving(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    setDeleteError("");
    try {
      await deleteWorkspace({ token, workspaceId: workspace.id, name: confirmName.trim() });
      onWorkspaceDeleted();
    } catch (err) {
      setDeleteError(err.message || "Could not delete workspace.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="profile-modal-overlay" onClick={onClose}>
      <div className="profile-modal" onClick={(e) => e.stopPropagation()}>
        <div className="profile-modal-header">
          <span>Workspace settings</span>
          <button className="profile-modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="profile-modal-body">
          <form onSubmit={handleSaveName} className="profile-modal-section">
            <div>
              <label>Name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={120}
                required
              />
            </div>
            {plan && (
              <div>
                <label>Plan</label>
                <input value={plan} disabled />
              </div>
            )}
            {nameMessage && (
              <p className={nameMessage.type === "error" ? "profile-modal-error" : "profile-modal-success"}>
                {nameMessage.text}
              </p>
            )}
            <button type="submit" className="primary" disabled={!nameChanged || nameSaving}>
              {nameSaving ? "Saving…" : "Save changes"}
            </button>
          </form>

          {/* Danger zone */}
          <div className="profile-modal-section profile-modal-danger">
            <p className="profile-modal-section-title">Danger zone</p>
            {!deleteOpen ? (
              <button type="button" className="danger" onClick={() => setDeleteOpen(true)}>
                Delete workspace
              </button>
            ) : (
              <div className="profile-modal-delete-confirm">
                <p>
                  This permanently deletes "{savedName}" - every draft, connected platform, media file, and
                  member's access in it. This can't be undone.
                </p>
                <div>
                  <label>
                    Type <strong style={{ textTransform: "none" }}>{savedName}</strong> to confirm
                  </label>
                  <input value={confirmName} onChange={(e) => setConfirmName(e.target.value)} />
                </div>
                {deleteError && <p className="profile-modal-error">{deleteError}</p>}
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => { setDeleteOpen(false); setConfirmName(""); setDeleteError(""); }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="danger"
                    disabled={confirmName.trim() !== savedName || deleting}
                    onClick={handleDelete}
                  >
                    {deleting ? "Deleting…" : "Permanently delete"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}