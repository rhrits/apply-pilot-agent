import { matchOption } from "./field-detector";

export function insertValue(element: Element, value: string): boolean {
  if (element instanceof HTMLSelectElement) {
    const option = Array.from(element.options).find((item) => item.text.trim().toLowerCase() === value.trim().toLowerCase() || item.value.trim().toLowerCase() === value.trim().toLowerCase());
    if (!option) return false;
    element.value = option.value;
    element.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  if (element instanceof HTMLElement && element.isContentEditable) {
    element.focus();
    element.textContent = value;
    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
    return true;
  }

  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    const prototype = element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    setter?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }
  return false;
}

/**
 * Selects one option within a radio/checkbox group.
 *
 * Native inputs get their `checked` state set through the same setter-plus-event
 * pattern as text inputs, since a plain attribute write is invisible to a React
 * controlled component. ARIA custom widgets (`role=radio`/`role=checkbox` on a
 * non-input element) have no `checked` property at all — they are almost always driven
 * entirely by a click handler, so a synthetic click is the only reliable path.
 */
export function selectChoiceElement(element: Element): boolean {
  if (element instanceof HTMLInputElement) {
    if (element.disabled) return false;
    if (element.checked) return true;
    // Activate exactly once. The previous setter + events + click sequence could toggle
    // an unchecked checkbox on and then immediately back off.
    element.click();
    return element.checked;
  }
  if (element.getAttribute("aria-disabled") === "true") return false;
  if (element.getAttribute("aria-checked") === "true") return true;
  (element as HTMLElement).click();
  return element.getAttribute("aria-checked") === "true";
}

export interface VerifiedWriteResult {
  ok: boolean;
  verified: boolean;
  actualValue: string | null;
  reason?: "disabled" | "unsupported" | "invalid_format" | "out_of_range" | "no_option" | "ambiguous_option" | "write_failed" | "verification_failed";
}

function result(ok: boolean, actualValue: string | null, reason?: VerifiedWriteResult["reason"]): VerifiedWriteResult {
  return { ok, verified: ok, actualValue, reason };
}

function normalized(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function readValue(element: Element): string {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) return element.value;
  return ((element as HTMLElement).innerText || element.textContent || "").replace(/\s+/g, " ").trim();
}

function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Returns a browser-canonical date value, or null rather than guessing. */
export function canonicalDateValue(inputType: string, value: string): string | null {
  const text = value.trim();
  if (inputType === "date") return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
  if (inputType === "month") return /^\d{4}-\d{2}$/.test(text) ? text : null;
  if (inputType === "week") return /^\d{4}-W\d{2}$/.test(text) ? text : null;
  if (inputType === "time") return /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(text) ? text : null;
  if (inputType === "datetime-local") return /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(text) ? text : null;
  return text;
}

function chooseSelectOption(select: HTMLSelectElement, value: string): HTMLOptionElement | null {
  const options = Array.from(select.options).filter((option) => !option.disabled && !(option.value === "" && /select|choose|pick/i.test(option.text)));
  const exactValue = options.find((option) => normalized(option.value) === normalized(value));
  if (exactValue) return exactValue;
  const matchedLabel = matchOption(value, options.map((option) => option.text));
  return matchedLabel ? options.find((option) => option.text === matchedLabel) ?? null : null;
}

/** Writes, waits for framework rerenders, and verifies the final observed state. */
export async function insertValueVerified(element: Element, value: string): Promise<VerifiedWriteResult> {
  if (element instanceof HTMLInputElement && element.disabled || element instanceof HTMLTextAreaElement && element.disabled || element instanceof HTMLSelectElement && element.disabled || element.getAttribute("aria-disabled") === "true") {
    return result(false, readValue(element) || null, "disabled");
  }

  if (element instanceof HTMLSelectElement) {
    const option = chooseSelectOption(element, value);
    if (!option) return result(false, element.value || null, "no_option");
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
    setter?.call(element, option.value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    await settle();
    return element.value === option.value ? result(true, option.text) : result(false, element.value || null, "verification_failed");
  }

  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    let writeValue = value;
    if (element instanceof HTMLInputElement && ["date", "datetime-local", "month", "week", "time"].includes(element.type)) {
      const canonical = canonicalDateValue(element.type, value);
      if (!canonical) return result(false, element.value || null, "invalid_format");
      writeValue = canonical;
    }
    const prototype = element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    if (!setter) return result(false, readValue(element) || null, "unsupported");
    setter.call(element, writeValue);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    element.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
    await settle();
    if (element instanceof HTMLInputElement && !element.validity.valid) return result(false, element.value || null, element.validity.rangeUnderflow || element.validity.rangeOverflow ? "out_of_range" : "invalid_format");
    return element.value === writeValue ? result(true, element.value) : result(false, element.value || null, "verification_failed");
  }

  if (element instanceof HTMLElement && element.isContentEditable) {
    element.focus();
    element.textContent = value;
    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
    element.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
    await settle();
    const actual = readValue(element);
    return normalized(actual) === normalized(value) ? result(true, actual) : result(false, actual || null, "verification_failed");
  }

  return result(false, readValue(element) || null, "unsupported");
}

export async function selectChoiceVerified(element: Element): Promise<VerifiedWriteResult> {
  if (element instanceof HTMLInputElement) {
    if (element.disabled) return result(false, element.checked ? "true" : "false", "disabled");
    if (!element.checked) element.click();
    await settle();
    return element.checked ? result(true, "true") : result(false, "false", "verification_failed");
  }
  if (element.getAttribute("aria-disabled") === "true") return result(false, element.getAttribute("aria-checked"), "disabled");
  if (element.getAttribute("aria-checked") !== "true") (element as HTMLElement).click();
  await settle();
  return element.getAttribute("aria-checked") === "true" ? result(true, "true") : result(false, element.getAttribute("aria-checked"), "verification_failed");
}

function visibleOption(element: Element): boolean {
  const style = getComputedStyle(element as HTMLElement);
  const rect = element.getBoundingClientRect();
  return style.display !== "none" && style.visibility !== "hidden" && (rect.width > 0 && rect.height > 0 || element.getAttribute("aria-hidden") !== "true");
}

/** Bounded custom combobox/typeahead writer. Never presses Enter or submits a form. */
export async function fillComboboxVerified(combobox: Element, value: string, timeoutMs = 1200): Promise<VerifiedWriteResult> {
  if (combobox.getAttribute("aria-disabled") === "true") return result(false, readValue(combobox) || null, "disabled");
  const input = combobox instanceof HTMLInputElement ? combobox : combobox.querySelector("input") ?? null;
  if (!input) return result(false, readValue(combobox) || null, "unsupported");
  input.focus();
  const write = await insertValueVerified(input, value);
  if (!write.ok) return write;

  const controlledId = combobox.getAttribute("aria-controls") || combobox.getAttribute("aria-owns") || input.getAttribute("aria-controls") || input.getAttribute("aria-owns");
  const deadline = Date.now() + timeoutMs;
  let options: Element[] = [];
  while (Date.now() <= deadline) {
    const popup = controlledId ? document.getElementById(controlledId) : document.querySelector("[role='listbox']");
    options = popup ? Array.from(popup.querySelectorAll("[role='option']")).filter(visibleOption).filter((option) => option.getAttribute("aria-disabled") !== "true") : [];
    if (options.length) break;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  if (!options.length) return result(false, readValue(input) || null, "no_option");
  const labels = options.map((option) => (option.getAttribute("aria-label") || (option as HTMLElement).innerText || option.textContent || "").trim());
  const matched = matchOption(value, labels);
  if (!matched) return result(false, readValue(input) || null, "ambiguous_option");
  const option = options[labels.indexOf(matched)];
  (option as HTMLElement).click();
  await settle();
  const selected = option.getAttribute("aria-selected") === "true";
  const actual = readValue(input);
  return selected || normalized(actual) === normalized(matched) || normalized(actual) === normalized(value)
    ? result(true, actual || matched)
    : result(false, actual || null, "verification_failed");
}
