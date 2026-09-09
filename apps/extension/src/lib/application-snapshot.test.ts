import { describe, expect, it } from "vitest";
import { approvalMatches, computeSnapshotHash, createApprovalGrant, isSecretLike, snapshotStep, type FormStepSnapshot, type PreSubmitSnapshot } from "@uplyfox/shared";

function step(): FormStepSnapshot {
  return {
    stepIndex: 1, stepKey: "step-1", heading: "Account", url: "https://example.com/apply",
    frames: [], fieldSignature: "sig", validationErrors: [], blockers: [], navAction: { kind: "submit", label: "Submit", selector: "#submit", frameId: 0, confidence: .98 }, capturedAt: Date.parse("2026-09-09T12:00:00Z"),
    fields: [
      { descriptor: { id: "email", selector: "#email", shadowPath: [], frameId: 0, elementType: "input", inputType: "email", label: "Email", question: "Email", questionSource: "label", questionConfidence: .99, kind: "email", currentValue: "ada@example.com", options: [], required: true, disabled: false, visible: true }, resolution: { state: "resolved", value: "ada@example.com", source: "user", confidence: 1, needsReview: false } },
      { descriptor: { id: "password", selector: "#password", shadowPath: [], frameId: 0, elementType: "input", inputType: "password", label: "Password", question: "Password", questionSource: "label", questionConfidence: .99, kind: "unknown", currentValue: "never-store-this", options: [], required: true, disabled: false, visible: true }, resolution: { state: "resolved", value: "never-store-this", source: "user", confidence: 1, needsReview: false } },
      { descriptor: { id: "token", selector: "#token", shadowPath: [], frameId: 0, elementType: "input", inputType: "text", name: "csrf_token", label: "Code", question: "Code", questionSource: "label", questionConfidence: .5, kind: "unknown", currentValue: "secret-token", options: [], required: false, disabled: false, visible: false }, resolution: { state: "resolved", value: "secret-token", source: "user", confidence: 1, needsReview: false } },
    ],
  };
}

function snapshot(hash = ""): PreSubmitSnapshot {
  const captured = snapshotStep(step());
  return { version: 1, sessionId: "session", stepIndex: 1, job: { title: "Engineer", company: "Acme", url: "https://example.com/apply", hostname: "example.com" }, steps: [captured], frames: [], blankFields: captured.answers.filter((answer) => answer.value == null), submitTarget: { label: "Submit", frameId: 0, selector: "#submit" }, redactionVersion: "v1", snapshotHash: hash, capturedAt: "2026-09-09T12:00:00.000Z" };
}

describe("application snapshot", () => {
  it("redacts password and secret-like fields while preserving ordinary answers", () => {
    const captured = snapshotStep(step());
    expect(captured.answers.find((answer) => answer.fieldId === "email")?.value).toBe("ada@example.com");
    for (const id of ["password", "token"]) {
      const answer = captured.answers.find((item) => item.fieldId === id)!;
      expect(answer.redacted).toBe(true);
      expect(answer.value).toBeNull();
    }
  });

  it("recognizes common secret-bearing field names", () => {
    for (const name of ["csrf_token", "one-time-code", "client-secret", "routing number", "card CVV"]) expect(isSecretLike(name), name).toBe(true);
    expect(isSecretLike("Current company")).toBe(false);
  });

  it("produces the same hash regardless of object key insertion order", async () => {
    const first = snapshot();
    const reordered = { ...first, job: { hostname: "example.com", url: "https://example.com/apply", company: "Acme", title: "Engineer" } };
    expect(await computeSnapshotHash(first)).toBe(await computeSnapshotHash(reordered as PreSubmitSnapshot));
  });

  it("changes the hash when an approved answer changes", async () => {
    const first = snapshot();
    const changed = snapshot();
    changed.steps[0].answers[0].value = "other@example.com";
    expect(await computeSnapshotHash(first)).not.toBe(await computeSnapshotHash(changed));
  });

  it("does not include storage paths in the approval hash", async () => {
    const first = snapshot();
    const uploaded = { ...first, screenshotPath: "user/session/draft.png" };
    expect(await computeSnapshotHash(first)).toBe(await computeSnapshotHash(uploaded));
  });

  it("binds approval to session, draft, step and hash", () => {
    const grant = createApprovalGrant({ sessionId: "s", draftId: "d", stepIndex: 2, snapshotHash: "h" }, 1000);
    expect(approvalMatches(grant, { sessionId: "s", draftId: "d", stepIndex: 2, snapshotHash: "h" }, 1001)).toBe(true);
    expect(approvalMatches(grant, { sessionId: "s", draftId: "d", stepIndex: 3, snapshotHash: "h" }, 1001)).toBe(false);
    expect(approvalMatches(grant, { sessionId: "s", draftId: "d", stepIndex: 2, snapshotHash: "changed" }, 1001)).toBe(false);
  });

  it("rejects expired and consumed approval grants", () => {
    const grant = createApprovalGrant({ sessionId: "s", draftId: "d", stepIndex: 2, snapshotHash: "h" }, 1000);
    expect(approvalMatches(grant, { sessionId: "s", draftId: "d", stepIndex: 2, snapshotHash: "h" }, grant.expiresAt)).toBe(false);
    expect(approvalMatches({ ...grant, consumedAt: 2000 }, { sessionId: "s", draftId: "d", stepIndex: 2, snapshotHash: "h" }, 1500)).toBe(false);
  });
});
