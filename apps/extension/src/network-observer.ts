/**
 * Page-world network observer.
 *
 * Runs in the page's own JavaScript context (MAIN world) because `fetch` and
 * `XMLHttpRequest` in an isolated content script are different objects from the ones the
 * page uses. Without this, a submission made over XHR is invisible.
 *
 * PRIVACY — these limits are deliberate and load-bearing:
 *
 *  - Only the method, a truncated same-origin-safe URL, and the status code leave this
 *    file. Request and response BODIES are never read, so resume text, answers, salary,
 *    and personal details are never observed.
 *  - Query strings and hashes are stripped, since they can carry tokens.
 *  - Messages are posted to the page's own origin only, and tagged so the content script
 *    can reject anything it did not originate.
 *  - Only URLs that already look like an application endpoint are reported at all.
 *
 * The patch is transparent: originals are always called, and a throw inside the observer
 * can never break the host page.
 */

import { isApplicationRequest } from "@uplyfox/shared";
import { NETWORK_SIGNAL_SOURCE } from "./lib/network-channel";

export { NETWORK_SIGNAL_SOURCE };

declare global {
  interface Window { __uplyfoxNetworkObserver?: boolean }
}

function report(method: string, url: string, status: number) {
  try {
    // Classify the endpoint without filtering on status here. Phase E must observe a
    // definitive 4xx/5xx failure as failure evidence rather than letting it time out as
    // unknown. Bodies are still never read or reported.
    if (!isApplicationRequest(method, url)) return;
    // Strip query and hash: they can carry session tokens or personal identifiers.
    const path = url.split(/[?#]/)[0].slice(0, 200);
    window.postMessage({ source: NETWORK_SIGNAL_SOURCE, method, url: path, status }, window.location.origin);
  } catch {
    /* Observation must never surface an error into the page. */
  }
}

function resolveUrl(input: unknown): string {
  try {
    if (typeof input === "string") return new URL(input, location.href).href;
    if (input instanceof URL) return input.href;
    if (input instanceof Request) return input.url;
  } catch {
    /* Unparseable URLs are simply not reported. */
  }
  return "";
}

export function installNetworkObserver() {
  if (window.__uplyfoxNetworkObserver) return;
  window.__uplyfoxNetworkObserver = true;

  const originalFetch = window.fetch;
  if (typeof originalFetch === "function") {
    window.fetch = function patchedFetch(this: unknown, ...args: Parameters<typeof fetch>) {
      const [input, init] = args;
      const method = String(init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
      const url = resolveUrl(input);
      // The original call is returned untouched; observation only rides along.
      return originalFetch.apply(this as typeof globalThis, args).then((response) => {
        report(method, url, response.status);
        return response;
      });
    } as typeof window.fetch;
  }

  const OriginalXhr = window.XMLHttpRequest;
  if (typeof OriginalXhr === "function") {
    const originalOpen = OriginalXhr.prototype.open;
    const originalSend = OriginalXhr.prototype.send;
    const state = new WeakMap<XMLHttpRequest, { method: string; url: string }>();

    OriginalXhr.prototype.open = function patchedOpen(this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
      state.set(this, { method: String(method ?? "GET").toUpperCase(), url: resolveUrl(url) });
      return (originalOpen as (...args: unknown[]) => unknown).call(this, method, url, ...rest);
    } as typeof originalOpen;

    OriginalXhr.prototype.send = function patchedSend(this: XMLHttpRequest, ...args: unknown[]) {
      const entry = state.get(this);
      if (entry) {
        // `loadend` fires for success, error, and abort alike; only the status is read.
        this.addEventListener("loadend", () => report(entry.method, entry.url, this.status), { once: true });
      }
      return (originalSend as (...args: unknown[]) => unknown).apply(this, args);
    } as typeof originalSend;
  }
}

installNetworkObserver();
