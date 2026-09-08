import type { ExtensionMessage } from "@applypilot/shared";
import { answerForField, extractField } from "./lib/field-detector";
import { insertValue } from "./lib/insertion";
import { getProfile } from "./lib/profile";
import "./styles.css";

let activeElement: Element | null = null;
let overlay: HTMLDivElement | null = null;
let timer: number | undefined;

function removeOverlay() {
  overlay?.remove();
  overlay = null;
}

function showOverlay(element: Element, field: NonNullable<ReturnType<typeof extractField>>, answer: string | null) {
  removeOverlay();
  const host = document.createElement("div");
  host.id = "applypilot-overlay-host";
  host.style.cssText = "position:fixed;z-index:2147483647;pointer-events:auto;";
  const rect = element.getBoundingClientRect();
  host.style.left = `${Math.min(Math.max(8, rect.right - 268), window.innerWidth - 276)}px`;
  host.style.top = `${Math.min(rect.bottom + 8, window.innerHeight - (answer ? 145 : 75))}px`;
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = "*{box-sizing:border-box}button{font:600 12px system-ui;border:0;cursor:pointer}.card{width:260px;padding:12px;border:1px solid #d9d6fe;border-radius:14px;background:#fff;color:#1f2937;box-shadow:0 12px 35px rgba(31,24,71,.18)}.title{font:700 13px system-ui;color:#4f46e5;margin-bottom:6px}.q{font:500 12px system-ui;line-height:1.4;margin-bottom:8px;max-height:34px;overflow:hidden}.answer{font:600 12px system-ui;background:#f5f3ff;padding:8px;border-radius:9px;overflow-wrap:anywhere}.actions{display:flex;gap:6px;margin-top:9px}.primary{flex:1;color:#fff;background:#4f46e5;padding:8px 9px;border-radius:8px}.secondary{color:#4338ca;background:#eef2ff;padding:8px 9px;border-radius:8px}";
  shadow.append(style);
  const card = document.createElement("div");
  card.className = "card";
  card.innerHTML = `<div class="title">✦ ApplyPilot</div><div class="q"></div>${answer ? `<div class="answer"></div>` : ""}<div class="actions"><button class="primary">${answer ? "Insert answer" : "Open assistant"}</button><button class="secondary">Copy</button></div>`;
  (card.querySelector(".q") as HTMLElement).textContent = field.question || "Focused field";
  if (answer) (card.querySelector(".answer") as HTMLElement).textContent = answer;
  card.querySelector(".primary")?.addEventListener("click", () => {
    if (answer) insertValue(element, answer);
    else chrome.runtime.sendMessage({ type: "OPEN_SIDE_PANEL" } satisfies ExtensionMessage);
    removeOverlay();
  });
  card.querySelector(".secondary")?.addEventListener("click", async () => {
    await navigator.clipboard.writeText(answer ?? field.question);
    removeOverlay();
  });
  shadow.append(card);
  document.documentElement.append(host);
  overlay = host;
}

async function analyze(element: Element) {
  const field = extractField(element);
  if (!field) return;
  activeElement = element;
  const payload = { field, page: { url: location.href, title: document.title, hostname: location.hostname } };
  chrome.runtime.sendMessage({ type: "ACTIVE_FIELD", payload } satisfies ExtensionMessage).catch(() => undefined);
  const settings = await chrome.runtime.sendMessage({ type: "GET_SETTINGS" } satisfies ExtensionMessage).catch(() => ({ autoSuggest: true }));
  if (settings?.autoSuggest === false) return;
  const profile = await getProfile().catch(() => null);
  showOverlay(element, field, profile ? answerForField(field, profile) : null);
}

document.addEventListener("focusin", (event) => {
  const target = event.target as Element;
  window.clearTimeout(timer);
  timer = window.setTimeout(() => analyze(target), 80);
});
document.addEventListener("click", (event) => {
  if (overlay && !overlay.contains(event.target as Node) && event.target !== activeElement) removeOverlay();
});
window.addEventListener("scroll", removeOverlay, { passive: true });

const observer = new MutationObserver(() => {
  if (activeElement && !document.contains(activeElement)) {
    activeElement = null;
    removeOverlay();
  }
});
observer.observe(document.documentElement, { childList: true, subtree: true });

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

chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
  if (message.type === "INSERT_IN_ACTIVE_FIELD" && activeElement) {
    sendResponse({ ok: insertValue(activeElement, message.value) });
  }
  if (message.type === "SCAN_PAGE" || message.type === "FILL_ALL") {
    scanPage(message.type === "FILL_ALL").then(sendResponse).catch((error) => sendResponse({ authenticated: false, fields: [], error: String(error) }));
    return true;
  }
  if (message.type === "ATTACH_RESUME") {
    try { sendResponse(attachResume(message.fileName, message.mimeType, message.dataUrl)); }
    catch (error) { sendResponse({ ok: false, error: String(error) }); }
    return true;
  }
  if (message.type === "COPY_TEXT") {
    navigator.clipboard.writeText(message.value).then(() => sendResponse({ ok: true }));
    return true;
  }
});
