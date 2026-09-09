/**
 * Content-script half of the application-submission detector.
 *
 * Collects independent observations that the user actually submitted an application —
 * rather than merely opening one — and asks the shared fusion logic whether they
 * amount to enough evidence. Only when the threshold is crossed is the background
 * worker told to move the tracked job from "saved" to "applied".
 *
 * Nothing here submits, blocks, or alters the page. It only observes.
 */

import {
  evaluateApplicationSignals,
  isApplyIntentText,
  isConfirmationText,
  isConfirmationUrl,
  type ApplicationSignal,
  type ApplicationSignalKind,
} from "@uplyfox/shared";
import { NETWORK_SIGNAL_SOURCE } from "./network-channel";

const signals: ApplicationSignal[] = [];

/** Guards against re-reporting the same submission as the page settles. */
let reportedForUrl = "";

type Reporter = () => void;
let onApplied: Reporter = () => undefined;

function record(kind: ApplicationSignalKind, detail?: string) {
  signals.push({ kind, detail: detail?.slice(0, 120), at: Date.now() });
  // Keep the buffer small; fusion only ever looks at a recent window anyway.
  if (signals.length > 40) signals.splice(0, signals.length - 40);
  evaluate();
}

function evaluate() {
  const verdict = evaluateApplicationSignals(signals);
  if (!verdict.applied) return;
  const key = location.href.split(/[?#]/)[0];
  if (reportedForUrl === key) return;
  reportedForUrl = key;
  onApplied();
}

/** Returns the verdict for the signals gathered so far. */
export function currentApplicationVerdict() {
  return evaluateApplicationSignals(signals);
}

/**
 * The accessible name of a clicked control. Reads `aria-label` and `value` as well as
 * text, because many submit buttons are `<input type=submit>` or icon-labelled.
 */
function controlName(element: Element): string {
  const control = element.closest("button, input[type=submit], input[type=button], a[role=button], [role=button]");
  if (!control) return "";
  const aria = control.getAttribute("aria-label");
  if (aria?.trim()) return aria.trim();
  if (control instanceof HTMLInputElement && control.value.trim()) return control.value.trim();
  return ((control as HTMLElement).innerText || control.textContent || "").replace(/\s+/g, " ").trim();
}

/** Text added to the page after a submission, e.g. "Thanks for applying". */
function scanForConfirmationText(nodes: NodeList) {
  for (const node of Array.from(nodes)) {
    if (!(node instanceof HTMLElement)) continue;
    const text = (node.innerText || node.textContent || "").slice(0, 600);
    if (text && isConfirmationText(text)) {
      record("dom_confirmation", text.slice(0, 90));
      return;
    }
  }
}

export function installApplicationDetector(report: Reporter) {
  onApplied = report;

  // 1. Intent click. Capture phase so it is seen even if the page stops propagation.
  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const name = controlName(target);
    if (name && isApplyIntentText(name)) record("intent_click", name);
  }, true);

  // 2. Form submit.
  document.addEventListener("submit", (event) => {
    const form = event.target;
    if (form instanceof HTMLFormElement) record("form_submit", form.getAttribute("action")?.slice(0, 90) ?? "");
  }, true);

  // 3. Network. The MAIN-world observer posts method/URL/status only — never bodies.
  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    const data = event.data as { source?: string; method?: string; url?: string } | null | undefined;
    if (!data || data.source !== NETWORK_SIGNAL_SOURCE) return;
    record("network_post", `${data.method ?? "POST"} ${String(data.url ?? "").slice(0, 90)}`);
  });

  // 4. URL confirmation, including SPA transitions that never reload the page.
  const checkUrl = () => { if (isConfirmationUrl(location.href)) record("url_confirmation", location.pathname.slice(0, 90)); };
  const patchHistory = (method: "pushState" | "replaceState") => {
    const original = history[method];
    history[method] = function patched(this: History, ...args: Parameters<History["pushState"]>) {
      const result = original.apply(this, args);
      window.setTimeout(checkUrl, 0);
      return result;
    } as History[typeof method];
  };
  patchHistory("pushState");
  patchHistory("replaceState");
  window.addEventListener("popstate", checkUrl);
  checkUrl();

  // 5. DOM confirmation text inserted after submitting.
  const confirmationObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.addedNodes.length) scanForConfirmationText(mutation.addedNodes);
    }
  });
  confirmationObserver.observe(document.documentElement, { childList: true, subtree: true });
}
