/**
 * Guards the build-time API target.
 *
 * The extension shipped pointing at `http://localhost:3000` because the fallback was a
 * developer URL and no `.env` existed. Every request failed, and the failure looked
 * like the AI simply having no answer. This test fails loudly if that default ever
 * returns.
 */

import { describe, expect, it } from "vitest";
import { extensionConfig, PRODUCTION_WEB_APP_URL } from "./config";
import { isLocalhostTarget } from "./api-client";

describe("extension config", () => {
  it("never falls back to a developer machine", () => {
    expect(isLocalhostTarget(PRODUCTION_WEB_APP_URL)).toBe(false);
    expect(PRODUCTION_WEB_APP_URL).toMatch(/^https:\/\//);
  });

  it("derives the AI endpoint from the configured site", () => {
    expect(extensionConfig.aiApiUrl).toContain("/api/ai/answer");
    expect(extensionConfig.aiApiUrl.startsWith(extensionConfig.webAppUrl)).toBe(true);
  });

  it("keeps a single slash between the site and the endpoint path", () => {
    expect(extensionConfig.webAppUrl.endsWith("/")).toBe(false);
    expect(extensionConfig.aiApiUrl).not.toMatch(/[^:]\/\//);
  });
});
