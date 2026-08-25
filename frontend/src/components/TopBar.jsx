// TopBar.jsx
// Slim persistent bar shown above every page's content, regardless of
// sidebar collapse state. Surfaces the workspace name as a dropdown —
// notifications/help/account stay in the sidebar, not duplicated here.
import { useState, useRef, useEffect } from "react";

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

export default function TopBar({ workspaceName = "startTrack", plan = "Free", onCreateWorkspace }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const wrapRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Only one real workspace exists right now — the list is a single row,
  // filtered against search like a real switcher will be once multi-
  // workspace support lands on the backend.
  const workspaces = [{ name: workspaceName, plan }].filter((w) =>
    w.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="topbar">
      <div className="topbar-workspace-wrap" ref={wrapRef}>
        <button className="topbar-workspace" onClick={() => setOpen((o) => !o)}>
          <span className="topbar-workspace-text">
            <span className="topbar-workspace-name">{workspaceName}</span>
            <span className="topbar-workspace-plan">{plan}</span>
          </span>
          <ChevronDownIcon />
        </button>

        {open && (
          <div className="topbar-workspace-menu">
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
              {workspaces.map((w) => (
                <button key={w.name} className="topbar-workspace-row">
                  <span className="topbar-workspace-row-text">
                    <span className="topbar-workspace-row-name">{w.name}</span>
                    <span className="topbar-workspace-row-plan">{w.plan}</span>
                  </span>
                  <CheckIcon size={14} />
                </button>
              ))}
            </div>

            <button
              className="topbar-workspace-create"
              onClick={() => { setOpen(false); onCreateWorkspace?.(); }}
            >
              <PlusCircleIcon />
              Create a new workspace
            </button>
          </div>
        )}
      </div>
    </div>
  );
}