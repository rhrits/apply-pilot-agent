import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import type { ApplicationVerdict, ExtensionAuthStatus, PageSummary, PreSubmitSnapshot, SubmissionSignal, UserProfile } from "@uplyfox/shared";
import { extensionConfig, isExtensionConfigured } from "./config";

const chromeStorage = {
  getItem: async (key: string) => {
    const result = await chrome.storage.local.get(key);
    return typeof result[key] === "string" ? result[key] : null;
  },
  setItem: async (key: string, value: string) => {
    await chrome.storage.local.set({ [key]: value });
  },
  removeItem: async (key: string) => {
    await chrome.storage.local.remove(key);
  },
};

let client: SupabaseClient | null = null;

export function getExtensionSupabase(): SupabaseClient | null {
  if (!isExtensionConfigured()) return null;
  if (!client) {
    client = createClient(extensionConfig.supabaseUrl, extensionConfig.supabaseAnonKey, {
      auth: {
        storage: chromeStorage,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    });
  }
  return client;
}

export async function getExtensionUser(): Promise<User | null> {
  const supabase = getExtensionSupabase();
  if (!supabase) return null;
  const { data } = await supabase.auth.getUser();
  return data.user ?? null;
}

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

const USER_SCOPED_KEYS = ["profile", "profileSyncedAt", "profileOwnerId", "answerMemory", "unknownQuestions"];

async function ensureStorageOwner(userId: string) {
  const stored = await chrome.storage.local.get("profileOwnerId");
  if (stored.profileOwnerId !== userId) await chrome.storage.local.remove(USER_SCOPED_KEYS);
  await chrome.storage.local.set({ profileOwnerId: userId });
}

export async function clearUserScopedStorage() {
  const sessionValues = await chrome.storage.session.get(null);
  const applicationKeys = Object.keys(sessionValues).filter((key) => key.startsWith("applicationSession:") || key.startsWith("applicationDraft:") || key.startsWith("approvalGrant:") || key.startsWith("submissionAttempt:") || key.startsWith("pendingSubmissionTab:") || key.startsWith("latestSubmissionTab:") || key.startsWith("phaseEGuardTab:"));
  await Promise.all([
    chrome.storage.local.remove(USER_SCOPED_KEYS),
    chrome.storage.session.remove(["activeField", "activeTabId", "activeFrameId", ...applicationKeys]),
  ]);
}

export async function fetchAuthenticatedProfile(): Promise<UserProfile | null> {
  const supabase = getExtensionSupabase();
  if (!supabase) return null;
  const user = await getExtensionUser();
  if (!user) return null;
  await ensureStorageOwner(user.id);

  const [profileResult, experiencesResult, skillsResult, educationResult, projectsResult] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
    supabase.from("experiences").select("*").eq("user_id", user.id).order("start_date", { ascending: false }),
    supabase.from("skills").select("*").eq("user_id", user.id).order("name"),
    supabase.from("education").select("*").eq("user_id", user.id).order("end_year", { ascending: false }),
    supabase.from("projects").select("*").eq("user_id", user.id).order("created_at", { ascending: false }),
  ]);

  const row = profileResult.data as Record<string, unknown> | null;
  if (!row) {
    await clearUserScopedStorage();
    await chrome.storage.local.set({ profileOwnerId: user.id });
    return null;
  }
  const profile: UserProfile = {
    firstName: asString(row.first_name),
    lastName: asString(row.last_name),
    email: asString(row.email) || user.email || "",
    phone: asString(row.phone),
    location: asString(row.location),
    linkedin: asString(row.linkedin_url),
    github: asString(row.github_url),
    portfolio: asString(row.portfolio_url),
    currentTitle: asString(row.current_title),
    summary: asString(row.summary),
    noticePeriod: asString(row.notice_period),
    currentSalary: asString(row.current_salary),
    expectedSalary: asString(row.expected_salary),
    totalExperience: asString(row.total_experience),
    willingToRelocate: asString(row.willing_to_relocate),
    workAuthorization: asString(row.work_authorization),
    availability: asString(row.availability),
    customFields: Array.isArray(row.custom_fields) ? row.custom_fields as UserProfile["customFields"] : [],
    skills: (skillsResult.data ?? []).map((item) => ({ name: asString(item.name), years: item.years !== null && item.years !== undefined && !Number.isNaN(Number(item.years)) ? Number(item.years) : undefined, proficiency: asString(item.proficiency) || undefined })),
    experiences: (experiencesResult.data ?? []).map((item) => ({ company: asString(item.company), title: asString(item.job_title), period: [asString(item.start_date), asString(item.end_date) || "Present"].filter(Boolean).join(" – "), summary: asString(item.description), achievements: Array.isArray(item.achievements) ? item.achievements.map(String) : [], skills: Array.isArray(item.technologies) ? item.technologies.map(String) : [] })),
    education: (educationResult.data ?? []).map((item) => ({ institution: asString(item.institution), degree: asString(item.degree), field: asString(item.field), period: [item.start_year, item.end_year].filter(Boolean).join(" – ") })),
    projects: (projectsResult.data ?? []).map((item) => ({ name: asString(item.name), description: asString(item.description), technologies: Array.isArray(item.technologies) ? item.technologies.map(String) : [], impact: asString(item.impact) })),
  };
  await chrome.storage.local.set({ profile, profileOwnerId: user.id, profileSyncedAt: new Date().toISOString() });
  return profile;
}

export async function getExtensionAuthStatus(): Promise<ExtensionAuthStatus> {
  const configured = isExtensionConfigured();
  const urls = { onboardingUrl: `${extensionConfig.webAppUrl}/login?next=/onboarding`, profileUrl: `${extensionConfig.webAppUrl}/profile`, accessUrl: `${extensionConfig.webAppUrl}/access` };
  if (!configured) return { configured: false, authenticated: false, accessState: "unconfigured", userId: null, email: null, profile: null, ...urls };

  const user = await getExtensionUser();
  if (!user) {
    await clearUserScopedStorage();
    return { configured: true, authenticated: false, accessState: "unauthenticated", userId: null, email: null, profile: null, ...urls };
  }

  await ensureStorageOwner(user.id);
  const supabase = getExtensionSupabase();
  const { data: profileRow, error } = await supabase!.from("profiles").select("id,onboarding_completed_at").eq("id", user.id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!profileRow?.onboarding_completed_at) {
    await chrome.storage.local.remove(["profile", "profileSyncedAt"]);
    return { configured: true, authenticated: true, accessState: "profile_required", userId: user.id, email: user.email ?? null, profile: null, ...urls };
  }

  const { data: accessStatus, error: accessError } = await supabase!.rpc("get_my_access_status");
  if (accessError) throw new Error(accessError.message);
  if (accessStatus?.hasAccess !== true) {
    await chrome.storage.local.remove(["profile", "profileSyncedAt"]);
    return { configured: true, authenticated: true, accessState: "access_required", userId: user.id, email: user.email ?? null, profile: null, ...urls };
  }

  const cached = await chrome.storage.local.get(["profile", "profileOwnerId"]);
  const profile = cached.profileOwnerId === user.id ? cached.profile as UserProfile | undefined : undefined;
  const currentProfile = profile ?? await fetchAuthenticatedProfile();
  if (!currentProfile) return { configured: true, authenticated: true, accessState: "profile_required", userId: user.id, email: user.email ?? null, profile: null, ...urls };
  return { configured: true, authenticated: true, accessState: "ready", userId: user.id, email: user.email ?? null, profile: currentProfile, ...urls };
}

export async function clearExtensionSession(clearLocalData = false) {
  const supabase = getExtensionSupabase();
  await supabase?.auth.signOut();
  if (clearLocalData) {
    await Promise.all([chrome.storage.local.clear(), chrome.storage.session.clear()]);
  } else {
    await clearUserScopedStorage();
  }
}

/** Downloads the user's most recent resume and returns it as a data URL for file-input attachment. */
export async function fetchResumeFile(): Promise<{ fileName: string; mimeType: string; dataUrl: string } | { error: string }> {
  const supabase = getExtensionSupabase();
  if (!supabase) return { error: "Extension setup is missing. Please contact support." };
  const user = await getExtensionUser();
  if (!user) return { error: "Sign in to attach your resume." };
  const { data: resumes, error } = await supabase.from("resumes").select("name,storage_path,mime_type").eq("user_id", user.id).order("created_at", { ascending: false }).limit(1);
  if (error) return { error: error.message };
  const resume = resumes?.[0];
  if (!resume?.storage_path) return { error: "Upload a resume on the profile page first." };
  const download = await supabase.storage.from("resumes").download(resume.storage_path as string);
  if (download.error || !download.data) return { error: download.error?.message ?? "Could not download the resume." };
  const buffer = await download.data.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]);
  const mimeType = (resume.mime_type as string) || "application/pdf";
  return { fileName: (resume.name as string) || "resume.pdf", mimeType, dataUrl: `data:${mimeType};base64,${btoa(binary)}` };
}

function dataUrlBlob(dataUrl: string): Blob | null {
  const match = dataUrl.match(/^data:([^;,]+);base64,(.+)$/);
  if (!match) return null;
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: match[1] });
}

/** Persists a redacted immutable review draft and optional private viewport screenshot. */
export async function saveApplicationDraft(snapshot: PreSubmitSnapshot, screenshotDataUrl?: string): Promise<{ ok: boolean; draftId?: string; screenshotPath?: string; error?: string }> {
  const supabase = getExtensionSupabase();
  if (!supabase) return { ok: false, error: "Extension setup is missing." };
  const user = await getExtensionUser();
  if (!user) return { ok: false, error: "Sign in before saving an application draft." };
  const draftId = crypto.randomUUID();
  let screenshotPath: string | undefined;

  if (screenshotDataUrl) {
    const blob = dataUrlBlob(screenshotDataUrl);
    if (blob) {
      screenshotPath = `${user.id}/${snapshot.sessionId}/${draftId}.png`;
      const upload = await supabase.storage.from("application-evidence").upload(screenshotPath, blob, { contentType: "image/png", upsert: false });
      if (upload.error) screenshotPath = undefined; // HTML/answer draft remains useful without a screenshot.
    }
  }

  const normalizedUrl = snapshot.job.url.replace(/[?#].*$/, "").replace(/\/$/, "");
  const { data: trackedJob } = await supabase.from("jobs").select("id").eq("user_id", user.id).in("url", [snapshot.job.url, normalizedUrl]).limit(1).maybeSingle();

  const { error: sessionError } = await supabase.from("application_sessions").upsert({
    id: snapshot.sessionId, user_id: user.id, job_id: trackedJob?.id ?? null, url: snapshot.job.url, ats: snapshot.job.hostname,
    mode: "review_before_submit", status: "ready_for_review", blockers: snapshot.steps.at(-1)?.blockers ?? [], updated_at: new Date().toISOString(),
  });
  if (sessionError) {
    if (screenshotPath) await supabase.storage.from("application-evidence").remove([screenshotPath]);
    return { ok: false, error: sessionError.message };
  }

  const { error } = await supabase.from("application_drafts").insert({
    id: draftId, session_id: snapshot.sessionId, user_id: user.id, step_index: snapshot.stepIndex,
    answers: snapshot.steps, form_html: JSON.stringify(snapshot.frames), screenshot_path: screenshotPath ?? null,
    snapshot_hash: snapshot.snapshotHash, redaction_version: snapshot.redactionVersion,
  });
  if (error) {
    if (screenshotPath) await supabase.storage.from("application-evidence").remove([screenshotPath]);
    return { ok: false, error: error.message };
  }
  return { ok: true, draftId, screenshotPath };
}

export async function approveApplicationDraft(input: { draftId: string; sessionId: string; snapshotHash: string; expiresAt: string; tokenVerifier: string }): Promise<{ ok: boolean; error?: string }> {
  const supabase = getExtensionSupabase();
  if (!supabase) return { ok: false, error: "Extension setup is missing." };
  const user = await getExtensionUser();
  if (!user) return { ok: false, error: "Sign in before approving a draft." };
  const { data, error } = await supabase.rpc("issue_application_approval", { p_draft_id: input.draftId, p_session_id: input.sessionId, p_snapshot_hash: input.snapshotHash, p_token_verifier: input.tokenVerifier, p_expires_at: input.expiresAt });
  return error || data !== true ? { ok: false, error: error?.message ?? "The draft changed or was already approved. Capture it again." } : { ok: true };
}

export async function consumeApplicationApproval(input: { attemptId: string; draftId: string; sessionId: string; snapshotHash: string; tokenVerifier: string; startedAt: string; deadlineAt: string }): Promise<{ ok: boolean; error?: string }> {
  const supabase = getExtensionSupabase();
  if (!supabase) return { ok: false, error: "Extension setup is missing." };
  const { data, error } = await supabase.rpc("consume_application_approval", {
    p_attempt_id: input.attemptId, p_draft_id: input.draftId, p_session_id: input.sessionId,
    p_snapshot_hash: input.snapshotHash, p_token_verifier: input.tokenVerifier,
    p_started_at: input.startedAt, p_deadline_at: input.deadlineAt,
  });
  return error || data !== true ? { ok: false, error: error?.message ?? "Approval was expired, changed, or already consumed." } : { ok: true };
}

export async function finalizeSubmissionAttempt(input: { attemptId: string; outcome: "confirmed" | "unknown" | "failed"; evidence: SubmissionSignal[]; reason: string; applicationId?: string }): Promise<{ ok: boolean; error?: string }> {
  const supabase = getExtensionSupabase();
  if (!supabase) return { ok: false, error: "Extension setup is missing." };
  const { data, error } = await supabase.rpc("finalize_submission_attempt", {
    p_attempt_id: input.attemptId, p_outcome: input.outcome, p_evidence: input.evidence,
    p_reason: input.reason, p_external_application_id: input.applicationId ?? null,
  });
  return error || data !== true ? { ok: false, error: error?.message ?? "Submission outcome was already finalized." } : { ok: true };
}

/** Saves the current page as a tracked job opportunity (jobs + applications rows) for the signed-in user. */
export async function saveJobToSupabase(job: PageSummary): Promise<{ ok: boolean; error?: string; duplicate?: boolean }> {
  if (job.isJobPage !== true) return { ok: false, error: "This page was not detected as a job posting." };
  const supabase = getExtensionSupabase();
  if (!supabase) return { ok: false, error: "Extension setup is missing. Please contact support." };
  const user = await getExtensionUser();
  if (!user) return { ok: false, error: "Sign in to save this job." };

    const normalizedUrl = job.url.replace(/[?#].*$/, "").replace(/\/$/, "");
    const { data: existing } = await supabase.from("jobs").select("id").eq("user_id", user.id).in("url", [job.url, normalizedUrl]).limit(1).maybeSingle();
  if (existing) return { ok: true, duplicate: true };

    const { data: savedJob, error: jobError } = await supabase.from("jobs").insert({ user_id: user.id, company: job.company, title: job.title, url: normalizedUrl || job.url, location: job.location, work_mode: job.workMode, employment_type: job.employmentType, salary: job.salary, source: job.hostname, job_description: job.description, match_score: job.matchAnalysis?.score ?? null, match_details: job.matchAnalysis ?? null, tags: ["auto-detected", ...(job.skills ?? []).slice(0, 8)] }).select("id").single();
  if (jobError || !savedJob) return { ok: false, error: jobError?.message ?? "Could not save the job." };
  const { error: applicationError } = await supabase.from("applications").insert({ user_id: user.id, job_id: savedJob.id, status: "saved" });
  if (applicationError) return { ok: false, error: applicationError.message };
  return { ok: true };
}

/**
 * Moves a tracked opportunity to "applied" after the detector observed a real
 * submission, saving the job first if it was never tracked.
 *
 * Only forward transitions from "saved"/"applying" are made: if the candidate has
 * already recorded an interview or an offer, an automatic signal must never regress it.
 */
export async function markApplicationApplied(job: PageSummary, verdict?: ApplicationVerdict): Promise<{ ok: boolean; error?: string; changed?: boolean }> {
  const supabase = getExtensionSupabase();
  if (!supabase) return { ok: false, error: "Extension setup is missing." };
  const user = await getExtensionUser();
  if (!user) return { ok: false, error: "Sign in to track applications." };

  const normalizedUrl = job.url.replace(/[?#].*$/, "").replace(/\/$/, "");
  let { data: existing } = await supabase.from("jobs").select("id").eq("user_id", user.id).in("url", [job.url, normalizedUrl]).limit(1).maybeSingle();

  if (!existing) {
    const saved = await saveJobToSupabase(job);
    if (!saved.ok) return { ok: false, error: saved.error };
    const { data: created } = await supabase.from("jobs").select("id").eq("user_id", user.id).in("url", [job.url, normalizedUrl]).limit(1).maybeSingle();
    existing = created ?? null;
  }
  if (!existing) return { ok: false, error: "Could not locate the tracked job." };

  const { data: application } = await supabase
    .from("applications").select("id,status").eq("user_id", user.id).eq("job_id", existing.id).limit(1).maybeSingle();

  // Stored so the automatic decision stays auditable after the fact.
  const evidence = {
    detection_signals: verdict ? verdict.signals : null,
    detection_confidence: verdict ? verdict.confidence : null,
  };

  if (!application) {
    const { error } = await supabase.from("applications").insert({ user_id: user.id, job_id: existing.id, status: "applied", ...evidence });
    return error ? { ok: false, error: error.message } : { ok: true, changed: true };
  }

  if (!["saved", "applying"].includes(String(application.status))) return { ok: true, changed: false };

  const { error } = await supabase.from("applications").update({ status: "applied", ...evidence }).eq("id", application.id);
  return error ? { ok: false, error: error.message } : { ok: true, changed: true };
}

/** Reverts an automatic "applied" transition when the user presses Undo. */
export async function undoApplicationApplied(url: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = getExtensionSupabase();
  if (!supabase) return { ok: false, error: "Extension setup is missing." };
  const user = await getExtensionUser();
  if (!user) return { ok: false, error: "Sign in first." };

  const normalizedUrl = url.replace(/[?#].*$/, "").replace(/\/$/, "");
  const { data: job } = await supabase.from("jobs").select("id").eq("user_id", user.id).in("url", [url, normalizedUrl]).limit(1).maybeSingle();
  if (!job) return { ok: true };

  const { error } = await supabase
    .from("applications").update({ status: "saved" }).eq("user_id", user.id).eq("job_id", job.id).eq("status", "applied");
  return error ? { ok: false, error: error.message } : { ok: true };
}

export interface TrackedJob {
  id: string;
  company: string;
  title: string;
  url: string;
  status: string;
  createdAt: string;
  matchScore?: number;
}

export interface TrackerSnapshot {
  jobs: TrackedJob[];
  counts: Record<string, number>;
  total: number;
  answerCount: number;
}

/** Reads the job tracker so the side panel can show status without opening the web app. */
export async function fetchTracker(): Promise<TrackerSnapshot | { error: string }> {
  const supabase = getExtensionSupabase();
  if (!supabase) return { error: "Extension setup is missing. Please contact support." };
  const user = await getExtensionUser();
  if (!user) return { error: "Sign in to view your tracker." };

  const [applicationsResult, answersResult] = await Promise.all([
    supabase.from("applications").select("id,status,created_at,jobs(id,company,title,url,match_score)").eq("user_id", user.id).order("created_at", { ascending: false }).limit(50),
    supabase.from("answer_library").select("id", { count: "exact", head: true }).eq("user_id", user.id),
  ]);

  const rows = (applicationsResult.data ?? []) as Array<Record<string, unknown>>;
  const counts: Record<string, number> = {};
  const jobs: TrackedJob[] = rows.map((row) => {
    // Supabase types the embedded relation as an array even for a to-one join.
    const relation = row.jobs as Record<string, unknown> | Array<Record<string, unknown>> | null;
    const job = Array.isArray(relation) ? relation[0] : relation;
    const status = String(row.status ?? "saved");
    counts[status] = (counts[status] ?? 0) + 1;
    return {
      id: String(row.id ?? ""),
      company: String(job?.company ?? "Unknown company"),
      title: String(job?.title ?? "Untitled role"),
      url: String(job?.url ?? ""),
      status,
      createdAt: String(row.created_at ?? ""),
      matchScore: job?.match_score == null ? undefined : Number(job.match_score),
    };
  });

  return { jobs, counts, total: jobs.length, answerCount: answersResult.count ?? 0 };
}

