import { describe, expect, it } from "vitest";
import { analyzeJobMatch, type UserProfile } from "@applypilot/shared";

const profile: UserProfile = {
  firstName: "Alex", lastName: "Applicant", email: "alex@example.com", phone: "", location: "Remote",
  linkedin: "", github: "", portfolio: "", currentTitle: "Full-stack Engineer",
  skills: [{ name: "TypeScript", years: 3 }, { name: "React", years: 3 }, { name: "Python", years: 2 }],
  experiences: [{ company: "Example", title: "Full-stack Engineer", period: "2023 – Present", skills: ["TypeScript", "React"] }],
};

describe("job match analysis", () => {
  it("does not claim a reliable score without a real description", () => {
    const result = analyzeJobMatch({ title: "Frontend Engineer", description: "Apply now", skills: [] }, profile);
    expect(result.score).toBe(0);
    expect(result.summary).toMatch(/too short/i);
  });

  it("scores the description against profile skills and reports gaps", () => {
    const result = analyzeJobMatch({
      title: "Frontend Engineer",
      description: "We are looking for a Frontend Engineer. Requirements: TypeScript, React, Node.js, Docker. You will build reliable products with a collaborative team and own features from design through delivery.",
      skills: [],
    }, profile);
    expect(result.score).toBeGreaterThan(0);
    expect(result.matchedSkills).toEqual(expect.arrayContaining(["TypeScript", "React"]));
    expect(result.missingSkills).toEqual(expect.arrayContaining(["node.js", "docker"]));
  });
});
