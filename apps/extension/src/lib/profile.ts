import type { ExtensionMessage, UserProfile } from "@applypilot/shared";

export const demoProfile: UserProfile = {
  firstName: "Alex",
  lastName: "Applicant",
  email: "alex@example.com",
  phone: "+1 555 010 2026",
  location: "Remote / New York",
  linkedin: "https://www.linkedin.com/in/alex-applicant",
  github: "https://github.com/alex-applicant",
  portfolio: "https://alex-applicant.dev",
  currentTitle: "Full-stack Engineer",
  summary: "Full-stack engineer building reliable products with TypeScript, React, and Supabase.",
  skills: [
    { name: "TypeScript", years: 3, proficiency: "Advanced" },
    { name: "React", years: 3, proficiency: "Advanced" },
    { name: "Python", years: 2, proficiency: "Intermediate" },
  ],
};

export async function getProfile(): Promise<UserProfile | null> {
  const auth = await chrome.runtime.sendMessage({ type: "AUTH_STATUS" } satisfies ExtensionMessage);
  if (!auth?.authenticated) return null;
  const result = await chrome.storage.local.get("profile");
  return (result.profile as UserProfile | undefined) ?? null;
}
