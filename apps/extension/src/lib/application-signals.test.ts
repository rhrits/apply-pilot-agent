/**
 * Runtime tests for the content-script signal collector.
 *
 * The fusion maths is covered in application-detector.test.ts; what matters here is
 * that real DOM events produce the right signals, that the reporter fires exactly once
 * per page, and — most importantly — that ordinary browsing never triggers it.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NETWORK_SIGNAL_SOURCE } from "./network-channel";

async function loadDetector() {
  vi.resetModules();
  return import("./application-signals");
}

function click(element: Element) {
  element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

beforeEach(() => {
  document.body.innerHTML = "";
  window.history.replaceState({}, "", "/jobs/senior-engineer");
});

describe("application signal collection", () => {
  it("does not report when only the apply button was clicked", async () => {
    const { installApplicationDetector } = await loadDetector();
    const report = vi.fn();
    installApplicationDetector(report);

    document.body.innerHTML = `<button id="apply">Submit application</button>`;
    click(document.getElementById("apply")!);

    // Opening an application is not applying to one.
    expect(report).not.toHaveBeenCalled();
  });

  it("reports once a click is corroborated by a form submission", async () => {
    const { installApplicationDetector } = await loadDetector();
    const report = vi.fn();
    installApplicationDetector(report);

    document.body.innerHTML = `<form id="f"><button id="apply" type="button">Submit application</button></form>`;
    click(document.getElementById("apply")!);
    document.getElementById("f")!.dispatchEvent(new Event("submit", { bubbles: true }));

    expect(report).toHaveBeenCalledTimes(1);
  });

  it("reads the accessible name of an icon-only or input submit control", async () => {
    const { currentApplicationVerdict, installApplicationDetector } = await loadDetector();
    installApplicationDetector(() => undefined);

    document.body.innerHTML = `<input id="s" type="submit" value="Submit application" />`;
    click(document.getElementById("s")!);

    expect(currentApplicationVerdict().signals.some((signal) => signal.kind === "intent_click")).toBe(true);
  });

  it("ignores navigation buttons that only lead to an application", async () => {
    const { currentApplicationVerdict, installApplicationDetector } = await loadDetector();
    installApplicationDetector(() => undefined);

    document.body.innerHTML = `<button id="a">Apply on company site</button><button id="b">Save job</button>`;
    click(document.getElementById("a")!);
    click(document.getElementById("b")!);

    expect(currentApplicationVerdict().signals).toHaveLength(0);
  });

  it("counts a submission POST reported by the page-world observer", async () => {
    const { currentApplicationVerdict, installApplicationDetector } = await loadDetector();
    installApplicationDetector(() => undefined);

    window.dispatchEvent(new MessageEvent("message", {
      source: window,
      origin: window.location.origin,
      data: { source: NETWORK_SIGNAL_SOURCE, method: "POST", url: "/api/applications", status: 201 },
    }));
    await Promise.resolve();

    expect(currentApplicationVerdict().signals.some((signal) => signal.kind === "network_post")).toBe(true);
  });

  it("ignores network messages from other frames or origins", async () => {
    const { currentApplicationVerdict, installApplicationDetector } = await loadDetector();
    installApplicationDetector(() => undefined);

    // A hostile page could post a look-alike message; only our own origin is trusted.
    window.dispatchEvent(new MessageEvent("message", {
      source: null,
      origin: "https://evil.example",
      data: { source: NETWORK_SIGNAL_SOURCE, method: "POST", url: "/api/applications", status: 201 },
    }));
    await Promise.resolve();

    expect(currentApplicationVerdict().signals).toHaveLength(0);
  });

  it("detects confirmation text rendered after submitting", async () => {
    const { currentApplicationVerdict, installApplicationDetector } = await loadDetector();
    installApplicationDetector(() => undefined);

    const banner = document.createElement("div");
    banner.textContent = "Thank you for applying! Your application has been submitted.";
    document.body.appendChild(banner);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(currentApplicationVerdict().signals.some((signal) => signal.kind === "dom_confirmation")).toBe(true);
  });

  it("detects an SPA route change to a confirmation URL", async () => {
    const { currentApplicationVerdict, installApplicationDetector } = await loadDetector();
    installApplicationDetector(() => undefined);

    window.history.pushState({}, "", "/application/confirmation");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(currentApplicationVerdict().signals.some((signal) => signal.kind === "url_confirmation")).toBe(true);
  });

  it("reports only once even if more signals keep arriving", async () => {
    const { installApplicationDetector } = await loadDetector();
    const report = vi.fn();
    installApplicationDetector(report);

    document.body.innerHTML = `<form id="f"><button id="apply" type="button">Submit application</button></form>`;
    click(document.getElementById("apply")!);
    document.getElementById("f")!.dispatchEvent(new Event("submit", { bubbles: true }));
    document.getElementById("f")!.dispatchEvent(new Event("submit", { bubbles: true }));
    click(document.getElementById("apply")!);

    // Duplicate tracker writes and repeated toasts would erode trust fast.
    expect(report).toHaveBeenCalledTimes(1);
  });
});
