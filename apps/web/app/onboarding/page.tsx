"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  APPLICATION_ANSWER_FIELDS,
  EMPTY_NARRATIVE,
  type ApplicationAnswers,
  type GeneratedAnswer,
  type NarrativeInput,
  type RawSignal,
  type UserProfile,
} from "@applypilot/shared";
import { AuthGate } from "../../components/auth-gate";
import { VoiceButton } from "../../components/voice-input";
import { getSupabaseBrowserClient } from "../../lib/supabase";
import "./onboarding.css";

const STEPS = ["Sources", "Your story", "Details", "Review"] as const;
const STORAGE_KEY = "applypilot-onboarding";

export default function OnboardingPage() { return <AuthGate requireOnboarding={false}><OnboardingWizard /></AuthGate>; }

function OnboardingWizard() {
  const router = useRouter();
  const [stepIndex, setStepIndex] = useState(0);
  const [signals, setSignals] = useState<RawSignal[]>([]);
  const [narrative, setNarrative] = useState<NarrativeInput>(EMPTY_NARRATIVE);
  const [answers, setAnswers] = useState<Partial<ApplicationAnswers>>({});
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [gaps, setGaps] = useState<string[]>([]);
  const [generated, setGenerated] = useState<GeneratedAnswer[]>([]);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");

  // Draft inputs
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [githubInput, setGithubInput] = useState("");
  const [linkInput, setLinkInput] = useState("");
  const [pastedInput, setPastedInput] = useState("");

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) return;
      const state = JSON.parse(saved);
      setSignals(state.signals ?? []);
      setNarrative(state.narrative ?? EMPTY_NARRATIVE);
      setAnswers(state.answers ?? {});
    } catch { /* Start fresh when the saved draft is unreadable. */ }
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ signals, narrative, answers, updatedAt: new Date().toISOString() }));
  }, [answers, narrative, signals]);

  function addSignal(signal: Omit<RawSignal, "id" | "collectedAt">) {
    setSignals((current) => [...current, { ...signal, id: crypto.randomUUID(), collectedAt: new Date().toISOString() }]);
  }
  function removeSignal(id: string) { setSignals((current) => current.filter((signal) => signal.id !== id)); }

  async function accessToken() {
    const supabase = getSupabaseBrowserClient();
    const { data } = (await supabase?.auth.getSession()) ?? { data: { session: null } };
    return data.session?.access_token ?? null;
  }

  async function importResume() {
    if (!resumeFile) { setNotice("Choose a resume file first."); return; }
    setBusy("resume"); setNotice("");
    const form = new FormData();
    form.append("file", resumeFile);
    try {
      const response = await fetch("/api/resume/analyze", { method: "POST", body: form });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not read that resume.");
      addSignal({ source: "resume", origin: resumeFile.name, content: result.formattedText ?? "", data: result.profile });
      const links: string[] = [result.profile?.github, result.profile?.portfolio].filter(Boolean);
      if (links.length) setNotice(`Resume imported. We also found ${links.length} link(s) — add them below to enrich your profile.`);
      else setNotice("Resume imported.");
      setResumeFile(null);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Resume import failed."); }
    finally { setBusy(""); }
  }

  async function importGithub() {
    if (!githubInput.trim()) return;
    setBusy("github"); setNotice("");
    try {
      const response = await fetch("/api/enrich/github", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: githubInput }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "GitHub import failed.");
      const summary = [`GitHub @${result.username}`, result.bio, `Top languages: ${result.topLanguages.join(", ")}`, ...result.repositories.map((repo: { name: string; description?: string; language?: string; stars: number }) => `${repo.name} (${repo.language ?? "n/a"}, ${repo.stars}★): ${repo.description ?? ""}`)].filter(Boolean).join("\n");
      addSignal({ source: "github", origin: `github.com/${result.username}`, content: summary, data: result });
      setGithubInput(""); setNotice(`Imported ${result.repositories.length} repositories from GitHub.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "GitHub import failed."); }
    finally { setBusy(""); }
  }

  async function importLink() {
    if (!linkInput.trim()) return;
    setBusy("link"); setNotice("");
    try {
      const response = await fetch("/api/enrich/link", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: linkInput }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not read that link.");
      addSignal({ source: "project", origin: result.url, content: [result.title, result.description, result.text].filter(Boolean).join("\n"), data: result });
      setLinkInput(""); setNotice(`Read "${result.title}".`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Link import failed."); }
    finally { setBusy(""); }
  }

  function addPasted() {
    if (pastedInput.trim().length < 20) { setNotice("Paste a bit more text so it is useful."); return; }
    addSignal({ source: "linkedin_export", origin: "Pasted profile text", content: pastedInput.trim() });
    setPastedInput(""); setNotice("Pasted profile text added.");
  }

  async function synthesize() {
    setBusy("synthesize"); setNotice("");
    try {
      const token = await accessToken();
      if (!token) throw new Error("Your session expired. Sign in again.");
      const response = await fetch("/api/profile/synthesize", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ signals, narrative, answers, generateAnswers: true }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Profile build failed.");
      setProfile(result.profile); setGaps(result.gaps ?? []); setGenerated(result.generatedAnswers ?? []);
      setStepIndex(3);
      setNotice(`Profile built from ${signals.length} source(s) with ${result.generatedAnswers?.length ?? 0} reusable answers. Review everything before saving.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Profile build failed."); }
    finally { setBusy(""); }
  }

  async function saveProfile() {
    if (!profile) return;
    setBusy("save"); setNotice("");
    const supabase = getSupabaseBrowserClient();
    const { data: userData } = (await supabase?.auth.getUser()) ?? { data: { user: null } };
    if (!supabase || !userData.user) { setNotice("Sign in again to save."); setBusy(""); return; }
    const userId = userData.user.id;

    const { error } = await supabase.from("profiles").upsert({
      id: userId, first_name: profile.firstName, last_name: profile.lastName, email: profile.email, phone: profile.phone,
      location: profile.location, linkedin_url: profile.linkedin, github_url: profile.github, portfolio_url: profile.portfolio,
      current_title: profile.currentTitle, summary: profile.summary, notice_period: profile.noticePeriod || null,
      current_salary: profile.currentSalary || null, expected_salary: profile.expectedSalary || null,
      total_experience: profile.totalExperience || null, willing_to_relocate: profile.willingToRelocate || null,
      work_authorization: profile.workAuthorization || null, availability: profile.availability || null,
      custom_fields: profile.customFields ?? [], onboarding_completed_at: new Date().toISOString(),
    });
    if (error) { setNotice(`Could not save: ${error.message}`); setBusy(""); return; }

    await Promise.all([
      supabase.from("experiences").delete().eq("user_id", userId),
      supabase.from("skills").delete().eq("user_id", userId),
      supabase.from("education").delete().eq("user_id", userId),
      supabase.from("projects").delete().eq("user_id", userId),
    ]);

    const experienceRows = (profile.experiences ?? []).filter((item) => item.company || item.title).map((item) => ({ user_id: userId, company: item.company || "To review", job_title: item.title || "To review", description: item.summary || null, achievements: item.achievements ?? [], technologies: [] }));
    const skillRows = (profile.skills ?? []).filter((item) => item.name).map((item) => ({ user_id: userId, name: item.name, years: item.years ?? null, proficiency: item.proficiency ?? null }));
    const educationRows = (profile.education ?? []).filter((item) => item.institution || item.degree).map((item) => ({ user_id: userId, institution: item.institution || "To review", degree: item.degree || null, field: item.field || null }));
    const projectRows = (profile.projects ?? []).filter((item) => item.name).map((item) => ({ user_id: userId, name: item.name, description: item.description || null, impact: item.impact || null, technologies: item.technologies ?? [] }));

    if (experienceRows.length) await supabase.from("experiences").insert(experienceRows);
    if (skillRows.length) await supabase.from("skills").insert(skillRows);
    if (educationRows.length) await supabase.from("education").insert(educationRows);
    if (projectRows.length) await supabase.from("projects").insert(projectRows);
    if (generated.length) await supabase.from("answer_library").insert(generated.map((item) => ({ user_id: userId, question: item.question, answer: item.answer, category: item.category, tags: ["onboarding", ...item.basedOn], edited: item.edited })));

    localStorage.removeItem(STORAGE_KEY);
    setBusy("");
    router.push("/profile");
  }

  const canSynthesize = signals.length > 0 || narrative.about.trim().length > 40;
  const progress = useMemo(() => Math.round(((stepIndex + 1) / STEPS.length) * 100), [stepIndex]);

  return <main className="onboarding">
    <header className="onboarding-head">
      <div className="brand"><span className="logo-mark">✦</span>ApplyPilot</div>
      <div className="onboarding-progress"><span style={{ width: `${progress}%` }} /></div>
      <nav className="onboarding-steps">{STEPS.map((label, index) => <button key={label} className={index === stepIndex ? "active" : index < stepIndex ? "done" : ""} onClick={() => index <= stepIndex && setStepIndex(index)}><i>{index + 1}</i>{label}</button>)}</nav>
    </header>

    {stepIndex === 0 && <section className="onboarding-panel">
      <h1>Bring in everything about you</h1>
      <p className="lede">Add your resume and any links. We read them, then build one verified profile you can edit.</p>

      <div className="source-card">
        <div className="source-head"><strong>Resume</strong><small>PDF, TXT, or Markdown</small></div>
        <label className="file-drop"><input type="file" accept="application/pdf,.txt,.md,text/plain" onChange={(event) => setResumeFile(event.target.files?.[0] ?? null)} /><span>{resumeFile ? resumeFile.name : "Choose a resume file"}</span></label>
        <button className="ghost-button" onClick={importResume} disabled={busy === "resume"}>{busy === "resume" ? "Reading…" : "Import resume"}</button>
      </div>

      <div className="source-card">
        <div className="source-head"><strong>GitHub</strong><small>Public profile, repositories, and languages</small></div>
        <div className="inline-row"><input value={githubInput} onChange={(event) => setGithubInput(event.target.value)} placeholder="username or github.com/username" /><button className="ghost-button" onClick={importGithub} disabled={busy === "github"}>{busy === "github" ? "Fetching…" : "Import"}</button></div>
      </div>

      <div className="source-card">
        <div className="source-head"><strong>Project & portfolio links</strong><small>Add each one; we read the page text</small></div>
        <div className="inline-row"><input value={linkInput} onChange={(event) => setLinkInput(event.target.value)} placeholder="https://your-project.com" /><button className="ghost-button" onClick={importLink} disabled={busy === "link"}>{busy === "link" ? "Reading…" : "Add link"}</button></div>
      </div>

      <div className="source-card">
        <div className="source-head"><strong>LinkedIn or other profiles</strong><small>Paste the text — LinkedIn blocks automated reading</small></div>
        <textarea value={pastedInput} onChange={(event) => setPastedInput(event.target.value)} rows={4} placeholder="Open your LinkedIn profile, select the page or use “Save to PDF”, and paste the text here." />
        <button className="ghost-button" onClick={addPasted}>Add pasted text</button>
      </div>

      {signals.length > 0 && <div className="signal-list"><strong>{signals.length} source(s) collected</strong>{signals.map((signal) => <div className="signal-row" key={signal.id}><span className="signal-tag">{signal.source}</span><span className="signal-origin">{signal.origin}</span><button onClick={() => removeSignal(signal.id)}>×</button></div>)}</div>}
      {notice && <p className="onboarding-notice">{notice}</p>}
      <div className="onboarding-actions"><button className="primary-button" onClick={() => setStepIndex(1)}>Continue</button></div>
    </section>}

    {stepIndex === 1 && <section className="onboarding-panel">
      <h1>Tell us about yourself</h1>
      <p className="lede">Type or dictate. Your own words shape the tone of every generated answer.</p>
      {([["about", "About you", "What you do, what you are good at, what you care about."], ["experience", "Your experience", "Walk through your roles and the impact you had."], ["expectations", "What you are looking for", "Role, team, location, compensation, growth."]] as Array<[keyof NarrativeInput, string, string]>).map(([field, label, hint]) => <div className="narrative-block" key={field}>
        <div className="narrative-head"><label>{label}<small>{hint}</small></label><VoiceButton onText={(text) => setNarrative((current) => ({ ...current, [field]: `${current[field]} ${text}`.trim() }))} /></div>
        <textarea value={narrative[field]} onChange={(event) => setNarrative({ ...narrative, [field]: event.target.value })} rows={6} placeholder="Type here, or use dictate…" />
      </div>)}
      <div className="onboarding-actions"><button className="ghost-button" onClick={() => setStepIndex(0)}>Back</button><button className="primary-button" onClick={() => setStepIndex(2)}>Continue</button></div>
    </section>}

    {stepIndex === 2 && <section className="onboarding-panel">
      <h1>The questions every application asks</h1>
      <p className="lede">Answer what you can. Anything you skip is simply marked as missing — never invented.</p>
      <div className="answer-grid">{APPLICATION_ANSWER_FIELDS.map((field) => <div className={`answer-field ${field.multiline ? "wide" : ""}`} key={field.key}>
        <div className="answer-field-head"><label>{field.label}{field.sensitive && <span className="sensitive">sensitive</span>}<small>{field.hint}</small></label>{field.multiline && <VoiceButton onText={(text) => setAnswers((current) => ({ ...current, [field.key]: `${current[field.key] ?? ""} ${text}`.trim() }))} label="Dictate" />}</div>
        {field.multiline
          ? <textarea value={answers[field.key] ?? ""} onChange={(event) => setAnswers({ ...answers, [field.key]: event.target.value })} rows={4} />
          : <input value={answers[field.key] ?? ""} onChange={(event) => setAnswers({ ...answers, [field.key]: event.target.value })} placeholder={field.hint} />}
      </div>)}</div>
      {notice && <p className="onboarding-notice">{notice}</p>}
      <div className="onboarding-actions"><button className="ghost-button" onClick={() => setStepIndex(1)}>Back</button><button className="primary-button" onClick={synthesize} disabled={!canSynthesize || busy === "synthesize"}>{busy === "synthesize" ? "Building your profile…" : "Build my profile"}</button></div>
      {!canSynthesize && <p className="onboarding-hint">Add a resume, a link, or a few sentences about yourself before building.</p>}
    </section>}

    {stepIndex === 3 && profile && <section className="onboarding-panel">
      <h1>Review before saving</h1>
      <p className="lede">Everything below was extracted from your own materials. Edit anything that is wrong — nothing is saved until you confirm.</p>
      {gaps.length > 0 && <div className="gap-card"><strong>Still missing</strong><ul>{gaps.map((gap) => <li key={gap}>{gap}</li>)}</ul></div>}

      <h2>Basics</h2>
      <div className="answer-grid">{([["firstName", "First name"], ["lastName", "Last name"], ["email", "Email"], ["phone", "Phone"], ["location", "Location"], ["currentTitle", "Current title"], ["linkedin", "LinkedIn"], ["github", "GitHub"], ["portfolio", "Portfolio"], ["totalExperience", "Total experience"], ["noticePeriod", "Notice period"], ["expectedSalary", "Expected CTC"]] as Array<[keyof UserProfile, string]>).map(([field, label]) => <div className="answer-field" key={field}><label>{label}</label><input value={String(profile[field] ?? "")} onChange={(event) => setProfile({ ...profile, [field]: event.target.value })} /></div>)}</div>

      <h2>Summary</h2>
      <textarea className="review-summary" value={profile.summary ?? ""} onChange={(event) => setProfile({ ...profile, summary: event.target.value })} rows={4} />

      <h2>Skills <span className="count">{profile.skills?.length ?? 0}</span></h2>
      <div className="chip-list">{(profile.skills ?? []).map((skill, index) => <span key={index}>{skill.name}{skill.years ? ` · ${skill.years}y` : ""}</span>)}</div>

      <h2>Experience <span className="count">{profile.experiences?.length ?? 0}</span></h2>
      {(profile.experiences ?? []).map((item, index) => <div className="review-item" key={index}><strong>{item.title || "Role"}</strong><span>{item.company} · {item.period}</span><p>{item.summary}</p></div>)}

      <h2>Projects <span className="count">{profile.projects?.length ?? 0}</span></h2>
      {(profile.projects ?? []).map((item, index) => <div className="review-item" key={index}><strong>{item.name}</strong><span>{item.technologies?.join(" · ")}</span><p>{item.description}</p></div>)}

      <h2>Reusable answers <span className="count">{generated.length}</span></h2>
      <p className="lede">These are pre-written so the extension can answer instantly without calling the AI.</p>
      <div className="generated-list">{generated.map((item, index) => <details className="generated-item" key={item.id}><summary><span className="answer-category">{item.category}</span>{item.question}</summary><textarea value={item.answer} onChange={(event) => { const next = [...generated]; next[index] = { ...item, answer: event.target.value, edited: true }; setGenerated(next); }} rows={4} /></details>)}</div>

      {notice && <p className="onboarding-notice">{notice}</p>}
      <div className="onboarding-actions"><button className="ghost-button" onClick={() => setStepIndex(2)}>Back</button><button className="primary-button" onClick={saveProfile} disabled={busy === "save"}>{busy === "save" ? "Saving…" : "Save profile and finish"}</button></div>
    </section>}
  </main>;
}
