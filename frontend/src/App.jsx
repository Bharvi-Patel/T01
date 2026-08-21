// App.jsx
import { useState, useEffect } from "react";
import Login from "./components/Login";
import Form from "./components/Form";
import DraftReview from "./components/DraftReview";
import Done from "./components/Done";
import Landing from "./components/Landing";
import Sidebar from "./components/Sidebar";
import Settings from "./components/settings";
import Publish from "./components/Publish";
import Calendar from "./components/Calendar";
import Analytics from "./components/Analytics";
import Inbox from "./components/Inbox";
import { login as apiLogin, logout as apiLogout, signup as apiSignup, verifyEmail as apiVerifyEmail, resendVerification as apiResendVerification, generateDraft, createManualDraft, reviewDraft, scheduleDraft, getConnections, getDraft } from "./api";

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem("auth_token"));
  // const [token, setToken] = useState(() =>
  //   import.meta.env.DEV ? "dev-preview" : localStorage.getItem("auth_token")
  // );
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState("");
  const [pendingVerificationEmail, setPendingVerificationEmail] = useState(null);
  const [verifyMessage, setVerifyMessage] = useState(null); // { type, text } from a clicked email link
  const [resendLoading, setResendLoading] = useState(false);
  const [resendMessage, setResendMessage] = useState("");

  const [connections, setConnections] = useState({}); // { linkedin: { profile_name, profile_picture_url }, ... } — key present means connected

  const [showAuth, setShowAuth] = useState(false);
  
  const [step, setStep] = useState("dashboard"); // dashboard | generate | draft | done | settings | ...
  const [connectStatus, setConnectStatus] = useState(null); // { type: "success"|"error", platform }
  const [draftId, setDraftId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [pagePicker, setPagePicker] = useState(null); // { platform, pendingId }
  const [publishInitialTab, setPublishInitialTab] = useState("new");
  const [composeHandoffAsset, setComposeHandoffAsset] = useState(null); // { type, name, file, content } from Media tab, consumed once by Form
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    const saved = localStorage.getItem("sidebar_collapsed");
    return saved === null ? true : saved === "1"; // narrow icon rail by default
  });

  function toggleSidebarCollapsed() {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem("sidebar_collapsed", next ? "1" : "0");
      return next;
    });
  }


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
  
  function refreshConnections() {
    if (!token) return;
    getConnections({ token })
      .then((res) => {
        setConnections(res.connections || {});
      })
      .catch(() => {});
  }

  useEffect(refreshConnections, [token, step]);


  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const verifyToken = params.get("verify_token");
    if (verifyToken) {
      window.history.replaceState({}, "", window.location.pathname);
      setShowAuth(true);
      apiVerifyEmail({ token: verifyToken })
        .then(() => setVerifyMessage({ type: "success", text: "Email verified — you can sign in now." }))
        .catch((e) => setVerifyMessage({ type: "error", text: e.message || "That verification link is invalid or expired." }));
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const loginToken = params.get("login_token");
    if (loginToken) {
      localStorage.setItem("auth_token", loginToken);
      setToken(loginToken);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  
  async function handleSignup({ username, email, password }) {
    setAuthLoading(true);
    setAuthError("");
    try {
      const res = await apiSignup({ username, email, password });
      setPendingVerificationEmail(res.email || email);
    } catch (e) {
      setAuthError(e.message || "Could not create account.");
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleResendVerification() {
    if (!pendingVerificationEmail) return;
    setResendLoading(true);
    setResendMessage("");
    try {
      await apiResendVerification({ email: pendingVerificationEmail });
      setResendMessage("Verification email sent — check your inbox.");
    } catch (e) {
      setResendMessage(e.message || "Could not resend the email. Try again in a moment.");
    } finally {
      setResendLoading(false);
    }
  }

  function handleBackToSignIn() {
    setPendingVerificationEmail(null);
    setResendMessage("");
  }
  

  async function handleLogin({ identifier, password }) {
    setAuthLoading(true);
    setAuthError("");
    try {
      const res = await apiLogin({ identifier, password });
      localStorage.setItem("auth_token", res.token);
      setToken(res.token);
    } catch (e) {
      setAuthError(e.message || "Invalid username/email or password.");
    } finally {
      setAuthLoading(false);
    }
  }

  function handleLogout() {
    // Best-effort - if this fails (offline, already-expired token) we still
    // clear locally so the user isn't stuck on the logged-in state.
    if (token) apiLogout({ token }).catch(() => {});
    localStorage.removeItem("auth_token");
    setToken(null);
    handleRestart();
  }

  async function handleGenerate(formValues) {
    setLoading(true);
    setError("");
    try {
      const res =
        formValues.mode === "manual"
          ? await createManualDraft({ token, ...formValues })
          : await generateDraft({ token, ...formValues });
      setDraftId(res.draft_id);
      setDraft(res.draft);
      setStep("draft");
    } catch (e) {
      if (e.status === 401) return handleLogout();
      setError(e.message || "Something went wrong creating the draft.");
    } finally {
      setLoading(false);
    }
  }

  async function handleApprove(live, platforms) {
    setLoading(true);
    setError("");
    try {
      const res = await reviewDraft({ token, draftId, decision: "approve", live, platforms });
      setResult(res.results);
      setStep("done");
    } catch (e) {
      if (e.status === 401) return handleLogout();
      setError(e.message || "Something went wrong while publishing the draft.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSchedule(scheduledAtISO, platforms, live) {
    setLoading(true);
    setError("");
    try {
      await scheduleDraft({ token, draftId, scheduledAt: scheduledAtISO, platforms, live });
      setStep("calendar");
    } catch (e) {
      if (e.status === 401) return handleLogout();
      setError(e.message || "Something went wrong while scheduling the draft.");
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
      if (e.status === 401) return handleLogout();
      setError(e.message || "Something went wrong revising the draft.");
    } finally {
      setLoading(false);
    }
  }



  function handleSaveAsDraft() {
    // The draft was already persisted as pending_review the moment it was
    // generated, so there's nothing to save here — just leave the review
    // screen without approving/scheduling/rejecting. Land on the Publish
    // view's "Drafts" tab (pending review) so it's visibly there, waiting.
    setDraftId(null);
    setDraft(null);
    setResult(null);
    setError("");
    setPublishInitialTab("drafts");
    setStep("publish");
  }

  async function handleOpenDraft(id) {
    setLoading(true);
    setError("");
    try {
      const res = await getDraft({ token, draftId: id });
      setDraftId(res.draft_id);
      setDraft(res.draft);
      setStep("draft");
    } catch (e) {
      if (e.status === 401) return handleLogout();
      setError(e.message || "Could not load that draft.");
    } finally {
      setLoading(false);
    }
  }

  function handleRestart() {
    setStep("generate");
    setDraftId(null);
    setDraft(null);
    setResult(null);
    setError("");
  }

  function handleSendMediaToCompose(asset) {
    setComposeHandoffAsset(asset);
    handleRestart();
  }

  if (!token) {
    if (showAuth) {
      return (
        <div className="center-viewport">
          <div style={{ width: "100%", maxWidth: 400 }}>
            <Login
              onLogin={handleLogin}
              onSignUp={handleSignup}
              loading={authLoading}
              error={authError}
              verifyMessage={verifyMessage}
              pendingVerificationEmail={pendingVerificationEmail}
              onResendVerification={handleResendVerification}
              resendLoading={resendLoading}
              resendMessage={resendMessage}
              onBackToSignIn={handleBackToSignIn}
            />
          </div>
        </div>
      );
    }
    return <Landing onGetStarted={() => setShowAuth(true)} />;
  }

  return (
    <div style={{ display: "flex", minHeight: "100vh", width: "100%" }}>
      <Sidebar
        activeStep={step === "generate" || step === "draft" || step === "done" ? null : step}
        onNavigate={(key) => { setPublishInitialTab("new"); setStep(key); setMobileMenuOpen(false); }}
        onNewPost={() => { handleRestart(); setMobileMenuOpen(false); }}
        onLogout={handleLogout}
        mobileOpen={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
        collapsed={sidebarCollapsed}
        onToggleCollapsed={toggleSidebarCollapsed}
      />

      <div className="main-panel" style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <button
          className="mobile-menu-button"
          onClick={() => setMobileMenuOpen(true)}
          style={{ margin: "1rem 0 0 1rem" }}
          aria-label="Open menu"
        >
          ☰
        </button>

        <div className="page-container">
          {step === "dashboard" && (
            <div style={{ padding: "2rem 0" }}>
              <p style={{ fontFamily: "var(--font-display)", fontSize: "clamp(24px, 4vw, 32px)", color: "var(--ink)", marginBottom: 8 }}>
                Welcome back
              </p>
              <p style={{ color: "var(--text-secondary)", marginBottom: 28 }}>
                Start a new draft, or check in on your connected accounts.
              </p>
              <button className="primary" onClick={handleRestart} style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <span>+ New</span>
              </button>
            </div>
          )}

          {step === "generate" && (
              <Form
                onSubmit={handleGenerate}
                loading={loading}
                error={error}
                token={token}
                initialManualAsset={composeHandoffAsset}
                onConsumeInitialAsset={() => setComposeHandoffAsset(null)}
              />

          )}

          {step === "draft" && (
            <DraftReview
              draft={draft}
              connections={connections}
              onApprove={handleApprove}
              onSchedule={handleSchedule}
              onReject={handleReject}
              onSaveAsDraft={handleSaveAsDraft}
              loading={loading}
              error={error}
            />
          )}
          {step === "done" && <Done result={result} onRestart={handleRestart} />}

          {step === "settings" && (
            <Settings
              token={token}
              connections={connections}
              connectStatus={connectStatus}
              onDismissStatus={() => setConnectStatus(null)}
              onAuthError={handleLogout}
              pagePicker={pagePicker}
              onDone={() => { setPagePicker(null); setStep("generate"); }}
              onPagePickerDone={() => { setPagePicker(null); refreshConnections(); }}
              onConnectionsChanged={refreshConnections}
            />
          )}

          {step === "publish" && (
            <Publish token={token} onNewPost={handleRestart} onOpenDraft={handleOpenDraft} onAuthError={handleLogout} initialTab={publishInitialTab} onSendMediaToCompose={handleSendMediaToCompose} />
          )}

          {step === "calendar" && (
            <Calendar token={token} connections={connections} onOpenDraft={handleOpenDraft} onAuthError={handleLogout} />
          )}

          {step === "analytics" && (
            <Analytics token={token} onAuthError={handleLogout} />
          )}

          {step === "inbox" && (
            <Inbox token={token} connections={connections} onAuthError={handleLogout} />
          )}

          {["billing", "notifications"].includes(step) && (
            <div style={{ padding: "3rem 0", textAlign: "center", color: "var(--text-secondary)" }}>
              <p style={{ fontFamily: "var(--font-display)", fontSize: "22px", color: "var(--ink)", marginBottom: 8 }}>
                {{ billing: "Billing", notifications: "Notifications" }[step]}
              </p>
              <p>This section is coming soon.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}