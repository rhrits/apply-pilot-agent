"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { ResumeAnalysis, UserProfile } from "@applypilot/shared";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "../../lib/supabase";
import { AuthGate } from "../../components/auth-gate";
import "./profile.css";
import "./profile-auth.css";

const demoProfile: UserProfile = {
  firstName: "Alex", lastName: "Applicant", email: "alex@example.com", phone: "+1 555 010 2026", location: "Remote / New York", linkedin: "https://linkedin.com/in/alex-applicant", github: "https://github.com/alex-applicant", portfolio: "https://alex-applicant.dev", currentTitle: "Full-stack Engineer", summary: "Full-stack engineer building reliable products with TypeScript, React, and Supabase.", skills: [{ name: "TypeScript", years: 3, proficiency: "Advanced" }, { name: "React", years: 3, proficiency: "Advanced" }, { name: "Python", years: 2, proficiency: "Intermediate" }], experiences: [], education: [], projects: [],
};

export default function ProfilePage() { return <AuthGate><ProfileWorkspace /></AuthGate>; }

function ProfileWorkspace() {
  const [profile, setProfile] = useState<UserProfile>(demoProfile);
  const [resumeText, setResumeText] = useState("");
  const [analysis, setAnalysis] = useState<ResumeAnalysis | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [newSkill, setNewSkill] = useState("");
  const [newCustomLabel, setNewCustomLabel] = useState("");
  const [newCustomValue, setNewCustomValue] = useState("");
  const [authEmail, setAuthEmail] = useState("");
  const [authCode, setAuthCode] = useState("");
  const [authStep, setAuthStep] = useState<"idle" | "code-sent">("idle");
  const [authUser, setAuthUser] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("applypilot-profile");
      const savedAnalysis = localStorage.getItem("applypilot-resume-analysis");
      if (saved) setProfile(JSON.parse(saved) as UserProfile);
      if (savedAnalysis) setAnalysis(JSON.parse(savedAnalysis) as ResumeAnalysis);
    } catch { /* Use the demo profile when local storage is unavailable. */ }
  }, []);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;
    supabase.auth.getUser().then(async ({ data }) => {
      setAuthUser(data.user?.email ?? null);
      if (!data.user) return;
      const { data: saved } = await supabase.from("profiles").select("*").eq("id", data.user.id).maybeSingle();
      if (!saved) return;
      const row = saved as { first_name?: string; last_name?: string; email?: string; phone?: string; location?: string; linkedin_url?: string; github_url?: string; portfolio_url?: string; current_title?: string; summary?: string; notice_period?: string; current_salary?: string; expected_salary?: string; total_experience?: string; willing_to_relocate?: string; work_authorization?: string; availability?: string; custom_fields?: Array<{ id: string; label: string; value: string }> };
      setProfile((current) => ({ ...current, firstName: row.first_name ?? current.firstName, lastName: row.last_name ?? current.lastName, email: row.email ?? current.email, phone: row.phone ?? current.phone, location: row.location ?? current.location, linkedin: row.linkedin_url ?? current.linkedin, github: row.github_url ?? current.github, portfolio: row.portfolio_url ?? current.portfolio, currentTitle: row.current_title ?? current.currentTitle, summary: row.summary ?? current.summary, noticePeriod: row.notice_period ?? current.noticePeriod, currentSalary: row.current_salary ?? current.currentSalary, expectedSalary: row.expected_salary ?? current.expectedSalary, totalExperience: row.total_experience ?? current.totalExperience, willingToRelocate: row.willing_to_relocate ?? current.willingToRelocate, workAuthorization: row.work_authorization ?? current.workAuthorization, availability: row.availability ?? current.availability, customFields: row.custom_fields?.length ? row.custom_fields : current.customFields }));
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => setAuthUser(session?.user.email ?? null));
    return () => data.subscription.unsubscribe();
  }, []);

  const completeness = useMemo(() => {
    const fields = [profile.firstName, profile.lastName, profile.email, profile.phone, profile.location, profile.currentTitle, profile.summary, profile.linkedin, profile.github, profile.skills?.length ? "yes" : "", profile.experiences?.length ? "yes" : "", analysis ? "yes" : ""];
    return Math.round((fields.filter(Boolean).length / fields.length) * 100);
  }, [analysis, profile]);

  function updateField(field: keyof UserProfile, value: string) {
    setProfile((current) => ({ ...current, [field]: value }));
    setNotice("");
  }

  function mergeProfile(current: UserProfile, extracted: UserProfile): UserProfile {
    const pick = (existing?: string, incoming?: string) => (incoming && incoming.trim() ? incoming : existing ?? "");
    return {
      ...current,
      firstName: pick(current.firstName, extracted.firstName),
      lastName: pick(current.lastName, extracted.lastName),
      email: pick(current.email, extracted.email),
      phone: pick(current.phone, extracted.phone),
      location: pick(current.location, extracted.location),
      linkedin: pick(current.linkedin, extracted.linkedin),
      github: pick(current.github, extracted.github),
      portfolio: pick(current.portfolio, extracted.portfolio),
      currentTitle: pick(current.currentTitle, extracted.currentTitle),
      summary: pick(current.summary, extracted.summary),
      skills: extracted.skills?.length ? extracted.skills : current.skills,
      experiences: extracted.experiences?.length ? extracted.experiences : current.experiences,
      education: extracted.education?.length ? extracted.education : current.education,
      projects: extracted.projects?.length ? extracted.projects : current.projects,
    };
  }

  async function analyzeResume() {
    if (!file && resumeText.trim().length < 40) { setNotice("Paste at least a few paragraphs or choose a PDF/TXT resume first."); return; }
    setBusy(true); setNotice("");
    const form = new FormData();
    if (file) form.append("file", file); else form.append("text", resumeText);
    try {
      const response = await fetch("/api/resume/analyze", { method: "POST", body: form });
      const result = await response.json() as ResumeAnalysis & { error?: string };
      if (!response.ok) throw new Error(result.error || "Resume analysis failed");
      setAnalysis(result); setProfile((current) => mergeProfile(current, result.profile)); setResumeText(result.formattedText);
      const baseNotice = result.source === "ai" ? "AI extraction complete. Fields were filled in below — review every value before saving." : "Profile fields were filled in from the local extraction below — review before saving.";
      setNotice(result.aiNotice ? `${baseNotice} ${result.aiNotice}` : baseNotice);
      localStorage.setItem("applypilot-resume-analysis", JSON.stringify(result));
      await syncResume(result);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Resume analysis failed."); }
    finally { setBusy(false); }
  }

  async function syncResume(result: ResumeAnalysis) {
    if (!file) return;
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return;
    const storagePath = `${userData.user.id}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "-")}`;
    const upload = await supabase.storage.from("resumes").upload(storagePath, file, { contentType: file.type || "application/pdf", upsert: false });
    if (upload.error) { setNotice(`Profile extracted, but resume cloud upload failed: ${upload.error.message}`); return; }
    const { error } = await supabase.from("resumes").insert({ user_id: userData.user.id, name: file.name, storage_path: storagePath, mime_type: file.type, file_size: file.size, parsed_text: result.formattedText, formatted_text: result.formattedText, extracted_profile: result.profile, parsing_status: "needs_review" });
    if (error) setNotice(`Profile extracted, but resume metadata could not be saved: ${error.message}`);
    await syncStructuredProfile(result.profile, userData.user.id, supabase);
  }

  async function syncStructuredProfile(extracted: UserProfile, userId: string, supabase: NonNullable<ReturnType<typeof getSupabaseBrowserClient>>) {
    await Promise.all([
      supabase.from("experiences").delete().eq("user_id", userId),
      supabase.from("skills").delete().eq("user_id", userId),
      supabase.from("education").delete().eq("user_id", userId),
      supabase.from("projects").delete().eq("user_id", userId),
    ]);
    const experienceRows = (extracted.experiences ?? []).filter((item) => item.company || item.title).map((item) => ({ user_id: userId, company: item.company || "To review", job_title: item.title || "To review", description: item.summary || null, achievements: item.achievements ?? [], technologies: [] }));
    const skillRows = (extracted.skills ?? []).filter((item) => item.name).map((item) => ({ user_id: userId, name: item.name, years: item.years ?? null, proficiency: item.proficiency ?? null }));
    const educationRows = (extracted.education ?? []).filter((item) => item.institution || item.degree).map((item) => ({ user_id: userId, institution: item.institution || "To review", degree: item.degree || null, field: item.field || null, start_year: item.period?.match(/\b(19|20)\d{2}\b/)?.[0] ? Number(item.period.match(/\b(19|20)\d{2}\b/)?.[0]) : null, end_year: item.period?.match(/\b(19|20)\d{2}\b/g)?.at(-1) ? Number(item.period.match(/\b(19|20)\d{2}\b/g)?.at(-1)) : null }));
    const projectRows = (extracted.projects ?? []).filter((item) => item.name).map((item) => ({ user_id: userId, name: item.name, description: item.description || null, impact: item.impact || null, technologies: item.technologies ?? [] }));
    if (experienceRows.length) await supabase.from("experiences").insert(experienceRows);
    if (skillRows.length) await supabase.from("skills").insert(skillRows);
    if (educationRows.length) await supabase.from("education").insert(educationRows);
    if (projectRows.length) await supabase.from("projects").insert(projectRows);
  }

  function saveProfile() {
    localStorage.setItem("applypilot-profile", JSON.stringify(profile));
    const supabase = getSupabaseBrowserClient();
    if (!supabase) { setNotice("Profile saved in this browser. Add NEXT_PUBLIC_SUPABASE_ANON_KEY to enable cloud sync."); return; }
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) { setNotice("Profile saved locally. Sign in below to sync it to Supabase."); return; }
      const { error } = await supabase.from("profiles").upsert({ id: data.user.id, first_name: profile.firstName, last_name: profile.lastName, email: profile.email, phone: profile.phone, location: profile.location, linkedin_url: profile.linkedin, github_url: profile.github, portfolio_url: profile.portfolio, current_title: profile.currentTitle, summary: profile.summary, notice_period: profile.noticePeriod ?? null, current_salary: profile.currentSalary ?? null, expected_salary: profile.expectedSalary ?? null, total_experience: profile.totalExperience ?? null, willing_to_relocate: profile.willingToRelocate ?? null, work_authorization: profile.workAuthorization ?? null, availability: profile.availability ?? null, custom_fields: profile.customFields ?? [] });
      if (analysis) await syncStructuredProfile(profile, data.user.id, supabase);
      setNotice(error ? `Saved locally; cloud sync failed: ${error.message}` : "Profile saved locally and synced to Supabase.");
    });
  }

  async function requestOtp() {
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !authEmail.trim()) { setNotice("Add NEXT_PUBLIC_SUPABASE_ANON_KEY and enter your email to enable sign in."); return; }
    setAuthBusy(true);
    const { error } = await supabase.auth.signInWithOtp({ email: authEmail.trim(), options: { shouldCreateUser: true, emailRedirectTo: `${window.location.origin}/profile` } });
    setAuthBusy(false);
    if (error) { setNotice(error.message); return; }
    setAuthStep("code-sent");
    setNotice("Check your email. If Supabase sent a magic link, click it. If your template sends a code, enter the code below.");
  }

  async function verifyOtp() {
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !authCode.trim()) { setNotice("Enter the code from your email."); return; }
    setAuthBusy(true);
    const { data, error } = await supabase.auth.verifyOtp({ email: authEmail.trim(), token: authCode.trim(), type: "email" });
    setAuthBusy(false);
    if (error) { setNotice(error.message); return; }
    setAuthUser(data.user?.email ?? authEmail.trim());
    setAuthStep("idle"); setAuthCode("");
    setNotice("Signed in. Save your profile to sync it to Supabase.");
  }

  function changeEmail() {
    setAuthStep("idle"); setAuthCode(""); setNotice("");
  }

  async function signOut() {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;
    await supabase.auth.signOut();
    setAuthUser(null);
  }

  function addSkill() {
    const value = newSkill.trim();
    if (!value) return;
    setProfile((current) => ({ ...current, skills: [...(current.skills ?? []), { name: value }] }));
    setNewSkill("");
  }

  function addCustomField() {
    const label = newCustomLabel.trim();
    const value = newCustomValue.trim();
    if (!label || !value) return;
    setProfile((current) => ({ ...current, customFields: [...(current.customFields ?? []), { id: crypto.randomUUID(), label, value }] }));
    setNewCustomLabel(""); setNewCustomValue("");
  }

  function updateCustomField(id: string, key: "label" | "value", text: string) {
    setProfile((current) => ({ ...current, customFields: (current.customFields ?? []).map((field) => field.id === id ? { ...field, [key]: text } : field) }));
  }

  function removeCustomField(id: string) {
    setProfile((current) => ({ ...current, customFields: (current.customFields ?? []).filter((field) => field.id !== id) }));
  }

  return <main className="main profile-page"><div className="topbar"><div><div className="eyebrow">Application profile</div><h1>Your source of truth</h1><p className="page-subtitle">Import once, review carefully, then let the extension reuse your verified facts.</p></div><Link href="/" className="text-link">Back to overview</Link></div><section className="profile-hero"><div><span className="eyebrow">Profile readiness</span><h2>{completeness}% ready to apply</h2><p>Keep facts structured so answers stay accurate instead of sounding generic.</p></div><div className="profile-score"><strong>{completeness}%</strong><span>complete</span></div></section><section className="card auth-card"><div className="auth-card-head"><span className="eyebrow">Private workspace</span><h3>{authUser ? `Signed in as ${authUser}` : "Sign in with email + one-time code"}</h3><p className="card-help">Supabase Auth keeps your verified profile, resume metadata, and application history private with Row Level Security.</p></div>{authUser ? <div className="auth-signed-in"><span className="signed-in">● Cloud sync ready</span><button className="text-link" onClick={signOut}>Sign out</button></div> : authStep === "idle" ? <div className="auth-controls"><input value={authEmail} onChange={(event) => setAuthEmail(event.target.value)} placeholder="you@example.com" type="email" /><button className="save-button" onClick={requestOtp} disabled={authBusy}>{authBusy ? "Sending…" : "Email me a code"}</button></div> : <div className="auth-controls"><input value={authCode} onChange={(event) => setAuthCode(event.target.value)} placeholder="Code from email" inputMode="numeric" maxLength={8} /><button className="save-button" onClick={verifyOtp} disabled={authBusy}>{authBusy ? "Verifying…" : "Verify code"}</button><button className="text-link" onClick={requestOtp} disabled={authBusy}>Resend</button><button className="text-link" onClick={changeEmail}>Change email</button></div>}{!isSupabaseConfigured() && <details className="auth-guide"><summary>Developer setup: how do I enable email + OTP sign-in?</summary><ol><li>Open your Supabase project dashboard → <strong>Authentication → Sign In / Providers</strong> and confirm <strong>Email</strong> is enabled.</li><li>Go to <strong>Authentication → Email Templates → Magic Link</strong> and the default template sends a clickable link using <code>{"{{ .ConfirmationURL }}"}</code>. This is expected — click the link to sign in.</li><li>For a numeric OTP instead, edit the template to display <code>{"{{ .Token }}"}</code> and remove the confirmation-link-only wording. Then the code input above will work.</li><li>Add <code>/profile</code> to Supabase <strong>Authentication → URL Configuration → Redirect URLs</strong>.</li><li>Add <code>NEXT_PUBLIC_SUPABASE_URL</code> and <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> to <code>apps/web/.env.local</code>, then restart the dev server.</li></ol></details>}</section><div className="profile-layout"><section className="profile-column"><div className="card import-card"><div className="section-head"><div><h3>Build from your resume</h3><p className="card-help">Upload a PDF or paste resume text. ApplyPilot extracts contact details, skills, roles, education, projects, and a cleaner ATS-friendly version.</p></div><span className="step-badge">01</span></div><label className="upload-drop"><input type="file" accept="application/pdf,.txt,.md,text/plain" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /><span className="upload-icon">↑</span><strong>{file ? file.name : "Choose a resume file"}</strong><small>PDF, TXT, or Markdown · up to 8 MB</small></label><div className="or-divider"><span>or paste resume text</span></div><textarea className="resume-input" value={resumeText} onChange={(event) => setResumeText(event.target.value)} placeholder="Paste the complete resume here when upload is not convenient…" rows={9} /><button className="save-button wide" onClick={analyzeResume} disabled={busy}>{busy ? "Extracting and formatting…" : "Extract profile with AI"}</button>{notice && <p className="notice">{notice}</p>}</div>{analysis && <div className="card analysis-card"><div className="section-head"><div><h3>Resume intelligence</h3><p className="card-help">The original text is preserved as a reviewable, categorized version.</p></div><span className="source-pill">{analysis.source === "ai" ? "AI reviewed" : "Local extraction"}</span></div><div className="resume-sections">{analysis.sections.map((section) => <article key={`${section.title}-${section.category}`}><div><span className="section-category">{section.category}</span><strong>{section.title}</strong></div><p>{section.content}</p></article>)}</div><div className="suggestions"><strong>Improve next</strong>{analysis.suggestions.map((suggestion) => <span key={suggestion}>• {suggestion}</span>)}</div></div>}</section><aside className="profile-column"><div className="card"><div className="section-head"><div><h3>Verified profile</h3><p className="card-help">Review extracted values before the extension uses them.</p></div><span className="step-badge">02</span></div><div className="profile-form">{([["firstName", "First name"], ["lastName", "Last name"], ["email", "Email"], ["phone", "Phone"], ["location", "Location"], ["currentTitle", "Current title"], ["linkedin", "LinkedIn URL"], ["github", "GitHub URL"], ["portfolio", "Portfolio URL"]] as Array<[keyof UserProfile, string]>).map(([field, label]) => <label key={field}>{label}<input value={String(profile[field] ?? "")} onChange={(event) => updateField(field, event.target.value)} /></label>)}<label>Professional summary<textarea value={profile.summary ?? ""} onChange={(event) => updateField("summary", event.target.value)} rows={5} /></label></div><div className="section-head" style={{ marginTop: 24 }}><div><h3>Application answers</h3><p className="card-help">These are the questions almost every application asks. Filling them here means the extension answers them instantly without AI.</p></div><span className="step-badge">03</span></div><div className="profile-form">{([["noticePeriod", "Notice period"], ["totalExperience", "Total experience (years)"], ["currentSalary", "Current CTC"], ["expectedSalary", "Expected CTC"], ["willingToRelocate", "Willing to relocate"], ["workAuthorization", "Work authorization"], ["availability", "Earliest start date"]] as Array<[keyof UserProfile, string]>).map(([field, label]) => <label key={field}>{label}<input value={String(profile[field] ?? "")} onChange={(event) => updateField(field, event.target.value)} placeholder={field === "noticePeriod" ? "e.g. 30 days" : field === "willingToRelocate" ? "Yes / No" : ""} /></label>)}</div><button className="save-button wide" onClick={saveProfile}>Save verified profile</button></div><div className="card skill-card"><div className="section-head"><h3>Skills</h3><span className="step-badge">04</span></div><div className="skill-list">{(profile.skills ?? []).map((skill, index) => <span key={`${skill.name}-${index}`}>{skill.name}{skill.years ? ` · ${skill.years}y` : ""}</span>)}</div><div className="skill-add"><input value={newSkill} onChange={(event) => setNewSkill(event.target.value)} onKeyDown={(event) => event.key === "Enter" && addSkill()} placeholder="Add a skill" /><button onClick={addSkill}>Add</button></div></div><div className="card custom-fields-card"><div className="section-head"><h3>Custom fields</h3><span className="step-badge">05</span></div><p className="card-help">Add any question your applications ask that isn't covered above — visa sponsorship, driving license, portfolio access code, anything. The extension matches similar questions automatically, even without an exact match.</p><div className="custom-field-list">{(profile.customFields ?? []).map((field) => <div className="custom-field-row" key={field.id}><input value={field.label} onChange={(event) => updateCustomField(field.id, "label", event.target.value)} placeholder="Question" /><input value={field.value} onChange={(event) => updateCustomField(field.id, "value", event.target.value)} placeholder="Answer" /><button onClick={() => removeCustomField(field.id)}>×</button></div>)}</div><div className="custom-field-add"><input value={newCustomLabel} onChange={(event) => setNewCustomLabel(event.target.value)} placeholder="New question" /><input value={newCustomValue} onChange={(event) => setNewCustomValue(event.target.value)} placeholder="Answer" /><button onClick={addCustomField}>Add field</button></div></div></aside></div><section className="card profile-detail-grid"><div><h3>Extracted experience</h3>{profile.experiences?.length ? profile.experiences.map((experience, index) => <article className="detail-item" key={`${experience.company}-${index}`}><strong>{experience.title || "Role to review"}</strong><span>{experience.company || "Company to review"} · {experience.period || "Dates to review"}</span><p>{experience.summary}</p></article>) : <p className="empty-state">Upload a resume to build role history and measurable achievements here.</p>}</div><div><h3>Education and projects</h3>{profile.education?.map((item, index) => <article className="detail-item" key={`${item.institution}-${index}`}><strong>{item.degree || "Education"}</strong><span>{item.institution} {item.period ? `· ${item.period}` : ""}</span></article>)}{profile.projects?.map((project, index) => <article className="detail-item" key={`${project.name}-${index}`}><strong>{project.name}</strong><span>{project.technologies?.join(" · ")}</span><p>{project.description}</p></article>)}{!profile.education?.length && !profile.projects?.length && <p className="empty-state">Projects and education will appear after extraction.</p>}</div></section></main>;
}
