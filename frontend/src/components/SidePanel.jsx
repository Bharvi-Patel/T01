// SidePanel.jsx — generic version of PublishNav's full-height side panel,
// reused so every page that has its own tabs/filters gets the same look
// (flush against the primary Sidebar, dark theme vars, collapse button)
// instead of each page inventing its own top-of-page tab row.
export default function SidePanel({ title, tabs, activeKey, onSelect, collapsed, onToggleCollapsed }) {
    if (collapsed) return null;
  
    return (
      <div className="publish-nav-panel">
        <div className="publish-nav-header">
          <span>{title}</span>
          <button className="publish-nav-collapse-btn" onClick={onToggleCollapsed} aria-label={`Collapse ${title} panel`}>
            ⬜
          </button>
        </div>
        <div className="publish-nav-list">
          {tabs.map((t) => (
            <button
              key={t.key}
              className={activeKey === t.key ? "active" : ""}
              onClick={() => onSelect(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
    );
  }