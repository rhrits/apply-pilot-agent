import { describe, expect, it } from "vitest";
import { validateSubmitTarget, type SubmitTargetObservation } from "./submit-target";
import type { SubmitTargetDescriptor } from "@uplyfox/shared";

const target: SubmitTargetDescriptor = { label: "Submit application", frameId: 0, selector: "#submit", shadowPath: [], documentToken: "doc-1", tagName: "button", type: "submit", disabled: false, ariaDisabled: false, formFingerprint: "#form" };
const observed: SubmitTargetObservation = { documentToken: "doc-1", matchCount: 1, label: "Submit application", tagName: "button", type: "submit", role: undefined, formFingerprint: "#form", disabled: false, ariaDisabled: false, visible: true, connected: true };

describe("exact reviewed submit target", () => {
  it("accepts only an exact unchanged target", () => expect(validateSubmitTarget(target, observed)).toEqual({ ok: true }));
  it("rejects a new document using the same frame id", () => expect(validateSubmitTarget(target, { ...observed, documentToken: "doc-2" })).toMatchObject({ ok: false, reason: "stale_document" }));
  it("rejects zero or multiple selector matches", () => {
    expect(validateSubmitTarget(target, { ...observed, matchCount: 0 })).toMatchObject({ ok: false });
    expect(validateSubmitTarget(target, { ...observed, matchCount: 2 })).toMatchObject({ ok: false });
  });
  it("rejects changed label, type, role, or form association", () => {
    for (const changed of [{ label: "Next" }, { type: "button" }, { role: "menuitem" }, { formFingerprint: "#other" }]) expect(validateSubmitTarget(target, { ...observed, ...changed })).toMatchObject({ ok: false, reason: "target_identity_changed" });
  });
  it("rejects hidden, detached, disabled, or aria-disabled targets", () => {
    for (const changed of [{ visible: false }, { connected: false }, { disabled: true }, { ariaDisabled: true }]) expect(validateSubmitTarget(target, { ...observed, ...changed })).toMatchObject({ ok: false, reason: "target_unavailable" });
  });
  it("rejects a target whose approved label is not explicit submit semantics", () => expect(validateSubmitTarget({ ...target, label: "Continue" }, { ...observed, label: "Continue" })).toMatchObject({ ok: false, reason: "not_reviewed_submit" }));
});
