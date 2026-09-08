/**
 * Resume-first profile merging.
 *
 * The candidate's resume is the authoritative source. Enrichment sources (GitHub,
 * portfolio pages, pasted profiles, dictated narrative) may only fill fields the
 * resume left empty — they can never overwrite a resume-stated fact. This keeps the
 * profile grounded in the document the candidate actually curated for employers.
 */

import type { ProfileProject, UserProfile } from "./types";
import type { SignalSource } from "./onboarding";

/** Lower number wins. A source may only overwrite a value from a higher number. */
export const SOURCE_PRIORITY: Record<SignalSource | "manual", number> = {
  manual: 0,
  resume: 1,
  typed: 2,
  answers: 3,
  linkedin_export: 4,
  project: 5,
  website: 6,
  github: 7,
  voice: 8,
};

export type ProfileSources = Partial<Record<keyof UserProfile, SignalSource | "manual">>;

export function emptyProfile(): UserProfile {
  return {
    firstName: "", lastName: "", email: "", phone: "", location: "",
    linkedin: "", github: "", portfolio: "", currentTitle: "", summary: "",
    noticePeriod: "", currentSalary: "", expectedSalary: "", totalExperience: "",
    willingToRelocate: "", workAuthorization: "", availability: "",
    customFields: [], skills: [], experiences: [], education: [], projects: [],
  };
}

const SCALAR_FIELDS: Array<keyof UserProfile> = [
  "firstName", "lastName", "email", "phone", "location", "linkedin", "github", "portfolio",
  "currentTitle", "summary", "noticePeriod", "currentSalary", "expectedSalary",
  "totalExperience", "willingToRelocate", "workAuthorization", "availability",
];

function value(input: unknown): string {
  return typeof input === "string" ? input.trim() : "";
}

function canOverwrite(existingSource: SignalSource | "manual" | undefined, incoming: SignalSource | "manual"): boolean {
  if (!existingSource) return true;
  return SOURCE_PRIORITY[incoming] < SOURCE_PRIORITY[existingSource];
}

function hasContent(value: unknown): boolean {
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return value !== undefined && value !== null;
}

function mergeRecord<T extends object>(base: T, incoming: T, incomingWins: boolean): T {
  const result = { ...base } as T;
  for (const [key, candidate] of Object.entries(incoming)) {
    if (!hasContent(candidate)) continue;
    const current = (result as Record<string, unknown>)[key];
    if (incomingWins || !hasContent(current)) (result as Record<string, unknown>)[key] = candidate;
  }
  return result;
}

/**
 * Unions structured lists without allowing a lower-priority duplicate to hide a
 * richer record. This matters when an AI response contains the same role as the
 * resume but omits its bullets, dates, or technologies.
 */
function mergeCollection<T extends object>(
  base: T[],
  incoming: T[],
  key: (item: T) => string,
  incomingWins: boolean,
): T[] {
  const result = base.map((item) => ({ ...item }));
  const positions = new Map<string, number>();
  result.forEach((item, index) => positions.set(key(item).toLowerCase().trim(), index));

  for (const item of incoming) {
    const identity = key(item).toLowerCase().trim();
    if (!identity) continue;
    const existingIndex = positions.get(identity);
    if (existingIndex === undefined) {
      positions.set(identity, result.length);
      result.push({ ...item });
    } else {
      result[existingIndex] = mergeRecord(result[existingIndex], item, incomingWins);
    }
  }
  return result;
}

/**
 * Merges `incoming` into `base` under the given source, respecting precedence.
 * Returns the merged profile plus the updated provenance map.
 */
export function mergeProfile(
  base: UserProfile,
  incoming: Partial<UserProfile>,
  source: SignalSource | "manual",
  sources: ProfileSources = {},
): { profile: UserProfile; sources: ProfileSources } {
  const profile: UserProfile = { ...emptyProfile(), ...base };
  const nextSources: ProfileSources = { ...sources };

  for (const field of SCALAR_FIELDS) {
    const candidate = value(incoming[field]);
    if (!candidate) continue;
    const existing = value(profile[field]);
    // An empty field is always fillable; a populated one needs a higher-priority source.
    if (existing && !canOverwrite(nextSources[field], source)) continue;
    (profile[field] as string) = candidate;
    nextSources[field] = source;
  }

  const incomingWins = (field: keyof UserProfile) => !nextSources[field] || canOverwrite(nextSources[field], source);
  profile.skills = mergeCollection(profile.skills ?? [], incoming.skills ?? [], (skill) => skill.name, incomingWins("skills"));
  profile.experiences = mergeCollection(
    profile.experiences ?? [], incoming.experiences ?? [],
    (item) => `${item.company}|${item.title}`,
    incomingWins("experiences"),
  );
  profile.education = mergeCollection(
    profile.education ?? [], incoming.education ?? [],
    (item) => `${item.institution}|${item.degree ?? ""}`,
    incomingWins("education"),
  );
  profile.projects = mergeCollection(profile.projects ?? [], incoming.projects ?? [], (item) => item.name, incomingWins("projects"));
  profile.customFields = mergeCollection(profile.customFields ?? [], incoming.customFields ?? [], (item) => item.label, incomingWins("customFields"));

  for (const field of ["skills", "experiences", "education", "projects", "customFields"] as const) {
    if ((incoming[field]?.length ?? 0) > 0 && (!nextSources[field] || canOverwrite(nextSources[field], source))) {
      nextSources[field] = source;
    }
  }

  return { profile, sources: nextSources };
}

/** Applies enrichment sources in strict priority order so the resume always wins. */
export function mergeAllSources(
  contributions: Array<{ source: SignalSource | "manual"; profile: Partial<UserProfile> }>,
): { profile: UserProfile; sources: ProfileSources } {
  const ordered = [...contributions].sort((a, b) => SOURCE_PRIORITY[a.source] - SOURCE_PRIORITY[b.source]);
  let profile = emptyProfile();
  let sources: ProfileSources = {};
  for (const contribution of ordered) {
    const merged = mergeProfile(profile, contribution.profile, contribution.source, sources);
    profile = merged.profile;
    sources = merged.sources;
  }
  return { profile, sources };
}

const COMPLETENESS_CHECKS: Array<{ label: string; has: (profile: UserProfile) => boolean }> = [
  { label: "Name", has: (profile) => Boolean(value(profile.firstName)) },
  { label: "Email", has: (profile) => Boolean(value(profile.email)) },
  { label: "Phone", has: (profile) => Boolean(value(profile.phone)) },
  { label: "Location", has: (profile) => Boolean(value(profile.location)) },
  { label: "Current title", has: (profile) => Boolean(value(profile.currentTitle)) },
  { label: "Summary", has: (profile) => Boolean(value(profile.summary)) },
  { label: "Skills", has: (profile) => (profile.skills?.length ?? 0) > 0 },
  { label: "Experience", has: (profile) => (profile.experiences?.length ?? 0) > 0 },
  { label: "Education", has: (profile) => (profile.education?.length ?? 0) > 0 },
  { label: "Projects", has: (profile) => (profile.projects?.length ?? 0) > 0 },
  { label: "Notice period", has: (profile) => Boolean(value(profile.noticePeriod)) },
  { label: "Total experience", has: (profile) => Boolean(value(profile.totalExperience)) },
];

export function profileCompleteness(profile: UserProfile): { percent: number; missing: string[] } {
  const missing = COMPLETENESS_CHECKS.filter((check) => !check.has(profile)).map((check) => check.label);
  const percent = Math.round(((COMPLETENESS_CHECKS.length - missing.length) / COMPLETENESS_CHECKS.length) * 100);
  return { percent, missing };
}

/**
 * Splits projects into the primary set the candidate put on their resume and the
 * supporting set discovered from GitHub or portfolio links. The resume set is what
 * employers already saw, so it is always presented first and never mixed in.
 */
export function groupProjects(profile: UserProfile): { primary: ProfileProject[]; secondary: ProfileProject[] } {
  const all = profile.projects ?? [];
  return {
    primary: all.filter((project) => (project.source ?? "resume") === "resume" || project.source === "manual"),
    secondary: all.filter((project) => project.source === "github" || project.source === "portfolio"),
  };
}

const PROJECT_SOURCE_LABEL: Record<string, string> = {
  resume: "Resume",
  github: "GitHub",
  portfolio: "Portfolio",
  manual: "Added by you",
};

/** Renders the verified profile as Markdown with generated section headings. */
export function buildProfileMarkdown(profile: UserProfile): string {
  const lines: string[] = [];
  const fullName = [profile.firstName, profile.lastName].map(value).filter(Boolean).join(" ");
  if (fullName) lines.push(`# ${fullName}`);
  if (value(profile.currentTitle)) lines.push(`**${value(profile.currentTitle)}**`);

  const contact = [value(profile.location), value(profile.email), value(profile.phone)].filter(Boolean).join(" · ");
  if (contact) lines.push(contact);

  const links = [
    value(profile.linkedin) && `[LinkedIn](${value(profile.linkedin)})`,
    value(profile.github) && `[GitHub](${value(profile.github)})`,
    value(profile.portfolio) && `[Portfolio](${value(profile.portfolio)})`,
  ].filter(Boolean).join(" · ");
  if (links) lines.push(links);

  if (value(profile.summary)) lines.push("", "## Summary", value(profile.summary));

  if (profile.skills?.length) {
    lines.push("", "## Skills");
    lines.push(profile.skills.map((skill) => (skill.years ? `${skill.name} (${skill.years}y)` : skill.name)).join(" · "));
  }

  if (profile.experiences?.length) {
    lines.push("", "## Experience");
    for (const item of profile.experiences) {
      lines.push("", `### ${item.title || "Role"}${item.company ? ` — ${item.company}` : ""}`);
      const meta = [item.period, item.location].map(value).filter(Boolean).join(" · ");
      if (meta) lines.push(`*${meta}*`);
      if (item.achievements?.length) for (const achievement of item.achievements) lines.push(`- ${achievement}`);
      else if (item.summary) lines.push(item.summary);
      if (item.skills?.length) lines.push(`**Skills used:** ${item.skills.join(" · ")}`);
    }
  }

  const { primary, secondary } = groupProjects(profile);
  const renderProject = (item: ProfileProject) => {
    lines.push("", `### ${item.name}`);
    const meta = [item.role, item.period, item.technologies?.join(" · ")].map(value).filter(Boolean).join(" · ");
    if (meta) lines.push(`*${meta}*`);
    if (item.description) lines.push(item.description);
    if (item.impact) lines.push(`**Impact:** ${item.impact}`);
    if (item.url) lines.push(`[${item.url}](${item.url})`);
  };

  if (primary.length) {
    lines.push("", "## Projects");
    for (const item of primary) renderProject(item);
  }

  if (secondary.length) {
    lines.push("", "## Additional projects and open source");
    for (const item of secondary) {
      renderProject(item);
      lines.push(`*Source: ${PROJECT_SOURCE_LABEL[item.source ?? "manual"]}*`);
    }
  }

  if (profile.education?.length) {
    lines.push("", "## Education");
    for (const item of profile.education) {
      const heading = [item.degree, item.field].map(value).filter(Boolean).join(", ");
      lines.push(`- **${item.institution}**${heading ? ` — ${heading}` : ""}${item.period ? ` (${item.period})` : ""}`);
    }
  }

  const logistics: Array<[string, string]> = [
    ["Total experience", value(profile.totalExperience)],
    ["Notice period", value(profile.noticePeriod)],
    ["Expected compensation", value(profile.expectedSalary)],
    ["Willing to relocate", value(profile.willingToRelocate)],
    ["Work authorization", value(profile.workAuthorization)],
    ["Availability", value(profile.availability)],
  ];
  const present = logistics.filter(([, item]) => item);
  if (present.length) {
    lines.push("", "## Application details");
    for (const [label, item] of present) lines.push(`- **${label}:** ${item}`);
  }

  if (profile.customFields?.length) {
    lines.push("", "## Additional answers");
    for (const field of profile.customFields) lines.push(`- **${field.label}:** ${field.value}`);
  }

  return lines.join("\n").trim();
}
