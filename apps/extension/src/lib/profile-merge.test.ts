import { describe, expect, it } from "vitest";
import { buildProfileMarkdown, mergeAllSources, mergeProfile, emptyProfile, profileCompleteness } from "@applypilot/shared";

describe("resume-first merging", () => {
  it("never lets a lower-priority source overwrite a resume fact", () => {
    const base = mergeProfile(emptyProfile(), { currentTitle: "Backend Engineer", location: "Pune" }, "resume").profile;
    const merged = mergeProfile(base, { currentTitle: "Open Source Dev", location: "Remote" }, "github", { currentTitle: "resume", location: "resume" });
    expect(merged.profile.currentTitle).toBe("Backend Engineer");
    expect(merged.profile.location).toBe("Pune");
  });

  it("lets enrichment fill only the gaps the resume left empty", () => {
    const resume = mergeProfile(emptyProfile(), { firstName: "Asha", currentTitle: "Engineer" }, "resume");
    const merged = mergeProfile(resume.profile, { github: "https://github.com/asha", currentTitle: "Ignored" }, "github", resume.sources);
    expect(merged.profile.github).toBe("https://github.com/asha");
    expect(merged.profile.currentTitle).toBe("Engineer");
    expect(merged.sources.github).toBe("github");
  });

  it("applies sources in priority order regardless of input order", () => {
    const { profile } = mergeAllSources([
      { source: "github", profile: { currentTitle: "Hobbyist", summary: "From GitHub" } },
      { source: "resume", profile: { currentTitle: "Staff Engineer" } },
    ]);
    expect(profile.currentTitle).toBe("Staff Engineer");
    expect(profile.summary).toBe("From GitHub");
  });

  it("deduplicates merged list data", () => {
    const { profile } = mergeAllSources([
      { source: "resume", profile: { skills: [{ name: "TypeScript" }] } },
      { source: "github", profile: { skills: [{ name: "typescript" }, { name: "Go" }] } },
    ]);
    expect(profile.skills?.map((skill) => skill.name)).toEqual(["TypeScript", "Go"]);
  });

  it("keeps complete resume records when an AI contribution is partial", () => {
    const resume = mergeProfile(emptyProfile(), {
      experiences: [{
        company: "Acme",
        title: "Backend Engineer",
        period: "2021 – Present",
        summary: "Built the payments platform.",
        achievements: ["Reduced checkout failures by 32%"],
      }],
      projects: [{ name: "ApplyPilot", description: "A job copilot", technologies: ["TypeScript", "React"] }],
    }, "resume");

    const afterAi = mergeProfile(resume.profile, {
      experiences: [{ company: "Acme", title: "Backend Engineer" }],
      projects: [{ name: "ApplyPilot", description: "" }],
    }, "typed", resume.sources);

    expect(afterAi.profile.experiences?.[0].period).toBe("2021 – Present");
    expect(afterAi.profile.experiences?.[0].achievements).toEqual(["Reduced checkout failures by 32%"]);
    expect(afterAi.profile.projects?.[0].technologies).toEqual(["TypeScript", "React"]);
  });

  it("restores resume records when a partial model profile is reconciled first", () => {
    const model = mergeProfile(emptyProfile(), {
      experiences: [{ company: "Acme", title: "Backend Engineer" }],
    }, "typed").profile;
    const resume = mergeProfile(emptyProfile(), {
      experiences: [{ company: "Acme", title: "Backend Engineer", period: "2021 – Present", achievements: ["Shipped billing"] }],
    }, "resume").profile;

    const reconciled = mergeProfile(model, resume, "resume");
    expect(reconciled.profile.experiences?.[0].period).toBe("2021 – Present");
    expect(reconciled.profile.experiences?.[0].achievements).toEqual(["Shipped billing"]);
  });

  it("builds markdown with generated headings", () => {
    const markdown = buildProfileMarkdown({
      ...emptyProfile(),
      firstName: "Asha", lastName: "Rao", currentTitle: "Engineer", summary: "I build things.",
      skills: [{ name: "TypeScript", years: 4 }],
      experiences: [{ company: "Acme", title: "Engineer", period: "2021 – Present", achievements: ["Shipped billing"] }],
      projects: [{ name: "ApplyPilot", description: "Job copilot", technologies: ["React"] }],
      education: [{ institution: "MIT", degree: "BS" }],
    });
    expect(markdown).toContain("# Asha Rao");
    expect(markdown).toContain("## Summary");
    expect(markdown).toContain("## Skills");
    expect(markdown).toContain("### Engineer — Acme");
    expect(markdown).toContain("- Shipped billing");
    expect(markdown).toContain("## Projects");
    expect(markdown).toContain("## Education");
  });

  it("reports missing sections for completeness", () => {
    const { percent, missing } = profileCompleteness(emptyProfile());
    expect(percent).toBe(0);
    expect(missing).toContain("Skills");
  });
});
