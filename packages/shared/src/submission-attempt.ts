/** Attempt-specific confirmation model for an approved submission. */

export type SubmissionSignalKind = "target_click" | "form_submit" | "network_success" | "network_failure" | "confirmation_url" | "confirmation_dom" | "application_id" | "validation_error" | "captcha";

export interface SubmissionSignal {
  kind: SubmissionSignalKind;
  at: number;
  detail?: string;
  frameId?: number;
  documentToken?: string;
}

export interface SubmissionAttempt {
  attemptId: string;
  sessionId: string;
  draftId: string;
  tabId: number;
  frameId: number;
  snapshotHash: string;
  startedAt: number;
  deadlineAt: number;
  status: "armed" | "clicked" | "confirmed" | "unknown" | "failed";
  signals: SubmissionSignal[];
  errorReason?: string;
  applicationId?: string;
}

export const SUBMISSION_CONFIRMATION_WINDOW_MS = 30_000;

export interface SubmissionVerdict {
  outcome: "pending" | "confirmed" | "unknown" | "failed";
  reason: string;
  signals: SubmissionSignal[];
  applicationId?: string;
}

/**
 * Confirmation requires the exact click plus two independent post-click result signals.
 * A submit event alone is intent, not success. Explicit failure always wins.
 */
export function evaluateSubmissionAttempt(attempt: SubmissionAttempt, now = Date.now()): SubmissionVerdict {
  const signals = attempt.signals.filter((signal) => signal.at >= attempt.startedAt && signal.at <= attempt.deadlineAt);
  const failure = signals.find((signal) => signal.kind === "network_failure" || signal.kind === "validation_error" || signal.kind === "captcha");
  if (failure) return { outcome: "failed", reason: failure.detail || "The application page reported a submission failure.", signals };
  const click = signals.find((signal) => signal.kind === "target_click");
  const postClick = click ? signals.filter((signal) => signal.at >= click.at) : [];
  const resultKinds = new Set(postClick.filter((signal) => ["network_success", "confirmation_url", "confirmation_dom", "application_id"].includes(signal.kind)).map((signal) => signal.kind));
  const strong = resultKinds.has("network_success") || resultKinds.has("confirmation_url") || resultKinds.has("confirmation_dom") || resultKinds.has("application_id");
  const applicationId = postClick.find((signal) => signal.kind === "application_id")?.detail;
  if (click && strong && resultKinds.size >= 2) return { outcome: "confirmed", reason: "Submission confirmed by independent page signals.", signals, applicationId };
  if (now >= attempt.deadlineAt) return { outcome: "unknown", reason: "The submit click occurred, but success could not be proven before the confirmation deadline.", signals };
  return { outcome: "pending", reason: "Waiting for independent confirmation signals.", signals };
}
