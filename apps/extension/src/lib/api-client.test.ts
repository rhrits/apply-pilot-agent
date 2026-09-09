/**
 * Tests for how network failures are explained to the user.
 *
 * These matter because a silent extension is indistinguishable from a broken one. Each
 * case here corresponds to a real way the answer request fails in the field, and the
 * assertion is that the user is told something they can act on.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./config", () => ({
  extensionConfig: { supabaseUrl: "https://x.supabase.co", supabaseAnonKey: "k", webAppUrl: "http://localhost:3000", aiApiUrl: "http://localhost:3000/api/ai/answer" },
  isExtensionConfigured: () => true,
}));

const { classifyStatus, classifyTransportError, isLocalhostTarget, postJson, readJsonBody } = await import("./api-client");

afterEach(() => { vi.unstubAllGlobals(); });

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("connection diagnosis", () => {
  it("flags a build still pointing at a developer machine", () => {
    expect(isLocalhostTarget("http://localhost:3000/api/ai/answer")).toBe(true);
    expect(isLocalhostTarget("http://127.0.0.1:3000/api")).toBe(true);
    expect(isLocalhostTarget("https://uplyfox.com/api/ai/answer")).toBe(false);
  });

  it("explains a localhost build rather than reporting a bare fetch failure", () => {
    const failure = classifyTransportError(new TypeError("Failed to fetch"));
    expect(failure.kind).toBe("unreachable");
    // The actionable part: the user is told the build is misconfigured, not just "failed".
    expect(failure.message).toMatch(/VITE_WEB_APP_URL/);
  });

  it("reports a timeout distinctly from an unreachable host", () => {
    const failure = classifyTransportError(new DOMException("aborted", "AbortError"));
    expect(failure.kind).toBe("timeout");
    expect(failure.message).toMatch(/did not respond in time/);
  });

  it("tells the user to sign in again when the session expired", () => {
    expect(classifyStatus(401).kind).toBe("unauthorized");
    expect(classifyStatus(401).message).toMatch(/[Ss]ign in/);
  });

  it("prefers the server's own explanation when it sends one", () => {
    expect(classifyStatus(403, "Your access request is still pending approval.").message)
      .toBe("Your access request is still pending approval.");
  });

  it("does not throw when the server returns HTML instead of JSON", async () => {
    // Proxies and platform error pages do this constantly; response.json() would throw.
    const parsed = await readJsonBody(new Response("<html>502 Bad Gateway</html>", { status: 502 }));
    expect(parsed).toBeNull();
  });

  it("treats a non-JSON 200 as a proxy or login page, not an answer", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>login</html>", { status: 200 })));
    const result = await postJson("http://localhost:3000/api/ai/answer", {}, "token");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("malformed");
  });

  it("surfaces a structured error body from a failed request", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ error: "Finish onboarding first." }, 403)));
    const result = await postJson("http://localhost:3000/api/ai/answer", {}, "token");
    expect(result.ok).toBe(false);
    if (!result.ok) { expect(result.kind).toBe("forbidden"); expect(result.message).toBe("Finish onboarding first."); }
  });

  it("returns the payload on success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ answer: "Two weeks.", source: "profile" })));
    const result = await postJson<{ answer: string }>("http://localhost:3000/api/ai/answer", {}, "token");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.answer).toBe("Two weeks.");
  });

  it("aborts a request that hangs instead of spinning forever", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    })));
    const result = await postJson("http://localhost:3000/api/ai/answer", {}, "token", 10);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("timeout");
  });
});
