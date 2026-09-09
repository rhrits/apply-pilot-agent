import { buildSuggestionPrompts, groupProjects, isUsableSuggestion, normalizeSuggestionOutput, type DetectedField, type UserProfile } from "@applypilot/shared";
import { generate, hasAiProvider, isFailure, type ProviderName } from "./ai-provider";

export interface SuggestionAgentInput {
  question: string;
  profile: UserProfile;
  field?: DetectedField;
  selectedText?: string;
  page?: { url?: string; title?: string; hostname?: string };
  relatedSavedAnswers?: Array<{ question: string; answer: string }>;
}

export interface SuggestionAgentResult {
  answer: string;
  mode: "short_form" | "behavioral" | "selected_context";
  provider: ProviderName;
}

export interface SuggestionAgentFailure {
  error: string;
  throttled: boolean;
  mode?: "short_form" | "behavioral" | "selected_context";
}

function candidateFacts(profile: UserProfile): Record<string, unknown> {
  const grouped = groupProjects(profile);
  return {
    identity: {
      firstName: profile.firstName,
      lastName: profile.lastName,
      fullName: [profile.firstName, profile.lastName].filter(Boolean).join(" "),
      email: profile.email,
      phone: profile.phone,
      location: profile.location,
      linkedin: profile.linkedin,
      github: profile.github,
      portfolio: profile.portfolio,
    },
    applicationFields: {
      currentTitle: profile.currentTitle,
      summary: profile.summary,
      noticePeriod: profile.noticePeriod,
      currentSalary: profile.currentSalary,
      expectedSalary: profile.expectedSalary,
      totalExperience: profile.totalExperience,
      willingToRelocate: profile.willingToRelocate,
      workAuthorization: profile.workAuthorization,
      availability: profile.availability,
    },
    skills: (profile.skills ?? []).slice(0, 80),
    experiences: (profile.experiences ?? []).slice(0, 8).map((role) => ({
      company: role.company,
      title: role.title,
      period: role.period,
      location: role.location,
      summary: role.summary,
      achievements: (role.achievements ?? []).slice(0, 8),
      technologies: (role.skills ?? []).slice(0, 30),
    })),
    projects: [...grouped.primary, ...grouped.secondary].slice(0, 12).map((project) => ({
      name: project.name,
      description: project.description,
      impact: project.impact,
      role: project.role,
      period: project.period,
      technologies: project.technologies,
      url: project.url,
      source: project.source ?? "resume",
    })),
    education: (profile.education ?? []).slice(0, 8),
    customAnswers: (profile.customFields ?? []).slice(0, 60).map((field) => ({ question: field.label, answer: field.value })),
  };
}

export async function runSuggestionAgent(input: SuggestionAgentInput): Promise<SuggestionAgentResult | SuggestionAgentFailure> {
  if (!hasAiProvider()) return { error: "No AI provider is configured on the server.", throttled: false };

  const prompts = buildSuggestionPrompts({
    question: input.question,
    field: input.field,
    selectedText: input.selectedText,
    page: input.page,
    candidateFacts: candidateFacts(input.profile),
    relatedSavedAnswers: input.relatedSavedAnswers,
  });
  const result = await generate({
    system: prompts.system,
    user: prompts.user,
    temperature: 0.25,
    maxTokens: prompts.mode === "behavioral" ? 360 : 180,
  });
  if (isFailure(result)) return { ...result, mode: prompts.mode };

  const answer = normalizeSuggestionOutput(result.text);
  if (!isUsableSuggestion(answer)) return { error: "The candidate profile does not support a truthful answer.", throttled: false, mode: prompts.mode };
  return { answer, mode: prompts.mode, provider: result.provider };
}
