/**
 * Field-level review of resume-extracted data.
 *
 * Resume parsing is heuristic, so some fields are always wrong. The profile page told
 * the user to "review the highlighted values" but nothing was ever highlighted, which
 * meant a mis-parsed phone number or a skill that is actually a whole sentence would be
 * submitted to real employers unnoticed.
 *
 * Rather than invent a confidence number the extractor never produced, this module
 * derives confidence from properties of the extracted value itself. Each check
 * corresponds to a failure mode observed in real resumes:
 *
 *  - contact fields that do not match their own format,
 *  - "skills" that are really prose the section splitter swallowed,
 *  - roles missing a company or a period,
 *  - summaries that are one truncated fragment.
 *
 * Only fields sourced from the resume are reviewed; anything the candidate typed is
 * theirs and is never second-guessed.
 */

import type { UserProfile } from "./types";
import type { ProfileSources } from "./profile-merge";

export type ReviewSeverity = "needs_review" | "check" | "ok";

export interface ReviewItem {
  /** Stable identity, used as the React key and to record dismissal. */
  id: string;
  /** Human-readable location, e.g. "Skills" or "Experience 2". */
  area: string;
  label: string;
  value: string;
  confidence: number;
  severity: ReviewSeverity;
  /** Why this was flagged, in the user's language. */
  reason: string;
  /** Which profile tab to send the user to in order to fix it. */
  tab: "overview" | "details" | "sources";
}

/** Below this, a field is surfaced for review. */
export const REVIEW_THRESHOLD = 0.7;

const EMAIL = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
const PHONE = /^[+()\d][\d\s().-]{6,}$/;
const URL_LIKE = /^(https?:\/\/|www\.)[^\s]+\.[^\s]+$/i;
const DATE_HINT = /\d{4}|present|current|ongoing/i;

/**
 * A year range passes any reasonable phone-number regex: "2019 - 2021" is all digits,
 * spaces, and dashes, and has 8 digits. Resume extractors mistake employment dates for
 * phone numbers constantly, so date shapes are rejected explicitly.
 */
const DATE_RANGE_SHAPE = /\b(19|20)\d{2}\b\s*[-–—to]+\s*\b((19|20)\d{2}|present|current)\b/i;
const MONTH_NAME = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i;

function looksLikeDate(value: string): boolean {
  return DATE_RANGE_SHAPE.test(value) || MONTH_NAME.test(value);
}

function severityFor(confidence: number): ReviewSeverity {
  if (confidence < 0.5) return "needs_review";
  if (confidence < REVIEW_THRESHOLD) return "check";
  return "ok";
}

function item(partial: Omit<ReviewItem, "severity">): ReviewItem {
  return { ...partial, severity: severityFor(partial.confidence) };
}

/** Contact fields are checkable against their own format, so confidence is decisive. */
function reviewContact(profile: UserProfile, sources: ProfileSources): ReviewItem[] {
  const found: ReviewItem[] = [];
  const fromResume = (field: keyof ProfileSources) => sources[field] === "resume";

  if (fromResume("email") && profile.email) {
    const valid = EMAIL.test(profile.email.trim());
    found.push(item({ id: "email", area: "Basics", label: "Email", value: profile.email, tab: "overview", confidence: valid ? 0.95 : 0.2, reason: valid ? "Valid address." : "This does not look like an email address." }));
  }
  if (fromResume("phone") && profile.phone) {
    const digits = profile.phone.replace(/\D/g, "");
    // A resume's phone regex frequently captures a date range or a postcode instead.
    const valid = PHONE.test(profile.phone.trim())
      && digits.length >= 7 && digits.length <= 15
      && !looksLikeDate(profile.phone);
    found.push(item({ id: "phone", area: "Basics", label: "Phone", value: profile.phone, tab: "overview", confidence: valid ? 0.9 : 0.25, reason: valid ? "Looks like a phone number." : "This may be a date or ID picked up instead of a phone number." }));
  }
  for (const field of ["linkedin", "github", "portfolio"] as const) {
    const value = profile[field];
    if (!fromResume(field) || !value) continue;
    const valid = URL_LIKE.test(value.trim());
    found.push(item({ id: field, area: "Basics", label: field === "linkedin" ? "LinkedIn" : field === "github" ? "GitHub" : "Portfolio", value, tab: "overview", confidence: valid ? 0.92 : 0.35, reason: valid ? "Valid link." : "This link looks incomplete." }));
  }
  if (fromResume("firstName") && profile.firstName) {
    // Section headers and job titles are the usual false positives for a name.
    const clean = /^[A-Za-z][A-Za-z'’.-]*$/.test(profile.firstName.trim());
    found.push(item({ id: "firstName", area: "Basics", label: "First name", value: profile.firstName, tab: "overview", confidence: clean ? 0.9 : 0.4, reason: clean ? "Looks like a name." : "This may be a heading rather than your name." }));
  }
  return found;
}

/** A "skill" long enough to be a sentence is almost always mis-split prose. */
function reviewSkills(profile: UserProfile): ReviewItem[] {
  return (profile.skills ?? []).flatMap((skill, index) => {
    const name = (skill.name ?? "").trim();
    if (!name) return [];
    const words = name.split(/\s+/).length;
    if (words <= 4 && name.length <= 40) return [];
    return [item({
      id: `skill:${index}`,
      area: "Skills",
      label: `Skill ${index + 1}`,
      value: name,
      tab: "overview",
      confidence: words > 8 ? 0.15 : 0.45,
      reason: "This reads like a sentence, not a skill. The parser may have merged a bullet point.",
    })];
  });
}

function reviewExperiences(profile: UserProfile): ReviewItem[] {
  return (profile.experiences ?? []).flatMap((role, index) => {
    const missing: string[] = [];
    if (!role.company?.trim()) missing.push("company");
    if (!role.title?.trim()) missing.push("job title");
    if (!role.period?.trim() || !DATE_HINT.test(role.period)) missing.push("dates");
    if (!missing.length) return [];
    // Each missing anchor makes the record less trustworthy as a parsed unit.
    const confidence = Math.max(0.1, 0.75 - missing.length * 0.22);
    return [item({
      id: `experience:${index}`,
      area: `Experience ${index + 1}`,
      label: [role.title, role.company].filter(Boolean).join(" at ") || "Untitled role",
      value: missing.map((field) => `missing ${field}`).join(", "),
      tab: "overview",
      confidence,
      reason: `This role is missing its ${missing.join(" and ")}.`,
    })];
  });
}

function reviewEducation(profile: UserProfile): ReviewItem[] {
  return (profile.education ?? []).flatMap((entry, index) => {
    if (entry.institution?.trim() && entry.degree?.trim()) return [];
    return [item({
      id: `education:${index}`,
      area: `Education ${index + 1}`,
      label: entry.institution || entry.degree || "Untitled entry",
      value: !entry.institution?.trim() ? "missing institution" : "missing degree",
      tab: "overview",
      confidence: 0.4,
      reason: "This entry is incomplete, so it may have been split incorrectly.",
    })];
  });
}

/** Compensation and authorization are submitted verbatim, so a parse error is costly. */
function reviewSensitive(profile: UserProfile, sources: ProfileSources): ReviewItem[] {
  const fields: Array<[keyof UserProfile & keyof ProfileSources, string]> = [
    ["currentSalary", "Current compensation"],
    ["expectedSalary", "Expected compensation"],
    ["workAuthorization", "Work authorization"],
    ["noticePeriod", "Notice period"],
  ];
  return fields.flatMap(([field, label]) => {
    const value = String(profile[field] ?? "").trim();
    if (!value || sources[field] !== "resume") return [];
    return [item({
      id: `sensitive:${field}`,
      area: "Application details",
      label,
      value,
      tab: "details",
      confidence: 0.6,
      reason: "Extracted from your resume. Confirm it before it is sent to an employer.",
    })];
  });
}

/**
 * Everything worth a second look, worst first.
 *
 * Only fields that fall below the threshold are returned; a review queue that lists
 * correct values too would train the user to ignore it.
 */
export function buildReviewQueue(profile: UserProfile, sources: ProfileSources = {}): ReviewItem[] {
  const all = [
    ...reviewContact(profile, sources),
    ...reviewSkills(profile),
    ...reviewExperiences(profile),
    ...reviewEducation(profile),
    ...reviewSensitive(profile, sources),
  ];
  return all
    .filter((entry) => entry.confidence < REVIEW_THRESHOLD)
    .sort((a, b) => a.confidence - b.confidence);
}

/** One-line summary for the profile header. */
export function describeReviewQueue(items: ReviewItem[]): string {
  if (!items.length) return "Nothing needs review.";
  const urgent = items.filter((entry) => entry.severity === "needs_review").length;
  if (urgent) return `${urgent} field${urgent === 1 ? "" : "s"} likely wrong, ${items.length} to review.`;
  return `${items.length} field${items.length === 1 ? "" : "s"} to confirm.`;
}
