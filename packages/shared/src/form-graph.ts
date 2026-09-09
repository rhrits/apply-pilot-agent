/** Pure, serializable model for a read-only application-form inspection. */

import type { FieldElementType, FieldKind, QuestionSource } from "./types";

export type FormControlType = FieldElementType | "file" | "combobox" | "listbox";
export type ResolutionSource = "profile" | "answer_library" | "ai" | "user" | "none";
export type ResolutionState = "resolved" | "unknown" | "blocked";

export interface FieldOption {
  label: string;
  value?: string;
  selected: boolean;
  disabled: boolean;
}

export interface FieldDescriptor {
  id: string;
  selector: string;
  shadowPath: string[];
  frameId: number;
  elementType: FormControlType;
  inputType?: string;
  role?: string;
  label: string;
  question: string;
  questionSource: QuestionSource;
  questionConfidence: number;
  kind: FieldKind;
  name?: string;
  placeholder?: string;
  ariaLabel?: string;
  nearbyText?: string;
  currentValue: string | string[] | null;
  options: FieldOption[];
  required: boolean;
  disabled: boolean;
  visible: boolean;
  format?: {
    inputMode?: string;
    pattern?: string;
    min?: string;
    max?: string;
    maxLength?: number;
  };
}

export interface FieldResolution {
  state: ResolutionState;
  value: string | string[] | null;
  source: ResolutionSource;
  confidence: number;
  needsReview: boolean;
  reason?: string;
  missingFacts?: string[];
}

export interface InspectedField {
  descriptor: FieldDescriptor;
  resolution: FieldResolution;
}

export type ValidationSource = "native_validity" | "aria_invalid" | "role_alert" | "inline_text" | "network";

export interface FormValidationError {
  id: string;
  fieldId?: string;
  message: string;
  source: ValidationSource;
  severity: "error" | "warning";
  frameId: number;
  selector?: string;
}

export interface ButtonDescriptor {
  label: string;
  selector: string;
  frameId: number;
  disabled: boolean;
  visible: boolean;
  type?: string;
  role?: string;
  tagName?: "button" | "input";
  shadowPath?: string[];
  documentToken?: string;
  formFingerprint?: string;
  ariaDisabled?: boolean;
}

export interface NavAction {
  kind: "next" | "review" | "submit" | "none";
  label?: string;
  selector?: string;
  frameId?: number;
  disabled?: boolean;
  confidence: number;
  tagName?: "button" | "input";
  type?: string;
  role?: string;
  shadowPath?: string[];
  documentToken?: string;
  formFingerprint?: string;
  ariaDisabled?: boolean;
}

export type FormBlockerKind =
  | "unknown_required_field"
  | "unavailable_frame"
  | "closed_shadow_root"
  | "unsupported_control"
  | "captcha"
  | "validation_error";

export interface FormBlocker {
  kind: FormBlockerKind;
  detail: string;
  fieldId?: string;
  frameId?: number;
}

export interface FrameDescriptor {
  frameId: number;
  parentFrameId: number;
  url: string;
  origin: string;
  status: "scanned" | "unavailable";
  fieldCount: number;
  error?: string;
  documentToken?: string;
}

export interface FormStepSnapshot {
  stepIndex: number;
  stepKey: string;
  heading?: string;
  url: string;
  frames: FrameDescriptor[];
  fields: InspectedField[];
  fieldSignature: string;
  validationErrors: FormValidationError[];
  navAction: NavAction;
  blockers: FormBlocker[];
  capturedAt: number;
}

export interface FormPlanSummary {
  total: number;
  resolved: number;
  unknown: number;
  blocked: number;
  requiredUnknown: number;
  lowConfidence: number;
}

function normalized(value: unknown): string {
  return String(value ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Stable, non-cryptographic digest used only to detect whether a form step changed. */
function digest(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function fieldSignature(fields: Array<FieldDescriptor | InspectedField>): string {
  const canonical = fields
    .map((entry) => "descriptor" in entry ? entry.descriptor : entry)
    .map((field) => [field.frameId, field.selector, normalized(field.question), field.elementType, field.required ? "1" : "0"].join("|"))
    .sort()
    .join("\n");
  return digest(canonical);
}

const SUBMIT_DENY = /save( and)? (continue|exit)|save draft|add another|search|sign in|log in|upload|preview/i;
const SUBMIT = /^(submit( application)?|send application|apply now|complete application|finish application)$/i;
const REVIEW = /^(review( application)?|preview application|review and submit)$/i;
const NEXT = /^(next|continue|save and continue|proceed|next step)$/i;

/** Classifies navigation controls without granting any click capability. */
export function classifyNavAction(buttons: ButtonDescriptor[]): NavAction {
  const usable = buttons.filter((button) => button.visible && !SUBMIT_DENY.test(button.label.trim()));
  const choose = (pattern: RegExp, kind: NavAction["kind"], confidence: number): NavAction | null => {
    const button = usable.find((candidate) => pattern.test(candidate.label.trim()));
    return button ? { kind, label: button.label, selector: button.selector, frameId: button.frameId, disabled: button.disabled, confidence, tagName: button.tagName, type: button.type, role: button.role, shadowPath: button.shadowPath, documentToken: button.documentToken, formFingerprint: button.formFingerprint, ariaDisabled: button.ariaDisabled } : null;
  };
  return choose(SUBMIT, "submit", 0.98)
    ?? choose(REVIEW, "review", 0.95)
    ?? choose(NEXT, "next", 0.9)
    ?? { kind: "none", confidence: 0 };
}

export function summarizeFormPlan(fields: InspectedField[]): FormPlanSummary {
  return fields.reduce<FormPlanSummary>((summary, field) => {
    summary.total += 1;
    summary[field.resolution.state] += 1;
    if (field.descriptor.required && field.resolution.state !== "resolved") summary.requiredUnknown += 1;
    if (field.resolution.confidence > 0 && field.resolution.confidence < 0.8) summary.lowConfidence += 1;
    return summary;
  }, { total: 0, resolved: 0, unknown: 0, blocked: 0, requiredUnknown: 0, lowConfidence: 0 });
}

export function blockersForFields(fields: InspectedField[], validationErrors: FormValidationError[] = []): FormBlocker[] {
  const blockers: FormBlocker[] = fields
    .filter((field) => field.descriptor.required && field.resolution.state !== "resolved")
    .map((field) => ({ kind: "unknown_required_field", detail: `Required answer missing: ${field.descriptor.question || field.descriptor.label}`, fieldId: field.descriptor.id, frameId: field.descriptor.frameId }));
  blockers.push(...validationErrors.map((error) => ({ kind: "validation_error" as const, detail: error.message, fieldId: error.fieldId, frameId: error.frameId })));
  return blockers;
}
