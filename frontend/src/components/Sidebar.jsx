// Sidebar.jsx
import { useState, useRef, useEffect } from "react";
import ProfileSettingsModal from "./ProfileSettingsModal";

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
  { key: "members", label: "Members", icon: "users" },
  { key: "billing", label: "Billing", icon: "card" },
];

const ICON_PATHS = {
  dashboard: "M3 11l9-8 9 8M5 10v10h14V10",
  inbox: "M3 8l9 6 9-6M5 6h14a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2z",
  link: "M9 15l6-6M8 12a4 4 0 010-5.66l2-2a4 4 0 015.66 5.66M16 12a4 4 0 010 5.66l-2 2a4 4 0 01-5.66-5.66",
  send: "M22 2L11 13M22 2l-7 20-4-9-9-4z",
  chart: "M4 20V10M12 20V4M20 20v-7",
  card: "M2 7a2 2 0 012-2h16a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V7zM2 10h20M6 15h4",
  users: "M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75",
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

function initials(name) {
  return (name || "?").trim().slice(0, 2).toUpperCase();
}

// Rendered inline rather than through the single-<path> Icon component
// above, since a sun needs a circle plus separate rays - not one path.
function SunIcon({ size = 15 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}
function MoonIcon({ size = 15 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
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
  token,
  profile,
  onProfileUpdated,
  onAccountDeleted,
  theme,
  onSetTheme,
  unreadNotifications = 0,
}) {
  const [accountOpen, setAccountOpen] = useState(false);
  const [profileModalOpen, setProfileModalOpen] = useState(false);
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
            aria-label={`Notifications${unreadNotifications > 0 ? ` (${unreadNotifications} unread)` : ""}`}
            style={{ position: "relative" }}
          >
            <span style={{ position: "relative", display: "inline-flex" }}>
              <Icon name="bell" size={16} />
              {unreadNotifications > 0 && (
                <span
                  aria-hidden="true"
                  style={{
                    position: "absolute", top: -4, right: -6,
                    minWidth: 14, height: 14, padding: "0 3px",
                    borderRadius: 7, background: "var(--accent)", color: "#fff",
                    fontSize: 9, fontWeight: 700, lineHeight: "14px", textAlign: "center",
                  }}
                >
                  {unreadNotifications > 99 ? "99+" : unreadNotifications}
                </span>
              )}
            </span>
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
                {profile?.avatar_url
                  ? <img src={profile.avatar_url} alt="" style={{ width: "100%", height: "100%", borderRadius: "50%", objectFit: "cover" }} />
                  : <Icon name="user" size={14} />}
              </span>
              {!collapsed && <span>{profile?.username || "Account"}</span>}
            </button>

            {accountOpen && (
              <div className={`sidebar-account-menu${collapsed ? " sidebar-account-menu--collapsed" : ""}`}>
                {profile && (
                  <div className="sidebar-account-menu-header">
                    <span className="sidebar-account-menu-avatar">
                      {profile.avatar_url
                        ? <img src={profile.avatar_url} alt="" />
                        : <span>{initials(profile.username)}</span>}
                    </span>
                    <div className="sidebar-account-menu-header-text">
                      <div className="sidebar-account-menu-name">{profile.username}</div>
                      {profile.email && <div className="sidebar-account-menu-email">{profile.email}</div>}
                    </div>
                  </div>
                )}
                <button
                  className="sidebar-account-menu-item"
                  onClick={() => { setProfileModalOpen(true); setAccountOpen(false); }}
                >
                  <Icon name="user" size={15} />
                  Profile settings
                </button>
                <button
                  className="sidebar-account-menu-item"
                  onClick={() => { onNavigate("settings"); setAccountOpen(false); }}
                >
                  <Icon name="link" size={15} />
                  Integrations
                </button>
                <div className="sidebar-account-menu-item sidebar-account-menu-appearance">
                  <span>Appearance</span>
                  <span className="appearance-toggle">
                    <button
                      type="button"
                      className={theme === "light" ? "active" : ""}
                      onClick={() => onSetTheme("light")}
                      aria-label="Light appearance"
                      aria-pressed={theme === "light"}
                    >
                      <SunIcon size={13} />
                    </button>
                    <button
                      type="button"
                      className={theme === "dark" ? "active" : ""}
                      onClick={() => onSetTheme("dark")}
                      aria-label="Dark appearance"
                      aria-pressed={theme === "dark"}
                    >
                      <MoonIcon size={13} />
                    </button>
                  </span>
                </div>
                <button className="sidebar-account-menu-item" onClick={onLogout}>
                  <Icon name="logout" size={15} />
                  Log out
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {profileModalOpen && (
        <ProfileSettingsModal
          token={token}
          profile={profile}
          onClose={() => setProfileModalOpen(false)}
          onProfileUpdated={onProfileUpdated}
          onAccountDeleted={onAccountDeleted}
        />
      )}
    </>
  );
}