import { describe, expect, it } from "vitest";
import { blockersForFields, classifyNavAction, fieldSignature, summarizeFormPlan, type ButtonDescriptor, type FieldDescriptor, type InspectedField } from "@uplyfox/shared";

function descriptor(overrides: Partial<FieldDescriptor> = {}): FieldDescriptor {
  return {
    id: "f0:#email:0", selector: "#email", shadowPath: [], frameId: 0,
    elementType: "input", inputType: "email", role: "textbox", label: "Email",
    question: "Email address", questionSource: "label", questionConfidence: 0.99,
    kind: "email", currentValue: null, options: [], required: true, disabled: false, visible: true,
    ...overrides,
  };
}

function inspected(state: "resolved" | "unknown" | "blocked", overrides: Partial<FieldDescriptor> = {}): InspectedField {
  return {
    descriptor: descriptor(overrides),
    resolution: { state, value: state === "resolved" ? "ada@example.com" : null, source: state === "resolved" ? "profile" : "none", confidence: state === "resolved" ? 0.95 : 0, needsReview: state !== "resolved" },
  };
}

function button(label: string, overrides: Partial<ButtonDescriptor> = {}): ButtonDescriptor {
  return { label, selector: `#${label.toLowerCase().replace(/\s+/g, "-")}`, frameId: 0, disabled: false, visible: true, ...overrides };
}

describe("form graph", () => {
  it("generates the same signature regardless of DOM enumeration order", () => {
    const a = descriptor();
    const b = descriptor({ id: "f1", selector: "#phone", question: "Phone" });
    expect(fieldSignature([a, b])).toBe(fieldSignature([b, a]));
  });

  it("changes signature when the wizard exposes a new field", () => {
    const before = [descriptor()];
    const after = [...before, descriptor({ id: "f1", selector: "#phone", question: "Phone" })];
    expect(fieldSignature(before)).not.toBe(fieldSignature(after));
  });

  it("does not change signature merely because proposed answers changed", () => {
    const first = inspected("resolved");
    const second = { ...first, resolution: { ...first.resolution, value: "other@example.com" } };
    expect(fieldSignature([first])).toBe(fieldSignature([second]));
  });

  it("classifies submit ahead of next when both are visible", () => {
    expect(classifyNavAction([button("Continue"), button("Submit application")]).kind).toBe("submit");
  });

  it("does not mistake Save draft or Sign in for navigation", () => {
    expect(classifyNavAction([button("Save draft"), button("Sign in")]).kind).toBe("none");
  });

  it("reports a disabled submit without pretending it is actionable", () => {
    const result = classifyNavAction([button("Submit application", { disabled: true })]);
    expect(result.kind).toBe("submit");
    expect(result.disabled).toBe(true);
  });

  it("summarizes each resolution state and required unknowns", () => {
    const fields = [
      inspected("resolved"),
      inspected("unknown", { id: "u", selector: "#unknown" }),
      inspected("blocked", { id: "b", selector: "#blocked", required: false }),
    ];
    expect(summarizeFormPlan(fields)).toEqual({ total: 3, resolved: 1, unknown: 1, blocked: 1, requiredUnknown: 1, lowConfidence: 0 });
  });

  it("creates a blocker only for unresolved required fields", () => {
    const fields = [
      inspected("resolved"),
      inspected("unknown", { id: "optional", selector: "#optional", required: false }),
      inspected("unknown", { id: "required", selector: "#required", question: "Security clearance" }),
    ];
    const blockers = blockersForFields(fields);
    expect(blockers).toHaveLength(1);
    expect(blockers[0].fieldId).toBe("required");
    expect(blockers[0].detail).toContain("Security clearance");
  });

  it("promotes existing validation errors to blockers", () => {
    const blockers = blockersForFields([], [{ id: "v1", message: "Enter a valid phone", source: "native_validity", severity: "error", frameId: 2 }]);
    expect(blockers).toEqual([{ kind: "validation_error", detail: "Enter a valid phone", fieldId: undefined, frameId: 2 }]);
  });
});
