import type { JobMatchAnalysis, PageSummary, UserProfile } from "./types";

const COMMON_SKILLS = [
  "javascript", "typescript", "python", "java", "kotlin", "go", "golang", "rust", "c++", "c#", "php", "ruby", "swift",
  "react", "next.js", "nextjs", "vue", "angular", "svelte", "node.js", "nodejs", "express", "django", "fastapi", "flask",
  "html", "css", "tailwind", "graphql", "rest", "sql", "postgresql", "mysql", "mongodb", "redis", "supabase", "firebase",
  "aws", "azure", "gcp", "docker", "kubernetes", "terraform", "linux", "git", "github", "ci/cd", "jenkins",
  "machine learning", "artificial intelligence", "llm", "natural language processing", "data analysis", "data science",
  "figma", "product design", "user research", "project management", "agile", "scrum", "communication", "leadership",
];

const STOP_WORDS = new Set(["about", "after", "again", "also", "and", "are", "for", "from", "have", "into", "must", "that", "the", "their", "this", "with", "your", "you"]);

function normalize(value: string): string {
  return value.toLowerCase().replace(/[._/+-]+/g, " ").replace(/\s+/g, " ").trim();
}

function terms(value: string): string[] {
  return [...new Set(normalize(value).split(/[^a-z0-9#]+/).filter((item) => item.length > 2 && !STOP_WORDS.has(item)))];
}

function profileText(profile: UserProfile): string {
  return [
    profile.currentTitle, profile.summary, profile.totalExperience,
    ...(profile.skills ?? []).flatMap((skill) => [skill.name, skill.proficiency]),
    ...(profile.experiences ?? []).flatMap((role) => [role.title, role.company, role.summary, ...(role.achievements ?? []), ...(role.skills ?? [])]),
    ...(profile.projects ?? []).flatMap((project) => [project.name, project.description, project.impact, ...(project.technologies ?? [])]),
  ].filter(Boolean).join(" ");
}

function containsSkill(text: string, skill: string): boolean {
  const normalizedText = normalize(text);
  const normalizedSkill = normalize(skill);
  return normalizedText.includes(normalizedSkill);
}

export function analyzeJobMatch(job: Pick<PageSummary, "title" | "description" | "skills">, profile: UserProfile): JobMatchAnalysis {
  const description = [job.title, job.description, ...(job.skills ?? [])].filter(Boolean).join(" ");
  const descriptionLength = job.description?.trim().length ?? 0;
  const profileSource = profileText(profile);
  const profileSkillNames = [...new Set([
    ...(profile.skills ?? []).map((skill) => skill.name),
    ...(profile.experiences ?? []).flatMap((role) => role.skills ?? []),
    ...(profile.projects ?? []).flatMap((project) => project.technologies ?? []),
  ].filter(Boolean))];
  const mentionedSkills = COMMON_SKILLS.filter((skill) => containsSkill(description, skill));
  const matchedSkills = profileSkillNames.filter((skill) => containsSkill(description, skill));
  const matchedKeywords = terms(description).filter((term) => terms(profileSource).includes(term));
  const missingSkills = mentionedSkills.filter((skill) => !profileSkillNames.some((candidate) => normalize(candidate) === normalize(skill)));
  const titleTerms = terms(job.title);
  const profileTitleTerms = terms([profile.currentTitle, ...(profile.experiences ?? []).map((role) => role.title)].filter(Boolean).join(" "));
  const titleScore = titleTerms.length ? titleTerms.filter((term) => profileTitleTerms.includes(term)).length / titleTerms.length : 0;
  const evidenceScore = terms(description).length ? Math.min(1, matchedKeywords.length / Math.max(6, terms(description).length * 0.35)) : 0;
  const skillScore = mentionedSkills.length ? matchedSkills.length / mentionedSkills.length : Math.min(1, matchedSkills.length / 5);
  const rawScore = mentionedSkills.length ? skillScore * 0.65 + titleScore * 0.2 + evidenceScore * 0.15 : titleScore * 0.45 + evidenceScore * 0.55;
  const score = descriptionLength >= 120 ? Math.round(Math.max(0, Math.min(100, rawScore * 100))) : 0;
  const summary = descriptionLength < 120
    ? "Job description is too short to calculate a reliable match."
    : missingSkills.length
      ? `${score}% match · ${missingSkills.slice(0, 4).join(", ")} not found in your profile.`
      : `${score}% match · your profile covers the main detected requirements.`;

  return {
    score,
    matchedSkills: matchedSkills.slice(0, 30),
    missingSkills: missingSkills.slice(0, 30),
    matchedKeywords: matchedKeywords.slice(0, 40),
    descriptionLength,
    analyzedAt: new Date().toISOString(),
    summary,
  };
}
