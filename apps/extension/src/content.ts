import {
  analyzeJobMatch,
  blockersForFields,
  canAutoFill,
  classifyNavAction,
  fieldSignature,
  resolveField,
  type ButtonDescriptor,
  type ExtensionMessage,
  type FieldDescriptor,
  type FormValidationError,
  type InspectedField,
  type PageSummary,
} from "@uplyfox/shared";
import { answerForField, extractField, extractGroupField, labelForChoice, matchOption } from "./lib/field-detector";
import { currentApplicationVerdict, installApplicationDetector } from "./lib/application-signals";
import { fillComboboxVerified, insertValueVerified, selectChoiceVerified } from "./lib/insertion";
import { getLocalMemory } from "./lib/memory";
import { getProfile } from "./lib/profile";
import { adapterForHost, isSafeNextElement } from "./lib/navigation-adapters";
import "./styles.css";

/**
 * The content script now runs in every frame (see manifest.ts) so application forms
 * embedded in an <iframe> — a common integration for iCIMS, and embedded
 * Greenhouse/Lever widgets on a company's own careers page — are scanned too. Job
 * detection and the application-submission detector must still run only once per page,
 * so they are gated to the top frame; field scanning and the focus overlay run in every
 * frame, since that is exactly where the previously-invisible fields live.
 */
const isTopFrame = window.top === window.self;

let activeElement: Element | null = null;
let overlay: HTMLDivElement | null = null;
let timer: number | undefined;
let requestToken = 0;
let lastSelectedText = "";
let lastDetectedJobKey = "";
let jobDetectionTimer: number | undefined;

function removeOverlay() {
  overlay?.remove();
  overlay = null;
}

type OverlayState =
  | { kind: "answer"; text: string; question: string }
  | { kind: "loading"; question: string }
  | { kind: "suggestion"; text: string; question: string; source: string }
  | { kind: "none"; question: string; notice?: string };

function renderOverlay(element: Element, state: OverlayState) {
  removeOverlay();
  const host = document.createElement("div");
  host.id = "uplyfox-overlay-host";
  host.style.cssText = "position:fixed;z-index:2147483647;pointer-events:auto;";
  const rect = element.getBoundingClientRect();
  const estimatedHeight = state.kind === "answer" || state.kind === "suggestion" ? 175 : state.kind === "none" && state.notice ? 150 : 90;
  host.style.left = `${Math.min(Math.max(8, rect.right - 268), window.innerWidth - 276)}px`;
  host.style.top = `${Math.min(rect.bottom + 8, window.innerHeight - estimatedHeight)}px`;
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = "*{box-sizing:border-box}button{font:600 12px system-ui;border:0;cursor:pointer}.card{width:264px;padding:12px;border:1px solid #d9d6fe;border-radius:14px;background:#fff;color:#1f2937;box-shadow:0 12px 35px rgba(31,24,71,.18)}.title{display:flex;align-items:center;gap:6px;font:700 13px system-ui;color:#4f46e5;margin-bottom:6px}.badge{font:700 8px system-ui;letter-spacing:.05em;text-transform:uppercase;padding:2px 6px;border-radius:8px;background:#eef2ff;color:#4338ca}.q{font:500 12px system-ui;line-height:1.4;margin-bottom:8px;max-height:34px;overflow:hidden}.answer{font:600 12px system-ui;background:#f5f3ff;padding:8px;border-radius:9px;overflow-wrap:anywhere}.notice{font:500 11px system-ui;line-height:1.45;padding:8px 9px;border-radius:9px;background:#fdf2f5;color:#8b1e3f;border:1px solid #f5d7e1}.loading{font:500 11px system-ui;color:#6b7280;display:flex;align-items:center;gap:7px;padding:8px 0}.spinner{width:12px;height:12px;border-radius:50%;border:2px solid #ddd6fe;border-top-color:#4f46e5;animation:spin .7s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}.actions{display:flex;gap:6px;margin-top:9px}.primary{flex:1;color:#fff;background:#4f46e5;padding:8px 9px;border-radius:8px}.secondary{color:#4338ca;background:#eef2ff;padding:8px 9px;border-radius:8px}.tertiary{color:#7a7a8c;background:#f4f4f8;padding:8px 9px;border-radius:8px}button:disabled{opacity:.5;cursor:wait}";
  shadow.append(style);
  const card = document.createElement("div");
  card.className = "card";

  const hasAnswer = state.kind === "answer" || state.kind === "suggestion";
  const noticeText = state.kind === "none" ? state.notice : "";
  const badge = state.kind === "suggestion" ? `<span class="badge">${state.source === "memory" ? "Remembered" : "AI suggestion"}</span>` : "";
  card.innerHTML = `<div class="title">✦ UplyFox${badge}</div><div class="q"></div>${state.kind === "loading" ? `<div class="loading"><span class="spinner"></span>Finding the best answer…</div>` : hasAnswer ? `<div class="answer"></div>` : noticeText ? `<div class="notice"></div>` : ""}<div class="actions">${state.kind === "loading" ? "" : hasAnswer ? `<button class="primary">Insert</button><button class="secondary">Copy</button>${state.kind === "suggestion" ? `<button class="tertiary">Save</button>` : ""}` : `<button class="primary">Open assistant</button><button class="secondary">Copy question</button><button class="tertiary">Save question</button>`}</div>`;
  (card.querySelector(".q") as HTMLElement).textContent = state.question || "Focused field";
  if (hasAnswer) (card.querySelector(".answer") as HTMLElement).textContent = state.text;
  // Surface the server's explanation (missing profile value, AI throttled, etc.) instead
  // of showing an unexplained empty card.
  if (noticeText) {
    const noticeNode = card.querySelector(".notice") as HTMLElement | null;
    if (noticeNode) noticeNode.textContent = noticeText;
  }

  card.querySelector(".primary")?.addEventListener("click", async () => {
    if (hasAnswer) {
      const write = element.getAttribute("role") === "combobox"
        ? await fillComboboxVerified(element, state.text)
        : await insertValueVerified(element, state.text);
      if (!write.ok) {
        const notice = card.querySelector(".answer") as HTMLElement | null;
        if (notice) notice.textContent = `Could not verify the insert (${write.reason ?? "write failed"}). Copy the answer instead.`;
        return;
      }
    } else chrome.runtime.sendMessage({ type: "OPEN_SIDE_PANEL" } satisfies ExtensionMessage);
    removeOverlay();
  });
  card.querySelector(".secondary")?.addEventListener("click", async () => {
    await navigator.clipboard.writeText(hasAnswer ? state.text : state.question);
    removeOverlay();
  });
  if (state.kind === "suggestion") {
    card.querySelector(".tertiary")?.addEventListener("click", async () => {
      await chrome.runtime.sendMessage({ type: "SAVE_ANSWER_MEMORY", item: { question: state.question, answer: state.text, source: state.source === "memory" ? "user" : "ai" } } satisfies ExtensionMessage);
      const button = card.querySelector(".tertiary") as HTMLButtonElement | null;
      if (button) { button.textContent = "Saved"; button.disabled = true; }
    });
  }
  if (state.kind === "none") {
    card.querySelector(".tertiary")?.addEventListener("click", async () => {
      const result = await chrome.runtime.sendMessage({ type: "GET_ACTIVE_FIELD" } satisfies ExtensionMessage);
      const page = result?.activeField?.page ?? { url: location.href, title: document.title, hostname: location.hostname };
      await chrome.runtime.sendMessage({ type: "SAVE_UNKNOWN_QUESTION", question: state.question, page } satisfies ExtensionMessage);
      const button = card.querySelector(".tertiary") as HTMLButtonElement | null;
      if (button) { button.textContent = "Saved"; button.disabled = true; }
    });
  }
  shadow.append(card);
  document.documentElement.append(host);
  overlay = host;
}

/**
 * Live agent: for fields with no direct profile match, first checks saved answer
 * memory (no network), then falls back to the authenticated AI endpoint, and
 * finally offers to save whatever the user accepts back into memory.
 */
async function requestLiveSuggestion(element: Element, field: NonNullable<ReturnType<typeof extractField>>, page: { url: string; title: string; hostname: string }, token: number) {
  const question = field.question || field.label;
  const memory = await chrome.runtime.sendMessage({ type: "FIND_ANSWER_MEMORY", question } satisfies ExtensionMessage).catch(() => null);
  if (token !== requestToken || activeElement !== element) return;
  if (memory?.item) { renderOverlay(element, { kind: "suggestion", text: memory.item.answer, question, source: "memory" }); return; }

  const tokenResult = await chrome.runtime.sendMessage({ type: "GET_AUTH_TOKEN" } satisfies ExtensionMessage).catch(() => null);
  if (token !== requestToken || activeElement !== element) return;
  if (!tokenResult?.accessToken) { renderOverlay(element, { kind: "none", question, notice: "Sign in from the UplyFox popup to get suggestions." }); return; }

  const result = await chrome.runtime.sendMessage({ type: "SUGGEST_ANSWER", question, page, field } satisfies ExtensionMessage).catch(() => null);
  if (token !== requestToken || activeElement !== element) return;
  if (result?.answer) renderOverlay(element, { kind: "suggestion", text: result.answer, question, source: result.source ?? "ai" });
  else renderOverlay(element, { kind: "none", question, notice: result?.notice || result?.error || "No grounded answer yet. Add this detail to your profile, or write it once and save it." });
}

async function analyze(element: Element) {
  const field = extractField(element);
  if (!field) return;
  activeElement = element;
  const page = { url: location.href, title: document.title, hostname: location.hostname };
  chrome.runtime.sendMessage({ type: "ACTIVE_FIELD", payload: { field, page } } satisfies ExtensionMessage).catch(() => undefined);

  const settings = await chrome.runtime.sendMessage({ type: "GET_SETTINGS" } satisfies ExtensionMessage).catch(() => ({ autoSuggest: true, liveAI: true }));
  if (settings?.autoSuggest === false || activeElement !== element) return;

  const profile = await getProfile().catch(() => null);
  if (!profile) return;
  const direct = answerForField(field, profile);
  const token = ++requestToken;

  if (direct) { renderOverlay(element, { kind: "answer", text: direct, question: field.question || field.label }); return; }
  if (settings?.liveAI) {
    renderOverlay(element, { kind: "loading", question: field.question || field.label });
    void requestLiveSuggestion(element, field, page, token);
  } else {
    renderOverlay(element, { kind: "none", question: field.question || field.label, notice: "Live AI suggestions are off. Turn them on in the UplyFox popup." });
  }
}

document.addEventListener("focusin", (event) => {
  const target = event.target as Element;
  window.clearTimeout(timer);
  timer = window.setTimeout(() => analyze(target), 80);
});
document.addEventListener("mouseup", () => {
  window.setTimeout(() => {
    const selection = window.getSelection()?.toString().replace(/\s+/g, " ").trim() ?? "";
    lastSelectedText = selection.slice(0, 1600);
  }, 0);
});
window.addEventListener("message", (event) => {
  if (event.source !== window || event.origin !== window.location.origin) return;
  if (event.data?.source !== "uplyfox-web" || event.data?.type !== "UPLYFOX_LOGOUT") return;
  chrome.runtime.sendMessage({ type: "AUTH_SIGN_OUT", clearLocalData: event.data.clearLocalData === true } satisfies ExtensionMessage).catch(() => undefined);
});
document.addEventListener("click", (event) => {
  if (overlay && !overlay.contains(event.target as Node) && event.target !== activeElement) removeOverlay();
});
window.addEventListener("scroll", removeOverlay, { passive: true });

function scheduleJobDetection() {
  window.clearTimeout(jobDetectionTimer);
  jobDetectionTimer = window.setTimeout(() => void detectAndNotifyJobPage(), 1200);
}

const observer = new MutationObserver(() => {
  if (activeElement && !document.contains(activeElement)) {
    activeElement = null;
    removeOverlay();
  }
  scheduleJobDetection();
});
observer.observe(document.documentElement, { childList: true, subtree: true });
window.addEventListener("popstate", scheduleJobDetection);
window.addEventListener("load", scheduleJobDetection);
const originalPushState = history.pushState;
history.pushState = function (...args) {
  originalPushState.apply(this, args);
  scheduleJobDetection();
};
const originalReplaceState = history.replaceState;
history.replaceState = function (...args) {
  originalReplaceState.apply(this, args);
  scheduleJobDetection();
};
scheduleJobDetection();

/**
 * Application tracking. When enough independent signals agree that the user actually
 * submitted an application, tell the worker so the tracked job moves to "applied".
 * The page summary is re-read at that moment so the job is recorded even if the user
 * never opened the side panel.
 *
 * Installed only in the top frame: a submission's confirming URL/DOM/network signals
 * are meaningful at the page level, and installing this in every iframe (ads, chat
 * widgets, embedded videos) would multiply irrelevant listeners for no benefit.
 */
if (isTopFrame) installApplicationDetector(() => {
  void (async () => {
    const settings = await chrome.runtime.sendMessage({ type: "GET_SETTINGS" } satisfies ExtensionMessage).catch(() => null);
    if (settings?.autoTrackJobs === false) return;
    const job = await getPageSummary().catch(() => null);
    if (!job) return;
    chrome.runtime
      .sendMessage({ type: "APPLICATION_SUBMITTED", job, verdict: currentApplicationVerdict() } satisfies ExtensionMessage)
      .catch(() => undefined);
  })();
});

const FORM_SELECTOR = "input, textarea, select, [contenteditable='true'], [role='combobox']";

/**
 * Query across open shadow roots as well as the light DOM.
 *
 * `document.querySelectorAll` stops at every shadow boundary, so application forms
 * rendered as web components — increasingly common in modal "quick apply" flows — were
 * completely invisible. Closed shadow roots remain unreachable by design.
 */
function queryDeep(selector: string, root: ParentNode = document): Element[] {
  const found = Array.from(root.querySelectorAll(selector));
  for (const element of Array.from(root.querySelectorAll("*"))) {
    const shadow = (element as HTMLElement).shadowRoot;
    if (shadow) found.push(...queryDeep(selector, shadow));
  }
  return found;
}

function visible(element: Element) {
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element as HTMLElement);
  return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
}

/** Nearest wrapper that groups a set of choice controls into one logical question. */
function groupContainer(element: Element): Element {
  return element.closest("fieldset, [role='radiogroup'], [role='group']") ?? element.parentElement ?? element;
}

/**
 * Finds every radio/checkbox question on the page, including custom ARIA widgets that
 * are not native `<input>` elements at all.
 *
 * Grouping mirrors how these actually behave: same-`name` native inputs are one
 * question no matter where in the DOM each option sits (the standard HTML radio-group
 * mechanism), while unnamed native inputs and ARIA-only choices are grouped by their
 * nearest shared fieldset/group container instead.
 */
function findChoiceGroups(includeHidden = false): Array<{ container: Element; elements: Element[] }> {
  const nativeChoices = (queryDeep("input[type='radio'], input[type='checkbox']") as HTMLInputElement[]).filter((element) => includeHidden || visible(element));
  const ariaChoices = queryDeep("[role='radio'], [role='checkbox']").filter((element) => includeHidden || visible(element)).filter((element) => !(element instanceof HTMLInputElement));

  const byName = new Map<string, HTMLInputElement[]>();
  const byContainer = new Map<Element, Element[]>();

  for (const input of nativeChoices) {
    if (input.name) {
      const list = byName.get(input.name) ?? [];
      list.push(input);
      byName.set(input.name, list);
    } else {
      const container = groupContainer(input);
      const list = byContainer.get(container) ?? [];
      list.push(input);
      byContainer.set(container, list);
    }
  }
  for (const element of ariaChoices) {
    const container = groupContainer(element);
    const list = byContainer.get(container) ?? [];
    list.push(element);
    byContainer.set(container, list);
  }

  const groups: Array<{ container: Element; elements: Element[] }> = [];
  for (const elements of byName.values()) groups.push({ container: groupContainer(elements[0]), elements });
  for (const [container, elements] of byContainer) groups.push({ container, elements });
  return groups;
}

type CollectedField =
  | { kind: "single"; element: Element; field: NonNullable<ReturnType<typeof extractField>> }
  | { kind: "group"; elements: Element[]; field: NonNullable<ReturnType<typeof extractGroupField>> };

function collectFields(includeHidden = false): CollectedField[] {
  const singles: CollectedField[] = queryDeep(FORM_SELECTOR)
    .filter((element) => includeHidden || visible(element))
    .map((element) => ({ kind: "single" as const, element, field: extractField(element) }))
    .filter((entry): entry is { kind: "single"; element: Element; field: NonNullable<ReturnType<typeof extractField>> } => entry.field !== null);

  const groups: CollectedField[] = findChoiceGroups(includeHidden)
    .map(({ container, elements }) => ({ kind: "group" as const, elements, field: extractGroupField(container, elements) }))
    .filter((entry): entry is { kind: "group"; elements: Element[]; field: NonNullable<ReturnType<typeof extractGroupField>> } => entry.field !== null);

  return [...singles, ...groups];
}

function currentValue(element: Element) {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) return element.value;
  return (element as HTMLElement).textContent ?? "";
}

function cssEscape(value: string): string {
  return CSS.escape(value);
}

/** Stable selector within the element's own document or shadow root. */
function selectorFor(element: Element): string {
  if (element.id) return `#${cssEscape(element.id)}`;
  const testId = element.getAttribute("data-testid") || element.getAttribute("data-automation-id") || element.getAttribute("data-qa");
  if (testId) return `[${element.hasAttribute("data-testid") ? "data-testid" : element.hasAttribute("data-automation-id") ? "data-automation-id" : "data-qa"}="${cssEscape(testId)}"]`;
  const name = element.getAttribute("name");
  if (name) {
    const candidate = `${element.tagName.toLowerCase()}[name="${cssEscape(name)}"]`;
    const root = element.getRootNode() as Document | ShadowRoot;
    if (root.querySelectorAll(candidate).length === 1) return candidate;
  }
  const segments: string[] = [];
  let current: Element | null = element;
  while (current && segments.length < 5) {
    let segment = current.tagName.toLowerCase();
    const parentElement: Element | null = current.parentElement;
    if (parentElement) {
      const siblings: Element[] = Array.from(parentElement.children).filter((sibling: Element) => sibling.tagName === current!.tagName);
      if (siblings.length > 1) segment += `:nth-of-type(${siblings.indexOf(current) + 1})`;
    }
    segments.unshift(segment);
    if (!parentElement || parentElement instanceof HTMLFormElement || parentElement.getAttribute("role") === "form") break;
    current = parentElement;
  }
  return segments.join(" > ");
}

/** Selector for every host crossed while entering nested open Shadow DOM. */
function shadowPathFor(element: Element): string[] {
  const path: string[] = [];
  let root = element.getRootNode();
  while (root instanceof ShadowRoot) {
    path.unshift(selectorFor(root.host));
    root = root.host.getRootNode();
  }
  return path;
}

function roleFor(element: Element, inputType: string): string {
  const explicit = element.getAttribute("role");
  if (explicit) return explicit;
  if (element instanceof HTMLSelectElement) return "combobox";
  if (element instanceof HTMLTextAreaElement || (element as HTMLElement).isContentEditable) return "textbox";
  if (element instanceof HTMLInputElement) {
    if (inputType === "radio" || inputType === "checkbox") return inputType;
    if (inputType === "file") return "button";
    return "textbox";
  }
  return "";
}

function optionsForEntry(entry: CollectedField) {
  if (entry.kind === "group") {
    return entry.elements.map((element) => ({
      label: labelForChoice(element),
      value: element instanceof HTMLInputElement ? element.value : undefined,
      selected: element instanceof HTMLInputElement ? element.checked : element.getAttribute("aria-checked") === "true",
      disabled: element instanceof HTMLInputElement ? element.disabled : element.getAttribute("aria-disabled") === "true",
    }));
  }
  if (entry.element instanceof HTMLSelectElement) {
    return Array.from(entry.element.options).map((option) => ({ label: option.text.trim(), value: option.value, selected: option.selected, disabled: option.disabled }));
  }
  return [];
}

function descriptorFor(entry: CollectedField, frameId: number, index: number): FieldDescriptor {
  const element = entry.kind === "single" ? entry.element : entry.elements[0];
  const selector = entry.kind === "single" ? selectorFor(element) : `${selectorFor(groupContainer(element))}::group`;
  const rawCurrent = entry.kind === "single" ? currentValue(element).trim() : entry.field.currentValue ?? "";
  const input = element instanceof HTMLInputElement ? element : null;
  return {
    id: `f${frameId}:${selector}:${index}`,
    selector,
    shadowPath: shadowPathFor(element),
    frameId,
    elementType: entry.field.elementType,
    inputType: entry.field.inputType,
    role: roleFor(element, entry.field.inputType ?? ""),
    label: entry.field.label,
    question: entry.field.question,
    questionSource: entry.field.questionSource ?? "unknown",
    questionConfidence: entry.field.confidence,
    kind: entry.field.kind,
    name: entry.field.name,
    placeholder: entry.field.placeholder,
    ariaLabel: entry.field.ariaLabel,
    nearbyText: entry.field.nearbyText,
    currentValue: rawCurrent || null,
    options: optionsForEntry(entry),
    required: entry.field.required,
    disabled: input ? input.disabled : element.getAttribute("aria-disabled") === "true",
    visible: entry.kind === "single" ? visible(element) : entry.elements.some(visible),
    format: input ? {
      inputMode: input.inputMode || undefined,
      pattern: input.pattern || undefined,
      min: input.min || undefined,
      max: input.max || undefined,
      maxLength: input.maxLength >= 0 ? input.maxLength : undefined,
    } : undefined,
  };
}

function validationErrorsFor(fields: InspectedField[], frameId: number): FormValidationError[] {
  const errors: FormValidationError[] = [];
  const bySelector = new Map(fields.map((field) => [field.descriptor.selector.replace(/::group$/, ""), field.descriptor.id]));
  const invalid = queryDeep("input:invalid, textarea:invalid, select:invalid, [aria-invalid='true']");
  for (const [index, element] of invalid.entries()) {
    const selector = selectorFor(element);
    const nativeMessage = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement ? element.validationMessage : "";
    const describedBy = element.getAttribute("aria-describedby")?.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? "").join(" ") ?? "";
    const message = [nativeMessage, describedBy].find((value) => value.trim()) || "This field is marked invalid.";
    errors.push({ id: `validation:${frameId}:${index}`, fieldId: bySelector.get(selector), message: message.trim().slice(0, 300), source: element.getAttribute("aria-invalid") === "true" ? "aria_invalid" : "native_validity", severity: "error", frameId, selector });
  }
  for (const [index, alert] of queryDeep("[role='alert']").filter(visible).entries()) {
    const message = ((alert as HTMLElement).innerText || alert.textContent || "").replace(/\s+/g, " ").trim();
    if (message) errors.push({ id: `alert:${frameId}:${index}`, message: message.slice(0, 300), source: "role_alert", severity: "error", frameId, selector: selectorFor(alert) });
  }
  return errors;
}

function buttonsForFrame(frameId: number): ButtonDescriptor[] {
  return queryDeep("button, input[type='submit'], input[type='button'], [role='button']")
    .filter(visible)
    .map((element) => ({
      label: (element.getAttribute("aria-label") || (element instanceof HTMLInputElement ? element.value : (element as HTMLElement).innerText || element.textContent) || "").replace(/\s+/g, " ").trim().slice(0, 160),
      selector: selectorFor(element),
      frameId,
      disabled: element instanceof HTMLButtonElement || element instanceof HTMLInputElement ? element.disabled : element.getAttribute("aria-disabled") === "true",
      visible: true,
      type: element.getAttribute("type") ?? undefined,
      role: element.getAttribute("role") ?? undefined,
    }))
    .filter((button) => button.label);
}

function captchaBlocker(frameId: number) {
  const challenge = queryDeep("iframe[src*='recaptcha'], iframe[src*='hcaptcha'], iframe[src*='turnstile'], .g-recaptcha, .h-captcha, [class*='cf-turnstile']")[0];
  return challenge ? [{ kind: "captcha" as const, detail: "Human verification detected. Solve it manually before continuing.", frameId }] : [];
}

/** Phase A: inspect one frame completely without writing to the page. */
async function inspectFormFrame(frameId: number) {
  const profile = await getProfile().catch(() => null);
  if (!profile) return { authenticated: false, fields: [], validationErrors: [], buttons: [], blockers: [], heading: "", url: location.href };
  const memory = await getLocalMemory().catch(() => []);
  const entries = collectFields(true);
  const fields: InspectedField[] = entries.map((entry, index) => {
    const descriptor = descriptorFor(entry, frameId, index);
    return { descriptor, resolution: resolveField({ descriptor, profile, memory }) };
  });
  const validationErrors = validationErrorsFor(fields, frameId);
  const blockers = [...blockersForFields(fields, validationErrors), ...captchaBlocker(frameId)];
  const heading = queryDeep("h1, [role='heading'][aria-level='1'], h2").filter(visible).map((node) => ((node as HTMLElement).innerText || node.textContent || "").trim()).find(Boolean) ?? "";
  return { authenticated: true, fields, validationErrors, buttons: buttonsForFrame(frameId), blockers, heading: heading.slice(0, 200), url: location.href, signature: fieldSignature(fields) };
}

/**
 * Clicks one adapter-approved Next control — never Review or Submit.
 *
 * This function has no selector argument from an LLM, worker, or page. It derives the
 * selector from a static extension-owned allowlist, requires a native button whose
 * effective type is exactly `button`, rejects unsafe words again at the element level,
 * checks current validation, and clicks at most once. Unknown portals cannot use it.
 */
function advanceSafeStepFrame() {
  const adapter = adapterForHost(location.hostname);
  if (!adapter) return { ok: false, reason: "unsupported_ats", detail: "Automatic step navigation is not enabled for this portal." };
  const candidates = adapter.safeNextSelectors.flatMap((selector) => queryDeep(selector)).filter((element) => visible(element) && isSafeNextElement(element, adapter));
  const unique = [...new Set(candidates)];
  if (unique.length !== 1) return { ok: false, reason: unique.length ? "ambiguous_next" : "no_safe_next", detail: unique.length ? "More than one safe Next control was found." : "No allowlisted safe Next control was found." };
  const invalid = queryDeep("input:invalid, textarea:invalid, select:invalid, [aria-invalid='true'], [role='alert']").filter(visible);
  if (invalid.length) return { ok: false, reason: "validation_error", detail: "Fix the visible validation errors before continuing." };
  const target = unique[0] as HTMLButtonElement;
  const label = (target.getAttribute("aria-label") || target.innerText || target.textContent || "Next").trim();
  const stepMarker = adapter.stepMarkerSelectors.flatMap((selector) => queryDeep(selector)).filter(visible).map((element) => ((element as HTMLElement).innerText || element.textContent || "").trim()).find(Boolean) ?? "";
  target.click();
  return { ok: true, clicked: true, adapterId: adapter.id, label, stepMarker, url: location.href };
}

async function scanPage(fill: boolean) {
  const profile = await getProfile().catch(() => null);
  if (!profile) return { authenticated: false, fields: [] };
  const memory = await getLocalMemory().catch(() => []);
  const entries = collectFields();
  const fields = await Promise.all(entries.map(async (entry, index) => {
    const descriptor = descriptorFor(entry, 0, index);
    const resolution = resolveField({ descriptor, profile, memory });
    let filled = false;
    let value = Array.isArray(resolution.value) ? resolution.value.join(", ") : resolution.value ?? "";
    let fillOutcome = resolution.state === "blocked" ? "blocked_sensitive" : resolution.state === "unknown" ? "unresolved" : descriptor.currentValue ? "already_filled" : "skipped_low_confidence";

    if (fill && canAutoFill(resolution)) {
      if (entry.kind === "single") {
        const write = entry.field.elementType === "combobox" || entry.element.getAttribute("role") === "combobox"
          ? await fillComboboxVerified(entry.element, value)
          : await insertValueVerified(entry.element, value);
        filled = write.ok && write.verified;
        fillOutcome = filled ? "verified" : write.reason ?? "verification_failed";
      } else {
        const matched = matchOption(value, entry.field.options);
        const target = matched ? entry.elements[entry.field.options.indexOf(matched)] : undefined;
        if (target) {
          const write = await selectChoiceVerified(target);
          filled = write.ok && write.verified;
          fillOutcome = filled ? "verified" : write.reason ?? "verification_failed";
          if (filled) value = matched ?? value;
        } else {
          fillOutcome = "ambiguous_option";
        }
      }
    }

    return { index, label: entry.field.label, question: entry.field.question, kind: entry.field.kind, value, filled, needsReview: resolution.needsReview, fillOutcome };
  }));
  return { authenticated: true, fields };
}

function dataUrlToFile(dataUrl: string, fileName: string, mimeType: string) {
  const base64 = dataUrl.split(",")[1] ?? "";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new File([bytes], fileName, { type: mimeType || "application/pdf" });
}

function attachResume(fileName: string, mimeType: string, dataUrl: string) {
  const inputs = (queryDeep("input[type='file']") as HTMLInputElement[]).filter(visible);
  const target = inputs.find((input) => !input.files?.length) ?? inputs[0];
  if (!target) return { ok: false, error: "No file upload field found on this page." };
  const transfer = new DataTransfer();
  transfer.items.add(dataUrlToFile(dataUrl, fileName, mimeType));
  target.files = transfer.files;
  target.dispatchEvent(new Event("input", { bubbles: true }));
  target.dispatchEvent(new Event("change", { bubbles: true }));
  return { ok: true };
}

type JobPostingData = { title?: string; company?: string; description?: string; location?: string; employmentType?: string; salary?: string; skills?: string[] };

function cleanPageValue(value: unknown, maxLength = 4000): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, maxLength) : "";
}

function readJobPostingData(): JobPostingData {
  const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
  for (const script of scripts) {
    try {
      const parsed = JSON.parse(script.textContent ?? "") as Record<string, unknown> | Array<Record<string, unknown>>;
      const candidates = Array.isArray(parsed) ? parsed : [parsed, ...(Array.isArray(parsed["@graph"]) ? parsed["@graph"] as Array<Record<string, unknown>> : [])];
      const job = candidates.find((item) => String(item?.["@type"] ?? "").toLowerCase().includes("jobposting"));
      if (!job) continue;
      const organization = job.hiringOrganization as Record<string, unknown> | undefined;
      const address = (job.jobLocation as Record<string, unknown> | Array<Record<string, unknown>> | undefined);
      const locationValue = Array.isArray(address) ? address[0] : address;
      const postal = locationValue?.address as Record<string, unknown> | undefined;
      const salaryValue = job.baseSalary as Record<string, unknown> | undefined;
      const salaryRange = salaryValue?.value as Record<string, unknown> | undefined;
      return {
        title: cleanPageValue(job.title, 200),
        company: cleanPageValue(organization?.name, 160),
        description: cleanPageValue(job.description, 12000),
        location: cleanPageValue([postal?.addressLocality, postal?.addressRegion, postal?.addressCountry].filter(Boolean).join(", "), 200),
        employmentType: cleanPageValue(job.employmentType, 80),
        salary: cleanPageValue([salaryRange?.minValue, salaryRange?.maxValue].filter(Boolean).join("–") || salaryValue?.value, 120),
        skills: cleanPageValue(job.skills, 500).split(/[,;|]/).map((item) => item.trim()).filter(Boolean).slice(0, 30),
      };
    } catch { /* Ignore malformed JSON-LD and continue with DOM extraction. */ }
  }
  return {};
}

function firstText(selectors: string[], maxLength = 400): string {
  for (const selector of selectors) {
    const element = document.querySelector(selector) as HTMLElement | HTMLMetaElement | null;
    const value = element instanceof HTMLMetaElement ? element.content : element?.innerText || element?.textContent;
    const text = cleanPageValue(value, maxLength);
    if (text) return text;
  }
  return "";
}

/** Best-effort extraction of company/job description for the job detector and tracker. */
function guessCompany(data: JobPostingData): string {
  if (data.company) return data.company;
  const og = document.querySelector('meta[property="og:site_name"]') as HTMLMetaElement | null;
  if (og?.content?.trim()) return og.content.trim();
  const text = firstText(['[itemprop="hiringOrganization"] [itemprop="name"]', '[class*="company-name" i]', '[data-company]', '[class*="employer" i]'], 160);
  if (text) return text;
  return location.hostname.replace(/^www\./, "").split(".")[0];
}

function guessDescription(data: JobPostingData): string {
  if (data.description && data.description.length >= 120) return data.description;
  const meta = document.querySelector('meta[name="description"]') as HTMLMetaElement | null;
  if (meta?.content?.trim() && meta.content.length >= 120) return cleanPageValue(meta.content, 12000);
  const block = document.querySelector('[itemprop="description"], [class*="job-description" i], [class*="jobdescription" i], [id*="job-description" i], [class*="job-details" i], article, main');
  const text = (block as HTMLElement | null)?.innerText ?? "";
  return cleanPageValue(text || document.body.innerText, 12000);
}

function guessJobTitle(data: JobPostingData): string {
  return data.title || firstText(['h1[itemprop="title"]', '[data-testid*="job-title" i]', '[class*="job-title" i]', 'h1'], 200) || cleanPageValue(document.title, 200);
}

function detectJobPage(data: JobPostingData, title: string, description: string): { isJobPage: boolean; confidence: number; source: string } {
  const urlSignal = /\/jobs?\b|\/careers?\b|\/positions?\b|\/vacanc|\/opening|\/apply\b|jobId=|gh_jid=|lever\.co|greenhouse\.io/i.test(location.href);
  const titleSignal = /\b(engineer|developer|designer|manager|analyst|scientist|architect|recruiter|consultant|intern|director|specialist|coordinator|lead|officer|administrator)\b/i.test(title);
  const descriptionSignal = /\b(responsibilities|qualifications|requirements|what you will do|about the role|experience with|job description|benefits)\b/i.test(description);
  if (data.title && data.description && data.description.length >= 120) return { isJobPage: true, confidence: 0.98, source: "json-ld-jobposting" };
  if (titleSignal && description.length >= 400 && (urlSignal || descriptionSignal)) return { isJobPage: true, confidence: 0.86, source: "dom-job-signals" };
  if (urlSignal && titleSignal && description.length >= 180) return { isJobPage: true, confidence: 0.74, source: "url-and-content" };
  return { isJobPage: false, confidence: Math.min(0.55, (titleSignal ? 0.25 : 0) + (descriptionSignal ? 0.2 : 0) + (urlSignal ? 0.1 : 0)), source: "insufficient-job-signals" };
}

async function getPageSummary(): Promise<PageSummary> {
  const data = readJobPostingData();
  const title = guessJobTitle(data);
  const description = guessDescription(data);
  const detection = detectJobPage(data, title, description);
  const summary: PageSummary = {
    title,
    url: location.href,
    hostname: location.hostname,
    company: guessCompany(data),
    location: data.location || firstText(['[itemprop="jobLocation"]', '[class*="job-location" i]', '[class*="location" i]'], 200),
    workMode: /remote/i.test(`${title} ${description}`) ? "remote" : /hybrid/i.test(`${title} ${description}`) ? "hybrid" : /onsite|on-site|in office/i.test(`${title} ${description}`) ? "onsite" : "unknown",
    employmentType: /intern/i.test(data.employmentType || description) ? "internship" : /contract|freelance/i.test(data.employmentType || description) ? "contract" : /part[- ]?time/i.test(data.employmentType || description) ? "part-time" : "full-time",
    salary: data.salary || firstText(['[itemprop="baseSalary"]', '[class*="salary" i]', '[class*="compensation" i]'], 120),
    description,
    skills: data.skills ?? [],
    isJobPage: detection.isJobPage,
    detectionConfidence: detection.confidence,
    detectionSource: detection.source,
  };
  const profile = await getProfile().catch(() => null);
  if (profile && summary.isJobPage) summary.matchAnalysis = analyzeJobMatch(summary, profile);
  return summary;
}

async function detectAndNotifyJobPage() {
  // Job detection reads and reports the whole document's identity (title/URL/description);
  // running it per-frame would fire once per iframe on the same page and race duplicate
  // JOB_PAGE_DETECTED messages against each other.
  if (!isTopFrame) return;
  const summary = await getPageSummary();
  if (!summary.isJobPage || (summary.detectionConfidence ?? 0) < 0.74) return;
  const key = `${summary.url}|${summary.title}|${summary.description.slice(0, 160)}`;
  if (key === lastDetectedJobKey) return;
  lastDetectedJobKey = key;
  chrome.runtime.sendMessage({ type: "JOB_PAGE_DETECTED", job: summary } satisfies ExtensionMessage).catch(() => undefined);
}

async function hasReadyAccess() {
  const status = await chrome.runtime.sendMessage({ type: "AUTH_STATUS" } satisfies ExtensionMessage).catch(() => null);
  return status?.accessState === "ready";
}

chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
  if (message.type === "INSERT_IN_ACTIVE_FIELD" && activeElement) {
    hasReadyAccess().then(async (ready) => {
      if (!ready) { sendResponse({ ok: false, error: "Complete sign-in and profile setup first." }); return; }
      const target = activeElement!;
      const write = target.getAttribute("role") === "combobox"
        ? await fillComboboxVerified(target, message.value)
        : await insertValueVerified(target, message.value);
      sendResponse(write);
    }).catch((error) => sendResponse({ ok: false, verified: false, error: String(error) }));
    return true;
  }
  if (message.type === "SCAN_PAGE" || message.type === "FILL_ALL") {
    scanPage(message.type === "FILL_ALL").then(sendResponse).catch((error) => sendResponse({ authenticated: false, fields: [], error: String(error) }));
    return true;
  }
  if (message.type === "INSPECT_FORM_FRAME") {
    inspectFormFrame(message.frameId).then(sendResponse).catch((error) => sendResponse({ authenticated: false, fields: [], validationErrors: [], buttons: [], blockers: [], heading: "", url: location.href, error: String(error) }));
    return true;
  }
  if (message.type === "ADVANCE_SAFE_STEP_FRAME") {
    hasReadyAccess().then((ready) => sendResponse(ready ? advanceSafeStepFrame() : { ok: false, reason: "not_ready", detail: "Complete sign-in and profile setup first." }));
    return true;
  }
  if (message.type === "ATTACH_RESUME") {
    hasReadyAccess().then((ready) => {
      if (!ready) { sendResponse({ ok: false, error: "Complete sign-in and profile setup first." }); return; }
      try { sendResponse(attachResume(message.fileName, message.mimeType, message.dataUrl)); }
      catch (error) { sendResponse({ ok: false, error: String(error) }); }
    });
    return true;
  }
  if (message.type === "GET_PAGE_SUMMARY") {
    hasReadyAccess().then((ready) => {
      if (!ready) { sendResponse({ error: "Complete sign-in and profile setup first." }); return; }
      getPageSummary().then(sendResponse).catch((error) => sendResponse({ error: String(error) }));
    });
    return true;
  }
  if (message.type === "GET_SELECTION_TEXT") {
    const selection = window.getSelection()?.toString().replace(/\s+/g, " ").trim() ?? lastSelectedText;
    sendResponse({ text: (selection || lastSelectedText).slice(0, 1600), page: { url: location.href, title: document.title, hostname: location.hostname } });
    return false;
  }
  if (message.type === "COPY_TEXT") {
    navigator.clipboard.writeText(message.value).then(() => sendResponse({ ok: true }));
    return true;
  }
});
