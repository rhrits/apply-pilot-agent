/** Deterministic, source-aware resolution shared by inspection and filling. */

import { answerQuestion, textSimilarity } from "./answer-engine";
import type { FieldDescriptor, FieldResolution } from "./form-graph";
import type { AnswerMemoryItem, UserProfile } from "./types";

export interface MemoryMatch {
  item: AnswerMemoryItem;
  score: number;
}

export interface ResolutionInput {
  descriptor: FieldDescriptor;
  profile: UserProfile;
  memory?: AnswerMemoryItem[];
  aiAnswer?: { answer: string; confidence: number } | null;
}

const HARD_STOP = /\brace\b|ethnicit|\bgender\b|sexual orientation|disabilit|veteran|criminal (record|history|conviction)|security clearance|citizenship|visa|sponsor|work authori[sz]ation|right to work|work permit|salary|compensation|relocat|professional licen[cs]|\bi certify\b|\bi agree\b|terms (and|&) conditions|\bconsent\b|\backnowledge\b|under penalty of perjury/i;

export function isHardStopQuestion(value: string): boolean {
  return HARD_STOP.test(value);
}

export function bestMemoryMatch(question: string, items: AnswerMemoryItem[] = []): MemoryMatch | null {
  const scored = items
    .filter((item) => item.answer.trim())
    .map((item) => ({ item, score: textSimilarity(question, item.question) }))
    .sort((a, b) => b.score - a.score);
  const best = scored[0];
  const second = scored[1];
  // A strong match with a margin over the runner-up is safer than the old unqualified
  // 0.55 threshold, which could choose between two similarly worded screening questions.
  if (!best || best.score < 0.62) return null;
  if (second && best.score < 0.9 && best.score - second.score < 0.12) return null;
  return best;
}

export function resolveField(input: ResolutionInput): FieldResolution {
  const { descriptor, profile } = input;
  const question = `${descriptor.question} ${descriptor.label}`.trim();

  if (isHardStopQuestion(question) || isHardStopQuestion(descriptor.nearbyText ?? "")) {
    return { state: "blocked", value: null, source: "none", confidence: 0, needsReview: true, reason: "Sensitive, legal, or consent question — confirm manually." };
  }

  if (descriptor.currentValue && (Array.isArray(descriptor.currentValue) ? descriptor.currentValue.length : descriptor.currentValue.trim())) {
    return { state: "resolved", value: descriptor.currentValue, source: "user", confidence: 1, needsReview: false, reason: "Already completed on the page." };
  }

  const memory = bestMemoryMatch(question, input.memory);
  if (memory) {
    return { state: "resolved", value: memory.item.answer, source: "answer_library", confidence: Math.min(0.98, 0.62 + memory.score * 0.36), needsReview: memory.score < 0.82, reason: memory.score < 0.82 ? "Closest saved answer — review before submitting." : undefined };
  }

  const engine = answerQuestion(question, profile);
  if (engine.source === "profile" && engine.answer) {
    return { state: "resolved", value: engine.answer, source: "profile", confidence: engine.confidence, needsReview: engine.needsReview, reason: engine.needsReview ? "Profile value is sensitive or derived — review before submitting." : undefined };
  }

  if (input.aiAnswer?.answer) {
    return { state: "resolved", value: input.aiAnswer.answer, source: "ai", confidence: Math.min(0.79, input.aiAnswer.confidence), needsReview: true, reason: "AI-generated answer — review required; Fill all will not write it automatically." };
  }

  const missing = engine.intent !== "unknown" && engine.intent !== "open_ended" ? [engine.intent.replace(/_/g, " ")] : [];
  return { state: "unknown", value: null, source: "none", confidence: 0, needsReview: descriptor.required, reason: descriptor.required ? "Required answer is not available in your profile or saved answers." : "No grounded answer found.", missingFacts: missing };
}

export function canAutoFill(resolution: FieldResolution): boolean {
  if (resolution.state !== "resolved" || resolution.value == null) return false;
  if (resolution.source !== "profile" && resolution.source !== "answer_library") return false;
  if (resolution.needsReview || resolution.confidence < 0.8) return false;
  return Array.isArray(resolution.value) ? resolution.value.length > 0 : resolution.value.trim().length > 0;
}
