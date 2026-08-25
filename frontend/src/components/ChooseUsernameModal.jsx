// ChooseUsernameModal.jsx — shown once, right after a first OAuth login
// (Google/LinkedIn/Facebook/X), before the rest of the app is usable.
// OAuth signup only ever auto-generates a placeholder username server-side
// (see username_is_set in the /me payload) - the user picks their real one
// here rather than living with whatever got auto-generated.
import { useState } from "react";
import { updateProfile } from "../api";

const USERNAME_PATTERN = /^[a-z0-9_]{3,64}$/;

export default function ChooseUsernameModal({ token, suggestedUsername, onDone }) {
  const [username, setUsername] = useState(suggestedUsername || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    const value = username.trim().toLowerCase();
    if (!USERNAME_PATTERN.test(value)) {
      setError("Lowercase letters, numbers, and underscores only - 3 to 64 characters, no spaces.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const updated = await updateProfile({ token, username: value });
      onDone(updated);
    } catch (err) {
      setError(err.message || "Could not save that username.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ width: "100%", maxWidth: 380 }}>
      <h1 className="masthead">Choose a username</h1>
      <hr className="masthead-rule" />
      <form
        onSubmit={handleSubmit}
        style={{ background: "var(--paper-raised)", borderRadius: "var(--radius)", border: "1px solid var(--border)", padding: "1.5rem" }}
      >
        <p style={{ margin: "0 0 1rem" }}>
          Pick a username to finish setting up your account. You can change it later in profile settings.
        </p>
        <div style={{ marginBottom: 8 }}>
          <label htmlFor="choose-username">Username</label>
          <input
            id="choose-username"
            type="text"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value.toLowerCase())}
            pattern="[a-z0-9_]{3,64}"
            required
          />
        </div>
        {/* <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 1rem" }}>
          Lowercase letters, numbers, and underscores only - no spaces.
        </p> */}
        {error && (
          <p style={{ fontSize: 13, color: "var(--danger)", background: "var(--danger-bg)", borderRadius: "var(--radius)", padding: "8px 12px", margin: "0 0 1rem" }}>
            {error}
          </p>
        )}
        <button type="submit" className="primary" style={{ width: "100%" }} disabled={saving}>
          {saving ? "Saving…" : "Continue"}
        </button>
      </form>
    </div>
  );
}