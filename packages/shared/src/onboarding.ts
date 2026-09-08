/**
 * Types for the onboarding pipeline: raw signal capture -> enrichment -> synthesis -> review.
 *
 * The pipeline deliberately keeps `RawSignals` (what the user gave us) separate from
 * `UserProfile` (what the user has verified). Nothing becomes verified profile data
 * until the user reviews it on the confirmation step.
 */

/** A single source of information about the candidate. */
export type SignalSource =
  | "resume"
  | "github"
  | "website"
  | "project"
  | "linkedin_export"
  | "typed"
  | "voice"
  | "answers";

export interface RawSignal {
  id: string;
  source: SignalSource;
  /** Where this came from: a URL, a filename, or "voice"/"typed". */
  origin: string;
  /** Extracted plain text. Never HTML. */
  content: string;
  /** Structured payload when the source has a known shape (e.g. the GitHub API). */
  data?: Record<string, unknown>;
  collectedAt: string;
  error?: string;
}

/** Public GitHub data, fetched from the documented REST API (no scraping). */
export interface GitHubEnrichment {
  username: string;
  name?: string;
  bio?: string;
  company?: string;
  location?: string;
  blog?: string;
  publicRepos: number;
  followers: number;
  topLanguages: string[];
  repositories: Array<{
    name: string;
    description?: string;
    language?: string;
    topics: string[];
    stars: number;
    forks: number;
    url: string;
    homepage?: string;
    updatedAt: string;
  }>;
}

/** A crawled project/portfolio page, reduced to readable text. */
export interface LinkEnrichment {
  url: string;
  title: string;
  description: string;
  /** Readable body text, truncated for prompt safety. */
  text: string;
  technologies: string[];
}

/** Free-text and voice input captured during onboarding. */
export interface NarrativeInput {
  /** "Tell us about yourself" */
  about: string;
  /** What the candidate is looking for next. */
  expectations: string;
  /** Experience summary in the candidate's own words. */
  experience: string;
}

/** The generic questions nearly every application asks. */
export interface ApplicationAnswers {
  currentCtc: string;
  expectedCtc: string;
  noticePeriod: string;
  reasonForLeaving: string;
  totalExperience: string;
  visaStatus: string;
  workAuthorization: string;
  preferredLocation: string;
  willingToRelocate: string;
  leadership: string;
  biggestAchievement: string;
  strengths: string;
  weaknesses: string;
}

export const APPLICATION_ANSWER_FIELDS: Array<{
  key: keyof ApplicationAnswers;
  label: string;
  hint: string;
  sensitive: boolean;
  multiline: boolean;
}> = [
  { key: "totalExperience", label: "Total years of experience", hint: "e.g. 3 years", sensitive: false, multiline: false },
  { key: "noticePeriod", label: "Notice period", hint: "e.g. 30 days", sensitive: false, multiline: false },
  { key: "currentCtc", label: "Current CTC / salary", hint: "Leave blank if you prefer not to share", sensitive: true, multiline: false },
  { key: "expectedCtc", label: "Expected CTC / salary", hint: "A range is fine", sensitive: true, multiline: false },
  { key: "preferredLocation", label: "Preferred location", hint: "e.g. Bengaluru or Remote", sensitive: false, multiline: false },
  { key: "willingToRelocate", label: "Willing to relocate", hint: "Yes / No / Depends", sensitive: false, multiline: false },
  { key: "workAuthorization", label: "Work authorization", hint: "e.g. Indian citizen, no sponsorship needed", sensitive: true, multiline: false },
  { key: "visaStatus", label: "Visa status", hint: "Only if relevant to your applications", sensitive: true, multiline: false },
  { key: "reasonForLeaving", label: "Why are you looking to move?", hint: "Keep it constructive", sensitive: false, multiline: true },
  { key: "leadership", label: "Leadership / ownership example", hint: "A time you led or drove something", sensitive: false, multiline: true },
  { key: "biggestAchievement", label: "Biggest achievement", hint: "Ideally with a measurable outcome", sensitive: false, multiline: true },
  { key: "strengths", label: "Your strengths", hint: "What you are reliably good at", sensitive: false, multiline: true },
  { key: "weaknesses", label: "An area you are improving", hint: "Honest and specific", sensitive: false, multiline: true },
];

/** A pre-generated answer the extension can reuse without calling the model. */
export interface GeneratedAnswer {
  id: string;
  question: string;
  answer: string;
  category: "about" | "motivation" | "behavioral" | "technical" | "project" | "logistics" | "leadership";
  /** Which signals supported this answer, so the user can audit it. */
  basedOn: SignalSource[];
  edited: boolean;
}

export type OnboardingStep = "sources" | "narrative" | "enriching" | "answers" | "review" | "done";

export interface OnboardingState {
  step: OnboardingStep;
  signals: RawSignal[];
  narrative: NarrativeInput;
  answers: Partial<ApplicationAnswers>;
  generatedAnswers: GeneratedAnswer[];
  updatedAt: string;
}

export const EMPTY_NARRATIVE: NarrativeInput = { about: "", expectations: "", experience: "" };
