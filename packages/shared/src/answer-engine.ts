import type { UserProfile } from "./types";

export type QuestionIntent =
  | "first_name" | "last_name" | "full_name" | "email" | "phone" | "location"
  | "linkedin" | "github" | "portfolio"
  | "current_company" | "current_title" | "total_experience" | "skill_experience"
  | "notice_period" | "current_salary" | "expected_salary"
  | "relocate" | "work_authorization" | "availability"
  | "education" | "skills" | "summary"
  | "why_company" | "why_role" | "cover_letter" | "open_ended"
  | "unknown";

export interface EngineAnswer {
  answer: string;
  intent: QuestionIntent;
  confidence: number;
  /** true when the answer must be reviewed by a human before submitting. */
  needsReview: boolean;
  source: "profile" | "needs_ai" | "missing";
}

/**
 * PDF text extraction frequently glues a trailing location onto a job title,
 * e.g. "Full-Stack Developer AI EngineerLondon, UK (Remote)".
 */
export function cleanTitle(value: string | undefined): string {
  if (!value) return "";
  return value
    .replace(/\s*\([^)]*\)\s*$/, "")
    .replace(/([a-z])([A-Z][a-z]+,\s*[A-Z][A-Za-z.]+)\s*$/, "$1")
    .replace(/,\s*[A-Z][A-Za-z.'-]+(?:,\s*[A-Z][A-Za-z.'-]+)?\s*$/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function detectIntent(rawQuestion: string): QuestionIntent {
  const q = rawQuestion.toLowerCase();
  const has = (...terms: string[]) => terms.some((term) => q.includes(term));

  if (has("notice period", "notice-period", "when can you join", "joining time", "how soon can you")) return "notice_period";
  if (has("current ctc", "current salary", "present salary", "current compensation", "existing ctc")) return "current_salary";
  if (has("expected ctc", "expected salary", "salary expectation", "desired salary", "compensation expectation")) return "expected_salary";
  if (has("current company", "present company", "current employer", "last company", "last employer", "currently working at", "current organization", "last experience", "recent employer")) return "current_company";
  if (has("current title", "current designation", "current role", "job title", "present designation", "your designation")) return "current_title";
  if (has("total experience", "years of experience", "overall experience", "total work experience", "how many years")) return "total_experience";
  if (has("relocat", "willing to move", "open to relocation")) return "relocate";
  if (has("work authorization", "authorized to work", "require sponsorship", "need sponsorship", "visa status", "right to work", "work permit")) return "work_authorization";
  if (has("available", "start date", "earliest start")) return "availability";
  if (has("first name", "given name")) return "first_name";
  if (has("last name", "surname", "family name")) return "last_name";
  if (has("full name", "your name", "candidate name")) return "full_name";
  if (has("e-mail", "email")) return "email";
  if (has("phone", "mobile", "contact number", "telephone")) return "phone";
  if (has("linkedin")) return "linkedin";
  if (has("github")) return "github";
  if (has("portfolio", "personal website", "your website")) return "portfolio";
  if (has("current location", "city", "where are you based", "your location", "address")) return "location";
  if (has("education", "degree", "university", "college", "qualification")) return "education";
  if (has("skills", "technologies", "tech stack", "tools you")) return "skills";
  if (has("about yourself", "tell us about you", "introduce yourself", "summary", "profile summary")) return "summary";
  if (has("why do you want to work", "why this company", "why are you interested in", "why join", "why us")) return "why_company";
  if (has("why this role", "why are you a good fit", "why should we hire")) return "why_role";
  if (has("cover letter")) return "cover_letter";
  if (q.trim().length > 60) return "open_ended";
  return "unknown";
}

function latestExperience(profile: UserProfile) {
  return profile.experiences?.find((item) => item.company || item.title) ?? null;
}

function totalYears(profile: UserProfile): string {
  if (profile.totalExperience) return profile.totalExperience;
  const years = (profile.experiences ?? [])
    .map((item) => item.period ?? "")
    .flatMap((period) => {
      const found = period.match(/\b(19|20)\d{2}\b/g);
      if (!found || found.length === 0) return [];
      const start = Number(found[0]);
      const end = /present|current/i.test(period) ? new Date().getFullYear() : Number(found[found.length - 1]);
      return Number.isFinite(start) && Number.isFinite(end) && end >= start ? [end - start] : [];
    })
    .reduce((sum, span) => sum + span, 0);
  return years > 0 ? String(years) : "";
}

/**
 * Answers "how many years/how comfortable are you with X" by matching against the
 * user's own saved skills instead of a fixed list of languages, so it works for
 * any skill the user has actually recorded (frameworks, tools, soft skills, etc.).
 */
function matchSkillQuestion(question: string, profile: UserProfile): EngineAnswer | null {
  const q = question.toLowerCase();
  const experienceLike = /(experience|years?|familiar|proficient|comfortable|skilled|rate yourself|expertise|proficiency|knowledge of|worked with)/.test(q);
  if (!experienceLike) return null;
  const skill = (profile.skills ?? []).find((item) => item.name && q.includes(item.name.toLowerCase()));
  if (!skill) return null;
  const answer = skill.years !== undefined ? String(skill.years) : skill.proficiency ?? "";
  return answer ? { answer, intent: "skill_experience", confidence: 0.85, needsReview: false, source: "profile" } : null;
}

/** Token-overlap similarity used for fuzzy matching against saved custom fields and memory. */
export function textSimilarity(left: string, right: string): number {
  const tokenize = (value: string) => new Set(value.toLowerCase().replace(/[^a-z0-9+#.]+/g, " ").split(/\s+/).filter((word) => word.length > 2));
  const a = tokenize(left);
  const b = tokenize(right);
  if (!a.size || !b.size) return 0;
  let overlap = 0;
  for (const word of a) if (b.has(word)) overlap += 1;
  return overlap / Math.max(a.size, b.size);
}

/**
 * Matches a question against user-defined custom fields (label/value pairs the fixed
 * schema does not cover), so the answer engine keeps learning beyond the built-in intents.
 */
function matchCustomField(question: string, profile: UserProfile): EngineAnswer | null {
  const fields = profile.customFields ?? [];
  if (!fields.length) return null;
  const scored = fields
    .filter((field) => field.value?.trim())
    .map((field) => ({ field, score: textSimilarity(question, field.label) }))
    .sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best || best.score < 0.34) return null;
  return { answer: best.field.value, intent: "unknown", confidence: 0.6 + best.score * 0.3, needsReview: true, source: "profile" };
}

function missing(intent: QuestionIntent): EngineAnswer {
  return { answer: "", intent, confidence: 0, needsReview: true, source: "missing" as const };
}

function value(intent: QuestionIntent, answer: string, confidence: number, needsReview = false): EngineAnswer {
  return answer ? { answer, intent, confidence, needsReview, source: "profile" } : missing(intent);
}

/**
 * Answers a form question directly from verified profile data.
 * Order of precedence: (1) the user's own skills (data-driven, not a fixed list),
 * (2) fixed intents mapped to structured profile fields, (3) user-defined custom
 * fields matched by keyword similarity, (4) escalate to the language model.
 * Returns source "needs_ai" for genuinely open-ended questions so the caller
 * can escalate to the language model instead of emitting a canned response.
 */
export function answerQuestion(question: string, profile: UserProfile): EngineAnswer {
  const skillAnswer = matchSkillQuestion(question, profile);
  if (skillAnswer) return skillAnswer;

  const intent = detectIntent(question);
  const latest = latestExperience(profile);
  const fullName = [profile.firstName, profile.lastName].filter(Boolean).join(" ");

  const structured = (() => {
    switch (intent) {
      case "first_name": return value(intent, profile.firstName, 0.99);
      case "last_name": return value(intent, profile.lastName, 0.99);
      case "full_name": return value(intent, fullName, 0.99);
      case "email": return value(intent, profile.email, 0.99);
      case "phone": return value(intent, profile.phone, 0.98);
      case "location": return value(intent, profile.location, 0.9);
      case "linkedin": return value(intent, profile.linkedin, 0.97);
      case "github": return value(intent, profile.github, 0.97);
      case "portfolio": return value(intent, profile.portfolio, 0.92);
      case "current_company": return value(intent, latest?.company ?? "", 0.9);
      case "current_title": return value(intent, cleanTitle(latest?.title || profile.currentTitle), 0.9);
      case "total_experience": return value(intent, totalYears(profile), 0.8);
      case "notice_period": return value(intent, profile.noticePeriod ?? "", 0.85, true);
      case "current_salary": return value(intent, profile.currentSalary ?? "", 0.8, true);
      case "expected_salary": return value(intent, profile.expectedSalary ?? "", 0.8, true);
      case "relocate": return value(intent, profile.willingToRelocate ?? "", 0.8, true);
      case "work_authorization": return value(intent, profile.workAuthorization ?? "", 0.75, true);
      case "availability": return value(intent, profile.availability ?? profile.noticePeriod ?? "", 0.75, true);
      case "summary": return value(intent, profile.summary ?? "", 0.75);
      case "skills": return value(intent, (profile.skills ?? []).map((skill) => skill.name).filter(Boolean).join(", "), 0.85);
      case "education": {
        const first = profile.education?.[0];
        if (!first) return missing(intent);
        return value(intent, [first.degree, first.institution, first.period].filter(Boolean).join(", "), 0.85);
      }
      case "why_company":
      case "why_role":
      case "cover_letter":
      case "open_ended":
        return { answer: "", intent, confidence: 0, needsReview: true, source: "needs_ai" as const };
      default:
        return { answer: "", intent, confidence: 0, needsReview: true, source: "needs_ai" as const };
    }
  })();

  if (structured.source === "profile") return structured;

  const customMatch = matchCustomField(question, profile);
  if (customMatch) return { ...customMatch, intent: structured.intent };

  return structured;
}

/** Neutralizes instruction-like text pulled from an untrusted web page. */
export function sanitizePageContext(input: unknown, maxLength = 600): string {
  const text = typeof input === "string" ? input : JSON.stringify(input ?? {});
  return text
    .replace(/```/g, "'")
    .replace(/\b(ignore|disregard|forget)\b[^.\n]{0,60}\b(previous|prior|above|earlier)\b[^.\n]{0,60}(instructions?|prompts?|rules?)/gi, "[removed]")
    .replace(/\b(system|developer|assistant)\s*(prompt|message|role)\b/gi, "[removed]")
    .replace(/\byou are now\b/gi, "[removed]")
    .slice(0, maxLength);
}
