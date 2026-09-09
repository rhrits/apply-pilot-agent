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
    if (element.checked) return true;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "checked")?.set;
    setter?.call(element, true);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    return true;
  }
  if (element.getAttribute("aria-checked") === "true") return true;
  (element as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  return true;
}
