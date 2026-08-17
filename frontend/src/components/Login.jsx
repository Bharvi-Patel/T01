import { useState, useEffect } from "react";
import { getLoginAuthorizeUrl } from "../api";


const OAUTH_PROVIDERS = [
  { key: "google", label: "Continue with Google", color: "#4285F4" },
  { key: "linkedin", label: "Continue with LinkedIn", color: "#0A66C2" },
  { key: "facebook", label: "Continue with Facebook", color: "#1877F2" },
  { key: "x", label: "Continue with X", color: "var(--ink)" },
];


export default function Login({ onLogin, onSignup, loading, error }) {
  const [mode, setMode] = useState("login"); // "login" | "signup"
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [mismatchError, setMismatchError] = useState("");

  useEffect(() => {
    setMismatchError("");
    setConfirmPassword("");
  }, [mode]);


  async function handleOAuthLogin(provider) {
    const { authorize_url } = await getLoginAuthorizeUrl({ provider });
    window.location.href = authorize_url;
  }


  function handleSubmit(e) {
    e.preventDefault();
    if (mode === "signup" && password !== confirmPassword) {
      setMismatchError("Passwords don't match.");
      return;
    }
    setMismatchError("");
    mode === "login" ? onLogin({ username, password }) : onSignup({ username, password });
  }

  const displayError = mismatchError || error;

  return (
    <div style={{ width: "100%", maxWidth: 380 }}>
      {/* <p className="eyebrow" style={{ margin: "0 0 6px" }}>hehe</p> */}
      <h1 className="masthead" style={{ fontSize: 44 }}>
        {mode === "login" ? "Sign in" : "Create account"}
      </h1>
      <hr className="masthead-rule" key={mode} />

      <form
        onSubmit={handleSubmit}
        style={{ background: "var(--paper-raised)", borderRadius: "var(--radius)", border: "1px solid var(--border)", padding: "1.5rem" }}
      >
        <div style={{ marginBottom: "1rem" }}>
          <label htmlFor="username">Username</label>
          <input id="username" type="text" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required />
        </div>

        <div style={{ marginBottom: mode === "signup" ? "1rem" : "1.5rem" }}>
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={mode === "signup" ? 8 : undefined}
          />
        </div>

        {mode === "signup" && (
          <div style={{ marginBottom: "1.5rem" }}>
            <label htmlFor="confirm-password">Confirm password</label>
            <input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={8}
            />
          </div>
        )}

        {displayError && (
          <p style={{ fontSize: 13, color: "var(--danger)", background: "var(--danger-bg)", borderRadius: "var(--radius)", padding: "8px 12px", margin: "0 0 1rem" }}>
            {displayError}
          </p>
        )}

        <button type="submit" className="primary" style={{ width: "100%" }} disabled={loading}>
          {loading ? (mode === "login" ? "Signing in…" : "Creating account…") : mode === "login" ? "Sign in" : "Create account"}
        </button>
      </form>

      <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "20px 0" }}>
        <hr style={{ flex: 1, border: "none", borderTop: "1px solid var(--border)", margin: 0 }} />
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--text-muted)" }}>
          or continue with
        </span>
        <hr style={{ flex: 1, border: "none", borderTop: "1px solid var(--border)", margin: 0 }} />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {OAUTH_PROVIDERS.map((p) => (
        <button
          key={p.key}
          type="button"
          onClick={() => handleOAuthLogin(p.key)}
          style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
        >
          {p.label}
        </button>
      ))}
    </div>

      <button
        type="button"
        className="text-link"
        onClick={() => setMode(mode === "login" ? "signup" : "login")}
        style={{ display: "block", width: "100%", textAlign: "center", marginTop: 16 }}
      >
        {mode === "login" ? "Don't have an account? Sign up" : "Already have an account? Sign in"}
      </button>
    </div>
  );
}