"use client";

/**
 * Instant persistence for onboarding.
 *
 * Everything the candidate gives us is written to Supabase as soon as it is captured,
 * so a refresh, crash, or device switch never loses work. Writes are debounced and
 * last-write-wins; a failed write is reported but never blocks the wizard.
 */

import type { RawSignal, UserProfile } from "@applypilot/shared";
import { getSupabaseBrowserClient } from "./supabase";

export interface PersistResult { ok: boolean; error?: string }

async function currentUserId(): Promise<string | null> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return null;
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

/** Writes the working profile draft plus captured narrative/answers. */
export async function saveDraft(input: {
  profile: Partial<UserProfile>;
  narrative?: unknown;
  answers?: unknown;
  resumeText?: string;
  resumeProfile?: Partial<UserProfile>;
  markdown?: string;
  sources?: Record<string, string>;
}): Promise<PersistResult> {
  const supabase = getSupabaseBrowserClient();
  const userId = await currentUserId();
  if (!supabase || !userId) return { ok: false, error: "Not signed in" };

  const payload: Record<string, unknown> = {
    id: userId,
    draft_profile: input.profile ?? {},
    draft_updated_at: new Date().toISOString(),
  };
  if (input.narrative !== undefined) payload.narrative = input.narrative;
  if (input.answers !== undefined) payload.application_answers = input.answers;
  if (input.resumeText !== undefined) payload.resume_text = input.resumeText;
  if (input.resumeProfile !== undefined) payload.resume_profile = input.resumeProfile;
  if (input.markdown !== undefined) payload.profile_markdown = input.markdown;
  if (input.sources !== undefined) payload.profile_sources = input.sources;

  const { error } = await supabase.from("profiles").upsert(payload);
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** Stores a captured source so extraction can be re-run later without a re-upload. */
export async function saveSignal(signal: RawSignal): Promise<PersistResult> {
  const supabase = getSupabaseBrowserClient();
  const userId = await currentUserId();
  if (!supabase || !userId) return { ok: false, error: "Not signed in" };

  const { error } = await supabase.from("profile_signals").upsert({
    user_id: userId,
    source: signal.source,
    origin: signal.origin,
    content: signal.content?.slice(0, 200_000) ?? "",
    data: signal.data ?? {},
  }, { onConflict: "user_id,source,origin" });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function deleteSignal(source: string, origin: string): Promise<PersistResult> {
  const supabase = getSupabaseBrowserClient();
  const userId = await currentUserId();
  if (!supabase || !userId) return { ok: false, error: "Not signed in" };
  const { error } = await supabase.from("profile_signals").delete().eq("user_id", userId).eq("source", source).eq("origin", origin);
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** Reloads a previously autosaved onboarding session. */
export async function loadDraft(): Promise<{
  profile: Partial<UserProfile> | null;
  narrative: unknown;
  answers: unknown;
  signals: RawSignal[];
} | null> {
  const supabase = getSupabaseBrowserClient();
  const userId = await currentUserId();
  if (!supabase || !userId) return null;

  const [profileResult, signalsResult] = await Promise.all([
    supabase.from("profiles").select("draft_profile,narrative,application_answers").eq("id", userId).maybeSingle(),
    supabase.from("profile_signals").select("source,origin,content,data,created_at").eq("user_id", userId).order("created_at"),
  ]);

  const row = profileResult.data as { draft_profile?: Partial<UserProfile>; narrative?: unknown; application_answers?: unknown } | null;
  return {
    profile: row?.draft_profile && Object.keys(row.draft_profile).length ? row.draft_profile : null,
    narrative: row?.narrative ?? null,
    answers: row?.application_answers ?? null,
    signals: (signalsResult.data ?? []).map((item, index) => ({
      id: `${item.source}-${index}`,
      source: item.source as RawSignal["source"],
      origin: item.origin as string,
      content: (item.content as string) ?? "",
      data: (item.data as Record<string, unknown>) ?? {},
      collectedAt: (item.created_at as string) ?? new Date().toISOString(),
    })),
  };
}

/** Writes the verified profile and all structured child records. */
export async function commitProfile(profile: UserProfile, options: { markdown: string; sources?: Record<string, string>; completeOnboarding?: boolean }): Promise<PersistResult> {
  const supabase = getSupabaseBrowserClient();
  const userId = await currentUserId();
  if (!supabase || !userId) return { ok: false, error: "Not signed in" };

  const { error } = await supabase.from("profiles").upsert({
    id: userId,
    first_name: profile.firstName, last_name: profile.lastName, email: profile.email, phone: profile.phone,
    location: profile.location, linkedin_url: profile.linkedin, github_url: profile.github, portfolio_url: profile.portfolio,
    current_title: profile.currentTitle, summary: profile.summary,
    notice_period: profile.noticePeriod || null, current_salary: profile.currentSalary || null,
    expected_salary: profile.expectedSalary || null, total_experience: profile.totalExperience || null,
    willing_to_relocate: profile.willingToRelocate || null, work_authorization: profile.workAuthorization || null,
    availability: profile.availability || null, custom_fields: profile.customFields ?? [],
    profile_markdown: options.markdown, profile_sources: options.sources ?? {},
    ...(options.completeOnboarding ? { onboarding_completed_at: new Date().toISOString() } : {}),
  });
  if (error) return { ok: false, error: error.message };

  await Promise.all([
    supabase.from("experiences").delete().eq("user_id", userId),
    supabase.from("skills").delete().eq("user_id", userId),
    supabase.from("education").delete().eq("user_id", userId),
    supabase.from("projects").delete().eq("user_id", userId),
  ]);

  // Supabase query builders are thenable rather than real Promises, so they are
  // collected as PromiseLike before being awaited together.
  const inserts: Array<PromiseLike<unknown>> = [];
  const experiences = (profile.experiences ?? []).filter((item) => item.company || item.title);
  const skills = (profile.skills ?? []).filter((item) => item.name);
  const education = (profile.education ?? []).filter((item) => item.institution || item.degree);
  const projects = (profile.projects ?? []).filter((item) => item.name);

  if (experiences.length) inserts.push(supabase.from("experiences").insert(experiences.map((item) => ({
    user_id: userId, company: item.company || "To review", job_title: item.title || "To review",
    description: item.summary || null, achievements: item.achievements ?? [], technologies: [],
  }))));
  if (skills.length) inserts.push(supabase.from("skills").insert(skills.map((item) => ({
    user_id: userId, name: item.name, years: item.years ?? null, proficiency: item.proficiency ?? null,
  }))));
  if (education.length) inserts.push(supabase.from("education").insert(education.map((item) => ({
    user_id: userId, institution: item.institution || "To review", degree: item.degree || null, field: item.field || null,
  }))));
  if (projects.length) inserts.push(supabase.from("projects").insert(projects.map((item) => ({
    user_id: userId, name: item.name, description: item.description || null,
    impact: item.impact || null, technologies: item.technologies ?? [],
  }))));

  await Promise.all(inserts);
  return { ok: true };
}
