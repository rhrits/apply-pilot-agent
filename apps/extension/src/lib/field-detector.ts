import { answerQuestion, type DetectedField, type FieldKind, type QuestionSource, type UserProfile } from "@uplyfox/shared";

const TEXT_TYPES = new Set(["text", "email", "tel", "url", "number", "search", ""]);

function clean(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

/**
 * Placeholder/label text that carries no question meaning. A value matching this is
 * discarded outright — it must never resurface through a fallback tier, which is what
 * previously let Google Forms' "Your answer" placeholder become the question.
 */
function isGenericPrompt(value: string): boolean {
  const text = value.trim().replace(/[*:\s]+$/, "");
  if (!text || text.length < 2) return true;
  if (/^[-–—_.·•]+$/.test(text)) return true;
  return /^(your |the |an |a )?(answer|answers|response|short answer|long answer|your answer|enter (your )?(answer|response|value|text)?|type (your )?(answer|response|here)?|write (your )?(answer|here)?|text|text field|free text|field|value|input|select|select\.{0,3}|select an option|choose|choose an option|please select|pick one|none|n\/a|optional|required|answer here|start typing|search)$/i.test(text);
}

/**
 * A usable question is any meaningful field name, not only an interrogative sentence.
 * The previous rule demanded "?", a trailing ":", a leading question word, or 45+ chars,
 * so ordinary labels like "Current company" were thrown away.
 */
function isQuestionLike(value: string): boolean {
  const text = value.trim();
  if (!text || isGenericPrompt(text)) return false;
  if (/\?|:\s*$/.test(text)) return true;
  if (/^(tell|describe|explain|share|provide|list|why|how|what|where|when|which|do|are|have|will|would|please)\b/i.test(text)) return true;
  if (text.length >= 45) return true;
  // A short noun phrase of two or more words is a legitimate field question.
  return text.split(/\s+/).length >= 2 && text.length <= 160;
}

/** Turn machine names such as `first_name` / `firstName` into readable text. */
function humanizeToken(value: string): string {
  return clean(
    value
      .replace(/[_\-.]+/g, " ")
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/\b\d{4,}\b/g, " "),
  );
}

function currentValue(element: Element): string {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) return clean(element.value);
  return clean((element as HTMLElement).innerText || element.textContent);
}

function nearbyText(element: Element): string {
  const container = element.closest("fieldset, [role='group'], .field, .form-group, .question, li, section, div");
  if (!container) return "";
  return clean((container as HTMLElement).innerText || container.textContent).slice(0, 500);
}

/**
 * Site-specific question resolution. Generic DOM heuristics cannot see how a given ATS
 * associates a question with its control, so each adapter reads the real question from
 * the structure that host actually uses.
 */
const QUESTION_ADAPTERS: Array<{ id: string; matches: (host: string) => boolean; resolve: (element: Element) => string }> = [
  {
    // Google Forms keeps the question in a [role=heading] inside the enclosing listitem,
    // while the input itself only exposes the "Your answer" placeholder/aria-label.
    id: "google-forms",
    matches: (host) => host.endsWith("docs.google.com") || host.endsWith("forms.gle"),
    resolve: (element) => {
      const item = element.closest("[role='listitem']");
      const heading = item?.querySelector("[role='heading']");
      return clean((heading as HTMLElement | null)?.innerText ?? heading?.textContent);
    },
  },
  {
    id: "greenhouse",
    matches: (host) => host.includes("greenhouse.io"),
    resolve: (element) => {
      const field = element.closest(".field, .application-question, [class*='question']");
      const label = field?.querySelector("label, .application-label, legend");
      return clean((label as HTMLElement | null)?.innerText ?? label?.textContent);
    },
  },
  {
    id: "lever",
    matches: (host) => host.includes("lever.co"),
    resolve: (element) => {
      const field = element.closest(".application-question, .application-field, li");
      const label = field?.querySelector(".application-label, label, .text");
      return clean((label as HTMLElement | null)?.innerText ?? label?.textContent);
    },
  },
  {
    id: "workday",
    matches: (host) => host.includes("myworkdayjobs.com") || host.includes("workday.com"),
    resolve: (element) => {
      const group = element.closest("[data-automation-id]");
      const label = group?.querySelector("label, legend, [id$='-label']");
      return clean((label as HTMLElement | null)?.innerText ?? label?.textContent);
    },
  },
  {
    id: "ashby",
    matches: (host) => host.includes("ashbyhq.com"),
    resolve: (element) => {
      const field = element.closest("[class*='_fieldEntry'], [class*='field']");
      const label = field?.querySelector("label, [class*='_label']");
      return clean((label as HTMLElement | null)?.innerText ?? label?.textContent);
    },
  },
];

function adapterQuestion(element: Element): string {
  const host = location.hostname;
  for (const adapter of QUESTION_ADAPTERS) {
    if (!adapter.matches(host)) continue;
    try {
      const value = adapter.resolve(element);
      if (value && !isGenericPrompt(value)) return value.slice(0, 300);
    } catch { /* A hostile or unexpected DOM must never break detection. */ }
  }
  return "";
}

/** Resolve `aria-labelledby` across the document, per the accessible-name algorithm. */
function ariaLabelledByText(element: Element): string {
  const ids = element.getAttribute("aria-labelledby");
  if (!ids) return "";
  const text = ids
    .split(/\s+/)
    .map((id) => {
      const node = document.getElementById(id);
      return node ? (node.innerText || node.textContent || "") : "";
    })
    .filter(Boolean)
    .join(" ");
  return clean(text);
}

/** Nearest preceding heading/legend/label text inside the field's own group. */
function precedingLabelText(element: Element): string {
  const group = element.closest("fieldset, [role='group'], [role='listitem'], .field, .form-group, .question, li");
  if (group) {
    const heading = group.querySelector("legend, [role='heading'], h1, h2, h3, h4, h5, h6, label");
    if (heading && !heading.contains(element)) {
      const text = clean((heading as HTMLElement).innerText || heading.textContent);
      if (text && !isGenericPrompt(text)) return text.slice(0, 300);
    }
  }
  let sibling = element.previousElementSibling;
  let hops = 0;
  while (sibling && hops < 3) {
    const text = clean((sibling as HTMLElement).innerText || sibling.textContent);
    if (text && text.length <= 300 && !isGenericPrompt(text)) return text;
    sibling = sibling.previousElementSibling;
    hops += 1;
  }
  return "";
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
  const nearby = nearbyText(element);
  const adapted = adapterQuestion(element);
  const labelledBy = ariaLabelledByText(element);
  const preceding = precedingLabelText(element);
  const context = clean([adapted, label, ariaLabel, preceding, placeholder, name, id, nearby].filter(Boolean).join(" | "));
  const inputType = element instanceof HTMLInputElement ? element.type : element instanceof HTMLSelectElement ? "select" : "textarea";
  const classification = classify(context, inputType);
  const options = element instanceof HTMLSelectElement ? Array.from(element.options).map((option) => clean(option.text)).filter(Boolean) : [];

  // Accessible-name order (W3C accname): site adapter, then aria-labelledby, aria-label,
  // associated/wrapping label, preceding heading, nearby question text, humanized
  // name/id, and only then placeholder. Every candidate that is generic is dropped
  // outright rather than being re-added by a fallback tier.
  const humanName = humanizeToken(name);
  const humanId = humanizeToken(id);

  const questionCandidate = ([
    { value: adapted, source: "label" as const },
    { value: labelledBy, source: "aria_label" as const },
    { value: ariaLabel, source: "aria_label" as const },
    { value: label, source: "label" as const },
    { value: preceding, source: "nearby_text" as const },
    ...(nearby && isQuestionLike(nearby) ? [{ value: nearby, source: "nearby_text" as const }] : []),
    { value: humanName, source: "name" as const },
    { value: humanId, source: "id" as const },
    { value: placeholder, source: "placeholder" as const },
  ] as Array<{ value: string; source: QuestionSource }>).filter(
    (candidate) => Boolean(candidate.value) && !isGenericPrompt(candidate.value),
  );
  const question = questionCandidate[0] ?? { value: "Focused field", source: "unknown" as const };

  return {
    id: id || `uplyfox-${Math.random().toString(36).slice(2)}`,
    elementType: element instanceof HTMLSelectElement ? "select" : (element as HTMLElement).isContentEditable ? "contenteditable" : element instanceof HTMLTextAreaElement ? "textarea" : "input",
    inputType,
    label: adapted || label || ariaLabel || preceding || humanizeToken(name) || humanizeToken(id) || placeholder,
    question: question.value,
    questionSource: question.source,
    nearbyText: nearby || undefined,
    name: name || undefined,
    placeholder: placeholder || undefined,
    ariaLabel: ariaLabel || undefined,
    currentValue: currentValue(element) || undefined,
    options,
    required: element.hasAttribute("required") || element.getAttribute("aria-required") === "true",
    ...classification,
  };
}

export function answerForField(field: DetectedField, profile: UserProfile): string | null {
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
  const direct = answers[field.kind];
  if (direct) return direct;
  // Fall back to the shared intent engine so notice period, salary, current company,
  // and per-skill experience questions are answered from verified profile data too.
  const engine = answerQuestion(`${field.label} ${field.question}`.trim(), profile);
  return engine.source === "profile" && engine.answer ? engine.answer : null;
}

/**
 * Radio/checkbox questions this tool must never answer automatically.
 *
 * These fall into two families: EEO/demographic disclosures (race, gender, disability,
 * veteran status, etc.) that are legally sensitive and optional by design, and
 * certification/consent attestations ("I certify that...", "I agree to the terms").
 * Both are hard-stop categories — detected and shown to the user, never auto-selected,
 * regardless of how confident the match looks.
 */
const SENSITIVE_QUESTION_PATTERN = /\brace\b|ethnicit|\bgender\b|gender identity|\btransgender\b|\bsex\b|disabilit|veteran|military service|sexual orientation|criminal (record|history|conviction)|security clearance|\bpregnan|\breligio|national origin|\bi certify\b|\bi agree\b|terms (and|&) conditions|\bconsent\b|\backnowledge\b|under penalty of perjury/i;

export function isSensitiveQuestion(text: string): boolean {
  return SENSITIVE_QUESTION_PATTERN.test(text);
}

/** The visible text identifying one choice in a radio/checkbox group. */
export function labelForChoice(element: Element): string {
  if (element instanceof HTMLInputElement) {
    const linked = element.labels?.[0]?.innerText;
    if (linked) return clean(linked);
    const aria = clean(element.getAttribute("aria-label"));
    if (aria) return aria;
    const labelledBy = ariaLabelledByText(element);
    if (labelledBy) return labelledBy;
    // Many ATS wrap the input in its own <label>, or place the text as the next sibling
    // rather than using a `for` attribute at all.
    const wrapping = element.closest("label");
    if (wrapping) {
      const text = clean((wrapping as HTMLElement).innerText || wrapping.textContent);
      if (text) return text;
    }
    const sibling = element.nextElementSibling;
    if (sibling) {
      const text = clean((sibling as HTMLElement).innerText || sibling.textContent);
      if (text) return text;
    }
    return clean(element.value) || "Option";
  }
  const aria = clean(element.getAttribute("aria-label"));
  if (aria) return aria;
  const labelledBy = ariaLabelledByText(element);
  if (labelledBy) return labelledBy;
  return clean((element as HTMLElement).innerText || element.textContent) || "Option";
}

function isChoiceChecked(element: Element): boolean {
  if (element instanceof HTMLInputElement) return element.checked;
  return element.getAttribute("aria-checked") === "true";
}

/** Groups a set of same-question radio/checkbox controls into one detected field. */
export function extractGroupField(container: Element, elements: Element[]): DetectedField | null {
  if (!elements.length) return null;
  const isCheckbox = elements[0] instanceof HTMLInputElement
    ? (elements[0] as HTMLInputElement).type === "checkbox"
    : elements[0].getAttribute("role") === "checkbox";

  const adapted = adapterQuestion(container);
  const labelledBy = ariaLabelledByText(container);
  const ariaLabel = clean(container.getAttribute("aria-label"));
  const legend = container.querySelector(":scope > legend, :scope > [role='heading']");
  const legendText = legend ? clean((legend as HTMLElement).innerText || legend.textContent) : "";
  const preceding = precedingLabelText(container);
  const nearby = nearbyText(container);
  const options = elements.map(labelForChoice);

  const questionCandidate = [adapted, labelledBy, ariaLabel, legendText, preceding]
    .find((value) => Boolean(value) && !isGenericPrompt(value));
  const question = questionCandidate || (nearby && isQuestionLike(nearby) ? nearby : "") || options.join(" / ") || "Select an option";

  const currentValue = elements
    .map((element, index) => (isChoiceChecked(element) ? options[index] : null))
    .filter((value): value is string => Boolean(value))
    .join(", ");

  const sensitive = isSensitiveQuestion(question) || isSensitiveQuestion(nearby);
  const classification = classify(question, isCheckbox ? "checkbox" : "radio");

  return {
    id: `uplyfox-group-${Math.random().toString(36).slice(2)}`,
    elementType: isCheckbox ? "checkboxgroup" : "radiogroup",
    inputType: isCheckbox ? "checkbox" : "radio",
    label: question,
    question,
    questionSource: adapted ? "label" : labelledBy || ariaLabel ? "aria_label" : legendText || preceding ? "label" : "nearby_text",
    nearbyText: nearby || undefined,
    currentValue: currentValue || undefined,
    options,
    required: elements.some((element) => element.hasAttribute("required") || element.getAttribute("aria-required") === "true"),
    kind: classification.kind,
    // Sensitive questions are capped low so they always land in "needs review" and are
    // never auto-selected, no matter how the text happens to classify.
    confidence: sensitive ? Math.min(classification.confidence, 0.2) : classification.confidence,
  };
}

const STOPWORDS = new Set(["the", "a", "an", "and", "or", "of", "to", "i", "am", "my", "is", "are"]);

function tokenize(value: string): string[] {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(/\s+/).filter((word) => word.length > 1 && !STOPWORDS.has(word));
}

const AFFIRMATIVE = new Set(["yes", "y", "true", "agree", "accept", "i agree"]);
const NEGATIVE = new Set(["no", "n", "false", "disagree", "decline"]);

/**
 * Picks the option that best matches a free-text profile answer.
 *
 * Radio/checkbox options are exact phrases the ATS wrote ("I do not require
 * sponsorship"), while the profile stores a short free-text answer ("No"). Exact
 * matching alone would almost never fire, so this layers progressively looser
 * comparisons and stops at the first one that produces a confident result.
 */
export function matchOption(value: string, options: string[]): string | null {
  const trimmedValue = value.trim();
  if (!trimmedValue || !options.length) return null;
  const normalizedValue = trimmedValue.toLowerCase();

  // 1. Exact match, case-insensitive.
  const exact = options.find((option) => option.trim().toLowerCase() === normalizedValue);
  if (exact) return exact;

  // 2. A single-option group is a standalone checkbox (e.g. "Subscribe to updates").
  // Only affirmative answers check it; anything else is left alone deliberately.
  if (options.length === 1) return AFFIRMATIVE.has(normalizedValue) ? options[0] : null;

  // 3. Yes/no polarity: prefer the option that clearly starts with the same polarity
  // word, so "No" does not accidentally match "No, I will require sponsorship" over a
  // plain "No" when both exist, but still resolves correctly when only one is present.
  if (AFFIRMATIVE.has(normalizedValue) || NEGATIVE.has(normalizedValue)) {
    const wantAffirmative = AFFIRMATIVE.has(normalizedValue);
    const polarity = options.filter((option) => {
      const first = option.trim().toLowerCase().split(/[\s,.]/)[0];
      return wantAffirmative ? AFFIRMATIVE.has(first) : NEGATIVE.has(first);
    });
    if (polarity.length === 1) return polarity[0];
    if (polarity.length > 1) return polarity.reduce((shortest, option) => option.length < shortest.length ? option : shortest);
  }

  // 4. Containment either direction, preferring the closer length (avoids a short value
  // like "Yes" preferring an unrelated long option that merely happens to contain it).
  const containing = options.filter((option) => option.toLowerCase().includes(normalizedValue) || normalizedValue.includes(option.toLowerCase()));
  if (containing.length) {
    return containing.reduce((closest, option) => Math.abs(option.length - trimmedValue.length) < Math.abs(closest.length - trimmedValue.length) ? option : closest);
  }

  // 5. Token overlap, above a threshold so unrelated options are never forced to match.
  const valueTerms = new Set(tokenize(trimmedValue));
  if (!valueTerms.size) return null;
  let best: { option: string; score: number } | null = null;
  for (const option of options) {
    const optionTerms = new Set(tokenize(option));
    if (!optionTerms.size) continue;
    let overlap = 0;
    for (const term of valueTerms) if (optionTerms.has(term)) overlap += 1;
    const score = overlap / Math.max(valueTerms.size, optionTerms.size);
    if (score >= 0.34 && (!best || score > best.score)) best = { option, score };
  }
  return best?.option ?? null;
}
