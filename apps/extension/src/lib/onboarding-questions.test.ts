import { describe, expect, it } from "vitest";
import { GENERAL_APPLICATION_QUESTIONS, getGeneralApplicationQuestionBatches } from "@applypilot/shared";

describe("general application question catalog", () => {
  it("contains broad reusable coverage beyond thirty questions", () => {
    expect(GENERAL_APPLICATION_QUESTIONS.length).toBeGreaterThanOrEqual(30);
    expect(new Set(GENERAL_APPLICATION_QUESTIONS.map((item) => item.id)).size).toBe(GENERAL_APPLICATION_QUESTIONS.length);
    expect(new Set(GENERAL_APPLICATION_QUESTIONS.map((item) => item.category))).toEqual(
      new Set(["about", "motivation", "behavioral", "technical", "project", "logistics", "leadership"]),
    );
  });

  it("splits the catalog into bounded batches without losing questions", () => {
    const batches = getGeneralApplicationQuestionBatches(12);
    expect(batches.length).toBeGreaterThan(3);
    expect(batches.every((batch) => batch.length <= 12)).toBe(true);
    expect(batches.flat().map((item) => item.id)).toEqual(GENERAL_APPLICATION_QUESTIONS.map((item) => item.id));
  });
});
