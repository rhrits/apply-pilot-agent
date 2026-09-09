/** Immutable pre-submit draft and approval contracts. */

import { isHardStopQuestion } from "./field-resolution";
import type { FormBlocker, FormStepSnapshot, FormValidationError, ResolutionSource } from "./form-graph";

export interface SnapshotAnswer {
  fieldId: string;
  question: string;
  value: string | string[] | null;
  source: ResolutionSource;
  confidence: number;
  needsReview: boolean;
  sensitive: boolean;
  redacted: boolean;
  blankReason?: string;
  frameId: number;
}

export interface SnapshotStep {
  index: number;
  stepKey: string;
  heading?: string;
  url: string;
  answers: SnapshotAnswer[];
  validationErrors: FormValidationError[];
  blockers: FormBlocker[];
  capturedAt: string;
}

export interface SnapshotFrame {
  frameId: number;
  parentFrameId: number;
  origin: string;
  html: string | null;
  htmlSha256?: string;
  status: "captured" | "unavailable";
  redactions: string[];
}

export interface PreSubmitSnapshot {
  version: 1;
  sessionId: string;
  stepIndex: number;
  job: { title: string; company: string; url: string; hostname: string };
  steps: SnapshotStep[];
  frames: SnapshotFrame[];
  blankFields: SnapshotAnswer[];
  resume?: { fileName: string };
  submitTarget?: { label: string; frameId: number; selector: string };
  screenshotPath?: string;
  screenshotSha256?: string;
  redactionVersion: "v1";
  snapshotHash: string;
  capturedAt: string;
}

export interface ApprovalGrant {
  token: string;
  sessionId: string;
  draftId: string;
  stepIndex: number;
  snapshotHash: string;
  issuedAt: number;
  expiresAt: number;
  consumedAt?: number;
}

export const APPROVAL_TTL_MS = 10 * 60_000;

const SECRET = /password|current-password|new-password|one-time-code|\botp\b|token|secret|api[-_ ]?key|access[-_ ]?token|client[-_ ]?secret|authorization|cookie|session|csrf|xsrf|\bssn\b|social security|tax[-_ ]?id|bank|routing|account[-_ ]?number|credit[-_ ]?card|card[-_ ]?number|\bcvc\b|\bcvv\b|\bpin\b/i;

export function isSecretLike(value: string): boolean {
  return SECRET.test(value);
}

export function snapshotStep(step: FormStepSnapshot): SnapshotStep {
  const answers = step.fields.map(({ descriptor, resolution }): SnapshotAnswer => {
    const identity = `${descriptor.question} ${descriptor.label} ${descriptor.name ?? ""} ${descriptor.inputType ?? ""} ${descriptor.role ?? ""}`;
    const redacted = descriptor.inputType === "password" || descriptor.inputType === "hidden" || descriptor.inputType === "file" || isSecretLike(identity);
    const sensitive = isHardStopQuestion(identity);
    const rawValue = descriptor.currentValue ?? resolution.value;
    return {
      fieldId: descriptor.id,
      question: descriptor.question || descriptor.label,
      value: redacted ? null : rawValue,
      source: resolution.source,
      confidence: resolution.confidence,
      needsReview: resolution.needsReview || sensitive,
      sensitive,
      redacted,
      blankReason: redacted ? "Sensitive value redacted." : rawValue == null || rawValue === "" ? resolution.reason ?? "No answer." : undefined,
      frameId: descriptor.frameId,
    };
  });
  return { index: step.stepIndex, stepKey: step.stepKey, heading: step.heading, url: step.url, answers, validationErrors: step.validationErrors, blockers: step.blockers, capturedAt: new Date(step.capturedAt).toISOString() };
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([key]) => key !== "snapshotHash" && key !== "screenshotPath").sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonicalize(item)]));
  return value;
}

export async function sha256(value: string | Uint8Array): Promise<string> {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  const hash = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(hash)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function computeSnapshotHash(snapshot: Omit<PreSubmitSnapshot, "snapshotHash"> | PreSubmitSnapshot): Promise<string> {
  return sha256(JSON.stringify(canonicalize(snapshot)));
}

export function createApprovalGrant(input: { sessionId: string; draftId: string; stepIndex: number; snapshotHash: string }, now = Date.now()): ApprovalGrant {
  return { ...input, token: crypto.randomUUID(), issuedAt: now, expiresAt: now + APPROVAL_TTL_MS };
}

export function approvalMatches(grant: ApprovalGrant, input: { sessionId: string; draftId: string; stepIndex: number; snapshotHash: string }, now = Date.now()): boolean {
  return !grant.consumedAt && now < grant.expiresAt && grant.sessionId === input.sessionId && grant.draftId === input.draftId && grant.stepIndex === input.stepIndex && grant.snapshotHash === input.snapshotHash;
}
