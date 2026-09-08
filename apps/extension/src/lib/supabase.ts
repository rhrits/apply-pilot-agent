import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import type { UserProfile } from "@applypilot/shared";
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

export async function fetchAuthenticatedProfile(): Promise<UserProfile | null> {
  const supabase = getExtensionSupabase();
  if (!supabase) return null;
  const user = await getExtensionUser();
  if (!user) return null;

  const [profileResult, experiencesResult, skillsResult, educationResult, projectsResult] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
    supabase.from("experiences").select("*").eq("user_id", user.id).order("start_date", { ascending: false }),
    supabase.from("skills").select("*").eq("user_id", user.id).order("name"),
    supabase.from("education").select("*").eq("user_id", user.id).order("end_year", { ascending: false }),
    supabase.from("projects").select("*").eq("user_id", user.id).order("created_at", { ascending: false }),
  ]);

  const row = profileResult.data as Record<string, unknown> | null;
  if (!row) return null;
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
    skills: (skillsResult.data ?? []).map((item) => ({ name: asString(item.name), years: item.years !== null && item.years !== undefined && !Number.isNaN(Number(item.years)) ? Number(item.years) : undefined, proficiency: asString(item.proficiency) || undefined })),
    experiences: (experiencesResult.data ?? []).map((item) => ({ company: asString(item.company), title: asString(item.job_title), period: [asString(item.start_date), asString(item.end_date) || "Present"].filter(Boolean).join(" – "), summary: asString(item.description), achievements: Array.isArray(item.achievements) ? item.achievements.map(String) : [] })),
    education: (educationResult.data ?? []).map((item) => ({ institution: asString(item.institution), degree: asString(item.degree), field: asString(item.field), period: [item.start_year, item.end_year].filter(Boolean).join(" – ") })),
    projects: (projectsResult.data ?? []).map((item) => ({ name: asString(item.name), description: asString(item.description), technologies: Array.isArray(item.technologies) ? item.technologies.map(String) : [], impact: asString(item.impact) })),
  };
  await chrome.storage.local.set({ profile, profileSyncedAt: new Date().toISOString() });
  return profile;
}

export async function clearExtensionSession() {
  const supabase = getExtensionSupabase();
  await supabase?.auth.signOut();
  await chrome.storage.local.remove(["profile", "profileSyncedAt"]);
}

/** Downloads the user's most recent resume and returns it as a data URL for file-input attachment. */
export async function fetchResumeFile(): Promise<{ fileName: string; mimeType: string; dataUrl: string } | { error: string }> {
  const supabase = getExtensionSupabase();
  if (!supabase) return { error: "Extension Supabase configuration is missing." };
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
