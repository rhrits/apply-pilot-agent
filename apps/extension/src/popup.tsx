import { createRoot } from "react-dom/client";
import { useEffect, useRef, useState } from "react";
import type { ExtensionAuthStatus, ExtensionMessage } from "@uplyfox/shared";
import { extensionConfig, isExtensionConfigured } from "./lib/config";
import "./ui.css";
import "./popup-auth.css";
import "./popup-settings.css";
import "./popup-fox.css";
import "./brand-overrides.css";
import "./popup-jungle.css";
import "./popup-fixed.css";

type AuthState = ExtensionAuthStatus;

function Popup() {
  const [auth, setAuth] = useState<AuthState>({ configured: isExtensionConfigured(), authenticated: false, accessState: isExtensionConfigured() ? "unauthenticated" : "unconfigured", userId: null, email: null, profile: null });
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Checking your UplyFox session…");
  const [autoSuggest, setAutoSuggest] = useState(true);
  const [liveAI, setLiveAI] = useState(true);
  const [activeTabId, setActiveTabId] = useState<number | null>(null);
  const [connection, setConnection] = useState<{ ok: boolean; message: string; localhostBuild?: boolean } | null>(null);
  const [checking, setChecking] = useState(false);
  const [foxBusy, setFoxBusy] = useState(false);
  const foxWorkCount = useRef(0);

  function beginFoxWork() {
    foxWorkCount.current += 1;
    setFoxBusy(true);
  }

  function endFoxWork() {
    foxWorkCount.current = Math.max(0, foxWorkCount.current - 1);
    if (foxWorkCount.current === 0) setFoxBusy(false);
  }

  async function runConnectionCheck() {
    beginFoxWork();
    setChecking(true);
    try {
      const report = await chrome.runtime.sendMessage({ type: "CHECK_CONNECTION" } satisfies ExtensionMessage).catch(() => null);
      setConnection(report ?? { ok: false, message: "The UplyFox background worker did not respond. Reload the extension." });
    } finally {
      setChecking(false);
      endFoxWork();
    }
  }

  async function loadAuth() {
    beginFoxWork();
    try {
      const result = await chrome.runtime.sendMessage({ type: "AUTH_STATUS" } satisfies ExtensionMessage).catch((error) => ({
        ...auth,
        accessState: "unauthenticated" as const,
        error: error instanceof Error ? error.message : "The extension background worker did not respond.",
      })) as AuthState & { error?: string };
      if (result.accessState === "profile_required") {
        setAuth({ ...result, authenticated: false });
        setMessage("Your profile is required before the extension can be used. Opening onboarding…");
        await chrome.tabs.create({ url: result.onboardingUrl ?? `${extensionConfig.webAppUrl}/login?next=/onboarding` });
        window.close();
        return;
      }
      if (result.accessState === "access_required") {
        setAuth({ ...result, authenticated: false });
        setMessage("Access approval is required before the extension can be used. Opening access…");
        await chrome.tabs.create({ url: result.accessUrl ?? `${extensionConfig.webAppUrl}/access` });
        window.close();
        return;
      }
      setAuth(result);
      // The account card directly below already displays the email and sync state.
      // Repeating both here made the popup read like the same row was rendered twice.
      setMessage(result.error || (result.accessState === "ready" ? "Ready for your next application" : result.configured ? "Sign in to sync your profile" : "Extension configuration is missing"));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load your UplyFox session.");
    } finally {
      endFoxWork();
    }
  }
  useEffect(() => { void loadAuth(); }, []);
  useEffect(() => {
    beginFoxWork();
    void chrome.runtime.sendMessage({ type: "GET_SETTINGS" } satisfies ExtensionMessage)
      .then((settings) => { setAutoSuggest(settings?.autoSuggest !== false); setLiveAI(settings?.liveAI !== false); })
      .catch(() => undefined)
      .finally(endFoxWork);
  }, []);
  useEffect(() => { chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => setActiveTabId(tab?.id ?? null)).catch(() => undefined); }, []);

  async function toggleAutoSuggest() {
    const next = !autoSuggest;
    setAutoSuggest(next);
    beginFoxWork();
    try {
      await chrome.runtime.sendMessage({ type: "UPDATE_SETTINGS", settings: { autoSuggest: next } } satisfies ExtensionMessage);
    } finally {
      endFoxWork();
    }
  }

  async function toggleLiveAI() {
    const next = !liveAI;
    setLiveAI(next);
    beginFoxWork();
    try {
      await chrome.runtime.sendMessage({ type: "UPDATE_SETTINGS", settings: { liveAI: next } } satisfies ExtensionMessage);
    } finally {
      endFoxWork();
    }
  }

  const connectionPanel = <>
    <button className="button secondary" onClick={runConnectionCheck} disabled={checking}>{checking ? "Checking…" : "Check AI connection"}</button>
    {connection && <p className={`connection-note ${connection.ok ? "ok" : "bad"}`}>{connection.message}</p>}
  </>;


  async function requestCode() {
    if (!email.trim()) { setMessage("Enter your email first"); return; }
    beginFoxWork();
    setBusy(true);
    try {
      const result = await chrome.runtime.sendMessage({ type: "AUTH_REQUEST_OTP", email } satisfies ExtensionMessage) as { ok: boolean; error?: string };
      if (!result.ok) { setMessage(result.error || "Could not send sign-in email"); return; }
      setStep("code"); setMessage("Check your email and enter the code");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The sign-in service did not respond. Reload the extension and try again.");
    } finally {
      setBusy(false);
      endFoxWork();
    }
  }
  async function verifyCode() {
    beginFoxWork();
    setBusy(true);
    try {
      const result = await chrome.runtime.sendMessage({ type: "AUTH_VERIFY_OTP", email, token: code } satisfies ExtensionMessage) as { ok: boolean; error?: string; email?: string };
      if (!result.ok) { setMessage(result.error || "Invalid or expired code"); return; }
      setStep("email"); setCode("");
      await loadAuth();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not verify that code. Try again.");
    } finally {
      setBusy(false);
      endFoxWork();
    }
  }
  async function signOut() {
    beginFoxWork();
    try {
      await chrome.runtime.sendMessage({ type: "AUTH_SIGN_OUT", clearLocalData: true } satisfies ExtensionMessage);
      setAuth({ configured: isExtensionConfigured(), authenticated: false, accessState: isExtensionConfigured() ? "unauthenticated" : "unconfigured", userId: null, email: null, profile: null }); setMessage("Signed out");
    } finally {
      endFoxWork();
    }
  }
  async function refreshProfile() {
    beginFoxWork();
    setMessage("Refreshing your profile…");
    try {
      const result = await chrome.runtime.sendMessage({ type: "REFRESH_PROFILE" } satisfies ExtensionMessage);
      setMessage(result?.profile ? "Your profile is up to date" : result?.error || "Profile refresh failed");
    } finally {
      endFoxWork();
    }
  }
  function openPanel() {
    if (activeTabId === null) { setMessage("Open the Side Panel from the toolbar"); return; }
    chrome.sidePanel.open({ tabId: activeTabId }).then(() => window.close()).catch((error) => setMessage(String(error)));
  }
  function openProfile() { chrome.tabs.create({ url: auth.accessState === "profile_required" ? auth.onboardingUrl ?? `${extensionConfig.webAppUrl}/login?next=/onboarding` : auth.profileUrl ?? `${extensionConfig.webAppUrl}/profile` }); }

  return <main className="popup-shell">
    {foxBusy && <div className="fox-loading" role="status" aria-live="polite">
      <div className="fox-loading-orbit"><span className="fox-orbit-ring" /><img src="/uplyfox-pixel-crimson-animated-logo.svg" alt="" /></div>
      <strong>UplyFox is working…</strong>
      <small>Fetching your profile securely</small>
    </div>}
    <div className="brand"><img className="brand-mark static-fox" src="/uplyfox-pixel-crimson-logo.svg" width={34} height={34} alt="UplyFox fox" /><div><strong>UplyFox</strong><small>Authenticated job copilot</small></div></div>
    <div className="status"><span className={`dot ${auth.authenticated ? "" : "idle"}`} />{message}</div>
    {auth.authenticated ? <>
      <div className="account-card"><strong>{auth.email}</strong><span>Profile data synced</span></div>
      <button className="button primary" onClick={openPanel}>Open page assistant</button>
      <button className="button secondary" onClick={refreshProfile}>Sync profile data</button>
      <label className="toggle-row"><span><strong>Automatic suggestions</strong><small>Show a suggestion when you focus a field</small></span><input type="checkbox" checked={autoSuggest} onChange={toggleAutoSuggest} /></label>
      <label className="toggle-row"><span><strong>Live AI suggestions</strong><small>When there's no direct match, ask the AI and offer to save it</small></span><input type="checkbox" checked={liveAI} onChange={toggleLiveAI} /></label>
      {connectionPanel}
      <button className="button secondary" onClick={signOut}>Sign out</button>
    </> : <section className="popup-auth">
      <h2>Connect your profile</h2><p>Use the same email as the web app to sync your profile data.</p>
      {step === "email" ? <><input className="popup-input" value={email} onChange={(event) => setEmail(event.target.value)} type="email" placeholder="you@example.com" /><button className="button primary" onClick={requestCode} disabled={busy}>{busy ? "Sending…" : "Send sign-in email"}</button></> : <><input className="popup-input" value={code} onChange={(event) => setCode(event.target.value)} inputMode="numeric" maxLength={8} placeholder="Code from email" /><button className="button primary" onClick={verifyCode} disabled={busy}>{busy ? "Verifying…" : "Verify code"}</button><button className="button secondary" onClick={() => setStep("email")}>Change email</button></>}
      {!auth.configured && <button className="button secondary" onClick={openProfile}>Open web setup</button>}
    </section>}
    <p className="privacy-note">Your session stays in extension storage. Your profile data is only available to you.</p>
  </main>;
}

createRoot(document.getElementById("root")!).render(<Popup />);
