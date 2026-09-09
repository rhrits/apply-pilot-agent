import type { ApplicationSignal, ApplicationSignalKind, ApplicationVerdict } from "./types";

/**
 * Application-submission detection.
 *
 * A tracker only stays accurate if it fills itself. Asking someone to remember to mark
 * "applied" after every submission is exactly the chore this product exists to remove.
 *
 * No single browser signal is trustworthy on its own:
 *
 *  - "Apply" often only opens a modal rather than submitting.
 *  - A `submit` event fires for search and filter forms too.
 *  - A `POST` can be autosave, analytics, or a draft.
 *  - A confirmation URL can be reached by the back button.
 *
 * So signals are scored and fused instead. Crossing the threshold requires evidence
 * from at least two independent sources, which is what keeps a false "applied" —
 * the outcome that actually destroys trust in a tracker — rare.
 */

/**
 * Weight per signal, calibrated so that:
 *  - no single signal can ever reach the threshold on its own;
 *  - two strong, independent signals do (click + request, click + confirmation page);
 *  - a submit plus a confirmation page plus confirmation copy does;
 *  - confirmation signals ALONE do not, because the back button can reach a
 *    confirmation page without a new application being submitted.
 */
const SIGNAL_WEIGHT: Record<ApplicationSignalKind, number> = {
  intent_click: 0.35,
  form_submit: 0.25,
  network_post: 0.35,
  url_confirmation: 0.25,
  dom_confirmation: 0.25,
};

/** Fusion threshold. Reachable only by combining independent signals. */
export const APPLICATION_CONFIDENCE_THRESHOLD = 0.6;

/** Signals older than this are stale — a later click is a separate attempt. */
export const SIGNAL_WINDOW_MS = 90_000;

/** Buttons that submit an application, as opposed to merely opening one. */
const APPLY_INTENT = /^(apply|apply now|apply for this job|submit application|submit|send application|finish( (and|&) submit)?|complete application|continue to apply|i'?m interested)\b/i;

/**
 * Text that means the button only advances a step or opens a form. Checked first so
 * "Apply on company site" or "Save job" can never look like a submission.
 */
const NON_SUBMIT_INTENT = /\b(save|saved|later|bookmark|view|see|learn|read|share|copy|back|cancel|close|search|filter|sort|sign in|log ?in|register|create account|next|previous|upload|browse|attach|add|edit|preview|download|print)\b|apply\s+(on|via|through|with|at)\b/i;

/** Endpoint shapes used by real application submissions. */
const APPLICATION_ENDPOINT = /\/(apply|application|applications|submit|candidate|candidates|job-?application|jobseeker)\b|\/(applications?|apply)\/?(\?|$)/i;

/** Endpoints that fire constantly and must never be read as a submission. */
const NOISE_ENDPOINT = /\b(analytics|telemetry|tracking|beacon|metric|log|event|session|heartbeat|autosave|draft|validate|typeahead|suggest|search|graphql\/?$)\b/i;

const CONFIRMATION_URL = /\/(confirmation|confirmed|thank[-_]?you|thanks|submitted|success|complete[d]?|received)\b/i;

const CONFIRMATION_TEXT = /\b(application (was |has been )?(received|submitted|sent|complete)|thanks? (you )?for (applying|your application)|we('| ha)ve received your application|your application (is|was|has been) (in|received|submitted)|successfully applied|application submitted)\b/i;

/** Recognizes a submit-intent button by its accessible name. */
export function isApplyIntentText(value: string): boolean {
  const text = value.replace(/\s+/g, " ").trim();
  if (!text || text.length > 60) return false;
  if (NON_SUBMIT_INTENT.test(text)) return false;
  return APPLY_INTENT.test(text);
}

/** True when a request looks like an application submission rather than page noise. */
export function isApplicationRequest(method: string, url: string, status?: number): boolean {
  if (!/^(POST|PUT|PATCH)$/i.test(method)) return false;
  if (typeof status === "number" && (status < 200 || status >= 400)) return false;
  if (NOISE_ENDPOINT.test(url)) return false;
  return APPLICATION_ENDPOINT.test(url);
}

export function isConfirmationUrl(url: string): boolean {
  return CONFIRMATION_URL.test(url);
}

export function isConfirmationText(value: string): boolean {
  return CONFIRMATION_TEXT.test(value.replace(/\s+/g, " ").trim());
}

/**
 * Fuses recent signals into a verdict.
 *
 * Each kind contributes once — ten clicks are still one click's worth of evidence —
 * and two distinct kinds are required, so no single noisy source can trigger a change.
 */
export function evaluateApplicationSignals(signals: ApplicationSignal[], now = Date.now()): ApplicationVerdict {
  const recent = signals.filter((signal) => now - signal.at <= SIGNAL_WINDOW_MS);

  const strongest = new Map<ApplicationSignalKind, ApplicationSignal>();
  for (const signal of recent) {
    const existing = strongest.get(signal.kind);
    if (!existing || signal.at > existing.at) strongest.set(signal.kind, signal);
  }

  const contributing = [...strongest.values()];
  const confidence = contributing.reduce((total, signal) => total + SIGNAL_WEIGHT[signal.kind], 0);
  const rounded = Math.min(1, Math.round(confidence * 100) / 100);

  return {
    applied: contributing.length >= 2 && rounded >= APPLICATION_CONFIDENCE_THRESHOLD,
    confidence: rounded,
    signals: contributing.sort((a, b) => a.at - b.at),
  };
}

/** Human-readable evidence for the Undo toast, so the decision is never opaque. */
export function describeApplicationSignals(signals: ApplicationSignal[]): string {
  const labels: Record<ApplicationSignalKind, string> = {
    intent_click: "clicked apply",
    form_submit: "submitted the form",
    network_post: "application request sent",
    url_confirmation: "confirmation page",
    dom_confirmation: "confirmation message",
  };
  const seen = [...new Set(signals.map((signal) => signal.kind))];
  return seen.map((kind) => labels[kind]).join(" · ");
}
