import { describe, expect, it } from "vitest";
import { canAutoFill, resolveField, type FieldDescriptor } from "@uplyfox/shared";
import { demoProfile } from "./profile";

function field(question: string, overrides: Partial<FieldDescriptor> = {}): FieldDescriptor {
  return { id: "f", selector: "#f", shadowPath: [], frameId: 0, elementType: "input", inputType: "text", role: "textbox", label: question, question, questionSource: "label", questionConfidence: 0.95, kind: "unknown", currentValue: null, options: [], required: true, disabled: false, visible: true, ...overrides };
}

describe("structured field resolution", () => {
  it("preserves the profile engine confidence instead of detector confidence", () => {
    const result = resolveField({ descriptor: field("Email address", { questionConfidence: 0.3 }), profile: demoProfile });
    expect(result.source).toBe("profile");
    expect(result.confidence).toBe(0.99);
  });

  it("prefers a strong saved answer over the profile engine", () => {
    const result = resolveField({
      descriptor: field("What is your email address?"), profile: demoProfile,
      memory: [{ id: "m", question: "What is your email address?", answer: "reviewed@example.com", source: "user", updatedAt: "2026-09-09" }],
    });
    expect(result.source).toBe("answer_library");
    expect(result.value).toBe("reviewed@example.com");
  });

  it("does not choose between ambiguous saved answers", () => {
    const result = resolveField({
      descriptor: field("Why are you interested?"), profile: demoProfile,
      memory: [
        { id: "a", question: "Why are you interested in this company?", answer: "Company", source: "user", updatedAt: "2026-09-09" },
        { id: "b", question: "Why are you interested in this role?", answer: "Role", source: "user", updatedAt: "2026-09-09" },
      ],
    });
    expect(result.source).not.toBe("answer_library");
  });

  it("blocks every hard-stop category before memory or profile resolution", () => {
    for (const question of ["Do you require visa sponsorship?", "Expected salary", "Are you a veteran?", "Are you willing to relocate?", "I certify this is accurate"]) {
      const result = resolveField({ descriptor: field(question), profile: demoProfile, memory: [{ id: "m", question, answer: "Yes", source: "user", updatedAt: "2026-09-09" }] });
      expect(result.state, question).toBe("blocked");
      expect(canAutoFill(result), question).toBe(false);
    }
  });

  it("treats an existing page value as authoritative user input", () => {
    const result = resolveField({ descriptor: field("Email", { currentValue: "typed@example.com" }), profile: demoProfile });
    expect(result.source).toBe("user");
    expect(result.confidence).toBe(1);
    expect(canAutoFill(result)).toBe(false);
  });

  it("marks AI answers review-only and never eligible for Fill all", () => {
    const result = resolveField({ descriptor: field("Why this company?"), profile: demoProfile, aiAnswer: { answer: "Because...", confidence: 0.95 } });
    expect(result.source).toBe("ai");
    expect(result.needsReview).toBe(true);
    expect(result.confidence).toBeLessThan(0.8);
    expect(canAutoFill(result)).toBe(false);
  });

  it("returns missing profile facts for known empty intents", () => {
    const result = resolveField({ descriptor: field("What is your GitHub URL?"), profile: { ...demoProfile, github: "" } });
    expect(result.state).toBe("unknown");
    expect(result.missingFacts).toContain("github");
  });

  it("allows only strong non-review profile answers to auto-fill", () => {
    expect(canAutoFill(resolveField({ descriptor: field("Email"), profile: demoProfile }))).toBe(true);
    expect(canAutoFill(resolveField({ descriptor: field("Notice period"), profile: demoProfile }))).toBe(false);
  });
});
