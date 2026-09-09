import { describe, expect, it } from "vitest";
import { evaluateSubmissionAttempt, type SubmissionAttempt, type SubmissionSignal } from "@uplyfox/shared";

const START = 1_000;
function signal(kind: SubmissionSignal["kind"], at = START + 10, detail?: string): SubmissionSignal { return { kind, at, detail }; }
function attempt(signals: SubmissionSignal[], overrides: Partial<SubmissionAttempt> = {}): SubmissionAttempt {
  return { attemptId: "a", sessionId: "s", draftId: "d", tabId: 1, frameId: 0, snapshotHash: "h", startedAt: START, deadlineAt: START + 30_000, status: "clicked", signals, ...overrides };
}

describe("strict submission confirmation", () => {
  it("does not confirm from a click and form-submit event alone", () => {
    expect(evaluateSubmissionAttempt(attempt([signal("target_click"), signal("form_submit")]), START + 100).outcome).toBe("pending");
  });

  it("does not confirm from only one result signal", () => {
    expect(evaluateSubmissionAttempt(attempt([signal("target_click"), signal("confirmation_dom")]), START + 100).outcome).toBe("pending");
  });

  it("confirms from the reviewed click plus independent network and DOM evidence", () => {
    const verdict = evaluateSubmissionAttempt(attempt([signal("target_click"), signal("network_success"), signal("confirmation_dom")]), START + 100);
    expect(verdict.outcome).toBe("confirmed");
  });

  it("confirms URL plus application id and returns the id", () => {
    const verdict = evaluateSubmissionAttempt(attempt([signal("target_click"), signal("confirmation_url"), signal("application_id", START + 20, "APP-12345")]), START + 100);
    expect(verdict.outcome).toBe("confirmed");
    expect(verdict.applicationId).toBe("APP-12345");
  });

  it("lets explicit failure evidence win over apparent success", () => {
    const verdict = evaluateSubmissionAttempt(attempt([signal("target_click"), signal("network_success"), signal("confirmation_dom"), signal("network_failure", START + 30, "422 validation")]), START + 100);
    expect(verdict.outcome).toBe("failed");
  });

  it("becomes unknown at the deadline rather than confirmed", () => {
    const verdict = evaluateSubmissionAttempt(attempt([signal("target_click"), signal("form_submit")]), START + 30_000);
    expect(verdict.outcome).toBe("unknown");
  });

  it("ignores evidence from before the attempt and after its deadline", () => {
    const verdict = evaluateSubmissionAttempt(attempt([
      signal("target_click"),
      signal("network_success", START - 1),
      signal("confirmation_dom", START + 30_001),
    ]), START + 100);
    expect(verdict.outcome).toBe("pending");
  });

  it("requires the exact target click before any result can confirm", () => {
    expect(evaluateSubmissionAttempt(attempt([signal("network_success"), signal("confirmation_dom")]), START + 100).outcome).toBe("pending");
  });

  it("ignores confirmation evidence that existed before the reviewed click", () => {
    const verdict = evaluateSubmissionAttempt(attempt([
      signal("confirmation_dom", START + 5),
      signal("target_click", START + 20),
      signal("network_success", START + 30),
    ]), START + 100);
    expect(verdict.outcome).toBe("pending");
  });
});
