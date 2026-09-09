/** Strict allowlist for Phase C navigation. No generic text-only clicking. */

export interface NavigationAdapter {
  id: string;
  matches(hostname: string): boolean;
  safeNextSelectors: string[];
  stepMarkerSelectors: string[];
}

export const NAVIGATION_ADAPTERS: NavigationAdapter[] = [
  {
    id: "workday",
    matches: (host) => host.includes("myworkdayjobs.com") || host.includes("workday.com"),
    safeNextSelectors: ['button[type="button"][data-automation-id="bottom-navigation-next-button"]', 'button[type="button"][data-automation-id="pageFooterNextButton"]'],
    stepMarkerSelectors: ['[data-automation-id="progressBarActiveStep"]', '[aria-current="step"]'],
  },
  {
    id: "greenhouse",
    matches: (host) => host.includes("greenhouse.io"),
    safeNextSelectors: ['button[type="button"][data-testid="next-button"]', 'button[type="button"][data-qa="next-button"]'],
    stepMarkerSelectors: ['[aria-current="step"]', '[data-testid="application-step"]'],
  },
  {
    id: "ashby",
    matches: (host) => host.includes("ashbyhq.com"),
    safeNextSelectors: ['button[type="button"][data-testid="application-form-next-button"]', 'button[type="button"][data-testid="next-button"]'],
    stepMarkerSelectors: ['[aria-current="step"]', '[data-testid="application-step"]'],
  },
  {
    id: "smartrecruiters",
    matches: (host) => host.includes("smartrecruiters.com"),
    safeNextSelectors: ['button[type="button"][data-test="next-button"]', 'button[type="button"][data-testid="next-button"]'],
    stepMarkerSelectors: ['[aria-current="step"]', '[data-test="step-indicator"]'],
  },
  {
    id: "icims",
    matches: (host) => host.includes("icims.com"),
    safeNextSelectors: ['button[type="button"].iCIMS_Navigation_Button_Next', 'button[type="button"][data-testid="next-button"]'],
    stepMarkerSelectors: ['[aria-current="step"]', '.iCIMS_ProgressBar_CurrentStep'],
  },
];

const UNSAFE_LABEL = /submit|apply|send|finish|complete|review/i;

export function adapterForHost(hostname: string): NavigationAdapter | null {
  return NAVIGATION_ADAPTERS.find((adapter) => adapter.matches(hostname)) ?? null;
}

export function isSafeNextElement(element: Element, adapter: NavigationAdapter): boolean {
  if (!(element instanceof HTMLButtonElement)) return false;
  if (element.type !== "button" || element.disabled || element.getAttribute("aria-disabled") === "true") return false;
  const label = (element.getAttribute("aria-label") || element.innerText || element.textContent || "").trim();
  if (!label || UNSAFE_LABEL.test(label)) return false;
  return adapter.safeNextSelectors.some((selector) => {
    try { return element.matches(selector); } catch { return false; }
  });
}
