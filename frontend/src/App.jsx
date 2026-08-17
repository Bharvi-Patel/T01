// App.jsx
import { useState, useEffect } from "react";
import Login from "./components/Login";
import ConnectorsPanel from "./components/ConnectorsPanel";
import Form from "./components/Form";
import DraftReview from "./components/DraftReview";
import Done from "./components/Done";
import Landing from "./components/Landing";
import Sidebar from "./components/Sidebar";
import { login as apiLogin, signup as apiSignup, generateDraft, reviewDraft, getConnections } from "./api";

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem("auth_token"));
  // const [token, setToken] = useState(() =>
  //   import.meta.env.DEV ? "dev-preview" : localStorage.getItem("auth_token")
  // );
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState("");

  const [connections, setConnections] = useState({}); // { finto: true, linkedin: false, ... }

  const [showAuth, setShowAuth] = useState(false);
  
  const [step, setStep] = useState("generate"); // generate | draft | done
  const [connectStatus, setConnectStatus] = useState(null); // { type: "success"|"error", platform }
  const [draftId, setDraftId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [pagePicker, setPagePicker] = useState(null); // { platform, pendingId }


  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has("connected") || params.has("error")) {
      setConnectStatus(
        params.has("connected") ? { type: "success", platform: params.get("connected") } : { type: "error", detail: params.get("error") }
      );
      setStep("settings");
      window.history.replaceState({}, "", window.location.pathname);
    } else if (params.has("select_page")) {
      setPagePicker({ platform: params.get("select_page"), pendingId: params.get("pending")});
      setStep("settings");
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);
  
  useEffect(() => {
    if (!token) return;
    getConnections({ token })
      .then((res) => {
        const next = {};
        res.connections.forEach((key) => { next[key] = true; });
        setConnections(next);
      })
      .catch(() => {});
  }, [token, step]);


  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const loginToken = params.get("login_token");
    if (loginToken) {
      localStorage.setItem("auth_token", loginToken);
      setToken(loginToken);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  
  async function handleSignup({ username, password }) {
    setAuthLoading(true);
    setAuthError("");
    try {
      const res = await apiSignup({ username, password });
      localStorage.setItem("auth_token", res.token);
      setToken(res.token);
    } catch (e) {
      setAuthError(e.message || "Could not create account.");
    } finally {
      setAuthLoading(false);
    }
  }
  

  async function handleLogin({ username, password }) {
    setAuthLoading(true);
    setAuthError("");
    try {
      const res = await apiLogin({ username, password });
      localStorage.setItem("auth_token", res.token);
      setToken(res.token);
    } catch (e) {
      setAuthError(e.message || "Invalid username or password.");
    } finally {
      setAuthLoading(false);
    }
  }

  function handleLogout() {
    localStorage.removeItem("auth_token");
    setToken(null);
    handleRestart();
  }

  <Sidebar
    activeStep={step === "generate" || step === "draft" || step === "done" ? "generate" : step}
    onNavigate={(key) => setStep(key)}
    onNewPost={handleRestart}
    onLogout={handleLogout}
  />

  async function handleGenerate({ category, subtopic, wordCount }) {
    setLoading(true);
    setError("");
    try {
      const res = await generateDraft({ token, category, subtopic, wordCount });
      setDraftId(res.draft_id);
      setDraft(res.draft);
      setStep("draft");
    } catch (e) {
      if (String(e.message).includes("401")) return handleLogout();
      setError(e.message || "Something went wrong generating the draft.");
    } finally {
      setLoading(false);
    }
  }

  async function handleApprove(live, platforms) {
    setLoading(true);
    setError("");
    try {
      const res = await reviewDraft({ token, draftId, decision: "approve", live, platforms });
      setResult(res.result);
      setStep("done");
    } catch (e) {
      if (String(e.message).includes("401")) return handleLogout();
      setError(e.message || "Something went wrong while publishing the draft.");
    } finally {
      setLoading(false);
    }
  }

  async function handleReject(feedback) {
    setLoading(true);
    setError("");
    try {
      const res = await reviewDraft({ token, draftId, decision: "reject", feedback });
      setDraft(res.draft);
    } catch (e) {
      if (String(e.message).includes("401")) return handleLogout();
      setError(e.message || "Something went wrong revising the draft.");
    } finally {
      setLoading(false);
    }
  }



  fetch("http://localhost:8000/auth/google/authorize-url", { method: "POST" })
  .then(r => r.json())
  .then(console.log)
  .catch(console.error)




  

  function handleRestart() {
    setStep("generate");
    setDraftId(null);
    setDraft(null);
    setResult(null);
    setError("");
  }

  function handleConnect(platformKey) {
    // Opens the connect flow for that platform — wired up once the
    // connect-platform screen exists. For now just a placeholder toggle
    // so the rail reflects state during layout/preview work.
    setConnections((prev) => ({ ...prev, [platformKey]: !prev[platformKey] }));
  }

  if (!token) {
    return (
      <div style={{ width: "100%", maxWidth: showAuth ? 400 : 720 }}>
        {showAuth
          ? <Login onLogin={handleLogin} onSignUp={handleSignup} loading={authLoading} error={authError} />
          : <Landing onGetStarted={() => setShowAuth(true)} />
        }
      </div>
    );
  }

  return (
    <div style={{ display: "flex", minHeight: "100vh", width: "100%" }}>
      <ConnectorsPanel connections={connections} onConnect={handleConnect} onLogout={handleLogout} />

      <div style={{ flex: 1, padding: "3rem 3.5rem", display: "flex", justifyContent: "center" }}>
        <div style={{ width: "100%", maxWidth: 700 }}>
          {step === "generate" && (
              <Form onSubmit={handleGenerate} loading={loading} error={error} />

          )}

          {step === "draft" && (
            <DraftReview
              draft={draft}
              connections={connections}
              onApprove={handleApprove}
              onReject={handleReject}
              loading={loading}
              error={error}
            />
          )}
          {step === "done" && <Done result={result} onRestart={handleRestart} />}
        </div>
      </div>
    </div>
  );
}