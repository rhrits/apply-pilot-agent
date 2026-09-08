import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import type { ExtensionAuthStatus, ExtensionMessage } from "@applypilot/shared";
import { extensionConfig, isExtensionConfigured } from "./lib/config";
import "./ui.css";
import "./popup-auth.css";
import "./popup-settings.css";

type AuthState = ExtensionAuthStatus;

function Popup() {
  const [auth, setAuth] = useState<AuthState>({ configured: isExtensionConfigured(), authenticated: false, accessState: isExtensionConfigured() ? "unauthenticated" : "unconfigured", userId: null, email: null, profile: null });
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Checking your ApplyPilot session…");
  const [autoSuggest, setAutoSuggest] = useState(true);
  const [liveAI, setLiveAI] = useState(false);
  const [activeTabId, setActiveTabId] = useState<number | null>(null);

  async function loadAuth() {
    const result = await chrome.runtime.sendMessage({ type: "AUTH_STATUS" } satisfies ExtensionMessage) as AuthState;
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
    setMessage(result.accessState === "ready" ? `Profile data synced for ${result.email}` : result.configured ? "Sign in to sync your profile" : "Extension configuration is missing");
  }
  useEffect(() => { void loadAuth(); }, []);
  useEffect(() => { chrome.runtime.sendMessage({ type: "GET_SETTINGS" } satisfies ExtensionMessage).then((settings) => { setAutoSuggest(settings?.autoSuggest !== false); setLiveAI(settings?.liveAI === true); }).catch(() => undefined); }, []);
  useEffect(() => { chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => setActiveTabId(tab?.id ?? null)).catch(() => undefined); }, []);

  async function toggleAutoSuggest() {
    const next = !autoSuggest;
    setAutoSuggest(next);
    await chrome.runtime.sendMessage({ type: "UPDATE_SETTINGS", settings: { autoSuggest: next } } satisfies ExtensionMessage);
  }

  async function toggleLiveAI() {
    const next = !liveAI;
    setLiveAI(next);
    await chrome.runtime.sendMessage({ type: "UPDATE_SETTINGS", settings: { liveAI: next } } satisfies ExtensionMessage);
  }

  async function requestCode() {
    if (!email.trim()) { setMessage("Enter your email first"); return; }
    setBusy(true);
    const result = await chrome.runtime.sendMessage({ type: "AUTH_REQUEST_OTP", email } satisfies ExtensionMessage) as { ok: boolean; error?: string };
    setBusy(false);
    if (!result.ok) { setMessage(result.error || "Could not send sign-in email"); return; }
    setStep("code"); setMessage("Check your email and enter the code");
  }
  async function verifyCode() {
    setBusy(true);
    const result = await chrome.runtime.sendMessage({ type: "AUTH_VERIFY_OTP", email, token: code } satisfies ExtensionMessage) as { ok: boolean; error?: string; email?: string };
    setBusy(false);
    if (!result.ok) { setMessage(result.error || "Invalid or expired code"); return; }
    await loadAuth(); setStep("email"); setCode("");
  }
  async function signOut() {
    await chrome.runtime.sendMessage({ type: "AUTH_SIGN_OUT" } satisfies ExtensionMessage);
    setAuth({ configured: isExtensionConfigured(), authenticated: false, accessState: isExtensionConfigured() ? "unauthenticated" : "unconfigured", userId: null, email: null, profile: null }); setMessage("Signed out");
  }
  async function refreshProfile() {
    setMessage("Refreshing your profile…");
    const result = await chrome.runtime.sendMessage({ type: "REFRESH_PROFILE" } satisfies ExtensionMessage);
    setMessage(result?.profile ? "Your profile is up to date" : result?.error || "Profile refresh failed");
  }
  function openPanel() {
    if (activeTabId === null) { setMessage("Open the Side Panel from the toolbar"); return; }
    chrome.sidePanel.open({ tabId: activeTabId }).then(() => window.close()).catch((error) => setMessage(String(error)));
  }
  function openProfile() { chrome.tabs.create({ url: auth.accessState === "profile_required" ? auth.onboardingUrl ?? `${extensionConfig.webAppUrl}/login?next=/onboarding` : auth.profileUrl ?? `${extensionConfig.webAppUrl}/profile` }); }

  return <main className="popup-shell"><div className="brand"><img className="brand-mark" src="/icons/48.png" width={34} height={34} alt="" /><div><strong>ApplyPilot</strong><small>Authenticated job copilot</small></div></div><div className="status"><span className={`dot ${auth.authenticated ? "" : "idle"}`} />{message}</div>{auth.authenticated ? <><div className="account-card"><strong>{auth.email}</strong><span>Profile data synced</span></div><button className="button primary" onClick={openPanel}>Open page assistant</button><button className="button secondary" onClick={refreshProfile}>Sync profile data</button><label className="toggle-row"><span><strong>Automatic suggestions</strong><small>Show a suggestion when you focus a field</small></span><input type="checkbox" checked={autoSuggest} onChange={toggleAutoSuggest} /></label><label className="toggle-row"><span><strong>Live AI suggestions</strong><small>When there's no direct match, ask the AI and offer to save it</small></span><input type="checkbox" checked={liveAI} onChange={toggleLiveAI} /></label><button className="button secondary" onClick={signOut}>Sign out</button></> : <section className="popup-auth"><h2>Connect your profile</h2><p>Use the same email as the web app to sync your profile data.</p>{step === "email" ? <><input className="popup-input" value={email} onChange={(event) => setEmail(event.target.value)} type="email" placeholder="you@example.com" /><button className="button primary" onClick={requestCode} disabled={busy}>{busy ? "Sending…" : "Send sign-in email"}</button></> : <><input className="popup-input" value={code} onChange={(event) => setCode(event.target.value)} inputMode="numeric" maxLength={8} placeholder="Code from email" /><button className="button primary" onClick={verifyCode} disabled={busy}>{busy ? "Verifying…" : "Verify code"}</button><button className="button secondary" onClick={() => setStep("email")}>Change email</button></>}{!auth.configured && <button className="button secondary" onClick={openProfile}>Open web setup</button>}</section>}<p className="privacy-note">Your session stays in extension storage. Your profile data is only available to you.</p></main>;
}

createRoot(document.getElementById("root")!).render(<Popup />);
