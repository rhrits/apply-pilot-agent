"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AuthGate } from "../../components/auth-gate";
import { accessFetch } from "../../lib/access-client";
import "./access.css";

type AccessRequest = { id: string; status: "pending" | "approved" | "rejected" | "cancelled"; message?: string | null; reviewer_note?: string | null; created_at: string };
type AccessStatus = { email: string; isAdmin: boolean; hasAccess: boolean; onboardingCompletedAt: string | null; request: AccessRequest | null; entitlements: Array<{ expires_at: string | null }> };

export default function AccessPage() {
  return <AuthGate requireOnboarding={false} requireAccess={false}><AccessContent /></AuthGate>;
}

function AccessContent() {
  const [status, setStatus] = useState<AccessStatus | null>(null);
  const [message, setMessage] = useState("");
  const [requestMessage, setRequestMessage] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  async function loadStatus() {
    try { setStatus(await accessFetch("/api/access/status") as AccessStatus); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not load access status"); }
    finally { setLoading(false); }
  }

  useEffect(() => { void loadStatus(); }, []);

  async function requestAccess() {
    setBusy(true); setMessage("");
    try { await accessFetch("/api/access/request", { method: "POST", body: JSON.stringify({ message: requestMessage }) }); setRequestMessage(""); await loadStatus(); setMessage("Your request is with the ApplyPilot team."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not submit request"); }
    finally { setBusy(false); }
  }

  async function redeemCode() {
    setBusy(true); setMessage("");
    try { await accessFetch("/api/access/redeem", { method: "POST", body: JSON.stringify({ code }) }); await loadStatus(); setCode(""); setMessage("Access unlocked. Welcome to ApplyPilot."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not redeem code"); }
    finally { setBusy(false); }
  }

  if (loading) return <main className="access-page"><div className="access-loading">Checking your access…</div></main>;
  if (!status) return <main className="access-page"><section className="access-card"><h1>Access unavailable</h1><p>{message || "Try refreshing this page."}</p></section></main>;
  if (status.hasAccess) return <main className="access-page"><section className="access-card access-success"><div className="access-brand"><img src="/icons/48.png" width={32} height={32} alt="" /><strong>ApplyPilot</strong></div><span className="access-badge success">ACCESS ACTIVE</span><h1>Your workspace is ready.</h1><p>Your verified profile, answer library, tracker, and extension are unlocked.</p><div className="access-actions"><Link className="access-button primary" href="/dashboard">Open workspace</Link>{status.isAdmin && <Link className="access-button secondary" href="/admin">Open admin</Link>}</div></section></main>;

  const requestStatus = status.request?.status;
  return <main className="access-page"><section className="access-card"><div className="access-brand"><img src="/icons/48.png" width={32} height={32} alt="" /><strong>ApplyPilot</strong>{status.isAdmin && <Link className="admin-link" href="/admin">Admin console</Link>}</div><span className={`access-badge ${requestStatus === "approved" ? "approved" : requestStatus === "rejected" ? "rejected" : "pending"}`}>{requestStatus === "approved" ? "APPROVED" : requestStatus === "rejected" ? "REQUEST AGAIN" : requestStatus ? "PENDING REVIEW" : "INVITE ONLY"}</span><h1>Unlock your application workspace.</h1><p className="access-lede">ApplyPilot is currently in a controlled beta. Request access or enter a one-time invite code from the team.</p>{requestStatus === "pending" && <div className="access-notice"><strong>Request received.</strong><span>We will review your request and send an access code if approved.</span></div>}{requestStatus === "approved" && <div className="access-notice approved-notice"><strong>Your request was approved.</strong><span>Enter the one-time code you received. It expires after one hour.</span></div>}{requestStatus === "rejected" && status.request?.reviewer_note && <div className="access-notice"><strong>Request feedback</strong><span>{status.request.reviewer_note}</span></div>}<div className="access-section"><label htmlFor="access-code">One-time access code</label><div className="access-input-row"><input id="access-code" value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="AP-XXXXXX-XXXXXX-XXXXXX-XXXXXX" autoComplete="off" /><button className="access-button primary" onClick={redeemCode} disabled={busy || code.trim().length < 16}>{busy ? "Checking…" : "Redeem code"}</button></div><small>Codes are single-use and tied to your account.</small></div>{(!requestStatus || requestStatus === "rejected") && <div className="access-section request-section"><label htmlFor="request-message">Request access</label><textarea id="request-message" value={requestMessage} onChange={(event) => setRequestMessage(event.target.value)} placeholder="Tell us briefly how you plan to use ApplyPilot (optional)." rows={3} /><button className="access-button secondary" onClick={requestAccess} disabled={busy}>{busy ? "Sending…" : requestStatus === "rejected" ? "Submit another request" : "Send access request"}</button></div>}{status.onboardingCompletedAt ? <p className="access-foot">Signed in as {status.email}. Your profile is complete.</p> : <p className="access-foot">Complete your profile while your request is reviewed. <Link href="/onboarding">Open onboarding</Link></p>}{message && <p className="access-message">{message}</p>}</section></main>;
}
