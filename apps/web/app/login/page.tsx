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
  const requestedNext = params.get("next") || "/dashboard";
  const next = requestedNext.startsWith("/") && !requestedNext.startsWith("//") ? requestedNext : "/dashboard";

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
    // No emailRedirectTo: omitting it keeps this a pure OTP flow, so Supabase does not
    // mint a confirmation URL and the email template can render only {{ .Token }}.
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: true } });
    setBusy(false);
    if (error) { setNotice(error.message); return; }
    setStep("code"); setNotice(`We sent a 6-digit code to ${email.trim()}. It expires in 1 hour.`);
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

  return <main className="login-page"><div className="login-orbit" /><section className="login-card"><div className="login-brand"><img src="/icons/48.png" width={26} height={26} alt="" /><span>ApplyPilot</span></div><div className="eyebrow">Private application workspace</div><h1>Build your profile once.</h1><p className="login-lede">Your resume, verified answers, job tracker, and extension sync all live in one secure workspace.</p><div className="login-steps"><span className={step === "email" ? "active" : "done"}>1</span><i /><span className={step === "code" ? "active" : ""}>2</span><small>{step === "email" ? "Email" : "Enter code"}</small></div>{step === "email" ? <><label>Email address<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" autoFocus onKeyDown={(event) => event.key === "Enter" && requestCode()} /></label><button className="login-button" onClick={requestCode} disabled={busy}>{busy ? "Sending code…" : "Email me a sign-in code"}</button></> : <><label>6-digit code<input value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} placeholder="123456" inputMode="numeric" maxLength={6} autoFocus onKeyDown={(event) => event.key === "Enter" && verifyCode()} /></label><button className="login-button" onClick={verifyCode} disabled={busy}>{busy ? "Verifying…" : "Verify and enter workspace"}</button><button className="login-back" onClick={requestCode} disabled={busy}>Resend code</button><button className="login-back" onClick={() => { setStep("email"); setCode(""); setNotice(""); }}>Use a different email</button></>}{notice && <p className="login-notice">{notice}</p>}<p className="login-foot">By continuing, you agree to keep application data accurate and review answers before submitting.</p></section></main>;
}
