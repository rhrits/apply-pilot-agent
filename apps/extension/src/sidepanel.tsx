import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { ActiveFieldPayload, AnswerResponse, ExtensionMessage, ScannedField, UserProfile } from "@applypilot/shared";
import { extensionConfig } from "./lib/config";
import "./sidepanel.css";
import "./sidepanel-auth.css";
import "./sidepanel-tabs.css";

const API_URL = extensionConfig.aiApiUrl;

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  if (!value) return null;
  async function copy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }
  return <div className="copy-row"><div className="copy-row-text"><small>{label}</small><span>{value}</span></div><button onClick={copy}>{copied ? "✓" : "Copy"}</button></div>;
}

function ProfileTab({ profile }: { profile: UserProfile | null }) {
  if (!profile) return <p className="empty">Sign in from the extension popup to load your profile.</p>;
  const name = [profile.firstName, profile.lastName].filter(Boolean).join(" ");
  return <div className="tab-body">
    <h2>Contact</h2>
    <CopyRow label="Full name" value={name} />
    <CopyRow label="First name" value={profile.firstName} />
    <CopyRow label="Last name" value={profile.lastName} />
    <CopyRow label="Email" value={profile.email} />
    <CopyRow label="Phone" value={profile.phone} />
    <CopyRow label="Location" value={profile.location} />
    <h2>Links</h2>
    <CopyRow label="LinkedIn" value={profile.linkedin} />
    <CopyRow label="GitHub" value={profile.github} />
    <CopyRow label="Portfolio" value={profile.portfolio} />
    <h2>Application answers</h2>
    <CopyRow label="Current title" value={profile.currentTitle ?? ""} />
    <CopyRow label="Notice period" value={profile.noticePeriod ?? ""} />
    <CopyRow label="Total experience" value={profile.totalExperience ?? ""} />
    <CopyRow label="Current CTC" value={profile.currentSalary ?? ""} />
    <CopyRow label="Expected CTC" value={profile.expectedSalary ?? ""} />
    <CopyRow label="Willing to relocate" value={profile.willingToRelocate ?? ""} />
    <CopyRow label="Work authorization" value={profile.workAuthorization ?? ""} />
    <h2>Summary</h2>
    <CopyRow label="Professional summary" value={profile.summary ?? ""} />
    <h2>Skills</h2>
    <CopyRow label="All skills" value={(profile.skills ?? []).map((skill) => skill.name).join(", ")} />
    <h2>Experience</h2>
    {(profile.experiences ?? []).map((item, index) => <div key={index}>
      <CopyRow label={item.company || "Company"} value={[item.title, item.company, item.period].filter(Boolean).join(" · ")} />
      {item.achievements?.map((achievement, position) => <CopyRow key={position} label="Achievement" value={achievement} />)}
    </div>)}
    <h2>Education</h2>
    {(profile.education ?? []).map((item, index) => <CopyRow key={index} label={item.institution || "Education"} value={[item.degree, item.institution, item.period].filter(Boolean).join(", ")} />)}
    <h2>Projects</h2>
    {(profile.projects ?? []).map((item, index) => <CopyRow key={index} label={item.name} value={[item.name, item.description].filter(Boolean).join(" — ")} />)}
  </div>;
}

function SidePanel() {
  const [tab, setTab] = useState<"assistant" | "profile" | "fields">("assistant");
  const [active, setActive] = useState<ActiveFieldPayload | null>(null);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<AnswerResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [authenticated, setAuthenticated] = useState(false);
  const [accountEmail, setAccountEmail] = useState<string | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [fields, setFields] = useState<ScannedField[]>([]);

  useEffect(() => {
    chrome.runtime.sendMessage({ type: "AUTH_STATUS" } satisfies ExtensionMessage).then((result) => {
      setAuthenticated(Boolean(result?.authenticated));
      setAccountEmail(result?.email ?? null);
      setProfile(result?.profile ?? null);
    }).catch(() => undefined);
    chrome.runtime.sendMessage({ type: "GET_ACTIVE_FIELD" } satisfies ExtensionMessage).then((result) => {
      const payload = result?.activeField as ActiveFieldPayload | undefined;
      if (payload) { setActive(payload); setQuestion(payload.field.question); }
    }).catch(() => undefined);
  }, []);

  async function activeTabId() {
    const [tabInfo] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabInfo?.id;
  }

  async function generate() {
    const prompt = question.trim();
    if (!prompt) return;
    setLoading(true); setStatus("");
    try {
      const remembered = await chrome.runtime.sendMessage({ type: "FIND_ANSWER_MEMORY", question: prompt } satisfies ExtensionMessage);
      if (remembered?.item) {
        setAnswer({ answer: remembered.item.answer, source: "memory", confidence: 0.92, notice: "Matched from your saved answer memory." });
        setStatus("Matched a saved answer. Review it before inserting.");
        return;
      }
      const tokenResult = await chrome.runtime.sendMessage({ type: "GET_AUTH_TOKEN" } satisfies ExtensionMessage);
      if (!tokenResult?.accessToken) throw new Error("Sign in from the extension popup first");
      const response = await fetch(API_URL, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenResult.accessToken}` }, body: JSON.stringify({ question: prompt, page: active?.page }) });
      const result = await response.json() as AnswerResponse & { error?: string };
      if (!response.ok) throw new Error(result.error || "Request failed");
      setAnswer(result.answer ? result : null);
      if (result.notice) setStatus(result.notice);
    } catch (error) { setAnswer(null); setStatus(error instanceof Error ? error.message : "Could not generate an answer."); }
    finally { setLoading(false); }
  }

  async function saveMemory() {
    if (!answer || !question.trim()) return;
    const result = await chrome.runtime.sendMessage({ type: "SAVE_ANSWER_MEMORY", item: { question: question.trim(), answer: answer.answer, source: answer.source === "ai" ? "ai" : "user" } } satisfies ExtensionMessage);
    setStatus(result?.item ? "Saved to answer memory. Similar questions will reuse it." : result?.error ?? "Could not save answer memory.");
  }

  async function scan(fill: boolean) {
    const id = await activeTabId();
    if (!id) return;
    setStatus(fill ? "Filling fields…" : "Scanning page…");
    try {
      const result = await chrome.tabs.sendMessage(id, { type: fill ? "FILL_ALL" : "SCAN_PAGE" } satisfies ExtensionMessage);
      if (!result?.authenticated) { setStatus("Sign in from the extension popup to scan this page."); return; }
      const scanned: ScannedField[] = result.fields ?? [];
      setFields(scanned);
      setTab("fields");
      const filledCount = scanned.filter((item) => item.filled).length;
      setStatus(fill ? `Filled ${filledCount} of ${scanned.length} detected fields.` : `Detected ${scanned.length} fields on this page.`);
    } catch { setStatus("Reload the page, then scan again."); }
  }

  async function attachResume() {
    const id = await activeTabId();
    if (!id) return;
    setStatus("Fetching your resume…");
    const file = await chrome.runtime.sendMessage({ type: "GET_RESUME_FILE" } satisfies ExtensionMessage);
    if (!file || file.error) { setStatus(file?.error ?? "Could not load your resume."); return; }
    const result = await chrome.tabs.sendMessage(id, { type: "ATTACH_RESUME", fileName: file.fileName, mimeType: file.mimeType, dataUrl: file.dataUrl } satisfies ExtensionMessage).catch(() => null);
    setStatus(result?.ok ? `Attached ${file.fileName} to the upload field.` : result?.error ?? "Could not attach the resume.");
  }

  async function copy() { if (answer) { await navigator.clipboard.writeText(answer.answer); setStatus("Copied to clipboard"); } }
  async function insert() {
    if (!answer) return;
    const result = await chrome.runtime.sendMessage({ type: "GET_ACTIVE_FIELD" } satisfies ExtensionMessage);
    const id = result?.activeTabId;
    if (id) { await chrome.tabs.sendMessage(id, { type: "INSERT_IN_ACTIVE_FIELD", value: answer.answer } satisfies ExtensionMessage); setStatus("Inserted into the focused field"); }
    else setStatus("Focus a field first");
  }

  return <main className="panel">
    <header><div className="brand-mark">✦</div><div><h1>ApplyPilot</h1><p>Page assistant</p></div><span className="ready">{authenticated ? "SYNCED" : "SIGN IN"}</span></header>
    {!authenticated && <section className="auth-banner">Sign in from the extension popup to connect your Supabase profile.</section>}
    {authenticated && <section className="account-banner">Signed in as {accountEmail}</section>}
    <section className="page-card"><small>{active?.page.hostname ?? "Current page"}</small><strong>{active?.page.title ?? "Focus a form field to start"}</strong></section>
    <div className="quick-actions">
      <button onClick={() => scan(false)}>Scan page</button>
      <button onClick={() => scan(true)}>Fill all</button>
      <button onClick={attachResume}>Attach resume</button>
    </div>
    <nav className="tabs">
      <button className={tab === "assistant" ? "active" : ""} onClick={() => setTab("assistant")}>Assistant</button>
      <button className={tab === "profile" ? "active" : ""} onClick={() => setTab("profile")}>My data</button>
      <button className={tab === "fields" ? "active" : ""} onClick={() => setTab("fields")}>Fields{fields.length ? ` (${fields.length})` : ""}</button>
    </nav>
    {tab === "assistant" && <>
      <label className="label">Question or field prompt</label>
      <textarea value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Paste a question, or focus a field on the page…" rows={4} />
      <button className="generate" onClick={generate} disabled={loading}>{loading ? "Generating…" : "Generate answer"}</button>
      {answer && <section className="answer-card"><div className="answer-meta"><span>Suggested answer</span><span>{answer.source}</span></div><p>{answer.answer}</p><div className="actions"><button onClick={copy}>Copy</button><button onClick={insert}>Insert</button><button onClick={saveMemory}>Save memory</button></div></section>}
    </>}
    {tab === "profile" && <ProfileTab profile={profile} />}
    {tab === "fields" && <div className="tab-body">{fields.length === 0 ? <p className="empty">Run “Scan page” to list every detected field.</p> : fields.map((field) => <div className="field-row" key={field.index}><div className="field-row-text"><strong>{field.label || field.question || "Field"}</strong><small>{field.kind}{field.filled ? " · filled" : field.value ? " · ready" : " · no value"}</small></div>{field.value && <button onClick={() => navigator.clipboard.writeText(field.value)}>Copy</button>}</div>)}</div>}
    {status && <p className="status">{status}</p>}
    <footer>Autofill is confidence-aware. Review sensitive answers before submitting.</footer>
  </main>;
}

createRoot(document.getElementById("root")!).render(<SidePanel />);
