"use client";

import { useEffect, useState } from "react";
import { AuthGate } from "../../components/auth-gate";
import { accessFetch } from "../../lib/access-client";
import "./admin.css";

type AccessRequest = { id: string; user_id: string; email: string; status: "pending" | "approved" | "rejected" | "cancelled"; message?: string | null; reviewer_note?: string | null; created_at: string; reviewed_at?: string | null };
type AccessCode = { id: string; request_id: string; email: string; code_prefix: string; status: "active" | "redeemed" | "expired" | "revoked"; expires_at: string; redeemed_at?: string | null; created_at: string };

export default function AdminPage() {
  return <AuthGate requireOnboarding={false} requireAccess={false}><AdminContent /></AuthGate>;
}

function AdminContent() {
  const [requests, setRequests] = useState<AccessRequest[]>([]);
  const [codes, setCodes] = useState<AccessCode[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [generatedCode, setGeneratedCode] = useState("");
  const [generatedCodeId, setGeneratedCodeId] = useState("");
  const [generatedEmail, setGeneratedEmail] = useState("");
  const [authorized, setAuthorized] = useState(true);

  async function load() {
    try {
      const [requestRows, codeRows] = await Promise.all([accessFetch("/api/admin/access-requests"), accessFetch("/api/admin/codes")]);
      setRequests(requestRows as AccessRequest[]);
      setCodes(codeRows as AccessCode[]);
      setAuthorized(true);
    } catch (error) {
      setAuthorized(false);
      setNotice(error instanceof Error ? error.message : "Could not load admin console");
    }
  }

  useEffect(() => { void load(); }, []);

  async function review(requestId: string, decision: "approved" | "rejected") {
    setBusy(requestId); setNotice("");
    try {
      await accessFetch("/api/admin/access-requests", { method: "POST", body: JSON.stringify({ requestId, decision }) });
      await load();
      setNotice(`Request ${decision}.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not update request"); }
    finally { setBusy(null); }
  }

  async function createCode(request: AccessRequest) {
    setBusy(request.id); setNotice("");
    try {
      const result = await accessFetch("/api/admin/codes", { method: "POST", body: JSON.stringify({ requestId: request.id }) }) as { id: string; code: string };
      setGeneratedCode(result.code);
      setGeneratedCodeId(result.id);
      setGeneratedEmail(request.email);
      await load();
      setNotice("Code generated. Send it now or copy it for a separate message.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not create code"); }
    finally { setBusy(null); }
  }

  async function sendCodeEmail() {
    if (!generatedCode || !generatedCodeId) return;
    setBusy("send-email"); setNotice("");
    try {
      await accessFetch("/api/admin/codes/send", { method: "POST", body: JSON.stringify({ codeId: generatedCodeId, code: generatedCode }) });
      setNotice(`Access code sent to ${generatedEmail}.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not send code email"); }
    finally { setBusy(null); }
  }

  async function revoke(codeId: string) {
    setBusy(codeId); setNotice("");
    try {
      await accessFetch("/api/admin/codes", { method: "POST", body: JSON.stringify({ action: "revoke", codeId }) });
      await load();
      setNotice("Code revoked.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not revoke code"); }
    finally { setBusy(null); }
  }

  if (!authorized) return <main className="admin-page"><section className="admin-empty"><h1>Admin access required</h1><p>{notice || "This account is not configured as a UplyFox administrator."}</p></section></main>;

  const pending = requests.filter((item) => item.status === "pending");
  return <main className="admin-page">
    <header className="admin-header"><div><span className="admin-kicker">UplyFox control room</span><h1>Access requests</h1><p>Review requests, issue one-time codes, and email approved users securely.</p></div><a href="/access" className="admin-back">Back to access</a></header>
    {generatedCode && <section className="generated-code"><div><span>New code · show this once</span><strong>{generatedCode}</strong><small>Bound to {generatedEmail}. Expires in one hour.</small><p>Send the styled UplyFox email with the same code and a one-click unlock link.</p></div><div className="generated-actions"><button className="send-email-button" onClick={sendCodeEmail} disabled={busy === "send-email"}>{busy === "send-email" ? "Sending…" : "Send code email"}</button><button className="copy-code-button" onClick={() => navigator.clipboard.writeText(generatedCode)}>Copy code</button></div></section>}
    {notice && <p className="admin-notice">{notice}</p>}
    <section className="admin-stats"><div><strong>{pending.length}</strong><span>Pending requests</span></div><div><strong>{requests.filter((item) => item.status === "approved").length}</strong><span>Approved</span></div><div><strong>{codes.filter((item) => item.status === "active").length}</strong><span>Active codes</span></div><div><strong>{codes.filter((item) => item.status === "redeemed").length}</strong><span>Redeemed</span></div></section>
    <section className="admin-panel"><div className="admin-panel-head"><div><span className="admin-kicker">Review queue</span><h2>Requests</h2></div><button className="refresh-button" onClick={load}>Refresh</button></div>{requests.length === 0 ? <p className="admin-muted">No access requests yet.</p> : <div className="request-list">{requests.map((item) => <article className="request-row" key={item.id}><div className="request-main"><strong>{item.email}</strong><span>Requested {new Date(item.created_at).toLocaleString()}</span>{item.message && <p>{item.message}</p>}</div><span className={`status-pill ${item.status}`}>{item.status}</span><div className="request-actions">{item.status === "pending" && <><button className="approve" disabled={busy === item.id} onClick={() => review(item.id, "approved")}>Approve</button><button className="reject" disabled={busy === item.id} onClick={() => review(item.id, "rejected")}>Reject</button></>}{item.status === "approved" && <button className="approve" disabled={busy === item.id} onClick={() => createCode(item)}>Generate 1-hour code</button>}</div></article>)}</div>}</section>
    <section className="admin-panel"><div className="admin-panel-head"><div><span className="admin-kicker">Issued invitations</span><h2>One-time codes</h2></div></div>{codes.length === 0 ? <p className="admin-muted">Codes appear here after a request is approved.</p> : <div className="code-list">{codes.map((item) => <article className="code-row" key={item.id}><div><strong>{item.code_prefix}…</strong><span>{item.email}</span></div><span className={`status-pill ${item.status}`}>{item.status}</span><small>{item.status === "active" ? `Expires ${new Date(item.expires_at).toLocaleString()}` : item.redeemed_at ? `Redeemed ${new Date(item.redeemed_at).toLocaleString()}` : ""}</small>{item.status === "active" && <button className="reject" disabled={busy === item.id} onClick={() => revoke(item.id)}>Revoke</button>}</article>)}</div>}</section>
  </main>;
}
