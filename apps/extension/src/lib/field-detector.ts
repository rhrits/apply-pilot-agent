import type { DetectedField, FieldKind } from "@applypilot/shared";

const TEXT_TYPES = new Set(["text", "email", "tel", "url", "number", "search", ""]);

function clean(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function nearbyText(element: Element): string {
  const container = element.closest("fieldset, [role='group'], .field, .form-group, .question, li, section, div");
  if (!container) return "";
  return clean((container as HTMLElement).innerText || container.textContent).slice(0, 500);
}

function labelFor(element: Element): string {
  const html = element as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
  const linked = html.labels?.[0]?.innerText;
  if (linked) return clean(linked);
  if (element.id) {
    const explicitLabel = Array.from(document.querySelectorAll("label")).find((candidate) => candidate.htmlFor === element.id)?.textContent;
    if (explicitLabel) return clean(explicitLabel);
  }
  const aria = element.getAttribute("aria-label");
  if (aria) return clean(aria);
  const labelledBy = element.getAttribute("aria-labelledby");
  if (labelledBy) {
    const text = labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.innerText ?? document.getElementById(id)?.textContent ?? "").join(" ");
    if (text) return clean(text);
  }
  const parentLabel = element.parentElement?.querySelector("label")?.innerText;
  return clean(parentLabel);
}

function classify(text: string, inputType: string): { kind: FieldKind; confidence: number } {
  const value = text.toLowerCase();
  if (/e-?mail|email address/.test(value) || inputType === "email") return { kind: "email", confidence: 0.99 };
  if (/first name|given name|forename/.test(value)) return { kind: "first_name", confidence: 0.96 };
  if (/last name|family name|surname/.test(value)) return { kind: "last_name", confidence: 0.96 };
  if (/phone|mobile|telephone/.test(value) || inputType === "tel") return { kind: "phone", confidence: 0.96 };
  if (/linkedin/.test(value)) return { kind: "linkedin", confidence: 0.97 };
  if (/github/.test(value)) return { kind: "github", confidence: 0.97 };
  if (/portfolio|personal website|website URL/.test(value)) return { kind: "portfolio", confidence: 0.9 };
  if (/city|state|country|location|address/.test(value)) return { kind: "location", confidence: 0.82 };
  if (/years? of experience|experience with|worked with|experience/.test(value)) return { kind: "experience", confidence: 0.78 };
  return { kind: "unknown", confidence: 0.25 };
}

export function extractField(element: Element): DetectedField | null {
  const isEditable = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement || (element as HTMLElement).isContentEditable;
  if (!isEditable || element instanceof HTMLInputElement && !TEXT_TYPES.has(element.type)) return null;

  const html = element as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
  const label = labelFor(element);
  const placeholder = clean(element.getAttribute("placeholder"));
  const ariaLabel = clean(element.getAttribute("aria-label"));
  const name = clean(element.getAttribute("name"));
  const id = clean(element.id);
  const context = clean([label, placeholder, ariaLabel, name, id, nearbyText(element)].filter(Boolean).join(" | "));
  const inputType = element instanceof HTMLInputElement ? element.type : element instanceof HTMLSelectElement ? "select" : "textarea";
  const classification = classify(context, inputType);
  const options = element instanceof HTMLSelectElement ? Array.from(element.options).map((option) => clean(option.text)).filter(Boolean) : [];

  return {
    id: id || `applypilot-${Math.random().toString(36).slice(2)}`,
    elementType: element instanceof HTMLSelectElement ? "select" : (element as HTMLElement).isContentEditable ? "contenteditable" : element instanceof HTMLTextAreaElement ? "textarea" : "input",
    inputType,
    label: label || placeholder || ariaLabel || name || id,
    question: label || nearbyText(element) || placeholder || name || id,
    name: name || undefined,
    placeholder: placeholder || undefined,
    ariaLabel: ariaLabel || undefined,
    options,
    required: element.hasAttribute("required") || element.getAttribute("aria-required") === "true",
    ...classification,
  };
}

export function answerForField(field: DetectedField, profile: import("@applypilot/shared").UserProfile): string | null {
  const answers: Partial<Record<FieldKind, string>> = {
    first_name: profile.firstName,
    last_name: profile.lastName,
    email: profile.email,
    phone: profile.phone,
    location: profile.location,
    linkedin: profile.linkedin,
    github: profile.github,
    portfolio: profile.portfolio,
  };
  if (field.kind === "experience") {
    const question = field.question.toLowerCase();
    const matchedSkill = profile.skills?.find((skill) => question.includes(skill.name.toLowerCase()));
    if (matchedSkill?.years !== undefined) return String(matchedSkill.years);
  }
  return answers[field.kind] ?? null;
}
