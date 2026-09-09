import { describe, expect, it } from "vitest";
import { answerForField, extractField } from "./field-detector";
import { demoProfile } from "./profile";

describe("field detector", () => {
  it("uses an associated label and classifies email", () => {
    document.body.innerHTML = '<label for="email">Email address</label><input id="email" type="email" />';
    const field = extractField(document.querySelector("input")!);
    expect(field?.kind).toBe("email");
    expect(field?.question).toBe("Email address");
    expect(answerForField(field!, demoProfile)).toBe(demoProfile.email);
  });

  it("reads dynamic nearby question text", () => {
    document.body.innerHTML = '<div><p>How many years of Python experience do you have?</p><input name="python" /></div>';
    const field = extractField(document.querySelector("input")!);
    expect(field?.kind).toBe("experience");
    expect(field?.confidence).toBeGreaterThan(0.7);
  });

  it("keeps a meaningful placeholder when the visible label is generic", () => {
    document.body.innerHTML = '<label for="answer">Answer</label><textarea id="answer" placeholder="Why do you want to join this company?"></textarea>';
    const field = extractField(document.querySelector("textarea")!);
    expect(field?.question).toBe("Why do you want to join this company?");
    expect(field?.questionSource).toBe("placeholder");
    expect(field?.placeholder).toBe("Why do you want to join this company?");
  });

  it("preserves field metadata for answer generation", () => {
    document.body.innerHTML = '<label for="work-mode">Work mode</label><select id="work-mode" required><option>Remote</option><option>Hybrid</option></select>';
    const field = extractField(document.querySelector("select")!);
    expect(field?.options).toEqual(["Remote", "Hybrid"]);
    expect(field?.required).toBe(true);
    expect(field?.inputType).toBe("select");
  });

  it("never uses a generic placeholder as the question", () => {
    document.body.innerHTML = '<div><input name="current_company" placeholder="Your answer" /></div>';
    const field = extractField(document.querySelector("input")!);
    expect(field?.question).not.toBe("Your answer");
    expect(field?.question).toBe("current company");
    expect(field?.questionSource).toBe("name");
  });

  it("reads the real question from a Google Forms listitem heading", () => {
    document.body.innerHTML =
      '<div role="listitem"><div role="heading">Why do you want this role?</div>'
      + '<input aria-label="Your answer" placeholder="Your answer" /></div>';
    const field = extractField(document.querySelector("input")!);
    expect(field?.question).toBe("Why do you want this role?");
  });

  it("prefers aria-labelledby over the placeholder", () => {
    document.body.innerHTML = '<span id="q7">Notice period</span><input aria-labelledby="q7" placeholder="Type here" />';
    const field = extractField(document.querySelector("input")!);
    expect(field?.question).toBe("Notice period");
    expect(field?.questionSource).toBe("aria_label");
  });

  it("keeps a short two-word label that is not a full sentence", () => {
    document.body.innerHTML = '<label for="co">Current company</label><input id="co" />';
    const field = extractField(document.querySelector("input")!);
    expect(field?.question).toBe("Current company");
  });
});
