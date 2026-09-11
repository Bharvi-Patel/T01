// HelpCenter.jsx — renders the FAQ content from ../data/helpContent.json,
// grouped into categories with a simple client-side search. The JSON file
// is the single source of truth for this content - the backend embeds the
// same file into pgvector (see Agent01/help_content.py) so the chat
// assistant's RAG grounding (Checkpoint 5) and this page never drift apart.
import { useMemo, useState } from "react";
import SECTIONS from "../data/helpContent.json";

function ChevronIcon({ open }) {
  return (
    <svg
      width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round"
      style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s ease", flexShrink: 0 }}
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function Article({ article, open, onToggle }) {
  return (
    <div style={{ borderBottom: "0.5px solid var(--border-strong)" }}>
      <button
        onClick={onToggle}
        style={{
          width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
          padding: "12px 4px", background: "none", border: "none", textAlign: "left", cursor: "pointer",
          color: "var(--ink)", fontSize: 13.5, fontWeight: 500,
        }}
      >
        <span>{article.q}</span>
        <ChevronIcon open={open} />
      </button>
      {open && (
        <p style={{ margin: "0 4px 14px", fontSize: 13, lineHeight: 1.55, color: "var(--text-secondary)" }}>
          {article.a}
        </p>
      )}
    </div>
  );
}

function SectionBlock({ section, openKey, onToggle }) {
  return (
    <div style={{ marginBottom: 26 }}>
      <p style={{ fontFamily: "var(--font-display)", fontSize: 16, color: "var(--ink)", margin: "0 0 6px" }}>
        {section.title}
      </p>
      <div
        style={{
          background: "var(--paper-raised)", border: "0.5px solid var(--border-strong)",
          borderRadius: 8, padding: "0 14px",
        }}
      >
        {section.articles.map((article, i) => {
          const articleKey = `${section.key}-${i}`;
          return (
            <Article
              key={articleKey}
              article={article}
              open={openKey === articleKey}
              onToggle={() => onToggle(openKey === articleKey ? null : articleKey)}
            />
          );
        })}
      </div>
    </div>
  );
}

export default function HelpCenter() {
  const [query, setQuery] = useState("");
  const [openKey, setOpenKey] = useState(null);

  const filteredSections = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return SECTIONS;
    return SECTIONS.map((section) => ({
      ...section,
      articles: section.articles.filter(
        (a) => a.q.toLowerCase().includes(q) || a.a.toLowerCase().includes(q)
      ),
    })).filter((section) => section.articles.length > 0);
  }, [query]);

  return (
    <div style={{ maxWidth: 640 }}>
      <p style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "var(--ink)", margin: "0 0 4px" }}>
        Help center
      </p>
      <p style={{ fontSize: 13.5, color: "var(--text-secondary)", margin: "0 0 20px" }}>
        Answers to common questions about using T01.
      </p>

      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search help articles…"
        style={{ width: "100%", marginBottom: 24, boxSizing: "border-box" }}
      />

      {filteredSections.length === 0 && (
        <p style={{ fontSize: 13.5, color: "var(--text-secondary)" }}>
          No articles match "{query}". Try a different search term.
        </p>
      )}

      {filteredSections.map((section) => (
        <SectionBlock key={section.key} section={section} openKey={openKey} onToggle={setOpenKey} />
      ))}
    </div>
  );
}