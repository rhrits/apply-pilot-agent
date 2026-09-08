export type FieldKind =
  | "first_name"
  | "last_name"
  | "email"
  | "phone"
  | "location"
  | "linkedin"
  | "github"
  | "portfolio"
  | "experience"
  | "unknown";

export type FieldElementType = "input" | "textarea" | "select" | "contenteditable";

export interface DetectedField {
  id: string;
  elementType: FieldElementType;
  inputType?: string;
  label: string;
  question: string;
  name?: string;
  placeholder?: string;
  ariaLabel?: string;
  options: string[];
  required: boolean;
  kind: FieldKind;
  confidence: number;
}

export interface UserProfile {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  location: string;
  linkedin: string;
  github: string;
  portfolio: string;
  currentTitle?: string;
  summary?: string;
  noticePeriod?: string;
  currentSalary?: string;
  expectedSalary?: string;
  totalExperience?: string;
  willingToRelocate?: string;
  workAuthorization?: string;
  availability?: string;
  /** User-defined question/answer pairs for fields the fixed schema does not cover. */
  customFields?: Array<{ id: string; label: string; value: string }>;
  skills?: Array<{ name: string; years?: number; proficiency?: string }>;
  experiences?: Array<{ company: string; title: string; period?: string; summary?: string; achievements?: string[] }>;
  education?: Array<{ institution: string; degree?: string; field?: string; period?: string }>;
  projects?: Array<{ name: string; description?: string; technologies?: string[]; impact?: string }>;
}

export interface ResumeAnalysis {
  formattedText: string;
  profile: UserProfile;
  sections: Array<{ title: string; content: string; category: "summary" | "experience" | "skills" | "education" | "projects" | "certifications" | "other" }>;
  suggestions: string[];
  source: "ai" | "heuristic";
  aiNotice?: string;
}

export type ApplicationStatus = "saved" | "applying" | "applied" | "assessment" | "interview" | "offer" | "rejected" | "withdrawn";

export interface JobApplication {
  id: string;
  company: string;
  title: string;
  url?: string;
  location?: string;
  workMode?: "remote" | "hybrid" | "onsite" | "unknown";
  employmentType?: "full-time" | "part-time" | "contract" | "internship" | "unknown";
  salary?: string;
  status: ApplicationStatus;
  priority: "low" | "medium" | "high";
  nextStep?: string;
  nextStepDate?: string;
  notes?: string;
  contactName?: string;
  source?: string;
  tags?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ActiveFieldPayload {
  field: DetectedField;
  page: { url: string; title: string; hostname: string };
}

export interface ExtensionSettings {
  autoSuggest: boolean;
  liveAI: boolean;
}

export interface AnswerMemoryItem {
  id: string;
  question: string;
  answer: string;
  intent?: string;
  source: "user" | "ai" | "profile";
  updatedAt: string;
}

export type ExtensionMessage =
  | { type: "ACTIVE_FIELD"; payload: ActiveFieldPayload }
  | { type: "GET_ACTIVE_FIELD" }
  | { type: "AUTH_STATUS" }
  | { type: "AUTH_REQUEST_OTP"; email: string }
  | { type: "AUTH_VERIFY_OTP"; email: string; token: string }
  | { type: "AUTH_SIGN_OUT" }
  | { type: "GET_AUTH_TOKEN" }
  | { type: "GET_PROFILE" }
  | { type: "REFRESH_PROFILE" }
  | { type: "GET_SETTINGS" }
  | { type: "UPDATE_SETTINGS"; settings: Partial<ExtensionSettings> }
  | { type: "FIND_ANSWER_MEMORY"; question: string }
  | { type: "SAVE_ANSWER_MEMORY"; item: Omit<AnswerMemoryItem, "id" | "updatedAt"> }
  | { type: "SCAN_PAGE" }
  | { type: "FILL_ALL" }
  | { type: "GET_RESUME_FILE" }
  | { type: "ATTACH_RESUME"; fileName: string; mimeType: string; dataUrl: string }
  | { type: "GET_PAGE_SUMMARY" }
  | { type: "SAVE_JOB"; job: PageSummary }
  | { type: "SUGGEST_ANSWER"; question: string; page: ActiveFieldPayload["page"] }
  | { type: "OPEN_SIDE_PANEL" }
  | { type: "INSERT_IN_ACTIVE_FIELD"; value: string }
  | { type: "COPY_TEXT"; value: string };

export interface PageSummary {
  title: string;
  url: string;
  hostname: string;
  company: string;
  description: string;
}

export interface ScannedField {
  index: number;
  label: string;
  question: string;
  kind: FieldKind;
  value: string;
  filled: boolean;
  needsReview: boolean;
}

export interface AnswerResponse {
  answer: string;
  source: "profile" | "ai" | "demo" | "memory";
  confidence: number;
  notice?: string;
}
