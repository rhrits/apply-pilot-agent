/** Pure state and safety rules for Phase C multi-step navigation. */

import type { FormBlocker, FormStepSnapshot } from "@uplyfox/shared";

export type ApplicationSessionStatus =
  | "observing" | "filling" | "waiting_for_transition" | "awaiting_user"
  | "blocked" | "stalled" | "timed_out" | "max_steps" | "cancelled" | "complete";

export interface StepIdentity {
  url: string;
  heading: string;
  fieldSignature: string;
  stepMarker: string;
}

export interface ApplicationSession {
  sessionId: string;
  tabId: number;
  startedAt: number;
  deadlineAt: number;
  status: ApplicationSessionStatus;
  atsId: string | null;
  stepIndex: number;
  maxSteps: number;
  currentStep: FormStepSnapshot | null;
  steps: FormStepSnapshot[];
  lastIdentity: StepIdentity | null;
  blockers: FormBlocker[];
  terminalReason?: string;
}

export const SESSION_LIMITS = {
  maxSteps: 12,
  maxWallClockMs: 5 * 60_000,
  transitionTimeoutMs: 6_000,
  settleIntervalMs: 250,
  maxClickAttempts: 1,
} as const;

export function createApplicationSession(tabId: number, now = Date.now()): ApplicationSession {
  return { sessionId: crypto.randomUUID(), tabId, startedAt: now, deadlineAt: now + SESSION_LIMITS.maxWallClockMs, status: "observing", atsId: null, stepIndex: 0, maxSteps: SESSION_LIMITS.maxSteps, currentStep: null, steps: [], lastIdentity: null, blockers: [] };
}

export function snapshotIdentity(snapshot: FormStepSnapshot, stepMarker = ""): StepIdentity {
  return { url: snapshot.url, heading: snapshot.heading ?? "", fieldSignature: snapshot.fieldSignature, stepMarker };
}

/** Transition succeeds on any independent step signal; URL change is not required. */
export function didStepTransition(before: StepIdentity, after: StepIdentity): boolean {
  return before.url !== after.url
    || before.heading !== after.heading
    || before.fieldSignature !== after.fieldSignature
    || Boolean(after.stepMarker && before.stepMarker !== after.stepMarker);
}

export function stopReasonForSnapshot(snapshot: FormStepSnapshot): string | null {
  if (snapshot.blockers.some((blocker) => blocker.kind === "captcha")) return "Human verification detected. Solve it manually, then continue.";
  if (snapshot.blockers.some((blocker) => blocker.kind === "unavailable_frame")) return "An embedded frame could not be inspected. Continue manually so no required field is missed.";
  if (snapshot.blockers.some((blocker) => blocker.kind === "unsupported_control" || blocker.kind === "closed_shadow_root")) return "This step contains an unsupported control that needs manual review.";
  const required = snapshot.blockers.filter((blocker) => blocker.kind === "unknown_required_field");
  if (required.length) return `${required.length} required field${required.length === 1 ? " needs" : "s need"} a manual answer.`;
  if (snapshot.validationErrors.length) return "The page has validation errors that need review.";
  if (snapshot.navAction.kind === "submit") return "Final submit step reached. Review is required before submission.";
  if (snapshot.navAction.kind === "review") return "Review step reached. Phase C stops before review or submission.";
  return null;
}

export function sessionCanContinue(session: ApplicationSession, now = Date.now()): { ok: true } | { ok: false; status: ApplicationSessionStatus; reason: string } {
  if (now >= session.deadlineAt) return { ok: false, status: "timed_out", reason: "The five-minute session limit was reached." };
  if (session.stepIndex >= session.maxSteps) return { ok: false, status: "max_steps", reason: `Stopped after ${session.maxSteps} steps.` };
  if (session.status === "cancelled") return { ok: false, status: "cancelled", reason: "Session cancelled." };
  return { ok: true };
}
