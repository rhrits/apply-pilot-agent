"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildProfileMarkdown,
  buildReviewQueue,
  describeReviewQueue,
  emptyProfile,
  groupProjects,
  mergeProfile,
  profileCompleteness,
  type ProfileSources,
  type ProjectSource,
  type ResumeAnalysis,
  type UserProfile,
} from "@uplyfox/shared";
import { getSupabaseBrowserClient } from "../../lib/supabase";
import { commitProfile } from "../../lib/onboarding-store";
import { deleteStoredResume, getResumePreviewUrl, getStoredResume, storeResumeFile, type StoredResume } from "../../lib/resume-store";
import { AuthGate } from "../../components/auth-gate";
import { AccountSecurity } from "../../components/account-security";
import { EditableRecordList } from "../../components/editable-record-list";
import { Markdown } from "../../components/markdown";
import "./profile.css";

type Tab = "overview" | "document" | "details" | "sources";
type SaveState = "clean" | "dirty" | "saving" | "saved" | "error";

const PROFILE_TABS: Array<[Tab, string]> = [
  ["overview", "Overview"],
  ["document", "Profile document"],
  ["details", "Application details"],
  ["sources", "Resume & sources"],
];

export default function ProfilePage() {
  return <AuthGate><ProfileWorkspace /></AuthGate>;
}

function ProfileWorkspace() {
  const [profile, setProfile] = useState<UserProfile>(emptyProfile());
  const [sources, setSources] = useState<ProfileSources>({});
  const [markdown, setMarkdown] = useState("");
  const [markdownEdited, setMarkdownEdited] = useState(false);
  const [tab, setTab] = useState<Tab>("overview");
  const [saveState, setSaveState] = useState<SaveState>("clean");
  const [notice, setNotice] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(true);

  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [resumeBusy, setResumeBusy] = useState(false);
  const [storedResume, setStoredResume] = useState<StoredResume | null>(null);
  const [resumePreviewUrl, setResumePreviewUrl] = useState<string | null>(null);
  const [showResumePreview, setShowResumePreview] = useState(false);
  const [analysis, setAnalysis] = useState<ResumeAnalysis | null>(null);
  const [newSkill, setNewSkill] = useState("");
  const [newCustomLabel, setNewCustomLabel] = useState("");
  const [newCustomValue, setNewCustomValue] = useState("");

  const loaded = useRef(false);
  const completeness = useMemo(() => profileCompleteness(profile), [profile]);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) { setLoading(false); return; }
    supabase.auth.getUser().then(async ({ data }) => {
      const user = data.user;
      if (!user) { setLoading(false); return; }
      setEmail(user.email ?? "");
      void getStoredResume().then(setStoredResume);

      const [profileResult, skillsResult, experiencesResult, educationResult, projectsResult] = await Promise.all([
        supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
        supabase.from("skills").select("name,years,proficiency,position").eq("user_id", user.id).order("position"),
        supabase.from("experiences").select("company,job_title,description,achievements,technologies,start_date,end_date,period,location,position").eq("user_id", user.id).order("position"),
        supabase.from("education").select("institution,degree,field,start_year,end_year,period,position").eq("user_id", user.id).order("position"),
        supabase.from("projects").select("name,description,impact,technologies,url,source,period,role,position").eq("user_id", user.id).order("position"),
      ]);

      const row = (profileResult.data ?? {}) as Record<string, unknown>;
      const value = (input: unknown) => (typeof input === "string" ? input : "");
      const next: UserProfile = {
        ...emptyProfile(),
        firstName: value(row.first_name), lastName: value(row.last_name),
        email: value(row.email) || user.email || "", phone: value(row.phone), location: value(row.location),
        linkedin: value(row.linkedin_url), github: value(row.github_url), portfolio: value(row.portfolio_url),
        currentTitle: value(row.current_title), summary: value(row.summary),
        noticePeriod: value(row.notice_period), currentSalary: value(row.current_salary),
        expectedSalary: value(row.expected_salary), totalExperience: value(row.total_experience),
        willingToRelocate: value(row.willing_to_relocate), workAuthorization: value(row.work_authorization),
        availability: value(row.availability),
        customFields: Array.isArray(row.custom_fields) ? row.custom_fields as UserProfile["customFields"] : [],
        skills: (skillsResult.data ?? []).map((item) => ({ name: value(item.name), years: item.years == null ? undefined : Number(item.years), proficiency: value(item.proficiency) || undefined })),
        experiences: (experiencesResult.data ?? []).map((item) => ({
          company: value(item.company), title: value(item.job_title),
          // The stored free-text period keeps the resume's own wording; the date columns
          // are only a fallback for rows written before that column existed.
          period: value(item.period) || [value(item.start_date), value(item.end_date) || "Present"].filter(Boolean).join(" – "),
          location: value(item.location) || undefined,
          summary: value(item.description), achievements: Array.isArray(item.achievements) ? item.achievements.map(String) : [],
          skills: Array.isArray(item.technologies) ? item.technologies.map(String) : [],
        })),
        education: (educationResult.data ?? []).map((item) => ({
          institution: value(item.institution), degree: value(item.degree), field: value(item.field),
          period: value(item.period) || [item.start_year, item.end_year].filter(Boolean).join(" – "),
        })),
        projects: (projectsResult.data ?? []).map((item) => ({
          name: value(item.name), description: value(item.description), impact: value(item.impact),
          technologies: Array.isArray(item.technologies) ? item.technologies.map(String) : [],
          url: value(item.url), source: (value(item.source) || "resume") as ProjectSource,
          period: value(item.period) || undefined, role: value(item.role) || undefined,
        })),
      };

      setProfile(next);
      setSources((row.profile_sources ?? {}) as ProfileSources);
      const stored = value(row.profile_markdown);
      setMarkdown(stored || buildProfileMarkdown(next));
      setMarkdownEdited(Boolean(stored));
      setLoading(false);
      loaded.current = true;
    });
  }, []);

  // Keep the generated document in sync until the candidate edits it by hand.
  useEffect(() => {
    if (!loaded.current || markdownEdited) return;
    setMarkdown(buildProfileMarkdown(profile));
  }, [markdownEdited, profile]);

  const markDirty = useCallback(() => { if (loaded.current) setSaveState("dirty"); }, []);

  /**
   * Fields that look mis-parsed. Recomputed as the profile is edited so an item
   * disappears the moment it is corrected.
   */
  const reviewQueue = useMemo(() => buildReviewQueue(profile, sources), [profile, sources]);

  /**
   * Tab selection, mirrored into the URL hash.
   *
   * Without this the active tab is lost on reload and cannot be linked to, which is
   * painful when pointing someone at a specific section (for example the review queue).
   */
  const selectTab = useCallback((next: Tab) => {
    setTab(next);
    if (typeof window !== "undefined") window.history.replaceState(null, "", `#${next}`);
  }, []);

  // Restore the tab named in the URL on first load.
  useEffect(() => {
    const hash = window.location.hash.replace("#", "") as Tab;
    if (PROFILE_TABS.some(([key]) => key === hash)) setTab(hash);
  }, []);

  /** Arrow-key movement between tabs, as expected for a WAI-ARIA tablist. */
  function onTabKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    const offset = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!offset) return;
    event.preventDefault();
    const index = PROFILE_TABS.findIndex(([key]) => key === tab);
    const next = PROFILE_TABS[(index + offset + PROFILE_TABS.length) % PROFILE_TABS.length][0];
    selectTab(next);
    document.getElementById(`profile-tab-${next}`)?.focus();
  }

  function updateField(field: keyof UserProfile, value: string) {
    setProfile((current) => ({ ...current, [field]: value }));
    setSources((current) => ({ ...current, [field]: "manual" }));
    markDirty();
  }

  async function save() {
    setSaveState("saving"); setNotice("");
    const result = await commitProfile(profile, { markdown, sources: sources as Record<string, string> });
    if (!result.ok) { setSaveState("error"); setNotice(result.error ?? "Could not save."); return; }
    setSaveState("saved");
    setTimeout(() => setSaveState((current) => (current === "saved" ? "clean" : current)), 2500);
  }

  // Ctrl/Cmd+S saves without leaving the keyboard.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (saveState === "dirty" || saveState === "error") void save();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  async function importResume() {
    if (!resumeFile) { setNotice("Choose a resume file first."); return; }
    setResumeBusy(true); setNotice("");
    try {
      const form = new FormData();
      form.append("file", resumeFile);
      const response = await fetch("/api/resume/analyze", { method: "POST", body: form });
      const result = await response.json() as ResumeAnalysis & { error?: string };
      if (!response.ok) throw new Error(result.error || "Could not read that resume.");
      setAnalysis(result);
      // Resume wins: re-merging under "resume" replaces anything a weaker source had filled.
      const merged = mergeProfile(profile, result.profile, "resume", sources);
      // Seed a sensible order for freshly imported projects (resume first, supporting
      // evidence after). The candidate can reorder from here and that order is saved.
      const grouped = groupProjects(merged.profile);
      setProfile({ ...merged.profile, projects: [...grouped.primary, ...grouped.secondary] });
      setSources(merged.sources);
      // Persist the original file so the extension can attach this exact document.
      const stored = await storeResumeFile(resumeFile, result.rawText ?? result.formattedText ?? "");
      if (stored.ok && stored.resume) setStoredResume(stored.resume);
      setResumeFile(null);
      setSaveState("dirty");
      setNotice(stored.ok
        ? "Resume extracted and saved. Review the highlighted values, then save."
        : `Resume extracted, but the file could not be stored: ${stored.error ?? "upload failed"}`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Resume import failed."); }
    finally { setResumeBusy(false); }
  }

  function addSkill() {
    const name = newSkill.trim();
    if (!name) return;
    if (profile.skills?.some((skill) => skill.name.toLowerCase() === name.toLowerCase())) { setNewSkill(""); return; }
    setProfile((current) => ({ ...current, skills: [...(current.skills ?? []), { name }] }));
    setNewSkill(""); markDirty();
  }

  /**
   * Edits one skill row by position.
   *
   * Position, not name: rows are editable, so while a name is being typed several rows
   * can share a value (or be blank) and a name-keyed update would edit the wrong row.
   */
  function updateSkill(index: number, patch: Partial<{ name: string; years: number | undefined; proficiency: string | undefined }>) {
    setProfile((current) => ({
      ...current,
      skills: (current.skills ?? []).map((entry, position) => position === index ? { ...entry, ...patch } : entry),
    }));
    markDirty();
  }

  function removeSkill(index: number) {
    // Remove by position. Filtering by name deleted every row sharing that name, so
    // clearing one duplicate silently destroyed the others.
    setProfile((current) => ({ ...current, skills: (current.skills ?? []).filter((_, position) => position !== index) }));
    markDirty();
  }

  function addCustomField() {
    const label = newCustomLabel.trim();
    const value = newCustomValue.trim();
    if (!label || !value) return;
    setProfile((current) => ({ ...current, customFields: [...(current.customFields ?? []), { id: crypto.randomUUID(), label, value }] }));
    setNewCustomLabel(""); setNewCustomValue(""); markDirty();
  }

  function updateCustomField(id: string, key: "label" | "value", text: string) {
    setProfile((current) => ({ ...current, customFields: (current.customFields ?? []).map((field) => field.id === id ? { ...field, [key]: text } : field) }));
    markDirty();
  }

  function removeCustomField(id: string) {
    setProfile((current) => ({ ...current, customFields: (current.customFields ?? []).filter((field) => field.id !== id) }));
    markDirty();
  }

  const fullName = [profile.firstName, profile.lastName].filter(Boolean).join(" ");
  const initials = ((profile.firstName?.[0] ?? "") + (profile.lastName?.[0] ?? "")).toUpperCase() || (email[0] ?? "?").toUpperCase();
  const dirty = saveState === "dirty" || saveState === "error";

  const BASIC_FIELDS: Array<[keyof UserProfile, string, string]> = [
    ["firstName", "First name", "text"], ["lastName", "Last name", "text"],
    ["email", "Email", "email"], ["phone", "Phone", "tel"],
    ["location", "Location", "text"], ["currentTitle", "Current title", "text"],
    ["linkedin", "LinkedIn", "url"], ["github", "GitHub", "url"], ["portfolio", "Portfolio", "url"],
  ];
  const DETAIL_FIELDS: Array<[keyof UserProfile, string]> = [
    ["totalExperience", "Total experience"], ["noticePeriod", "Notice period"],
    ["currentSalary", "Current compensation"], ["expectedSalary", "Expected compensation"],
    ["willingToRelocate", "Willing to relocate"], ["workAuthorization", "Work authorization"],
    ["availability", "Availability"],
  ];

  return <main className="main profile-page">
    <div className="topbar">
      <div><div className="eyebrow">Application profile</div><h1>Your source of truth</h1></div>
      <Link href="/dashboard" className="text-link">Back to overview</Link>
    </div>

    <section className="profile-hero">
      <div className="profile-hero-identity">
        <div className="profile-avatar">{initials}</div>
        <div>
          <h2>{fullName || "Finish your profile"}</h2>
          <p>{profile.currentTitle || "Add your current title"}{profile.location ? ` · ${profile.location}` : ""}</p>
          <p className="profile-email">{email}</p>
        </div>
      </div>
      <div className="profile-score">
        <svg viewBox="0 0 80 80" width="76" height="76">
          <circle cx="40" cy="40" r="34" fill="none" stroke="#e4e0ff" strokeWidth="7" />
          <circle cx="40" cy="40" r="34" fill="none" stroke="#5546d9" strokeWidth="7" strokeLinecap="round" strokeDasharray={`${completeness.percent * 2.136} 213.6`} transform="rotate(-90 40 40)" />
          <text x="40" y="46" textAnchor="middle" fontSize="17" fontWeight="700" fill="#1f2040" fontFamily="Space Grotesk">{completeness.percent}%</text>
        </svg>
        <span>complete</span>
      </div>
    </section>

    {completeness.missing.length > 0 && <div className="missing-bar">
      <strong>Still missing</strong>
      {completeness.missing.map((item) => <span key={item}>{item}</span>)}
    </div>}

    <nav className="profile-tabs" role="tablist" aria-label="Profile sections">
      {PROFILE_TABS.map(([key, label]) =>
        <button
          key={key}
          role="tab"
          id={`profile-tab-${key}`}
          aria-selected={tab === key}
          aria-controls={`profile-panel-${key}`}
          tabIndex={tab === key ? 0 : -1}
          className={tab === key ? "active" : ""}
          onClick={() => selectTab(key)}
          onKeyDown={onTabKeyDown}
        >{label}</button>)}
    </nav>

    {notice && <p className="profile-notice">{notice}</p>}

    {reviewQueue.length > 0 && <section className="review-queue" aria-labelledby="review-queue-heading">
      <div className="section-head">
        <h3 id="review-queue-heading">Needs your review <span className="count">{reviewQueue.length}</span></h3>
        <span className="card-hint">{describeReviewQueue(reviewQueue)}</span>
      </div>
      <p className="card-hint review-intro">Resume parsing is not perfect. These values look wrong, and they would be sent to employers as-is.</p>
      <ul className="review-list">
        {reviewQueue.map((entry) => <li key={entry.id} className={`review-item ${entry.severity}`}>
          <div className="review-main">
            <span className="review-area">{entry.area} · {entry.label}</span>
            <strong>{entry.value}</strong>
            <small>{entry.reason}</small>
          </div>
          <button className="ghost-button" onClick={() => selectTab(entry.tab)}>Fix</button>
        </li>)}
      </ul>
    </section>}

    {tab === "overview" && <div className="profile-stack" role="tabpanel" id="profile-panel-overview" aria-labelledby="profile-tab-overview">
      <section className="card">
        <div className="section-head"><h3>Basics</h3><span className="card-hint">Used to fill identity fields automatically</span></div>
        <div className="field-grid">{BASIC_FIELDS.map(([field, label, type]) => <label key={field}>
          <span>{label}{sources[field] && <em className={`source-chip ${sources[field] === "resume" ? "resume" : ""}`}>{sources[field]}</em>}</span>
          <input type={type} value={String(profile[field] ?? "")} onChange={(event) => updateField(field, event.target.value)} placeholder={label} />
        </label>)}</div>
        <label className="full-width"><span>Professional summary</span>
          <textarea value={profile.summary ?? ""} onChange={(event) => updateField("summary", event.target.value)} rows={4} placeholder="A short, factual summary in your own words." />
        </label>
      </section>

      <section className="card">
        <div className="section-head">
          <h3>Skills <span className="count">{profile.skills?.length ?? 0}</span></h3>
          <span className="card-hint">Years and level are editable</span>
        </div>
        <div className="skill-rows">{(profile.skills ?? []).map((skill, index) => <div className="skill-row" key={index}>
          <input
            value={skill.name}
            placeholder="Skill"
            aria-label={`Skill ${index + 1} name`}
            onChange={(event) => updateSkill(index, { name: event.target.value })}
          />
          <input
            type="number" min={0} max={50} step={0.5}
            value={skill.years ?? ""}
            placeholder="Years"
            aria-label={`Years of ${skill.name || "this skill"}`}
            onChange={(event) => updateSkill(index, { years: event.target.value === "" ? undefined : Number(event.target.value) })}
          />
          <select
            value={skill.proficiency ?? ""}
            aria-label={`Proficiency in ${skill.name || "this skill"}`}
            onChange={(event) => updateSkill(index, { proficiency: event.target.value || undefined })}
          >
            <option value="">Level</option>
            <option value="beginner">Beginner</option>
            <option value="intermediate">Intermediate</option>
            <option value="advanced">Advanced</option>
            <option value="expert">Expert</option>
          </select>
          <button onClick={() => removeSkill(index)} aria-label={`Remove ${skill.name || `skill ${index + 1}`}`}>×</button>
        </div>)}
          {!profile.skills?.length && <p className="empty-state">No skills yet. Import a resume or add them below.</p>}
        </div>
        <div className="inline-add">
          <input value={newSkill} onChange={(event) => setNewSkill(event.target.value)} onKeyDown={(event) => event.key === "Enter" && addSkill()} placeholder="Add a skill" />
          <button className="ghost-button" onClick={addSkill}>Add</button>
        </div>
      </section>

      <div className="profile-columns">
        <section className="card">
          <div className="section-head">
            <h3>Experience <span className="count">{profile.experiences?.length ?? 0}</span></h3>
            <span className="card-hint">Drag or use ↑ ↓ to order</span>
          </div>
          <EditableRecordList
            items={profile.experiences ?? []}
            onChange={(next) => { setProfile((current) => ({ ...current, experiences: next })); markDirty(); }}
            createEmpty={() => ({ company: "", title: "", period: "", location: "", summary: "", achievements: [], skills: [] })}
            title={(item) => item.title || item.company}
            subtitle={(item) => [item.company, item.period, item.location].filter(Boolean).join(" · ")}
            addLabel="Add a role"
            emptyHint="Import your resume to populate your roles, or add one manually."
            fields={[
              { key: "title", label: "Job title", placeholder: "Senior Engineer" },
              { key: "company", label: "Company", placeholder: "Acme Inc." },
              { key: "period", label: "Period", placeholder: "2022 — Present" },
              { key: "location", label: "Location", placeholder: "Remote" },
              { key: "summary", label: "Summary", type: "area", placeholder: "What you owned in this role" },
              { key: "achievements", label: "Achievements", type: "list", placeholder: "Cut onboarding time by 40%" },
              { key: "skills", label: "Skills used", type: "list", placeholder: "TypeScript" },
            ]}
          />
        </section>

        <section className="card">
          <div className="section-head">
            <h3>Projects <span className="count">{profile.projects?.length ?? 0}</span></h3>
            <span className="card-hint">Resume projects first</span>
          </div>
          <EditableRecordList
            items={profile.projects ?? []}
            onChange={(next) => { setProfile((current) => ({ ...current, projects: next })); markDirty(); }}
            createEmpty={() => ({ name: "", description: "", technologies: [], impact: "", role: "", period: "", url: "", source: "manual" as ProjectSource })}
            title={(item) => item.name}
            subtitle={(item) => [item.role, item.period, item.source].filter(Boolean).join(" · ")}
            addLabel="Add a project"
            emptyHint="Projects from your resume appear here first."
            fields={[
              { key: "name", label: "Name", placeholder: "UplyFox" },
              { key: "role", label: "Your role", placeholder: "Creator" },
              { key: "period", label: "Period", placeholder: "2025" },
              { key: "url", label: "Link", placeholder: "https://" },
              { key: "description", label: "Description", type: "area" },
              { key: "impact", label: "Impact", type: "area", placeholder: "The measurable outcome" },
              { key: "technologies", label: "Technologies", type: "list", placeholder: "React" },
            ]}
          />
        </section>
      </div>

      <section className="card">
        <div className="section-head">
          <h3>Education <span className="count">{profile.education?.length ?? 0}</span></h3>
          <span className="card-hint">Drag or use ↑ ↓ to order</span>
        </div>
        <EditableRecordList
          items={profile.education ?? []}
          onChange={(next) => { setProfile((current) => ({ ...current, education: next })); markDirty(); }}
          createEmpty={() => ({ institution: "", degree: "", field: "", period: "" })}
          title={(item) => item.institution || item.degree || ""}
          subtitle={(item) => [item.degree, item.field, item.period].filter(Boolean).join(" · ")}
          addLabel="Add education"
          emptyHint="No education entries yet."
          fields={[
            { key: "institution", label: "Institution", placeholder: "University" },
            { key: "degree", label: "Degree", placeholder: "B.Tech" },
            { key: "field", label: "Field", placeholder: "Computer Science" },
            { key: "period", label: "Period", placeholder: "2018 — 2022" },
          ]}
        />
      </section>
    </div>}

    {tab === "document" && <section className="card" role="tabpanel" id="profile-panel-document" aria-labelledby="profile-tab-document">
      <div className="section-head">
        <h3>Profile document</h3>
        <div className="head-actions">
          <button className="text-link" onClick={() => { setMarkdown(buildProfileMarkdown(profile)); setMarkdownEdited(false); markDirty(); }}>Regenerate from profile</button>
          <button className="text-link" onClick={() => navigator.clipboard.writeText(markdown)}>Copy Markdown</button>
        </div>
      </div>
      <p className="card-hint">Auto-generated with headings from your verified profile. Applications that ask for a written background reuse this.</p>
      <div className="document-split">
        <textarea className="markdown-editor" value={markdown} onChange={(event) => { setMarkdown(event.target.value); setMarkdownEdited(true); markDirty(); }} rows={26} spellCheck={false} />
        <div className="markdown-preview"><Markdown content={markdown} /></div>
      </div>
    </section>}

    {tab === "details" && <div className="profile-stack" role="tabpanel" id="profile-panel-details" aria-labelledby="profile-tab-details">
      <section className="card">
        <div className="section-head"><h3>Application details</h3><span className="card-hint">The questions almost every form asks</span></div>
        <div className="field-grid">{DETAIL_FIELDS.map(([field, label]) => <label key={field}>
          <span>{label}{sources[field] && <em className={`source-chip ${sources[field] === "resume" ? "resume" : ""}`}>{sources[field]}</em>}</span>
          <input value={String(profile[field] ?? "")} onChange={(event) => updateField(field, event.target.value)} placeholder={label} />
        </label>)}</div>
      </section>

      <section className="card">
        <div className="section-head"><h3>Custom answers <span className="count">{profile.customFields?.length ?? 0}</span></h3><span className="card-hint">For questions the standard fields do not cover</span></div>
        <div className="custom-list">{(profile.customFields ?? []).map((field) => <div className="custom-row" key={field.id}>
          <input value={field.label} onChange={(event) => updateCustomField(field.id, "label", event.target.value)} placeholder="Question" />
          <input value={field.value} onChange={(event) => updateCustomField(field.id, "value", event.target.value)} placeholder="Your answer" />
          <button onClick={() => removeCustomField(field.id)} aria-label="Remove">×</button>
        </div>)}</div>
        <div className="inline-add">
          <input value={newCustomLabel} onChange={(event) => setNewCustomLabel(event.target.value)} placeholder="Question label" />
          <input value={newCustomValue} onChange={(event) => setNewCustomValue(event.target.value)} placeholder="Your answer" />
          <button className="ghost-button" onClick={addCustomField}>Add</button>
        </div>
      </section>
    </div>}

    {tab === "sources" && <div className="profile-stack" role="tabpanel" id="profile-panel-sources" aria-labelledby="profile-tab-sources">
      {storedResume && <section className="card">
        <div className="section-head"><h3>Stored resume</h3><span className="pill">Used by the extension</span></div>
        <p className="card-hint">This is the exact file the browser extension attaches to job-board upload fields.</p>
        <div className="resume-file-row">
          <div className="resume-file-icon">PDF</div>
          <div className="resume-file-meta">
            <strong>{storedResume.name}</strong>
            <small>{storedResume.fileSize ? `${Math.round(storedResume.fileSize / 1024)} KB` : "Stored"} · uploaded {storedResume.createdAt ? new Date(storedResume.createdAt).toLocaleDateString() : "recently"}</small>
          </div>
          <button className="ghost-button" onClick={async () => {
            if (showResumePreview) { setShowResumePreview(false); return; }
            const url = await getResumePreviewUrl(storedResume.storagePath);
            if (!url) { setNotice("Could not open the resume preview."); return; }
            setResumePreviewUrl(url); setShowResumePreview(true);
          }}>{showResumePreview ? "Hide" : "View"}</button>
          <button className="ghost-button" onClick={async () => {
            if (!window.confirm(`Delete ${storedResume.name}? The extension will no longer be able to attach it.`)) return;
            const result = await deleteStoredResume(storedResume);
            if (!result.ok) { setNotice(result.error ?? "Could not delete the resume."); return; }
            setStoredResume(null); setShowResumePreview(false); setResumePreviewUrl(null);
            setNotice("Resume deleted. Upload a new one below.");
          }}>Delete</button>
        </div>
        {showResumePreview && resumePreviewUrl && <iframe className="resume-preview-frame" src={resumePreviewUrl} title={storedResume.name} />}
      </section>}

      <section className="card">
        <div className="section-head"><h3>{storedResume ? "Replace your resume" : "Re-import your resume"}</h3></div>
        <p className="card-hint">Your resume always takes priority. Re-importing refreshes every field it covers and leaves your manual edits elsewhere untouched.{storedResume ? " Uploading a new file replaces the stored one." : ""}</p>
        <label className="upload-drop">
          <input type="file" accept="application/pdf,.txt,.md,text/plain" onChange={(event) => setResumeFile(event.target.files?.[0] ?? null)} />
          <span className="upload-icon">↑</span>
          <strong>{resumeFile ? resumeFile.name : "Choose a resume file"}</strong>
          <small>PDF, TXT, or Markdown · up to 8 MB</small>
        </label>
        <button className="save-button wide" onClick={importResume} disabled={resumeBusy}>{resumeBusy ? "Extracting…" : "Extract and apply"}</button>
      </section>

      {analysis && <section className="card">
        <div className="section-head"><h3>Extraction review</h3><span className={`pill ${analysis.source === "ai" ? "" : "pending"}`}>{analysis.source === "ai" ? "AI formatted" : "Locally extracted"}</span></div>
        {analysis.aiNotice && <p className="card-hint">{analysis.aiNotice}</p>}
        <ul className="suggestion-list">{analysis.suggestions.map((suggestion) => <li key={suggestion}>{suggestion}</li>)}</ul>
      </section>}

      <section className="card">
        <div className="section-head"><h3>Rebuild your profile</h3></div>
        <p className="card-hint">Runs the full wizard again: extract a resume, add GitHub and links, then rebuild every section. Nothing changes until you save at the end.</p>
        <Link className="save-button wide" href="/onboarding">Rebuild from the wizard</Link>
      </section>
    </div>}

    <AccountSecurity />

    <div className={`save-bar ${dirty ? "visible" : ""}`}>
      <span>{saveState === "error" ? notice || "Save failed." : "You have unsaved changes."}</span>
      <div>
        <button className="text-link" onClick={() => window.location.reload()}>Discard</button>
        <button className="save-button" onClick={save} disabled={saveState === "saving"}>{saveState === "saving" ? "Saving…" : "Save profile"}</button>
      </div>
    </div>
    {saveState === "saved" && <div className="save-toast">Profile saved</div>}
    {loading && <div className="save-toast">Loading your profile…</div>}
  </main>;
}
