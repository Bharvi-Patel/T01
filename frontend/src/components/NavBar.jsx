// NavBar.jsx
import { useState, useRef, useEffect } from "react";

const MENU_ITEMS = ["Features", "Resources", "Pricing"];

export default function NavBar() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "2.5rem" }}>
      <p className="eyebrow" style={{ margin: 0 }}>startTrack</p>

      <div ref={ref} style={{ position: "relative" }}>
        <button onClick={() => setOpen((o) => !o)} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          Menu
          <span style={{ fontSize: 10, transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s ease" }}>▾</span>
        </button>

        {open && (
          <div
            style={{
              position: "absolute", top: "calc(100% + 8px)", right: 0, minWidth: 160,
              background: "var(--paper-raised)", border: "1px solid var(--border)",
              borderRadius: "var(--radius)", padding: 6, zIndex: 10,
            }}
          >
            {MENU_ITEMS.map((item) => (
              <a
                key={item}
                href="#"
                onClick={(e) => e.preventDefault()}
                style={{
                  display: "block", padding: "8px 10px", fontSize: 14, color: "var(--ink)",
                  textDecoration: "none", borderRadius: "var(--radius)",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--paper)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                {item}
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}