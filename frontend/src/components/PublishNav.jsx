// PublishNav.jsx — full-height panel that sits flush against the primary
// Sidebar, extending it with Publish's own sub-navigation. Rendered by
// App.jsx as a sibling of Sidebar/main-panel (not inside page-container),
// so it inherits the app's default dark theme vars rather than the light
// ones main-panel overrides for content.
import { TABS } from "./Publish";

export default function PublishNav({ tab, onSelectTab, collapsed, onToggleCollapsed }) {
  if (collapsed) return null;

  return (
    <div className="publish-nav-panel">
      <div className="publish-nav-header">
        <span>Publishing</span>
        <button className="publish-nav-collapse-btn" onClick={onToggleCollapsed} aria-label="Collapse publishing panel">
          ⬜
        </button>
      </div>
      <div className="publish-nav-list">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={tab === t.key ? "active" : ""}
            onClick={() => onSelectTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}