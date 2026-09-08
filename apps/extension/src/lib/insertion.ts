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
