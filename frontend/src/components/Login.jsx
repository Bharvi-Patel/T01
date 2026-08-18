import { useState, useEffect } from "react";
import { getLoginAuthorizeUrl } from "../api";


const OAUTH_PROVIDERS = [
  { key: "google", label: "Continue with Google", color: "#4285F4" },
  { key: "linkedin", label: "Continue with LinkedIn", color: "#0A66C2" },
  { key: "facebook", label: "Continue with Facebook", color: "#1877F2" },
  { key: "x", label: "Continue with X", color: "var(--ink)" },
];

function EyeIcon({ off }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {off ? (
        <>
          <path d="M17.94 17.94A10.94 10.94 0 0112 20c-7 0-11-8-11-8a20.3 20.3 0 015.06-5.94M9.9 4.24A10.4 10.4 0 0112 4c7 0 11 8 11 8a20.3 20.3 0 01-3.22 4.4M14.12 14.12a3 3 0 11-4.24-4.24" />
          <path d="M1 1l22 22" />
        </>
      ) : (
        <>
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
          <circle cx="12" cy="12" r="3" />
        </>
      )}
    </svg>
  );
}

// Password input with a show/hide eye toggle. Same label/required/etc API
// as a plain <input>, just swaps type between "password" and "text".
function PasswordField({ id, autoComplete, value, onChange, minLength }) {
  const [visible, setVisible] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <input
        id={id}
        type={visible ? "text" : "password"}
        autoComplete={autoComplete}
        value={value}
        onChange={onChange}
        required
        minLength={minLength}
        style={{ paddingRight: 40 }}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Hide password" : "Show password"}
        tabIndex={-1}
        style={{
          position: "absolute",
          top: "50%",
          right: 10,
          transform: "translateY(-50%)",
          width: 28,
          height: 28,
          padding: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "transparent",
          border: "none",
          color: "var(--text-muted)",
        }}
      >
        <EyeIcon off={visible} />
      </button>
    </div>
  );
}


export default function Login({ onLogin, onSignUp, loading, error }) {
  const [mode, setMode] = useState("login"); // "login" | "signup"
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
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
    mode === "login" ? onLogin({ identifier: username, password }) : onSignUp({ username, email, password });
  }

  const displayError = mismatchError || error;

  return (
    <div style={{ width: "100%", maxWidth: 380 }}>
      {/* <p className="eyebrow" style={{ margin: "0 0 6px" }}>hehe</p> */}
      <h1 className="masthead">
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

        {mode === "signup" && (
          <div style={{ marginBottom: "1rem" }}>
            <label htmlFor="email">Email</label>
            <input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
        )}

        <div style={{ marginBottom: mode === "signup" ? "1rem" : "1.5rem" }}>
          <label htmlFor="password">Password</label>
          <PasswordField
            id="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={mode === "signup" ? 8 : undefined}
          />
        </div>

        {mode === "signup" && (
          <div style={{ marginBottom: "1.5rem" }}>
            <label htmlFor="confirm-password">Confirm password</label>
            <PasswordField
              id="confirm-password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
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