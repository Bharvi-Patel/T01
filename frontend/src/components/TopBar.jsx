// TopBar.jsx
// Slim persistent bar shown above every page's content, regardless of
// sidebar collapse state. Surfaces the workspace name as a dropdown —
// notifications/help/account stay in the sidebar, not duplicated here.
import { useState, useRef, useEffect } from "react";
import { listWorkspaces, createWorkspace, switchWorkspace } from "../api";

function ChevronDownIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}
function SearchIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-3.5-3.5" />
    </svg>
  );
}
function PlusCircleIcon({ size = 15 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v8M8 12h8" />
    </svg>
  );
}
function CheckIcon({ size = 15 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

export default function TopBar({ token, onAuthError }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [workspaces, setWorkspaces] = useState(null); // null = not loaded yet
  const [loadError, setLoadError] = useState("");
  const [switching, setSwitching] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const wrapRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false);
        setShowCreateForm(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Load the real workspace list once we have a token, so the button
  // shows the caller's actual active workspace instead of a placeholder.
  useEffect(() => {
    if (!token) { setWorkspaces(null); return; }
    listWorkspaces({ token })
      .then(setWorkspaces)
      .catch((e) => {
        if (e.status === 401) return onAuthError?.();
        setLoadError(e.message || "Couldn't load workspaces");
      });
  }, [token]);

  const active = (workspaces || []).find((w) => w.is_active);
  const workspaceName = active?.name || "Workspace";
  const plan = active?.plan ? active.plan[0].toUpperCase() + active.plan.slice(1) : "";

  const filtered = (workspaces || []).filter((w) =>
    w.name.toLowerCase().includes(search.toLowerCase())
  );

  async function handleSwitch(workspaceId) {
    if (switching || workspaceId === active?.id) { setOpen(false); return; }
    setSwitching(true);
    try {
      await switchWorkspace({ token, workspaceId });
      // Workspace-scoped data (drafts, members, connections, calendar...)
      // is fetched all over the app keyed by token, not workspace id, so
      // a full reload is the simplest reliable way to pick up the switch
      // everywhere at once.
      window.location.reload();
    } catch (e) {
      if (e.status === 401) return onAuthError?.();
      setLoadError(e.message || "Couldn't switch workspace");
      setSwitching(false);
    }
  }

  async function handleCreate(e) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    setCreateError("");
    try {
      await createWorkspace({ token, name });
      window.location.reload();
    } catch (e2) {
      if (e2.status === 401) return onAuthError?.();
      setCreateError(e2.message || "Couldn't create workspace");
      setCreating(false);
    }
  }

  return (
    <div className="topbar">
      <div className="topbar-workspace-wrap" ref={wrapRef}>
        <button className="topbar-workspace" onClick={() => setOpen((o) => !o)}>
          <span className="topbar-workspace-text">
            <span className="topbar-workspace-name">{workspaceName}</span>
            {plan && <span className="topbar-workspace-plan">{plan}</span>}
          </span>
          <ChevronDownIcon />
        </button>

        {open && (
          <div className="topbar-workspace-menu">
            {loadError && (
              <div style={{ fontSize: 12.5, color: "var(--danger)", padding: "4px 8px" }}>{loadError}</div>
            )}

            <div className="topbar-workspace-search">
              <SearchIcon />
              <input
                type="text"
                placeholder="Search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                autoFocus
              />
            </div>

            <div className="topbar-workspace-list">
              {filtered.map((w) => (
                <button
                  key={w.id}
                  className="topbar-workspace-row"
                  onClick={() => handleSwitch(w.id)}
                  disabled={switching}
                >
                  <span className="topbar-workspace-row-text">
                    <span className="topbar-workspace-row-name">{w.name}</span>
                    <span className="topbar-workspace-row-plan">
                      {w.plan ? w.plan[0].toUpperCase() + w.plan.slice(1) : ""}
                    </span>
                  </span>
                  {w.is_active && <CheckIcon size={14} />}
                </button>
              ))}
              {workspaces === null && !loadError && (
                <div style={{ fontSize: 12.5, color: "var(--text-secondary)", padding: "6px 8px" }}>Loading…</div>
              )}
            </div>

            {showCreateForm ? (
              <form onSubmit={handleCreate} style={{ display: "flex", flexDirection: "column", gap: 6, padding: 8 }}>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Workspace name"
                  autoFocus
                  style={{ fontSize: 13 }}
                />
                {createError && <div style={{ fontSize: 12, color: "var(--danger)" }}>{createError}</div>}
                <div style={{ display: "flex", gap: 6 }}>
                  <button type="submit" className="primary" disabled={creating || !newName.trim()} style={{ fontSize: 13, flex: 1 }}>
                    {creating ? "Creating…" : "Create"}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowCreateForm(false); setNewName(""); setCreateError(""); }}
                    style={{ fontSize: 13 }}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <button
                className="topbar-workspace-create"
                onClick={() => setShowCreateForm(true)}
              >
                <PlusCircleIcon />
                Create a new workspace
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}