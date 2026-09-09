import { describe, expect, it } from "vitest";
import {
  APPLICATION_CONFIDENCE_THRESHOLD,
  evaluateApplicationSignals,
  isApplicationRequest,
  isApplyIntentText,
  isConfirmationText,
  isConfirmationUrl,
  SIGNAL_WINDOW_MS,
  type ApplicationSignal,
} from "@uplyfox/shared";

const at = Date.now();
const signal = (kind: ApplicationSignal["kind"], offset = 0): ApplicationSignal => ({ kind, at: at - offset });

describe("apply intent text", () => {
  it("recognizes real submit buttons", () => {
    expect(isApplyIntentText("Apply")).toBe(true);
    expect(isApplyIntentText("Submit application")).toBe(true);
    expect(isApplyIntentText("Send application")).toBe(true);
  });

  it("rejects buttons that only navigate or save", () => {
    // These are the false positives that would wrongly mark a job as applied.
    expect(isApplyIntentText("Apply on company site")).toBe(false);
    expect(isApplyIntentText("Save job")).toBe(false);
    expect(isApplyIntentText("Search")).toBe(false);
    expect(isApplyIntentText("Upload resume")).toBe(false);
    expect(isApplyIntentText("Sign in")).toBe(false);
  });

  it("ignores empty or essay-length text", () => {
    expect(isApplyIntentText("   ")).toBe(false);
    expect(isApplyIntentText("Apply ".repeat(20))).toBe(false);
  });
});

describe("application requests", () => {
  it("accepts a successful POST to an application endpoint", () => {
    expect(isApplicationRequest("POST", "https://boards.greenhouse.io/acme/applications", 200)).toBe(true);
    expect(isApplicationRequest("POST", "https://jobs.lever.co/acme/apply", 201)).toBe(true);
  });

  it("ignores reads, failures, and background noise", () => {
    expect(isApplicationRequest("GET", "https://acme.com/apply", 200)).toBe(false);
    expect(isApplicationRequest("POST", "https://acme.com/apply", 500)).toBe(false);
    expect(isApplicationRequest("POST", "https://acme.com/analytics/apply", 200)).toBe(false);
    expect(isApplicationRequest("POST", "https://acme.com/application/autosave", 200)).toBe(false);
    expect(isApplicationRequest("POST", "https://acme.com/api/search", 200)).toBe(false);
  });
});

describe("confirmation signals", () => {
  it("matches confirmation URLs and copy", () => {
    expect(isConfirmationUrl("https://acme.com/apply/confirmation")).toBe(true);
    expect(isConfirmationUrl("https://acme.com/thank-you")).toBe(true);
    expect(isConfirmationText("Thanks for applying! We have received your application.")).toBe(true);
    expect(isConfirmationText("Your application was submitted")).toBe(true);
  });

  it("does not match ordinary job copy", () => {
    expect(isConfirmationUrl("https://acme.com/jobs/staff-engineer")).toBe(false);
    expect(isConfirmationText("Apply now to join our team")).toBe(false);
  });
});

describe("signal fusion", () => {
  it("never marks applied on a single signal", () => {
    // A lone click usually just opens a modal, so it must not be enough.
    expect(evaluateApplicationSignals([signal("intent_click")], at).applied).toBe(false);
    expect(evaluateApplicationSignals([signal("network_post")], at).applied).toBe(false);
  });

  it("marks applied when two independent signals agree", () => {
    const verdict = evaluateApplicationSignals([signal("intent_click"), signal("network_post")], at);
    expect(verdict.applied).toBe(true);
    expect(verdict.confidence).toBeGreaterThanOrEqual(APPLICATION_CONFIDENCE_THRESHOLD);
  });

  it("counts each kind once, so repeats cannot inflate confidence", () => {
    const verdict = evaluateApplicationSignals(
      [signal("intent_click", 3), signal("intent_click", 2), signal("intent_click", 1)],
      at,
    );
    expect(verdict.applied).toBe(false);
    expect(verdict.signals).toHaveLength(1);
  });

  it("ignores stale signals from an earlier attempt", () => {
    const verdict = evaluateApplicationSignals(
      [signal("intent_click", SIGNAL_WINDOW_MS + 1_000), signal("network_post")],
      at,
    );
    expect(verdict.applied).toBe(false);
  });

  it("accepts weak signals only when enough of them combine", () => {
    // Confirmation signals alone are not enough: the back button can reach a
    // confirmation page without a new application being submitted.
    const weak = evaluateApplicationSignals([signal("url_confirmation"), signal("dom_confirmation")], at);
    expect(weak.applied).toBe(false);

    const withSubmit = evaluateApplicationSignals(
      [signal("form_submit"), signal("url_confirmation"), signal("dom_confirmation")],
      at,
    );
    expect(withSubmit.applied).toBe(true);
  });
});
