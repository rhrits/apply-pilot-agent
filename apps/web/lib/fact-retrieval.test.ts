/**
 * Tests for fact retrieval and ranking.
 *
 * The behaviour that matters is that the fact answering the question survives ranking
 * and lands near the top, and that a genuinely empty profile is reported as empty
 * rather than answered from noise.
 */

import { describe, expect, it } from "vitest";
import { buildProfileFacts, preferredCategories, rankFacts, retrieveFacts } from "@uplyfox/shared";
import type { UserProfile } from "@uplyfox/shared";

const profile: UserProfile = {
  firstName: "Ada", lastName: "Lovelace", email: "ada@example.com", phone: "+1 555 0100",
  location: "Berlin, Germany", linkedin: "https://linkedin.com/in/ada", github: "", portfolio: "",
  currentTitle: "Senior Backend Engineer", summary: "Backend engineer focused on payments.",
  noticePeriod: "60 days", currentSalary: "", expectedSalary: "\u20ac95,000",
  totalExperience: "8 years", willingToRelocate: "Yes", workAuthorization: "EU citizen",
  availability: "Immediate", customFields: [],
  skills: [
    ...Array.from({ length: 40 }, (_, index) => ({ name: `Filler${index}` })),
    { name: "Kubernetes", years: 4, proficiency: "Advanced" },
    { name: "PostgreSQL", years: 6, proficiency: "Expert" },
  ],
  experiences: [
    {
      company: "Stripe", title: "Senior Backend Engineer", period: "2021 – Present",
      summary: "Led payment reliability work.",
      achievements: [
        "Resolved a production outage by rebuilding the retry queue, cutting failed charges by 40%",
        "Mentored four engineers through a migration to Kubernetes",
      ],
      skills: ["Go", "PostgreSQL"],
    },
    { company: "Zalando", title: "Backend Engineer", period: "2018 – 2021", summary: "Built checkout services.", achievements: [], skills: ["Java"] },
  ],
  education: [{ institution: "TU Berlin", degree: "BSc", field: "Computer Science", period: "2014 – 2018" }],
  projects: [{ name: "LedgerKit", description: "Open-source double-entry ledger.", technologies: ["Rust"], impact: "600 GitHub stars" }],
};

describe("fact retrieval", () => {
  it("splits the profile into individually rankable facts", () => {
    const facts = buildProfileFacts(profile);
    // Each achievement must stand alone, otherwise it cannot outrank an unrelated role.
    expect(facts.some((fact) => fact.text.includes("retry queue"))).toBe(true);
    expect(facts.filter((fact) => fact.category === "experience").length).toBeGreaterThan(2);
  });

  it("skips empty profile values instead of emitting blank facts", () => {
    const facts = buildProfileFacts(profile);
    expect(facts.some((fact) => fact.id === "identity:GitHub")).toBe(false);
    expect(facts.every((fact) => fact.text.trim().length > 0)).toBe(true);
  });

  it("routes a notice-period question to application facts", () => {
    expect(preferredCategories("What is your notice period?")[0]).toBe("application");
    const top = rankFacts("What is your notice period?", buildProfileFacts(profile))[0];
    expect(top.text).toContain("60 days");
  });

  it("surfaces the relevant achievement for a behavioral question", () => {
    // The whole point of P4: this fact previously sat behind 40 filler skills.
    const ranked = rankFacts("Tell us about a challenging production problem you solved", buildProfileFacts(profile));
    const position = ranked.findIndex((fact) => fact.text.includes("retry queue"));
    expect(position).toBeGreaterThanOrEqual(0);
    expect(position).toBeLessThan(5);
  });

  it("ranks the matching skill above unrelated filler skills", () => {
    const ranked = rankFacts("How many years of Kubernetes experience do you have?", buildProfileFacts(profile));
    const kubernetes = ranked.findIndex((fact) => fact.text.includes("Kubernetes"));
    const filler = ranked.findIndex((fact) => fact.text.includes("Filler0"));
    expect(kubernetes).toBeLessThan(filler);
  });

  it("prefers education facts for a degree question", () => {
    const top = rankFacts("Which university did you graduate from?", buildProfileFacts(profile))[0];
    expect(top.category).toBe("education");
  });

  it("keeps the selected facts inside the character budget", () => {
    const result = retrieveFacts("Tell us about your experience", profile, 300);
    const used = result.facts.reduce((total, fact) => total + fact.text.length, 0);
    expect(used).toBeLessThanOrEqual(300);
    expect(result.facts.length).toBeGreaterThan(0);
  });

  it("reports high coverage when the profile answers the question", () => {
    expect(retrieveFacts("What is your expected salary?", profile).coverage).toBeGreaterThan(0.3);
  });

  it("reports gaps for profile areas that hold no data", () => {
    const empty: UserProfile = { ...profile, education: [] };
    const result = retrieveFacts("Which university did you attend?", empty);
    // Naming the empty area is what makes the notice actionable.
    expect(result.gaps.join(" ")).toMatch(/education/i);
  });

  it("gives low coverage for a bare profile", () => {
    const bare: UserProfile = {
      ...profile, skills: [], experiences: [], projects: [], education: [], customFields: [],
      summary: "", noticePeriod: "", expectedSalary: "", totalExperience: "",
      willingToRelocate: "", workAuthorization: "", availability: "", currentTitle: "",
    };
    expect(retrieveFacts("Describe a time you led a difficult project", bare).coverage).toBeLessThan(0.35);
  });

  it("treats an explicit custom answer as high-value", () => {
    const withCustom: UserProfile = { ...profile, customFields: [{ id: "clearance", label: "Security clearance", value: "Active TS/SCI" }] };
    const top = rankFacts("Do you hold a security clearance?", buildProfileFacts(withCustom))[0];
    expect(top.text).toContain("TS/SCI");
  });
});
