import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { ActiveFieldPayload, AnswerResponse, ExtensionMessage } from "@applypilot/shared";
import { extensionConfig } from "./lib/config";
import "./sidepanel.css";
import "./sidepanel-auth.css";

const API_URL = extensionConfig.aiApiUrl;

function SidePanel() {
  const [active, setActive] = useState<ActiveFieldPayload | null>(null);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<AnswerResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [authenticated, setAuthenticated] = useState(false);
  const [accountEmail, setAccountEmail] = useState<string | null>(null);

  useEffect(() => {
    chrome.runtime.sendMessage({ type: "AUTH_STATUS" } satisfies ExtensionMessage).then((result) => {
      setAuthenticated(Boolean(result?.authenticated));
      setAccountEmail(result?.email ?? null);
    }).catch(() => undefined);
    chrome.runtime.sendMessage({ type: "GET_ACTIVE_FIELD" } satisfies ExtensionMessage).then((result) => {
      const payload = result?.activeField as ActiveFieldPayload | undefined;
      if (payload) { setActive(payload); setQuestion(payload.field.question); }
    }).catch(() => undefined);
  }, []);

  async function generate() {
    const prompt = question.trim();
    if (!prompt) return;
    setLoading(true); setStatus("");
    try {
      const tokenResult = await chrome.runtime.sendMessage({ type: "GET_AUTH_TOKEN" } satisfies ExtensionMessage);
      if (!tokenResult?.accessToken) throw new Error("Sign in to use your synced profile");
      const response = await fetch(API_URL, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenResult.accessToken}` }, body: JSON.stringify({ question: prompt, page: active?.page }) });
      if (!response.ok) throw new Error("API unavailable");
      setAnswer(await response.json() as AnswerResponse);
    } catch (error) { setAnswer(null); setStatus(error instanceof Error ? error.message : "Sign in required before generating an answer."); }
    finally { setLoading(false); }
  }

  async function copy() { if (answer) { await navigator.clipboard.writeText(answer.answer); setStatus("Copied to clipboard"); } }
  async function insert() { if (!answer) return; const result = await chrome.runtime.sendMessage({ type: "GET_ACTIVE_FIELD" } satisfies ExtensionMessage); const tabId = result?.activeTabId; if (tabId) { await chrome.tabs.sendMessage(tabId, { type: "INSERT_IN_ACTIVE_FIELD", value: answer.answer } satisfies ExtensionMessage); setStatus("Inserted into the focused field"); } else setStatus("Focus a field first"); }

  return <main className="panel"><header><div className="brand-mark">✦</div><div><h1>ApplyPilot</h1><p>Page assistant</p></div><span className="ready">{authenticated ? "SYNCED" : "SIGN IN"}</span></header>{!authenticated && <section className="auth-banner">Sign in from the extension popup to connect your Supabase profile.</section>}{authenticated && <section className="account-banner">Signed in as {accountEmail}</section>}<section className="page-card"><small>{active?.page.hostname ?? "Current page"}</small><strong>{active?.page.title ?? "Focus a form field to start"}</strong></section><label className="label">Question or field prompt</label><textarea value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Paste a question, or focus a field on the page…" rows={4} /><button className="generate" onClick={generate} disabled={loading}>{loading ? "Generating…" : "Generate answer"}</button>{answer && <section className="answer-card"><div className="answer-meta"><span>Suggested answer</span><span>{answer.source}</span></div><p>{answer.answer}</p><div className="actions"><button onClick={copy}>Copy</button><button onClick={insert}>Insert</button></div></section>}{status && <p className="status">{status}</p>}<footer>Autofill is confidence-aware. Review sensitive answers before submitting.</footer></main>;
}

createRoot(document.getElementById("root")!).render(<SidePanel />);
