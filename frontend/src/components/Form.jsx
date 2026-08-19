import { useState } from "react";

const CATEGORIES = [
  "Technology",
  "Web Development",
  "Artificial Intelligence",
  "Gadgets",
  "Business",
  "Startups",
  "Finance",
  "Lifestyle",
  "Health",
  "Travel",
];

export default function Form({ onSubmit, loading, error }) {
  const [category, setCategory] = useState("Business");
  const [subtopic, setSubtopic] = useState("");
  const [wordCount, setWordCount] = useState(100);

  function handleSubmit(e) {
    e.preventDefault();
    if (!subtopic.trim()) return;
    onSubmit({ category, subtopic: subtopic.trim(), wordCount });
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        background: "var(--surface-2)",
        borderRadius: 12,
        border: "0.5px solid var(--border)",
        padding: "1.5rem",
      }}
    >
      <p style={{ fontWeight: 500, fontSize: 15, margin: "0 0 1rem", color: "#fff"}}>
        Generate a new post
      </p>

      <div style={{ marginBottom: "1rem" }}>
        <label htmlFor="category">Category</label>
        <select
          id="category"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      <div style={{ marginBottom: "1rem" }}>
        <label htmlFor="subtopic">Subtopic</label>
        <input
          id="subtopic"
          type="text"
          value={subtopic}
          onChange={(e) => setSubtopic(e.target.value)}
          required
        />
      </div>

      <div style={{ marginBottom: "1.5rem" }}>
        <label htmlFor="wordcount">Word count</label>
        <input
          id="wordcount"
          type="number"
          min={100}
          value={wordCount}
          onChange={(e) => setWordCount(e.target.value)}
        />
      </div>

      {error && (
        <p
          style={{
            fontSize: 13,
            color: "var(--text-danger)",
            background: "var(--bg-danger)",
            borderRadius: "var(--radius)",
            padding: "8px 12px",
            margin: "0 0 1rem",
          }}
        >
          {error}
        </p>
      )}

      <button type="submit" className="primary" style={{ width: "100%" }} disabled={loading}>
        {loading ? "Generating…" : "Generate draft"}
      </button>
    </form>
  );
}
