// Sidebar.jsx
import { useState, useRef, useEffect } from "react";

// "generate" and "settings" are real, wired-up screens (the create/review/
// publish flow, and the social accounts connector page). Everything else
// still navigates, but shows a "coming soon" placeholder for now.
const NAV_ITEMS = [
  { key: "dashboard", label: "Dashboard", icon: "dashboard" },
  { key: "inbox", label: "Social Inbox", icon: "inbox" },
  { key: "settings", label: "Social Accounts", icon: "link" },
  { key: "publish", label: "Publish", icon: "send" },
  { key: "calendar", label: "Calendar", icon: "calendar" },
  { key: "analytics", label: "Analytics", icon: "chart" },
  { key: "billing", label: "Billing", icon: "card" },
];

const ICON_PATHS = {
  dashboard: "M3 11l9-8 9 8M5 10v10h14V10",
  inbox: "M3 8l9 6 9-6M5 6h14a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2z",
  link: "M9 15l6-6M8 12a4 4 0 010-5.66l2-2a4 4 0 015.66 5.66M16 12a4 4 0 010 5.66l-2 2a4 4 0 01-5.66-5.66",
  send: "M22 2L11 13M22 2l-7 20-4-9-9-4z",
  chart: "M4 20V10M12 20V4M20 20v-7",
  card: "M2 7a2 2 0 012-2h16a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V7zM2 10h20M6 15h4",
  calendar: "M8 2v4M16 2v4M3 9h18M4 5h16a1 1 0 011 1v13a1 1 0 01-1 1H4a1 1 0 01-1-1V6a1 1 0 011-1z",
  bell: "M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0",
  help: "M12 2a10 10 0 100 20 10 10 0 000-20zM9.5 9a2.5 2.5 0 015 0c0 1.5-2 2-2 3.5M12 17h.01",
  user: "M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z",
  plus: "M12 5v14M5 12h14",
  chevronLeft: "M15 18l-6-6 6-6",
  chevronRight: "M9 18l6-6-6-6",
  logout: "M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9",
};

function Icon({ name, size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}

export default function Sidebar({
  activeStep,
  onNavigate,
  onNewPost,
  onLogout,
  mobileOpen,
  onCloseMobile,
  collapsed,
  onToggleCollapsed,
  workspaceName = "startTrack",
}) {
  const [accountOpen, setAccountOpen] = useState(false);
  const accountRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (accountRef.current && !accountRef.current.contains(e.target)) setAccountOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <>
      <div className={`sidebar-backdrop${mobileOpen ? " open" : ""}`} onClick={onCloseMobile} />
      <div className={`sidebar${mobileOpen ? " open" : ""}${collapsed ? " collapsed" : ""}`}>
        {/* Header: logo + workspace name + collapse toggle */}
        <div className="sidebar-header">
          <div className="sidebar-brand">
            <span className="sidebar-logo-mark" aria-hidden="true">◆</span>
            {!collapsed && <span className="sidebar-workspace-name">{workspaceName}</span>}
          </div>
          <button
            className="sidebar-collapse-btn"
            onClick={onToggleCollapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <Icon name={collapsed ? "chevronRight" : "chevronLeft"} size={14} />
          </button>
        </div>

        {/* + New */}
        <button
          className="primary sidebar-new-btn"
          onClick={onNewPost}
          data-tooltip="New post"
          aria-label="New post"
        >
          <Icon name="plus" size={16} />
          {!collapsed && <span>New</span>}
        </button>

        {/* Nav */}
        <div className="sidebar-nav">
          {NAV_ITEMS.map((item) => {
            const active = activeStep === item.key;
            return (
              <button
                key={item.key}
                className={`sidebar-nav-item${active ? " active" : ""}`}
                onClick={() => onNavigate(item.key)}
                data-tooltip={item.label}
                aria-label={item.label}
              >
                <span className="sidebar-nav-item-main">
                  <Icon name={item.icon} />
                  {!collapsed && <span className="sidebar-nav-item-label">{item.label}</span>}
                </span>
              </button>
            );
          })}
        </div>

        {/* Bottom: notifications + help + account */}
        <div className="sidebar-bottom">
          <button
            className={`sidebar-help-btn${activeStep === "notifications" ? " active" : ""}`}
            onClick={() => onNavigate("notifications")}
            data-tooltip="Notifications"
            aria-label="Notifications"
          >
            <Icon name="bell" size={16} />
            {!collapsed && <span>Notifications</span>}
          </button>

          <button
            className={`sidebar-help-btn${activeStep === "help" ? " active" : ""}`}
            onClick={() => onNavigate("help")}
            data-tooltip="Help center"
            aria-label="Help center"
          >
            <span className="sidebar-help-mark">?</span>
            {!collapsed && <span>Help center</span>}
          </button>

          <div ref={accountRef} className="sidebar-account-wrap">
            <button
              className="sidebar-account-btn"
              onClick={() => setAccountOpen((o) => !o)}
              data-tooltip="Account"
              aria-label="Account"
            >
              <span className="sidebar-account-avatar">
                <Icon name="user" size={14} />
              </span>
              {!collapsed && <span>Account</span>}
            </button>

            {accountOpen && (
              <div className={`sidebar-account-menu${collapsed ? " sidebar-account-menu--collapsed" : ""}`}>
                <button className="sidebar-account-menu-item" onClick={onLogout}>
                  <Icon name="logout" size={15} />
                  Log out
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}