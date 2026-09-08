"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  APPLICATION_ANSWER_FIELDS,
  EMPTY_NARRATIVE,
  buildProfileMarkdown,
  emptyProfile,
  groupProjects,
  mergeProfile,
  profileCompleteness,
  type ApplicationAnswers,
  type GeneratedAnswer,
  type NarrativeInput,
  type ProfileSources,
  type RawSignal,
  type UserProfile,
} from "@applypilot/shared";
import { AuthGate } from "../../components/auth-gate";
import { VoiceButton } from "../../components/voice-input";
import { Markdown } from "../../components/markdown";
import { getSupabaseBrowserClient } from "../../lib/supabase";
import { commitProfile, deleteSignal, loadDraft, saveDraft, saveSignal } from "../../lib/onboarding-store";
import "./onboarding.css";

const STEPS = ["Resume", "Enrich", "Your story", "Details", "Build", "Review"] as const;

type SaveState = "idle" | "saving" | "saved" | "error";

async function readApiResponse(response: Response): Promise<any> {
  const raw = await response.text();
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    const status = response.status ? ` (${response.status})` : "";
    throw new Error(response.ok
      ? "The server returned an invalid response. Please try again."
      : `The profile service returned an error${status}. Please try again.`);
  }
}

function resumeSources(profile: Partial<UserProfile>): ProfileSources {
  const result: ProfileSources = {};
  for (const key of Object.keys(profile) as Array<keyof UserProfile>) {
    const value = profile[key];
    if ((typeof value === "string" && value.trim()) || (Array.isArray(value) && value.length)) result[key] = "resume";
  }
  return result;
}

export default function OnboardingPage() {
  return <AuthGate requireOnboarding={false} requireAccess={false}><OnboardingWizard /></AuthGate>;
}

function OnboardingWizard() {
  const router = useRouter();
  const [stepIndex, setStepIndex] = useState(0);
  const [signals, setSignals] = useState<RawSignal[]>([]);
  const [profile, setProfile] = useState<UserProfile>(emptyProfile());
  const [sources, setSources] = useState<ProfileSources>({});
  const [narrative, setNarrative] = useState<NarrativeInput>(EMPTY_NARRATIVE);
  const [answers, setAnswers] = useState<Partial<ApplicationAnswers>>({});
  const [markdown, setMarkdown] = useState("");
  const [gaps, setGaps] = useState<string[]>([]);
  const [generated, setGenerated] = useState<GeneratedAnswer[]>([]);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [hydrated, setHydrated] = useState(false);

  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [resumeTextInput, setResumeTextInput] = useState("");
  const [resumeText, setResumeText] = useState("");
  const [resumeProfile, setResumeProfile] = useState<Partial<UserProfile>>({});
  const [resumeSections, setResumeSections] = useState<Array<{ title: string; content: string; category: string }>>([]);
  const [githubInput, setGithubInput] = useState("");
  const [linkInput, setLinkInput] = useState("");
  const [pastedInput, setPastedInput] = useState("");

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasResume = signals.some((signal) => signal.source === "resume") || Boolean(resumeText.trim()) || Object.keys(resumeProfile).length > 0;
  const completeness = useMemo(() => profileCompleteness(profile), [profile]);
  const { primary: primaryProjects, secondary: secondaryProjects } = useMemo(() => groupProjects(profile), [profile]);
  const [alreadyOnboarded, setAlreadyOnboarded] = useState(false);

  // Restore any autosaved session so a refresh or device switch never loses captured work.
  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    supabase?.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      const { data: row } = await supabase.from("profiles").select("onboarding_completed_at").eq("id", data.user.id).maybeSingle();
      setAlreadyOnboarded(Boolean(row?.onboarding_completed_at));
    });

    loadDraft().then((draft) => {
      if (draft) {
        if (draft.profile) setProfile({ ...emptyProfile(), ...draft.profile });
        if (draft.narrative && typeof draft.narrative === "object") setNarrative({ ...EMPTY_NARRATIVE, ...draft.narrative as NarrativeInput });
        if (draft.answers && typeof draft.answers === "object") setAnswers(draft.answers as Partial<ApplicationAnswers>);
        if (draft.resumeText) setResumeText(draft.resumeText);
        if (draft.resumeProfile) setResumeProfile(draft.resumeProfile);
        if (draft.signals.length) setSignals(draft.signals);
        const savedResume = draft.signals.find((signal) => signal.source === "resume");
        const restoredResumeProfile = draft.resumeProfile ?? (
          savedResume?.data?.profile && typeof savedResume.data.profile === "object"
            ? savedResume.data.profile as Partial<UserProfile>
            : {}
        );
        if (Object.keys(restoredResumeProfile).length) setSources({
          ...resumeSources(restoredResumeProfile),
          ...(draft.sources as ProfileSources ?? {}),
        });
        if (savedResume) {
          if (!draft.resumeText) setResumeText(savedResume.content);
          if (!draft.resumeProfile) {
            const extracted = savedResume.data?.profile;
            if (extracted && typeof extracted === "object") setResumeProfile(extracted as Partial<UserProfile>);
          }
        }
      }
      setHydrated(true);
    }).catch(() => setHydrated(true));
  }, []);

  // Debounced autosave: every captured field is persisted without an explicit save action.
  useEffect(() => {
    if (!hydrated) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaveState("saving");
    saveTimer.current = setTimeout(async () => {
      const result = await saveDraft({ profile, narrative, answers, resumeText, resumeProfile, sources: sources as Record<string, string> });
      setSaveState(result.ok ? "saved" : "error");
    }, 700);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [answers, hydrated, narrative, profile, sources]);

  const applySignal = useCallback(async (
    signal: Omit<RawSignal, "id" | "collectedAt">,
    extracted: Partial<UserProfile>,
    persistence?: { resumeText?: string; resumeProfile?: Partial<UserProfile> },
  ) => {
    const record: RawSignal = { ...signal, id: crypto.randomUUID(), collectedAt: new Date().toISOString() };
    setSignals((current) => [...current.filter((item) => !(item.source === record.source && item.origin === record.origin)), record]);
    // Merge under the signal's own source so precedence rules decide what may be overwritten.
    const merged = mergeProfile(profile, extracted, record.source, sources);
    setProfile(merged.profile);
    setSources(merged.sources);
    const signalResult = await saveSignal(record);
    const draftResult = await saveDraft({
      profile: merged.profile,
      sources: merged.sources as Record<string, string>,
      ...(record.source === "resume" ? { resumeText: persistence?.resumeText ?? record.content, resumeProfile: persistence?.resumeProfile ?? extracted } : {}),
    });
    if (!signalResult.ok || !draftResult.ok) {
      throw new Error(`Resume extracted locally, but could not save it: ${signalResult.error ?? draftResult.error ?? "database write failed"}`);
    }
    return merged.profile;
  }, [profile, sources]);

  async function importResume() {
    const hasText = resumeTextInput.trim().length > 40;
    if (!resumeFile && !hasText) { setNotice("Choose a resume file or paste your resume text."); return; }
    setBusy("resume"); setNotice("");
    try {
      const form = new FormData();
      if (resumeFile) form.append("file", resumeFile);
      else form.append("text", resumeTextInput);
      const response = await fetch("/api/resume/analyze", { method: "POST", body: form });
      const result = await readApiResponse(response);
      if (!response.ok) throw new Error(result.error || "Could not read that resume.");

      const extractedProfile = result.profile ?? {};
      const extractedText = result.rawText ?? result.formattedText ?? "";
      setResumeProfile(extractedProfile);
      setResumeText(extractedText);
      setResumeSections(Array.isArray(result.sections) ? result.sections : []);

      const merged = await applySignal(
        { source: "resume", origin: resumeFile?.name ?? "Pasted resume", content: extractedText, data: { profile: extractedProfile, sections: result.sections ?? [] } },
        extractedProfile,
        { resumeText: extractedText, resumeProfile: extractedProfile },
      );
      setResumeFile(null); setResumeTextInput("");
      const found = [
        merged.experiences?.length && `${merged.experiences.length} role(s)`,
        merged.skills?.length && `${merged.skills.length} skill(s)`,
        merged.projects?.length && `${merged.projects.length} project(s)`,
        merged.education?.length && `${merged.education.length} education entr(ies)`,
      ].filter(Boolean).join(" · ");
      setNotice(`Resume saved. Extracted ${found || "your details"}. These facts now take priority over every other source.`);
      setStepIndex(1);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Resume import failed."); }
    finally { setBusy(""); }
  }

  async function importGithub() {
    if (!githubInput.trim()) return;
    setBusy("github"); setNotice("");
    try {
      const response = await fetch("/api/enrich/github", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: githubInput }) });
      const result = await readApiResponse(response);
      if (!response.ok) throw new Error(result.error || "GitHub import failed.");
      const summary = [`GitHub @${result.username}`, result.bio, `Top languages: ${result.topLanguages.join(", ")}`,
        ...result.repositories.map((repo: { name: string; description?: string; language?: string; stars: number }) => `${repo.name} (${repo.language ?? "n/a"}, ${repo.stars}★): ${repo.description ?? ""}`)].filter(Boolean).join("\n");
      await applySignal(
        { source: "github", origin: `github.com/${result.username}`, content: summary, data: { ...result, profile: {
          github: `https://github.com/${result.username}`,
          skills: (result.topLanguages ?? []).map((name: string) => ({ name })),
          projects: (result.repositories ?? []).slice(0, 10).map((repo: { name: string; description?: string; language?: string; url?: string }) => ({
            name: repo.name,
            description: repo.description ?? "",
            technologies: repo.language ? [repo.language] : [],
            url: repo.url ?? "",
            source: "github" as const,
          })),
        } } },
        {},
      );
      setGithubInput("");
      setNotice(`GitHub added as supporting detail. Your resume still takes priority for anything both sources mention.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "GitHub import failed."); }
    finally { setBusy(""); }
  }

  async function importLink() {
    if (!linkInput.trim()) return;
    setBusy("link"); setNotice("");
    try {
      const response = await fetch("/api/enrich/link", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: linkInput }) });
      const result = await readApiResponse(response);
      if (!response.ok) throw new Error(result.error || "Could not read that link.");
      await applySignal(
        { source: "project", origin: result.url, content: [result.title, result.description, result.text].filter(Boolean).join("\n"), data: { ...result, profile: {
          portfolio: result.url,
          projects: result.title ? [{ name: result.title, description: result.description ?? "", url: result.url, technologies: result.technologies ?? [], source: "portfolio" as const }] : [],
        } } },
        {},
      );
      setLinkInput(""); setNotice(`Read "${result.title}" and saved it as supporting detail.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Link import failed."); }
    finally { setBusy(""); }
  }

  async function addPasted() {
    if (pastedInput.trim().length < 20) { setNotice("Paste a bit more text so it is useful."); return; }
    await applySignal({ source: "linkedin_export", origin: "Pasted profile text", content: pastedInput.trim(), data: {} }, {});
    setPastedInput(""); setNotice("Pasted profile text saved.");
  }

  async function removeSignal(signal: RawSignal) {
    setSignals((current) => current.filter((item) => item.id !== signal.id));
    await deleteSignal(signal.source, signal.origin);
  }

  async function accessToken() {
    const supabase = getSupabaseBrowserClient();
    const { data } = (await supabase?.auth.getSession()) ?? { data: { session: null } };
    return data.session?.access_token ?? null;
  }

  async function runAgent() {
    setBusy("agent"); setNotice("");
    try {
      const token = await accessToken();
      if (!token) throw new Error("Your session expired. Sign in again.");
      const response = await fetch("/api/profile/synthesize", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          signals,
          resumeText,
          resumeProfile,
          resumeSections,
          narrative,
          answers,
          generateAnswers: true,
        }),
      });
      const result = await readApiResponse(response);
      if (!response.ok) throw new Error(result.error || "Profile build failed.");
      // The server also protects this boundary, but keep a client-side guard so a
      // stale/partial response can never erase the extracted resume in the review UI.
      const protectedResume = mergeProfile(emptyProfile(), resumeProfile, "resume");
      const reconciled = mergeProfile(
        protectedResume.profile,
        { ...emptyProfile(), ...(result.profile ?? {}) },
        "typed",
        { ...protectedResume.sources, ...(result.sources ?? {}) },
      );
      setProfile(reconciled.profile);
      setMarkdown(result.profileMarkdown ?? "");
      setGaps(result.gaps ?? []);
      setGenerated(result.generatedAnswers ?? []);
      setSources(reconciled.sources);
      await saveDraft({
        profile: reconciled.profile,
        markdown: result.profileMarkdown,
        resumeText,
        resumeProfile,
        sources: reconciled.sources as Record<string, string>,
      });
      setStepIndex(5);
      setNotice(result.aiUsed
        ? `Profile built from ${signals.length} source(s) with ${result.generatedAnswers?.length ?? 0} reusable answers.`
        : `Profile assembled from your materials with ${result.generatedAnswers?.length ?? 0} answers. AI polish was unavailable, so nothing was rewritten.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Profile build failed."); }
    finally { setBusy(""); }
  }

  function updateField(field: keyof UserProfile, value: string) {
    setProfile((current) => ({ ...current, [field]: value }));
    setSources((current) => ({ ...current, [field]: "manual" }));
  }

  async function finish() {
    setBusy("save"); setNotice("");
    const document = markdown || buildProfileMarkdown(profile);
    const result = await commitProfile(profile, {
      markdown: document,
      sources: sources as Record<string, string>,
      resumeText,
      resumeProfile,
      completeOnboarding: true,
    });
    if (!result.ok) { setNotice(`Could not save: ${result.error}`); setBusy(""); return; }

    const supabase = getSupabaseBrowserClient();
    const { data: userData } = (await supabase?.auth.getUser()) ?? { data: { user: null } };
    if (supabase && userData.user && generated.length) {
      await supabase.from("answer_library").insert(generated.map((item) => ({
        user_id: userData.user!.id, question: item.question, answer: item.answer,
        category: item.category, tags: ["onboarding", ...item.basedOn], edited: item.edited,
      })));
    }
    setBusy("");
    router.push("/profile");
  }

  const progress = Math.round(((stepIndex + 1) / STEPS.length) * 100);
  const saveLabel = saveState === "saving" ? "Saving…" : saveState === "saved" ? "All changes saved" : saveState === "error" ? "Save failed — retrying" : "";
{alreadyOnboarded && <div className="resume-banner">
        <div>
          <strong>You already have a profile</strong>
          <span>Skip ahead and keep using it, or rebuild it from a new resume. Rebuilding never deletes anything until you save.</span>
        </div>
        <div className="resume-banner-actions">
          <button className="ghost-button" onClick={() => setAlreadyOnboarded(false)}>Rebuild profile</button>
          <button className="primary-button" onClick={() => router.push("/profile")}>Skip to my profile</button>
        </div>
      </div>}
      
  return <main className="onboarding">
    <header className="onboarding-head">
      <div className="brand"><img src="/icons/48.png" width={28} height={28} alt="" />ApplyPilot</div>
      <div className="onboarding-progress"><span style={{ width: `${progress}%` }} /></div>
      <nav className="onboarding-steps">{STEPS.map((label, index) => <button key={label} className={index === stepIndex ? "active" : index < stepIndex ? "done" : ""} onClick={() => index <= stepIndex && setStepIndex(index)}><i>{index + 1}</i>{label}</button>)}</nav>
      {saveLabel && <div className={`autosave ${saveState}`}><span className="autosave-dot" />{saveLabel}</div>}
    </header>

    {stepIndex === 0 && <section className="onboarding-panel">
      <h1>Start with your resume</h1>
      <p className="lede">Your resume is the source of truth. We extract it first and save it immediately — everything you add later can only fill gaps, never overwrite it.</p>

      <div className="source-card primary">
        <div className="source-head"><strong>Upload your resume</strong><small>PDF, TXT, or Markdown · up to 8 MB</small></div>
        <label className="file-drop"><input type="file" accept="application/pdf,.txt,.md,text/plain" onChange={(event) => setResumeFile(event.target.files?.[0] ?? null)} /><span>{resumeFile ? resumeFile.name : "Choose a resume file"}</span></label>
        <div className="or-divider"><span>or paste the text</span></div>
        <textarea value={resumeTextInput} onChange={(event) => setResumeTextInput(event.target.value)} rows={6} placeholder="Paste your full resume text here…" />
        <button className="primary-button wide" onClick={importResume} disabled={busy === "resume"}>{busy === "resume" ? "Extracting and saving…" : "Extract and save resume"}</button>
      </div>

      {hasResume && <div className="extract-summary">
        <strong>Extracted from your resume</strong>
        <div className="extract-grid">
          <span><i>{profile.experiences?.length ?? 0}</i>roles</span>
          <span><i>{profile.skills?.length ?? 0}</i>skills</span>
          <span><i>{profile.projects?.length ?? 0}</i>projects</span>
          <span><i>{profile.education?.length ?? 0}</i>education</span>
        </div>
        <div className="resume-preview">
          <strong>{[resumeProfile.firstName, resumeProfile.lastName].filter(Boolean).join(" ") || "Candidate details"}</strong>
          <span>{[resumeProfile.currentTitle, resumeProfile.email, resumeProfile.phone, resumeProfile.location].filter(Boolean).join(" · ") || "Contact details will appear here"}</span>
          {resumeProfile.summary && <p>{resumeProfile.summary}</p>}
          {(resumeProfile.experiences ?? []).slice(0, 3).map((item, index) => <div className="resume-preview-item" key={`${item.company}-${item.title}-${index}`}><b>{item.title || "Role"}</b><span>{[item.company, item.period].filter(Boolean).join(" · ")}</span></div>)}
        </div>
      </div>}

      {notice && <p className="onboarding-notice">{notice}</p>}
      <div className="onboarding-actions">
        <button className="primary-button" onClick={() => setStepIndex(1)} disabled={!hasResume}>Continue</button>
        <button className="ghost-button" onClick={() => setStepIndex(1)}>Skip for now</button>
      </div>
    </section>}

    {stepIndex === 1 && <section className="onboarding-panel">
      <h1>Add supporting detail</h1>
      <p className="lede">These fill the gaps your resume left empty and add extra projects. They never change a fact your resume already stated.</p>

      <div className="source-card">
        <div className="source-head"><strong>GitHub</strong><small>Public repositories, languages, and bio</small></div>
        <div className="inline-row"><input value={githubInput} onChange={(event) => setGithubInput(event.target.value)} placeholder="username or github.com/username" /><button className="ghost-button" onClick={importGithub} disabled={busy === "github"}>{busy === "github" ? "Fetching…" : "Import"}</button></div>
      </div>

      <div className="source-card">
        <div className="source-head"><strong>Project & portfolio links</strong><small>Add each one; we read the page text</small></div>
        <div className="inline-row"><input value={linkInput} onChange={(event) => setLinkInput(event.target.value)} placeholder="https://your-project.com" /><button className="ghost-button" onClick={importLink} disabled={busy === "link"}>{busy === "link" ? "Reading…" : "Add link"}</button></div>
      </div>

      <div className="source-card">
        <div className="source-head"><strong>LinkedIn or other profiles</strong><small>Paste the text — LinkedIn blocks automated reading</small></div>
        <textarea value={pastedInput} onChange={(event) => setPastedInput(event.target.value)} rows={4} placeholder="Open your profile, select the page or use “Save to PDF”, and paste the text here." />
        <button className="ghost-button" onClick={addPasted}>Add pasted text</button>
      </div>

      {signals.length > 0 && <div className="signal-list">
        <strong>{signals.length} source(s) saved</strong>
        {signals.map((signal) => <div className="signal-row" key={signal.id}>
          <span className={`signal-tag ${signal.source === "resume" ? "authoritative" : ""}`}>{signal.source === "resume" ? "resume · priority" : signal.source}</span>
          <span className="signal-origin">{signal.origin}</span>
          <button onClick={() => removeSignal(signal)} aria-label={`Remove ${signal.origin}`}>×</button>
        </div>)}
      </div>}

      {notice && <p className="onboarding-notice">{notice}</p>}
      <div className="onboarding-actions"><button className="ghost-button" onClick={() => setStepIndex(0)}>Back</button><button className="primary-button" onClick={() => setStepIndex(2)}>Continue</button></div>
    </section>}

    {stepIndex === 2 && <section className="onboarding-panel">
      <h1>Tell us about yourself</h1>
      <p className="lede">Type or dictate. Your own words shape the tone of every generated answer — they never change your resume facts.</p>
      {([["about", "About you", "What you do, what you are good at, what you care about."], ["experience", "Your experience", "Walk through your roles and the impact you had."], ["expectations", "What you are looking for", "Role, team, location, compensation, growth."]] as Array<[keyof NarrativeInput, string, string]>).map(([field, label, hint]) => <div className="narrative-block" key={field}>
        <div className="narrative-head"><label>{label}<small>{hint}</small></label><VoiceButton onText={(value) => setNarrative((current) => ({ ...current, [field]: `${current[field]} ${value}`.trim() }))} /></div>
        <textarea value={narrative[field]} onChange={(event) => setNarrative({ ...narrative, [field]: event.target.value })} rows={6} placeholder="Type here, or use dictate…" />
      </div>)}
      <div className="onboarding-actions"><button className="ghost-button" onClick={() => setStepIndex(1)}>Back</button><button className="primary-button" onClick={() => setStepIndex(3)}>Continue</button></div>
    </section>}

    {stepIndex === 3 && <section className="onboarding-panel">
      <h1>The questions every application asks</h1>
      <p className="lede">Answer what you can. Anything you skip is marked as missing — never invented.</p>
      <div className="answer-grid">{APPLICATION_ANSWER_FIELDS.map((field) => <div className={`answer-field ${field.multiline ? "wide" : ""}`} key={field.key}>
        <div className="answer-field-head"><label>{field.label}{field.sensitive && <span className="sensitive">sensitive</span>}<small>{field.hint}</small></label>{field.multiline && <VoiceButton onText={(value) => setAnswers((current) => ({ ...current, [field.key]: `${current[field.key] ?? ""} ${value}`.trim() }))} label="Dictate" />}</div>
        {field.multiline
          ? <textarea value={answers[field.key] ?? ""} onChange={(event) => setAnswers({ ...answers, [field.key]: event.target.value })} rows={4} />
          : <input value={answers[field.key] ?? ""} onChange={(event) => setAnswers({ ...answers, [field.key]: event.target.value })} placeholder={field.hint} />}
      </div>)}</div>
      <div className="onboarding-actions"><button className="ghost-button" onClick={() => setStepIndex(2)}>Back</button><button className="primary-button" onClick={() => setStepIndex(4)}>Continue</button></div>
    </section>}

    {stepIndex === 4 && <section className="onboarding-panel">
      <h1>Build your profile</h1>
      <p className="lede">The agent now assembles everything you gave us into one verified profile, a formatted profile document, and a library of reusable answers.</p>
      <div className="build-summary">
        {[["Resume", hasResume ? "Captured · authoritative" : "Not added"],
          ["Supporting sources", `${signals.filter((signal) => signal.source !== "resume").length} added`],
          ["Your story", [narrative.about, narrative.experience, narrative.expectations].filter((item) => item.trim()).length ? "Captured" : "Not added"],
          ["Application details", `${Object.values(answers).filter((item) => (item ?? "").trim()).length} of ${APPLICATION_ANSWER_FIELDS.length} answered`]].map(([label, value]) => <div className="build-row" key={label}><strong>{label}</strong><span>{value}</span></div>)}
      </div>
      {notice && <p className="onboarding-notice">{notice}</p>}
      <div className="onboarding-actions">
        <button className="ghost-button" onClick={() => setStepIndex(3)}>Back</button>
        <button className="primary-button" onClick={runAgent} disabled={busy === "agent"}>{busy === "agent" ? "Building your profile…" : "Build my profile"}</button>
      </div>
    </section>}

    {stepIndex === 5 && <section className="onboarding-panel">
      <h1>Review before saving</h1>
      <p className="lede">Everything below came from your own materials. Edit anything that is wrong — nothing is final until you confirm.</p>

      <div className="review-score"><strong>{completeness.percent}%</strong><span>profile complete</span></div>
      {gaps.length > 0 && <div className="gap-card"><strong>Still missing</strong><ul>{gaps.map((gap) => <li key={gap}>{gap}</li>)}</ul></div>}

      <h2>Basics</h2>
      <div className="answer-grid">{([["firstName", "First name"], ["lastName", "Last name"], ["email", "Email"], ["phone", "Phone"], ["location", "Location"], ["currentTitle", "Current title"], ["linkedin", "LinkedIn"], ["github", "GitHub"], ["portfolio", "Portfolio"], ["totalExperience", "Total experience"], ["noticePeriod", "Notice period"], ["expectedSalary", "Expected CTC"]] as Array<[keyof UserProfile, string]>).map(([field, label]) => <div className="answer-field" key={field}>
        <label>{label}{sources[field] && <span className={`source-chip ${sources[field] === "resume" ? "resume" : ""}`}>{sources[field]}</span>}</label>
        <input value={String(profile[field] ?? "")} onChange={(event) => updateField(field, event.target.value)} />
      </div>)}</div>

      <h2>Summary</h2>
      <textarea className="review-summary" value={profile.summary ?? ""} onChange={(event) => updateField("summary", event.target.value)} rows={4} />

      <h2>Skills <span className="count">{profile.skills?.length ?? 0}</span></h2>
      <div className="chip-list">{(profile.skills ?? []).map((skill, index) => <span key={index}>{skill.name}{skill.years ? ` · ${skill.years}y` : ""}</span>)}</div>

      <h2>Experience <span className="count">{profile.experiences?.length ?? 0}</span></h2>
      {(profile.experiences ?? []).map((item, index) => <div className="review-item" key={index}><strong>{item.title || "Role"}</strong><span>{[item.company, item.period, item.location].filter(Boolean).join(" · ")}</span>{item.achievements?.length ? <ul>{item.achievements.map((achievement, position) => <li key={position}>{achievement}</li>)}</ul> : <p>{item.summary}</p>}{item.skills?.length ? <div className="chip-list small">{item.skills.map((skill) => <span key={skill}>{skill}</span>)}</div> : null}</div>)}

      <h2>Projects from your resume <span className="count">{primaryProjects.length}</span></h2>
      <p className="lede">These are your primary projects. Anything imported from GitHub or a link is kept separately below.</p>
      {primaryProjects.map((item, index) => <div className="review-item" key={`primary-${index}`}><strong>{item.name}</strong><span>{[item.role, item.period].filter(Boolean).join(" · ")}</span><p>{item.description}</p>{item.technologies?.length ? <div className="chip-list small">{item.technologies.map((tech) => <span key={tech}>{tech}</span>)}</div> : null}{item.impact && <p className="impact">{item.impact}</p>}</div>)}
      {!primaryProjects.length && <p className="empty-state">No projects were found in your resume yet.</p>}

      {secondaryProjects.length > 0 && <>
        <h2>Supporting projects <span className="count">{secondaryProjects.length}</span></h2>
        <p className="lede">Imported from GitHub and your links. Used as extra evidence, never in place of your resume.</p>
        {secondaryProjects.map((item, index) => <div className="review-item secondary" key={`secondary-${index}`}><strong>{item.name}<em className="source-chip">{item.source}</em></strong><span>{item.technologies?.join(" · ")}</span><p>{item.description}</p></div>)}
      </>}

      <h2>Education <span className="count">{profile.education?.length ?? 0}</span></h2>
      {(profile.education ?? []).map((item, index) => <div className="review-item" key={index}><strong>{item.institution}</strong><span>{[item.degree, item.field, item.period].filter(Boolean).join(" · ")}</span></div>)}

      <h2>Profile document</h2>
      <p className="lede">This formatted version is saved with your profile and reused when an application asks for a written background.</p>
      <div className="markdown-preview"><Markdown content={markdown || buildProfileMarkdown(profile)} /></div>

      <h2>Reusable answers <span className="count">{generated.length}</span></h2>
      <p className="lede">Pre-written so the extension can answer instantly without calling the AI.</p>
      <div className="generated-list">{generated.map((item, index) => <details className="generated-item" key={item.id}><summary><span className="answer-category">{item.category}</span>{item.question}</summary><textarea value={item.answer} onChange={(event) => { const next = [...generated]; next[index] = { ...item, answer: event.target.value, edited: true }; setGenerated(next); }} rows={4} /></details>)}</div>

      {notice && <p className="onboarding-notice">{notice}</p>}
      <div className="onboarding-actions"><button className="ghost-button" onClick={() => setStepIndex(4)}>Back</button><button className="primary-button" onClick={finish} disabled={busy === "save"}>{busy === "save" ? "Saving…" : "Save profile and finish"}</button></div>
    </section>}
  </main>;
}
