"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AuthGate } from "../../components/auth-gate";
import { accessFetch } from "../../lib/access-client";
import "./access.css";

type AccessRequest = { id: string; status: "pending" | "approved" | "rejected" | "cancelled"; message?: string | null; reviewer_note?: string | null; created_at: string };
type AccessStatus = { email: string; isAdmin: boolean; hasAccess: boolean; onboardingCompletedAt: string | null; request: AccessRequest | null; entitlements: Array<{ expires_at: string | null }> };

export default function AccessPage() {
  return <AuthGate requireOnboarding={false} requireAccess={false}><AccessContent /></AuthGate>;
}

function AccessContent() {
  const router = useRouter();
  const params = useSearchParams();
  const requestedNext = params.get("next") || "/dashboard";
  const nextPath = requestedNext.startsWith("/") && !requestedNext.startsWith("//") ? requestedNext : "/dashboard";
  const inviteCode = params.get("code") ?? "";
  const autoRedeemed = useRef(false);
  const [status, setStatus] = useState<AccessStatus | null>(null);
  const [message, setMessage] = useState("");
  const [requestMessage, setRequestMessage] = useState("");
  const [code, setCode] = useState(inviteCode);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  async function loadStatus() {
    try { setStatus(await accessFetch("/api/access/status") as AccessStatus); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not load access status"); }
    finally { setLoading(false); }
  }

  useEffect(() => { void loadStatus(); }, []);
  useEffect(() => { if (status?.hasAccess) router.replace(nextPath); }, [nextPath, router, status?.hasAccess]);

  async function requestAccess() {
    setBusy(true); setMessage("");
    try { await accessFetch("/api/access/request", { method: "POST", body: JSON.stringify({ message: requestMessage }) }); setRequestMessage(""); await loadStatus(); setMessage("Your request was sent. We will email you if it is approved."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not submit request"); }
    finally { setBusy(false); }
  }

  async function redeemCode(value = code) {
    const submittedCode = value.trim();
    if (!submittedCode) return;
    setBusy(true); setMessage("");
    try { await accessFetch("/api/access/redeem", { method: "POST", body: JSON.stringify({ code: submittedCode }) }); setCode(""); router.replace(nextPath); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not redeem code"); }
    finally { setBusy(false); }
  }

  useEffect(() => {
    if (!loading && status && !status.hasAccess && inviteCode && !autoRedeemed.current) {
      autoRedeemed.current = true;
      void redeemCode(inviteCode);
    }
  }, [inviteCode, loading, status]);

  if (loading) return <main className="access-page"><div className="access-loading">Checking your access…</div></main>;
  if (!status) return <main className="access-page"><section className="access-card"><h1>Access unavailable</h1><p>{message || "Try refreshing this page."}</p></section></main>;
  if (status.hasAccess) return <main className="access-page"><section className="access-card access-success"><div className="access-brand"><img src="/icons/48.png" width={30} height={30} alt="" /><strong>ApplyPilot</strong></div><span className="access-badge success">ACCESS ACTIVE</span><h1>Your workspace is ready.</h1><p>Your profile, answer library, tracker, and extension are unlocked.</p><div className="access-actions"><Link className="access-button primary" href={nextPath}>Continue</Link>{status.isAdmin && <Link className="access-button secondary" href="/admin">Admin console</Link>}</div></section></main>;

  const requestStatus = status.request?.status;
  return <main className="access-page"><section className="access-card"><div className="access-brand"><img src="/icons/48.png" width={30} height={30} alt="" /><strong>ApplyPilot</strong>{status.isAdmin && <Link className="admin-link" href="/admin">Admin console</Link>}</div><span className={`access-badge ${requestStatus === "approved" ? "approved" : requestStatus === "rejected" ? "rejected" : "pending"}`}>{requestStatus === "approved" ? "APPROVED" : requestStatus === "rejected" ? "REQUEST AGAIN" : requestStatus ? "PENDING REVIEW" : "INVITE ONLY"}</span><h1>Get access to ApplyPilot.</h1><p className="access-lede">ApplyPilot is in a controlled beta. Request an invite and unlock your workspace with a one-time code.</p><div className="access-steps"><strong>How it works</strong><span>1. Request access.</span><span>2. Wait for approval.</span><span>3. Enter the code from email.</span></div>{requestStatus === "pending" && <div className="access-notice"><strong>Request received.</strong><span>We will review it and email you if approved.</span></div>}{requestStatus === "approved" && <div className="access-notice approved-notice"><strong>Your request was approved.</strong><span>Your code is ready. It expires after one hour and can be used once.</span></div>}{requestStatus === "rejected" && status.request?.reviewer_note && <div className="access-notice"><strong>Request feedback</strong><span>{status.request.reviewer_note}</span></div>}<div className="access-section"><label htmlFor="access-code">Have an access code?</label><div className="access-input-row"><input id="access-code" value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="AP-XXXXXX-XXXXXX-XXXXXX-XXXXXX" autoComplete="off" /><button className="access-button primary" onClick={() => void redeemCode()} disabled={busy || code.trim().length < 16}>{busy ? "Checking…" : "Unlock workspace"}</button></div><small>Use the code from your ApplyPilot email. The email button can fill and apply it automatically.</small></div>{(!requestStatus || requestStatus === "rejected") && <div className="access-section request-section"><label htmlFor="request-message">Request an access code</label><textarea id="request-message" value={requestMessage} onChange={(event) => setRequestMessage(event.target.value)} placeholder="Tell us briefly how you plan to use ApplyPilot (optional)." rows={3} /><button className="access-button secondary" onClick={() => void requestAccess()} disabled={busy}>{busy ? "Sending…" : requestStatus === "rejected" ? "Submit another request" : "Send request"}</button></div>}{status.onboardingCompletedAt ? <p className="access-foot">Signed in as {status.email}. Your profile is complete.</p> : <p className="access-foot">Complete your profile while your request is reviewed. <Link href="/onboarding">Open onboarding</Link></p>}{message && <p className="access-message">{message}</p>}</section></main>;
}
