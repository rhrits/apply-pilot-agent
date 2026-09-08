import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import type { ExtensionAuthStatus, PageSummary, UserProfile } from "@applypilot/shared";
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
  await Promise.all([
    chrome.storage.local.remove(USER_SCOPED_KEYS),
    chrome.storage.session.remove(["activeField", "activeTabId"]),
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
    experiences: (experiencesResult.data ?? []).map((item) => ({ company: asString(item.company), title: asString(item.job_title), period: [asString(item.start_date), asString(item.end_date) || "Present"].filter(Boolean).join(" – "), summary: asString(item.description), achievements: Array.isArray(item.achievements) ? item.achievements.map(String) : [] })),
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

export async function clearExtensionSession() {
  const supabase = getExtensionSupabase();
  await supabase?.auth.signOut();
  await clearUserScopedStorage();
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

/** Saves the current page as a tracked job opportunity (jobs + applications rows) for the signed-in user. */
export async function saveJobToSupabase(job: PageSummary): Promise<{ ok: boolean; error?: string; duplicate?: boolean }> {
  const supabase = getExtensionSupabase();
  if (!supabase) return { ok: false, error: "Extension setup is missing. Please contact support." };
  const user = await getExtensionUser();
  if (!user) return { ok: false, error: "Sign in to save this job." };

  const { data: existing } = await supabase.from("jobs").select("id").eq("user_id", user.id).eq("url", job.url).maybeSingle();
  if (existing) return { ok: true, duplicate: true };

  const { data: savedJob, error: jobError } = await supabase.from("jobs").insert({ user_id: user.id, company: job.company, title: job.title, url: job.url, source: job.hostname, job_description: job.description }).select("id").single();
  if (jobError || !savedJob) return { ok: false, error: jobError?.message ?? "Could not save the job." };
  const { error: applicationError } = await supabase.from("applications").insert({ user_id: user.id, job_id: savedJob.id, status: "saved" });
  if (applicationError) return { ok: false, error: applicationError.message };
  return { ok: true };
}

export interface TrackedJob {
  id: string;
  company: string;
  title: string;
  url: string;
  status: string;
  createdAt: string;
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
    supabase.from("applications").select("id,status,created_at,jobs(id,company,title,url)").eq("user_id", user.id).order("created_at", { ascending: false }).limit(50),
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
    };
  });

  return { jobs, counts, total: jobs.length, answerCount: answersResult.count ?? 0 };
}

