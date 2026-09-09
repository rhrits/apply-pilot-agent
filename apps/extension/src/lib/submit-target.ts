import type { SubmitTargetDescriptor } from "@uplyfox/shared";

export interface SubmitTargetObservation {
  documentToken: string;
  matchCount: number;
  label?: string;
  tagName?: string;
  type?: string;
  role?: string;
  formFingerprint?: string;
  disabled?: boolean;
  ariaDisabled?: boolean;
  visible?: boolean;
  connected?: boolean;
}

export function validateSubmitTarget(target: SubmitTargetDescriptor, observed: SubmitTargetObservation): { ok: true } | { ok: false; reason: string } {
  if (target.documentToken !== observed.documentToken) return { ok: false, reason: "stale_document" };
  if (observed.matchCount !== 1) return { ok: false, reason: "target_count_changed" };
  if (target.label !== observed.label || target.tagName !== observed.tagName || target.type !== observed.type || (target.role ?? "") !== (observed.role ?? "") || target.formFingerprint !== observed.formFingerprint) return { ok: false, reason: "target_identity_changed" };
  if (target.disabled || target.ariaDisabled || observed.disabled || observed.ariaDisabled || !observed.visible || !observed.connected) return { ok: false, reason: "target_unavailable" };
  if (target.type !== "submit" || !/^(submit( application)?|send application|apply now|complete application|finish application)$/i.test(target.label)) return { ok: false, reason: "not_reviewed_submit" };
  return { ok: true };
}
