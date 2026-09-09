import { analyzeJobMatch, type ExtensionMessage, type PageSummary } from "@applypilot/shared";
import { answerForField, extractField } from "./lib/field-detector";
import { insertValue } from "./lib/insertion";
import { getProfile } from "./lib/profile";
import "./styles.css";

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
  | { kind: "none"; question: string };

function renderOverlay(element: Element, state: OverlayState) {
  removeOverlay();
  const host = document.createElement("div");
  host.id = "applypilot-overlay-host";
  host.style.cssText = "position:fixed;z-index:2147483647;pointer-events:auto;";
  const rect = element.getBoundingClientRect();
  const estimatedHeight = state.kind === "answer" || state.kind === "suggestion" ? 175 : 90;
  host.style.left = `${Math.min(Math.max(8, rect.right - 268), window.innerWidth - 276)}px`;
  host.style.top = `${Math.min(rect.bottom + 8, window.innerHeight - estimatedHeight)}px`;
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = "*{box-sizing:border-box}button{font:600 12px system-ui;border:0;cursor:pointer}.card{width:264px;padding:12px;border:1px solid #d9d6fe;border-radius:14px;background:#fff;color:#1f2937;box-shadow:0 12px 35px rgba(31,24,71,.18)}.title{display:flex;align-items:center;gap:6px;font:700 13px system-ui;color:#4f46e5;margin-bottom:6px}.badge{font:700 8px system-ui;letter-spacing:.05em;text-transform:uppercase;padding:2px 6px;border-radius:8px;background:#eef2ff;color:#4338ca}.q{font:500 12px system-ui;line-height:1.4;margin-bottom:8px;max-height:34px;overflow:hidden}.answer{font:600 12px system-ui;background:#f5f3ff;padding:8px;border-radius:9px;overflow-wrap:anywhere}.loading{font:500 11px system-ui;color:#6b7280;display:flex;align-items:center;gap:7px;padding:8px 0}.spinner{width:12px;height:12px;border-radius:50%;border:2px solid #ddd6fe;border-top-color:#4f46e5;animation:spin .7s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}.actions{display:flex;gap:6px;margin-top:9px}.primary{flex:1;color:#fff;background:#4f46e5;padding:8px 9px;border-radius:8px}.secondary{color:#4338ca;background:#eef2ff;padding:8px 9px;border-radius:8px}.tertiary{color:#7a7a8c;background:#f4f4f8;padding:8px 9px;border-radius:8px}button:disabled{opacity:.5;cursor:wait}";
  shadow.append(style);
  const card = document.createElement("div");
  card.className = "card";

  const hasAnswer = state.kind === "answer" || state.kind === "suggestion";
  const badge = state.kind === "suggestion" ? `<span class="badge">${state.source === "memory" ? "Remembered" : "AI suggestion"}</span>` : "";
  card.innerHTML = `<div class="title">✦ ApplyPilot${badge}</div><div class="q"></div>${state.kind === "loading" ? `<div class="loading"><span class="spinner"></span>Finding the best answer…</div>` : hasAnswer ? `<div class="answer"></div>` : ""}<div class="actions">${state.kind === "loading" ? "" : hasAnswer ? `<button class="primary">Insert</button><button class="secondary">Copy</button>${state.kind === "suggestion" ? `<button class="tertiary">Save</button>` : ""}` : `<button class="primary">Open assistant</button><button class="secondary">Copy question</button><button class="tertiary">Save question</button>`}</div>`;
  (card.querySelector(".q") as HTMLElement).textContent = state.question || "Focused field";
  if (hasAnswer) (card.querySelector(".answer") as HTMLElement).textContent = state.text;

  card.querySelector(".primary")?.addEventListener("click", () => {
    if (hasAnswer) insertValue(element, state.text);
    else chrome.runtime.sendMessage({ type: "OPEN_SIDE_PANEL" } satisfies ExtensionMessage);
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
  if (!tokenResult?.accessToken) { renderOverlay(element, { kind: "none", question }); return; }

  const result = await chrome.runtime.sendMessage({ type: "SUGGEST_ANSWER", question, page, field } satisfies ExtensionMessage).catch(() => null);
  if (token !== requestToken || activeElement !== element) return;
  if (result?.answer) renderOverlay(element, { kind: "suggestion", text: result.answer, question, source: result.source ?? "ai" });
  else renderOverlay(element, { kind: "none", question });
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
    renderOverlay(element, { kind: "none", question: field.question || field.label });
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

const FORM_SELECTOR = "input, textarea, select, [contenteditable='true']";

function visible(element: Element) {
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element as HTMLElement);
  return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
}

function collectFields() {
  return Array.from(document.querySelectorAll(FORM_SELECTOR))
    .filter(visible)
    .map((element) => ({ element, field: extractField(element) }))
    .filter((entry): entry is { element: Element; field: NonNullable<ReturnType<typeof extractField>> } => entry.field !== null);
}

function currentValue(element: Element) {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) return element.value;
  return (element as HTMLElement).textContent ?? "";
}

async function scanPage(fill: boolean) {
  const profile = await getProfile().catch(() => null);
  if (!profile) return { authenticated: false, fields: [] };
  const entries = collectFields();
  const fields = entries.map((entry, index) => {
    const answer = answerForField(entry.field, profile);
    const alreadyFilled = currentValue(entry.element).trim().length > 0;
    let filled = false;
    if (fill && answer && !alreadyFilled && entry.field.confidence >= 0.9) filled = insertValue(entry.element, answer);
    return { index, label: entry.field.label, question: entry.field.question, kind: entry.field.kind, value: answer ?? "", filled, needsReview: Boolean(answer) && entry.field.confidence < 0.9 };
  });
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
  const inputs = Array.from(document.querySelectorAll<HTMLInputElement>("input[type='file']")).filter(visible);
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
    hasReadyAccess().then((ready) => sendResponse(ready ? { ok: insertValue(activeElement!, message.value) } : { ok: false, error: "Complete sign-in and profile setup first." }));
    return true;
  }
  if (message.type === "SCAN_PAGE" || message.type === "FILL_ALL") {
    scanPage(message.type === "FILL_ALL").then(sendResponse).catch((error) => sendResponse({ authenticated: false, fields: [], error: String(error) }));
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
