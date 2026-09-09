/**
 * Fact retrieval and ranking for grounded answers.
 *
 * The suggestion agent used to serialize the candidate's whole profile into every
 * prompt — up to 80 skills, 8 roles with 8 achievements each, 12 projects, and 60 saved
 * answers. Two things go wrong with that:
 *
 *  1. The one fact that answers the question is buried among a couple of hundred
 *     irrelevant ones, so the model returns INSUFFICIENT_CONTEXT even though the
 *     profile *does* contain the answer. This is the main cause of the empty
 *     "your profile doesn't have enough detail" notice.
 *  2. There is no way to tell "the profile lacks this" from "the prompt buried it",
 *     so the user is told to add detail they already added.
 *
 * This module flattens the profile into discrete facts, ranks them against the question,
 * and returns only what fits a budget — plus a coverage score and, when coverage is
 * poor, the specific profile areas that are actually empty.
 */

import type { UserProfile } from "./types";

export type FactCategory = "identity" | "application" | "skill" | "experience" | "project" | "education" | "custom";

export interface ProfileFact {
  id: string;
  category: FactCategory;
  /** Where the fact came from, shown to the user when reporting gaps. */
  label: string;
  text: string;
  /** Intrinsic importance, independent of the question. */
  weight: number;
}

export interface RankedFact extends ProfileFact { score: number }

export interface RetrievalResult {
  facts: RankedFact[];
  /** 0–1 estimate of how well the profile covers this question. */
  coverage: number;
  /** Profile areas the question needed that hold no data. */
  gaps: string[];
}

/** Characters of fact text allowed into a prompt. Keeps the model focused and the cost flat. */
export const DEFAULT_FACT_BUDGET = 6000;

/**
 * Minimum score for a fact to count as supporting the question.
 *
 * Coverage must reflect relevant depth, not mere presence: every profile has a name and
 * an email, and those must not make a behavioral question look well-grounded.
 */
export const RELEVANCE_FLOOR = 0.25;

const STOPWORDS = new Set([
  "the", "and", "for", "you", "your", "our", "with", "that", "this", "have", "has", "had", "are", "was", "were", "will",
  "would", "can", "could", "should", "what", "when", "where", "which", "who", "why", "how", "please", "describe", "tell",
  "about", "give", "any", "all", "from", "into", "than", "then", "them", "they", "their", "there", "here", "been", "being",
  "does", "did", "not", "but", "his", "her", "its", "job", "role", "position", "candidate", "applicant", "application",
]);

function tokenize(value: string): string[] {
  return value.toLowerCase().replace(/[^a-z0-9+#.]+/g, " ").split(/\s+/)
    .filter((word) => word.length > 2 && !STOPWORDS.has(word));
}

/**
 * Which parts of the profile a question is asking about.
 *
 * Term overlap alone is unreliable for job questions: "Tell me about a challenge you
 * overcame" shares almost no vocabulary with the achievement that answers it. Steering
 * by intent recovers the facts that pure lexical matching would miss.
 */
export function preferredCategories(question: string): FactCategory[] {
  const q = question.toLowerCase();
  if (/salary|compensation|notice period|relocat|authoriz|visa|sponsor|availab|start date|remote|willing/.test(q)) return ["application", "identity"];
  if (/email|phone|address|linkedin|github|portfolio|website|name|city|country|located/.test(q)) return ["identity", "application"];
  if (/degree|university|college|school|gpa|graduat|major|study|studied|education/.test(q)) return ["education"];
  if (/project|built|side project|portfolio piece|open source/.test(q)) return ["project", "experience"];
  if (/skill|technolog|language|framework|tool|proficien|stack|experience with|familiar/.test(q)) return ["skill", "experience", "project"];
  if (/challeng|conflict|failure|mistake|achievement|accomplish|proud|example|situation|time when|led|leadership|team/.test(q)) return ["experience", "project"];
  if (/why|motivat|interest|cover letter|about yourself|introduce|strength|weakness|career|goal/.test(q)) return ["application", "experience", "project"];
  return ["experience", "project", "skill", "application"];
}

function push(facts: ProfileFact[], fact: ProfileFact | null) {
  if (fact && fact.text.trim()) facts.push({ ...fact, text: fact.text.trim() });
}

/** Flattens a profile into independently rankable facts. */
export function buildProfileFacts(profile: UserProfile): ProfileFact[] {
  const facts: ProfileFact[] = [];
  const identity: Array<[string, unknown]> = [
    ["Full name", [profile.firstName, profile.lastName].filter(Boolean).join(" ")],
    ["Email", profile.email], ["Phone", profile.phone], ["Location", profile.location],
    ["LinkedIn", profile.linkedin], ["GitHub", profile.github], ["Portfolio", profile.portfolio],
  ];
  for (const [label, value] of identity) {
    if (typeof value === "string" && value.trim()) push(facts, { id: `identity:${label}`, category: "identity", label, text: `${label}: ${value}`, weight: 0.6 });
  }

  const application: Array<[string, unknown]> = [
    ["Current title", profile.currentTitle], ["Professional summary", profile.summary],
    ["Notice period", profile.noticePeriod], ["Current salary", profile.currentSalary],
    ["Expected salary", profile.expectedSalary], ["Total experience", profile.totalExperience],
    ["Willing to relocate", profile.willingToRelocate], ["Work authorization", profile.workAuthorization],
    ["Availability", profile.availability],
  ];
  for (const [label, value] of application) {
    if (typeof value === "string" && value.trim()) push(facts, { id: `application:${label}`, category: "application", label, text: `${label}: ${value}`, weight: 0.75 });
  }

  for (const [index, skill] of (profile.skills ?? []).entries()) {
    if (!skill?.name) continue;
    const detail = [skill.years ? `${skill.years} years` : "", skill.proficiency ?? ""].filter(Boolean).join(", ");
    push(facts, { id: `skill:${index}`, category: "skill", label: "Skills", text: detail ? `${skill.name} (${detail})` : skill.name, weight: 0.45 });
  }

  for (const [index, role] of (profile.experiences ?? []).entries()) {
    const header = [role.title, role.company].filter(Boolean).join(" at ");
    const period = role.period ? ` (${role.period})` : "";
    // More recent roles matter more; the list arrives newest-first.
    const recency = Math.max(0.5, 1 - index * 0.08);
    push(facts, { id: `experience:${index}`, category: "experience", label: header || "Experience", text: `${header}${period}. ${role.summary ?? ""}`.trim(), weight: 0.9 * recency });
    for (const [achievementIndex, achievement] of (role.achievements ?? []).entries()) {
      // Achievements are the raw material for behavioral answers, so each is its own fact.
      push(facts, { id: `experience:${index}:achievement:${achievementIndex}`, category: "experience", label: header || "Experience", text: `${header}: ${achievement}`, weight: 0.85 * recency });
    }
    if ((role.skills ?? []).length) {
      push(facts, { id: `experience:${index}:tech`, category: "skill", label: header || "Experience", text: `Technologies used at ${role.company || "this role"}: ${(role.skills ?? []).join(", ")}`, weight: 0.5 });
    }
  }

  for (const [index, project] of (profile.projects ?? []).entries()) {
    const detail = [project.description, project.impact].filter(Boolean).join(" ");
    const tech = (project.technologies ?? []).length ? ` Technologies: ${(project.technologies ?? []).join(", ")}.` : "";
    push(facts, { id: `project:${index}`, category: "project", label: project.name || "Project", text: `Project ${project.name}: ${detail}${tech}`.trim(), weight: 0.8 });
  }

  for (const [index, entry] of (profile.education ?? []).entries()) {
    const text = [entry.degree, entry.field].filter(Boolean).join(" in ");
    push(facts, { id: `education:${index}`, category: "education", label: entry.institution || "Education", text: `${text} at ${entry.institution}${entry.period ? ` (${entry.period})` : ""}`.trim(), weight: 0.7 });
  }

  for (const [index, field] of (profile.customFields ?? []).entries()) {
    if (!field?.label || !field?.value) continue;
    // The user answered this explicitly, so it outranks anything inferred.
    push(facts, { id: `custom:${index}`, category: "custom", label: field.label, text: `${field.label}: ${field.value}`, weight: 0.95 });
  }

  return facts;
}

/** Scores facts against a question by term overlap, intent affinity, and intrinsic weight. */
export function rankFacts(question: string, facts: ProfileFact[]): RankedFact[] {
  const questionTerms = new Set(tokenize(question));
  const preferred = preferredCategories(question);

  return facts
    .map((fact) => {
      const factTerms = new Set(tokenize(fact.text));
      let overlap = 0;
      for (const term of questionTerms) if (factTerms.has(term)) overlap += 1;
      const lexical = questionTerms.size ? overlap / questionTerms.size : 0;

      const affinityIndex = preferred.indexOf(fact.category);
      const affinity = affinityIndex === -1 ? 0 : 0.4 - affinityIndex * 0.1;

      const score = lexical * 0.6 + affinity + fact.weight * 0.15;
      return { ...fact, score: Math.round(score * 1000) / 1000 };
    })
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

const CATEGORY_GAP_LABEL: Record<FactCategory, string> = {
  identity: "contact details",
  application: "application preferences (notice period, salary, work authorization)",
  skill: "skills",
  experience: "work experience with achievements",
  project: "projects with descriptions and impact",
  education: "education history",
  custom: "saved custom answers",
};

/**
 * Selects the facts worth sending, and reports how well they cover the question.
 *
 * Coverage deliberately blends the best single match with the depth of support behind
 * it: one strong fact is enough for "What is your notice period", but a behavioral
 * question needs several before an answer can be honest.
 */
export function retrieveFacts(question: string, profile: UserProfile, budget = DEFAULT_FACT_BUDGET): RetrievalResult {
  const all = buildProfileFacts(profile);
  const ranked = rankFacts(question, all);

  const selected: RankedFact[] = [];
  let used = 0;
  for (const fact of ranked) {
    if (used + fact.text.length > budget) continue;
    selected.push(fact);
    used += fact.text.length;
    if (selected.length >= 60) break;
  }

  const top = selected.slice(0, 5);
  const best = top[0]?.score ?? 0;
  const supporting = top.filter((fact) => fact.score >= RELEVANCE_FLOOR).length;
  const depth = Math.min(1, supporting / 4);
  const coverage = Math.round(Math.min(1, best * 0.7 + depth * 0.3) * 100) / 100;

  const present = new Set(all.map((fact) => fact.category));
  const gaps = preferredCategories(question)
    .filter((category) => !present.has(category))
    .map((category) => CATEGORY_GAP_LABEL[category]);

  return { facts: selected, coverage, gaps };
}
