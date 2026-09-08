"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getSupabaseBrowserClient } from "../../lib/supabase";
import "./login.css";

export default function LoginPage() {
  return <Suspense fallback={<main className="auth-loading"><span className="loading-orbit" /><p>Loading secure sign-in…</p></main>}><LoginForm /></Suspense>;
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const next = params.get("next") || "/";

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;
    supabase.auth.getUser().then(({ data }) => { if (data.user) router.replace(next); });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => { if (session?.user) router.replace(next); });
    return () => data.subscription.unsubscribe();
  }, [next, router]);

  async function requestCode() {
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !email.trim()) { setNotice("Enter your email address."); return; }
    setBusy(true); setNotice("");
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: true, emailRedirectTo: `${window.location.origin}${next}` } });
    setBusy(false);
    if (error) { setNotice(error.message); return; }
    setStep("code"); setNotice("Check your email for a code or click the sign-in link.");
  }

  async function verifyCode() {
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !code.trim()) { setNotice("Enter the code from your email."); return; }
    setBusy(true);
    const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: "email" });
    setBusy(false);
    if (error) { setNotice(error.message); return; }
    router.replace(next);
  }

  return <main className="login-page"><div className="login-orbit" /><section className="login-card"><div className="login-brand"><span className="logo-mark">✦</span><span>ApplyPilot</span></div><div className="eyebrow">Private application workspace</div><h1>Build your profile once.</h1><p className="login-lede">Your resume, verified answers, job tracker, and extension sync all live in one secure workspace.</p><div className="login-steps"><span className={step === "email" ? "active" : "done"}>1</span><i /><span className={step === "code" ? "active" : ""}>2</span><small>{step === "email" ? "Email" : "Verify code"}</small></div>{step === "email" ? <><label>Email address<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" autoFocus /></label><button className="login-button" onClick={requestCode} disabled={busy}>{busy ? "Sending…" : "Continue with email"}</button></> : <><label>One-time code<input value={code} onChange={(event) => setCode(event.target.value)} placeholder="Enter the code from your email" inputMode="numeric" autoFocus /></label><button className="login-button" onClick={verifyCode} disabled={busy}>{busy ? "Verifying…" : "Verify and enter workspace"}</button><button className="login-back" onClick={() => setStep("email")}>Use a different email</button></>}{notice && <p className="login-notice">{notice}</p>}<p className="login-foot">By continuing, you agree to keep application data accurate and review answers before submitting.</p></section></main>;
}
