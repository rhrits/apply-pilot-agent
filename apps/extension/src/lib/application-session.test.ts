import { describe, expect, it } from "vitest";
import { createApplicationSession, didStepTransition, sessionCanContinue, snapshotIdentity, stopReasonForSnapshot, type StepIdentity } from "./application-session";
import type { FormStepSnapshot } from "@uplyfox/shared";

function identity(overrides: Partial<StepIdentity> = {}): StepIdentity {
  return { url: "https://example.com/apply", heading: "Contact", fieldSignature: "abc", stepMarker: "1 of 3", ...overrides };
}

function snapshot(overrides: Partial<FormStepSnapshot> = {}): FormStepSnapshot {
  return { stepIndex: 0, stepKey: "s", heading: "Contact", url: "https://example.com/apply", frames: [], fields: [], fieldSignature: "abc", validationErrors: [], navAction: { kind: "next", label: "Next", confidence: .9 }, blockers: [], capturedAt: 1, ...overrides };
}

describe("application session", () => {
  it("detects URL, heading, field-signature, or step-marker transitions", () => {
    const before = identity();
    expect(didStepTransition(before, identity({ url: "https://example.com/apply/2" }))).toBe(true);
    expect(didStepTransition(before, identity({ heading: "Experience" }))).toBe(true);
    expect(didStepTransition(before, identity({ fieldSignature: "def" }))).toBe(true);
    expect(didStepTransition(before, identity({ stepMarker: "2 of 3" }))).toBe(true);
    expect(didStepTransition(before, identity())).toBe(false);
  });

  it("stops at review and submit controls", () => {
    expect(stopReasonForSnapshot(snapshot({ navAction: { kind: "review", label: "Review", confidence: .95 } }))).toMatch(/Review step/);
    expect(stopReasonForSnapshot(snapshot({ navAction: { kind: "submit", label: "Submit application", confidence: .98 } }))).toMatch(/Final submit/);
  });

  it("stops on CAPTCHA, validation, unknown required fields, and unavailable frames", () => {
    expect(stopReasonForSnapshot(snapshot({ blockers: [{ kind: "captcha", detail: "captcha" }] }))).toMatch(/Human verification/);
    expect(stopReasonForSnapshot(snapshot({ validationErrors: [{ id: "v", message: "Required", source: "native_validity", severity: "error", frameId: 0 }] }))).toMatch(/validation/);
    expect(stopReasonForSnapshot(snapshot({ blockers: [{ kind: "unknown_required_field", detail: "missing" }] }))).toMatch(/required field/);
    expect(stopReasonForSnapshot(snapshot({ blockers: [{ kind: "unavailable_frame", detail: "frame" }] }))).toMatch(/frame/);
  });

  it("enforces wall-clock and step limits", () => {
    const session = createApplicationSession(5, 1000);
    expect(sessionCanContinue(session, session.deadlineAt)).toMatchObject({ ok: false, status: "timed_out" });
    expect(sessionCanContinue({ ...session, stepIndex: session.maxSteps }, 1001)).toMatchObject({ ok: false, status: "max_steps" });
  });

  it("copies snapshot identity without answer values", () => {
    expect(snapshotIdentity(snapshot(), "step-1")).toEqual({ url: "https://example.com/apply", heading: "Contact", fieldSignature: "abc", stepMarker: "step-1" });
  });
});
