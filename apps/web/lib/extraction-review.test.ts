/**
 * Tests for the extraction review queue.
 *
 * The queue only earns attention if it flags genuinely wrong values and stays silent
 * about correct ones. Both halves are asserted here — a queue full of false positives
 * would be trained away within a day.
 */

import { describe, expect, it } from "vitest";
import { buildReviewQueue, describeReviewQueue, REVIEW_THRESHOLD } from "@uplyfox/shared";
import type { ProfileSources, UserProfile } from "@uplyfox/shared";

function profileWith(overrides: Partial<UserProfile>): UserProfile {
  return {
    firstName: "Ada", lastName: "Lovelace", email: "ada@example.com", phone: "+1 555 010 2020",
    location: "Berlin", linkedin: "", github: "", portfolio: "", currentTitle: "Engineer",
    summary: "", noticePeriod: "", currentSalary: "", expectedSalary: "", totalExperience: "",
    willingToRelocate: "", workAuthorization: "", availability: "", customFields: [],
    skills: [], experiences: [], education: [], projects: [],
    ...overrides,
  };
}

const RESUME: ProfileSources = {
  email: "resume", phone: "resume", firstName: "resume", linkedin: "resume",
  currentSalary: "resume", expectedSalary: "resume", workAuthorization: "resume", noticePeriod: "resume",
};

describe("extraction review queue", () => {
  it("stays silent when everything parsed cleanly", () => {
    const queue = buildReviewQueue(profileWith({
      skills: [{ name: "TypeScript" }, { name: "Kubernetes" }],
      experiences: [{ company: "Stripe", title: "Engineer", period: "2021 – Present", summary: "", achievements: [], skills: [] }],
    }), { email: "resume", phone: "resume", firstName: "resume" });
    expect(queue).toHaveLength(0);
    expect(describeReviewQueue(queue)).toBe("Nothing needs review.");
  });

  it("flags a phone number that is really a date range", () => {
    const queue = buildReviewQueue(profileWith({ phone: "2019 - 2021" }), RESUME);
    const phone = queue.find((entry) => entry.id === "phone");
    expect(phone?.severity).toBe("needs_review");
    expect(phone?.reason).toMatch(/date/i);
  });

  it("flags a malformed email", () => {
    const queue = buildReviewQueue(profileWith({ email: "ada [at] example" }), RESUME);
    expect(queue.some((entry) => entry.id === "email")).toBe(true);
  });

  it("flags a skill that is actually a sentence", () => {
    // The most common resume-parse failure: a bullet swallowed into the skills list.
    const queue = buildReviewQueue(profileWith({
      skills: [{ name: "React" }, { name: "Led a team of six engineers to migrate the billing platform to Kubernetes" }],
    }), {});
    const flagged = queue.filter((entry) => entry.area === "Skills");
    expect(flagged).toHaveLength(1);
    expect(flagged[0].value).toMatch(/Led a team/);
  });

  it("does not flag ordinary multi-word skills", () => {
    const queue = buildReviewQueue(profileWith({ skills: [{ name: "Amazon Web Services" }, { name: "CI/CD" }] }), {});
    expect(queue.filter((entry) => entry.area === "Skills")).toHaveLength(0);
  });

  it("flags a role missing its company and dates", () => {
    const queue = buildReviewQueue(profileWith({
      experiences: [{ company: "", title: "Engineer", period: "", summary: "", achievements: [], skills: [] }],
    }), {});
    const role = queue.find((entry) => entry.area === "Experience 1");
    expect(role?.reason).toMatch(/company and dates/);
    expect(role?.confidence).toBeLessThan(0.5);
  });

  it("does not second-guess values the candidate typed", () => {
    // Only resume-sourced fields are reviewed; manual entry is authoritative.
    const queue = buildReviewQueue(profileWith({ phone: "not a phone" }), { phone: "manual" });
    expect(queue.some((entry) => entry.id === "phone")).toBe(false);
  });

  it("asks the user to confirm resume-extracted compensation", () => {
    const queue = buildReviewQueue(profileWith({ expectedSalary: "$120,000" }), RESUME);
    const salary = queue.find((entry) => entry.id === "sensitive:expectedSalary");
    expect(salary?.tab).toBe("details");
    expect(salary?.severity).toBe("check");
  });

  it("orders the least trustworthy field first", () => {
    const queue = buildReviewQueue(profileWith({
      phone: "2019 - 2021",
      expectedSalary: "$120,000",
    }), RESUME);
    expect(queue[0].confidence).toBeLessThanOrEqual(queue[queue.length - 1].confidence);
  });

  it("never returns a field above the review threshold", () => {
    const queue = buildReviewQueue(profileWith({ phone: "2019 - 2021", email: "bad" }), RESUME);
    expect(queue.every((entry) => entry.confidence < REVIEW_THRESHOLD)).toBe(true);
  });

  it("summarises how many fields are likely wrong", () => {
    const queue = buildReviewQueue(profileWith({ phone: "2019 - 2021" }), RESUME);
    expect(describeReviewQueue(queue)).toMatch(/likely wrong/);
  });
});
