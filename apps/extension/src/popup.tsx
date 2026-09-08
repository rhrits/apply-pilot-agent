import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import type { ExtensionMessage } from "@applypilot/shared";
import { extensionConfig, isExtensionConfigured } from "./lib/config";
import "./ui.css";
import "./popup-auth.css";

type AuthState = { configured: boolean; authenticated: boolean; email: string | null; profile?: { firstName?: string; lastName?: string } | null };

function Popup() {
  const [auth, setAuth] = useState<AuthState>({ configured: isExtensionConfigured(), authenticated: false, email: null });
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Checking your ApplyPilot session…");

  async function loadAuth() {
    const result = await chrome.runtime.sendMessage({ type: "AUTH_STATUS" } satisfies ExtensionMessage) as AuthState;
    setAuth(result);
    setMessage(result.authenticated ? `Synced as ${result.email}` : result.configured ? "Sign in to sync your profile" : "Extension configuration is missing");
  }
  useEffect(() => { void loadAuth(); }, []);

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
    setAuth({ configured: isExtensionConfigured(), authenticated: false, email: null }); setMessage("Signed out");
  }
  function openPanel() {
    chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => { if (tab.id) chrome.sidePanel.open({ tabId: tab.id }).then(() => window.close()).catch(() => setMessage("Open the Side Panel from the toolbar")); });
  }
  function openProfile() { chrome.tabs.create({ url: `${extensionConfig.webAppUrl}/profile` }); }

  return <main className="popup-shell"><div className="brand"><span className="brand-mark">✦</span><div><strong>ApplyPilot</strong><small>Authenticated job copilot</small></div></div><div className="status"><span className={`dot ${auth.authenticated ? "" : "idle"}`} />{message}</div>{auth.authenticated ? <><div className="account-card"><strong>{auth.email}</strong><span>Profile synced from Supabase</span></div><button className="button primary" onClick={openPanel}>Open page assistant</button><button className="button secondary" onClick={signOut}>Sign out</button></> : <section className="popup-auth"><h2>Connect your profile</h2><p>Use the same email as the web app. The extension will fetch only your RLS-authorized profile data.</p>{step === "email" ? <><input className="popup-input" value={email} onChange={(event) => setEmail(event.target.value)} type="email" placeholder="you@example.com" /><button className="button primary" onClick={requestCode} disabled={busy}>{busy ? "Sending…" : "Send sign-in email"}</button></> : <><input className="popup-input" value={code} onChange={(event) => setCode(event.target.value)} inputMode="numeric" maxLength={8} placeholder="Code from email" /><button className="button primary" onClick={verifyCode} disabled={busy}>{busy ? "Verifying…" : "Verify code"}</button><button className="button secondary" onClick={() => setStep("email")}>Change email</button></>}{!auth.configured && <button className="button secondary" onClick={openProfile}>Open web setup</button>}</section>}<p className="privacy-note">Your session stays in extension storage. Profile reads are protected by Supabase Row Level Security.</p></main>;
}

createRoot(document.getElementById("root")!).render(<Popup />);
