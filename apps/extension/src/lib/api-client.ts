/**
 * Network layer for calls from the extension to the UplyFox web API.
 *
 * The extension previously called `fetch(...).then(r => r.json())` directly, which fails
 * badly in exactly the situations users hit most:
 *
 *  - A build whose `VITE_WEB_APP_URL` points at `http://localhost:3000` only works while
 *    the dev server is running, so every request throws `TypeError: Failed to fetch`
 *    and the user sees nothing useful.
 *  - Proxies, tunnels, and platform errors return HTML, so `response.json()` throws a
 *    `SyntaxError` that gets shown to the user as if it were the answer.
 *  - Without a timeout, a hung server leaves the overlay spinning forever.
 *
 * Every failure here is turned into a sentence that names the cause and the next action.
 */

import { extensionConfig } from "./config";

export const REQUEST_TIMEOUT_MS = 20_000;

export interface ApiFailure {
  ok: false;
  kind: "offline" | "unreachable" | "timeout" | "unauthorized" | "forbidden" | "server" | "malformed";
  message: string;
  status?: number;
}

export interface ApiSuccess<T> { ok: true; data: T }
export type ApiResult<T> = ApiSuccess<T> | ApiFailure;

/** The host the extension was built to talk to, for use in error messages. */
export function apiHost(): string {
  try { return new URL(extensionConfig.aiApiUrl).host; } catch { return extensionConfig.aiApiUrl || "the UplyFox server"; }
}

/**
 * True when a packaged build is still pointing at a developer machine. This is the
 * single most common cause of "the extension never answers", and it is invisible
 * without an explicit check.
 */
export function isLocalhostTarget(url = extensionConfig.aiApiUrl): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(url);
}

/** Turns a transport-level throw into an actionable message. */
export function classifyTransportError(error: unknown): ApiFailure {
  if (error instanceof DOMException && error.name === "AbortError") {
    return { ok: false, kind: "timeout", message: `${apiHost()} did not respond in time. Try again in a moment.` };
  }
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return { ok: false, kind: "offline", message: "You appear to be offline. Reconnect and try again." };
  }
  const hint = isLocalhostTarget()
    ? `This build points at ${apiHost()}, so it only works while the UplyFox dev server is running. Rebuild with VITE_WEB_APP_URL set to your deployed site.`
    : `Could not reach ${apiHost()}. Check your connection, or the site may be down.`;
  return { ok: false, kind: "unreachable", message: hint };
}

/** Maps an HTTP status to a failure the user can act on. */
export function classifyStatus(status: number, serverMessage?: string): ApiFailure {
  if (status === 401) return { ok: false, kind: "unauthorized", status, message: serverMessage || "Your session expired. Sign in again from the UplyFox popup." };
  if (status === 403) return { ok: false, kind: "forbidden", status, message: serverMessage || "This account does not have access yet." };
  if (status === 429) return { ok: false, kind: "server", status, message: serverMessage || "Too many requests right now. Your saved answers still work." };
  return { ok: false, kind: "server", status, message: serverMessage || `${apiHost()} returned an error (${status}).` };
}

/** Reads a JSON body without throwing when the server sent HTML or nothing at all. */
export async function readJsonBody(response: Response): Promise<Record<string, unknown> | null> {
  const raw = await response.text().catch(() => "");
  if (!raw.trim()) return null;
  try { return JSON.parse(raw) as Record<string, unknown>; } catch { return null; }
}

export async function postJson<T>(url: string, body: unknown, accessToken: string, timeoutMs = REQUEST_TIMEOUT_MS): Promise<ApiResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    return classifyTransportError(error);
  } finally {
    clearTimeout(timer);
  }

  const payload = await readJsonBody(response);
  if (!response.ok) {
    const message = typeof payload?.error === "string" ? payload.error : undefined;
    return classifyStatus(response.status, message);
  }
  if (!payload) {
    // A 200 that is not JSON means something in front of the app answered instead of it.
    return { ok: false, kind: "malformed", status: response.status, message: `${apiHost()} returned an unexpected response. It may be behind a login or proxy page.` };
  }
  return { ok: true, data: payload as T };
}

export interface ConnectionReport {
  ok: boolean;
  message: string;
  host: string;
  localhostBuild: boolean;
}

/**
 * Diagnostic used by the popup so the user can tell configuration problems apart from
 * account problems, instead of guessing why suggestions are silent.
 */
export async function checkConnection(accessToken?: string): Promise<ConnectionReport> {
  const host = apiHost();
  const localhostBuild = isLocalhostTarget();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(extensionConfig.aiApiUrl, {
      method: "GET",
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
      signal: controller.signal,
    });
    const payload = await readJsonBody(response);
    if (!response.ok) return { ok: false, host, localhostBuild, message: classifyStatus(response.status, typeof payload?.error === "string" ? payload.error : undefined).message };
    const reason = typeof payload?.reason === "string" ? payload.reason : "";
    const ready = payload?.ready === true;
    return {
      ok: ready,
      host,
      localhostBuild,
      message: ready ? `Connected to ${host}.` : reason || `Reached ${host}, but this account is not ready to generate answers yet.`,
    };
  } catch (error) {
    return { ok: false, host, localhostBuild, message: classifyTransportError(error).message };
  } finally {
    clearTimeout(timer);
  }
}
