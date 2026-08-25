// App.jsx
import { useState, useEffect } from "react";
import Login from "./components/Login";
import ChooseUsernameModal from "./components/ChooseUsernameModal";
import Form from "./components/Form";
import DraftReview from "./components/DraftReview";
import Done from "./components/Done";
import Landing from "./components/Landing";
import Sidebar from "./components/Sidebar";
import TopBar from "./components/TopBar";
import Dashboard from "./components/Dashboard";
import Settings from "./components/settings";
import Publish from "./components/Publish";
import PublishNav from "./components/PublishNav";
import SidePanel from "./components/SidePanel";
import Calendar from "./components/Calendar";
import Analytics, { RANGE_OPTIONS } from "./components/Analytics";
import Inbox, { KIND_TABS } from "./components/Inbox";
import HelpCenter from "./components/HelpCenter";
import { MODE_TABS } from "./components/Form";
import { login as apiLogin, logout as apiLogout, signup as apiSignup, verifyEmail as apiVerifyEmail, resendVerification as apiResendVerification, generateDraft, createManualDraft, reviewDraft, scheduleDraft, getConnections, getDraft, getProfile } from "./api";

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
  const [profile, setProfile] = useState(null); // { username, email, avatar_url, timezone, ... } — the logged-in user's own account, from GET /me

  const [showAuth, setShowAuth] = useState(false);
  
  const [step, setStep] = useState("dashboard"); // dashboard | generate | draft | done | settings | ...
  const [connectStatus, setConnectStatus] = useState(null); // { type: "success"|"error", platform }
  const [draftId, setDraftId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [pagePicker, setPagePicker] = useState(null); // { platform, pendingId }
  const [publishTab, setPublishTab] = useState("new");
  const [publishNavCollapsed, setPublishNavCollapsed] = useState(false);
  const [composeMode, setComposeMode] = useState("ai");
  const [analyticsDays, setAnalyticsDays] = useState(30);
  const [inboxKindFilter, setInboxKindFilter] = useState("all");
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

  // Appearance (light/dark) - index.css keys every color var off the
  // document's data-theme attribute, so this just needs to set that and
  // persist the choice; nothing else has driven it until now.
  const [theme, setThemeState] = useState(() => localStorage.getItem("theme") || "dark");

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("theme", theme);
  }, [theme]);


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

  function refreshProfile() {
    if (!token) { setProfile(null); return; }
    getProfile({ token }).then(setProfile).catch(() => {});
  }

  useEffect(refreshProfile, [token]);


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

  // An OAuth signup (Google/LinkedIn/Facebook) still requires clicking the
  // emailed verification link before login - same requirement as password
  // signup. The callback redirects here with the address instead of a
  // login_token when that's still pending; reuse the same "check your
  // inbox" screen and resend flow password signup already has.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const verifyPending = params.get("verify_pending");
    if (verifyPending) {
      window.history.replaceState({}, "", window.location.pathname);
      setShowAuth(true);
      setPendingVerificationEmail(verifyPending);
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
    setProfile(null);
    handleRestart();
  }

  // Account was just deleted server-side (DELETE /me already invalidated
  // every session) - clear local state directly rather than calling
  // apiLogout, which would just fail against a token that's already gone.
  function handleAccountDeleted() {
    localStorage.removeItem("auth_token");
    setToken(null);
    setProfile(null);
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
    setPublishTab("drafts");
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

  // OAuth signup (Google/LinkedIn/Facebook/X) only ever auto-generates a
  // placeholder username server-side - block here until the user picks
  // their own, same screen real-estate as the sign-in/signup form.
  if (profile && !profile.username_is_set) {
    return (
      <div className="center-viewport">
        <ChooseUsernameModal
          token={token}
          suggestedUsername={profile.username}
          onDone={setProfile}
        />
      </div>
    );
  }

  // Every non-excluded page (all except calendar/dashboard/settings) gets a
  // left side panel matching Publish's own PublishNav look, driving that
  // page's existing tabs/filters instead of an in-page tab row.
  const sidePanelConfig = {
    generate: { title: "Compose", tabs: MODE_TABS, activeKey: composeMode, onSelect: setComposeMode },
    analytics: {
      title: "Analytics",
      tabs: RANGE_OPTIONS.map((r) => ({ key: String(r.days), label: r.label })),
      activeKey: String(analyticsDays),
      onSelect: (k) => setAnalyticsDays(Number(k)),
    },
    inbox: { title: "Inbox", tabs: KIND_TABS, activeKey: inboxKindFilter, onSelect: setInboxKindFilter },
  }[step];

  return (
    <div style={{ display: "flex", minHeight: "100vh", width: "100%" }}>
      <Sidebar
        activeStep={step === "generate" || step === "draft" || step === "done" ? null : step}
        onNavigate={(key) => { setPublishTab("new"); setStep(key); setMobileMenuOpen(false); }}
        onNewPost={() => { handleRestart(); setMobileMenuOpen(false); }}
        onLogout={handleLogout}
        mobileOpen={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
        collapsed={sidebarCollapsed}
        onToggleCollapsed={toggleSidebarCollapsed}
        token={token}
        profile={profile}
        onProfileUpdated={setProfile}
        onAccountDeleted={handleAccountDeleted}
        theme={theme}
        onSetTheme={setThemeState}
      />

      {step === "publish" && (
        <PublishNav
          tab={publishTab}
          onSelectTab={setPublishTab}
          collapsed={publishNavCollapsed}
          onToggleCollapsed={() => setPublishNavCollapsed((c) => !c)}
        />
      )}

      {step !== "publish" && sidePanelConfig && (
        <SidePanel
          title={sidePanelConfig.title}
          tabs={sidePanelConfig.tabs}
          activeKey={sidePanelConfig.activeKey}
          onSelect={sidePanelConfig.onSelect}
          collapsed={publishNavCollapsed}
          onToggleCollapsed={() => setPublishNavCollapsed((c) => !c)}
        />
      )}

      <div className="main-panel" style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <TopBar />
        <button
          className="mobile-menu-button"
          onClick={() => setMobileMenuOpen(true)}
          style={{ margin: "1rem 0 0 1rem" }}
          aria-label="Open menu"
        >
          ☰
        </button>

        {(step === "publish" || sidePanelConfig) && publishNavCollapsed && (
          <button
            onClick={() => setPublishNavCollapsed(false)}
            style={{ width: "auto", padding: "0 12px", margin: "1rem 0 0 1rem", alignSelf: "flex-start" }}
            aria-label="Expand panel"
          >
            ⬜ {step === "publish" ? "Publishing" : sidePanelConfig.title}
          </button>
        )}

        <div className={`page-container${step === "publish" ? " is-wide" : step === "calendar" ? " is-wider-calendar" : ""}`}>
          {step === "dashboard" && (
            <Dashboard
              token={token}
              profile={profile}
              onNewPost={handleRestart}
              onNavigate={(key) => { setPublishTab("new"); setStep(key); }}
              onOpenDraft={handleOpenDraft}
              onAuthError={handleLogout}
            />
          )}

          {step === "generate" && (
              <Form
                onSubmit={handleGenerate}
                loading={loading}
                error={error}
                token={token}
                initialManualAsset={composeHandoffAsset}
                onConsumeInitialAsset={() => setComposeHandoffAsset(null)}
                mode={composeMode}
                onModeChange={setComposeMode}
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
            <Publish token={token} tab={publishTab} onNewPost={handleRestart} onOpenDraft={handleOpenDraft} onAuthError={handleLogout} onSendMediaToCompose={handleSendMediaToCompose} />
          )}

          {step === "calendar" && (
            <Calendar token={token} connections={connections} onOpenDraft={handleOpenDraft} onAuthError={handleLogout} />
          )}

          {step === "analytics" && (
            <Analytics token={token} onAuthError={handleLogout} days={analyticsDays} onDaysChange={setAnalyticsDays} />
          )}

          {step === "inbox" && (
            <Inbox token={token} connections={connections} onAuthError={handleLogout} kindFilter={inboxKindFilter} onKindFilterChange={setInboxKindFilter} />
          )}

          {step === "help" && <HelpCenter />}

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