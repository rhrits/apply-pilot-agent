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

export type GeneralQuestionCategory = "about" | "motivation" | "behavioral" | "technical" | "project" | "logistics" | "leadership";

export interface GeneralApplicationQuestion {
  id: string;
  question: string;
  category: GeneralQuestionCategory;
  /** Hint for the batch agent about the evidence it should prefer. */
  evidence: string;
}

/**
 * Baseline question coverage for a new profile. These are intentionally generic:
 * company-specific questions are still answered later by the live suggestion agent.
 * The catalog is split into batches so a large profile does not rely on one fragile
 * response or exceed a provider's output limit.
 */
export const GENERAL_APPLICATION_QUESTIONS: GeneralApplicationQuestion[] = [
  { id: "about-yourself", question: "Tell me about yourself.", category: "about", evidence: "summary, current title, experience, skills" },
  { id: "career-summary", question: "How would you summarize your professional background?", category: "about", evidence: "summary, experience, education" },
  { id: "core-skills", question: "What are your core skills?", category: "technical", evidence: "skills" },
  { id: "strongest-skill", question: "What is your strongest professional skill?", category: "technical", evidence: "skills, experience, projects" },
  { id: "career-goals", question: "What are your career goals?", category: "motivation", evidence: "narrative, current title, experience" },
  { id: "role-looking-for", question: "What kind of role are you looking for next?", category: "motivation", evidence: "narrative expectations, skills, experience" },
  { id: "why-role", question: "Why are you interested in this type of role?", category: "motivation", evidence: "narrative, skills, projects" },
  { id: "why-new-opportunity", question: "Why are you looking for a new opportunity?", category: "motivation", evidence: "candidate-provided answers, narrative" },
  { id: "motivates-you", question: "What motivates you at work?", category: "motivation", evidence: "narrative, achievements, projects" },
  { id: "ideal-environment", question: "What kind of work environment helps you do your best work?", category: "motivation", evidence: "narrative, candidate-provided answers" },
  { id: "biggest-achievement", question: "What is your biggest professional achievement?", category: "behavioral", evidence: "achievements, projects, candidate-provided answers" },
  { id: "proud-project", question: "What project are you most proud of?", category: "project", evidence: "projects, experience" },
  { id: "project-impact", question: "Tell me about a project where you made a meaningful impact.", category: "project", evidence: "project impact, achievements" },
  { id: "project-challenge", question: "What was the most difficult project challenge you solved?", category: "project", evidence: "project descriptions, achievements" },
  { id: "project-ownership", question: "Describe a project where you took ownership from start to finish.", category: "leadership", evidence: "projects, experience, achievements" },
  { id: "leadership-example", question: "Tell me about a time you demonstrated leadership or ownership.", category: "leadership", evidence: "achievements, leadership answer, projects" },
  { id: "teamwork-example", question: "Tell me about a time you worked effectively with a team.", category: "behavioral", evidence: "experience, achievements, narrative" },
  { id: "conflict-example", question: "Tell me about a time you handled a disagreement or conflict.", category: "behavioral", evidence: "candidate-provided answers, experience" },
  { id: "feedback-example", question: "Tell me about a time you received difficult feedback.", category: "behavioral", evidence: "candidate-provided answers, narrative" },
  { id: "failure-example", question: "Tell me about a failure or mistake and what you learned from it.", category: "behavioral", evidence: "candidate-provided answers, narrative" },
  { id: "deadline-example", question: "Describe a time you had to deliver under a tight deadline.", category: "behavioral", evidence: "experience, achievements, projects" },
  { id: "ambiguity-example", question: "Describe a time you worked through ambiguity.", category: "behavioral", evidence: "experience, projects, narrative" },
  { id: "prioritization", question: "How do you prioritize when you have multiple important tasks?", category: "behavioral", evidence: "candidate-provided answers, experience" },
  { id: "learning-example", question: "Tell me about a time you had to learn something quickly.", category: "behavioral", evidence: "skills, experience, projects" },
  { id: "initiative-example", question: "Tell me about a time you took initiative without being asked.", category: "leadership", evidence: "achievements, projects, candidate-provided answers" },
  { id: "mentoring-example", question: "Tell me about a time you helped or mentored someone.", category: "leadership", evidence: "experience, candidate-provided answers" },
  { id: "technical-depth", question: "Which technical skill or technology do you have the deepest experience with?", category: "technical", evidence: "skills with years/proficiency, role technologies" },
  { id: "technical-quality", question: "How do you make sure your work is reliable and high quality?", category: "technical", evidence: "experience, achievements, skills" },
  { id: "debugging", question: "How do you approach debugging a difficult problem?", category: "technical", evidence: "experience, projects, candidate-provided answers" },
  { id: "code-review", question: "What is your approach to reviewing or improving someone else's work?", category: "technical", evidence: "experience, skills, candidate-provided answers" },
  { id: "new-technology", question: "How do you evaluate and learn a new technology?", category: "technical", evidence: "skills, projects, narrative" },
  { id: "technical-tradeoff", question: "Tell me about a technical trade-off you made.", category: "technical", evidence: "projects, experience, achievements" },
  { id: "current-title", question: "What is your current job title or designation?", category: "logistics", evidence: "current title, latest experience" },
  { id: "current-company", question: "What company do you currently work for or worked for most recently?", category: "logistics", evidence: "latest experience" },
  { id: "total-experience", question: "How many years of professional experience do you have?", category: "logistics", evidence: "total experience, dated roles" },
  { id: "notice-period", question: "What is your notice period or earliest start date?", category: "logistics", evidence: "notice period, availability" },
  { id: "location", question: "Where are you currently based?", category: "logistics", evidence: "location" },
  { id: "relocation", question: "Are you willing to relocate?", category: "logistics", evidence: "willing to relocate, preferred location" },
  { id: "work-authorization", question: "What is your work authorization status?", category: "logistics", evidence: "work authorization, custom answers" },
  { id: "sponsorship", question: "Will you require visa sponsorship now or in the future?", category: "logistics", evidence: "work authorization, custom answers" },
  { id: "expected-compensation", question: "What are your expected compensation or salary requirements?", category: "logistics", evidence: "expected salary, candidate-provided answers" },
  { id: "work-arrangement", question: "What work arrangement do you prefer: remote, hybrid, or onsite?", category: "logistics", evidence: "narrative, preferred location, custom answers" },
  { id: "availability", question: "When would you be available to start?", category: "logistics", evidence: "availability, notice period" },
  { id: "education", question: "Tell me about your education or academic background.", category: "about", evidence: "education" },
  { id: "professional-development", question: "How do you continue developing your professional skills?", category: "motivation", evidence: "skills, projects, education, narrative" },
  { id: "five-year-goal", question: "Where would you like your career to be in the next few years?", category: "motivation", evidence: "narrative, career goals" },
  { id: "additional-information", question: "Is there anything else you would like us to know about you?", category: "about", evidence: "summary, projects, custom answers" },
];

export function getGeneralApplicationQuestionBatches(batchSize = 12): GeneralApplicationQuestion[][] {
  const safeSize = Math.max(1, Math.floor(batchSize));
  const batches: GeneralApplicationQuestion[][] = [];
  for (let index = 0; index < GENERAL_APPLICATION_QUESTIONS.length; index += safeSize) {
    batches.push(GENERAL_APPLICATION_QUESTIONS.slice(index, index + safeSize));
  }
  return batches;
}

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
