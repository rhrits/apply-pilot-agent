import { buildSuggestionPrompts, extractInsufficientReason, isUsableSuggestion, normalizeSuggestionOutput, retrieveFacts, type DetectedField, type UserProfile } from "@uplyfox/shared";
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
  coverage: number;
}

export interface SuggestionAgentFailure {
  error: string;
  throttled: boolean;
  mode?: "short_form" | "behavioral" | "selected_context";
  /** What the profile was missing, when the model could say. */
  missing?: string;
  coverage?: number;
  gaps?: string[];
}

/**
 * Groups the retrieved facts for the prompt.
 *
 * Only the facts that ranked highest for this question are included, ordered by
 * relevance, so the answer-bearing fact is never buried behind dozens of unrelated ones.
 */
function retrievedFacts(question: string, profile: UserProfile) {
  const retrieval = retrieveFacts(question, profile);
  const grouped: Record<string, string[]> = {};
  for (const fact of retrieval.facts) {
    (grouped[fact.category] ??= []).push(fact.text);
  }
  return { payload: grouped as Record<string, unknown>, coverage: retrieval.coverage, gaps: retrieval.gaps };
}

export async function runSuggestionAgent(input: SuggestionAgentInput): Promise<SuggestionAgentResult | SuggestionAgentFailure> {
  if (!hasAiProvider()) return { error: "No AI provider is configured on the server.", throttled: false };

  const { payload, coverage, gaps } = retrievedFacts(input.question, input.profile);
  const prompts = buildSuggestionPrompts({
    question: input.question,
    field: input.field,
    selectedText: input.selectedText,
    page: input.page,
    candidateFacts: payload,
    relatedSavedAnswers: input.relatedSavedAnswers,
    coverage,
  });
  const result = await generate({
    system: prompts.system,
    user: prompts.user,
    temperature: 0.25,
    maxTokens: prompts.mode === "behavioral" ? 360 : 180,
  });
  if (isFailure(result)) return { ...result, mode: prompts.mode, coverage };

  const answer = normalizeSuggestionOutput(result.text);
  if (!isUsableSuggestion(answer)) {
    return {
      error: "The candidate profile does not support a truthful answer.",
      throttled: false,
      mode: prompts.mode,
      // The model names the missing detail, so the user learns what to add.
      missing: extractInsufficientReason(answer),
      coverage,
      gaps,
    };
  }
  return { answer, mode: prompts.mode, provider: result.provider, coverage };
}
