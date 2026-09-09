import { describe, expect, it } from "vitest";
import { answerForField, extractField, extractGroupField, isSensitiveQuestion, matchOption } from "./field-detector";
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

describe("radio and checkbox group detection", () => {
  it("reads the question from a fieldset legend and each option from its label", () => {
    document.body.innerHTML = `
      <fieldset>
        <legend>Are you legally authorized to work in this country?</legend>
        <label><input type="radio" name="work_auth" value="yes" /> Yes</label>
        <label><input type="radio" name="work_auth" value="no" /> No</label>
      </fieldset>`;
    const inputs = Array.from(document.querySelectorAll("input"));
    const field = extractGroupField(document.querySelector("fieldset")!, inputs);
    expect(field?.question).toBe("Are you legally authorized to work in this country?");
    expect(field?.options).toEqual(["Yes", "No"]);
    expect(field?.elementType).toBe("radiogroup");
  });

  it("reports the currently checked option", () => {
    document.body.innerHTML = `
      <fieldset>
        <legend>Preferred contact method</legend>
        <label><input type="radio" name="contact" value="email" checked /> Email</label>
        <label><input type="radio" name="contact" value="phone" /> Phone</label>
      </fieldset>`;
    const inputs = Array.from(document.querySelectorAll("input"));
    const field = extractGroupField(document.querySelector("fieldset")!, inputs);
    expect(field?.currentValue).toBe("Email");
  });

  it("detects a custom ARIA radio group with no native inputs", () => {
    document.body.innerHTML = `
      <div role="radiogroup" aria-label="Highest level of education">
        <div role="radio" aria-checked="false">Bachelor's</div>
        <div role="radio" aria-checked="false">Master's</div>
      </div>`;
    const container = document.querySelector("[role='radiogroup']")!;
    const choices = Array.from(container.querySelectorAll("[role='radio']"));
    const field = extractGroupField(container, choices);
    expect(field?.question).toBe("Highest level of education");
    expect(field?.options).toEqual(["Bachelor's", "Master's"]);
  });

  it("caps confidence for EEO/demographic questions so they are never auto-selected", () => {
    document.body.innerHTML = `
      <fieldset>
        <legend>Gender</legend>
        <label><input type="radio" name="gender" value="m" /> Male</label>
        <label><input type="radio" name="gender" value="f" /> Female</label>
      </fieldset>`;
    const inputs = Array.from(document.querySelectorAll("input"));
    const field = extractGroupField(document.querySelector("fieldset")!, inputs);
    expect(field?.confidence).toBeLessThanOrEqual(0.2);
    expect(isSensitiveQuestion(field!.question)).toBe(true);
  });

  it("flags certification/consent checkboxes as sensitive", () => {
    expect(isSensitiveQuestion("I certify that the above information is true and accurate")).toBe(true);
    expect(isSensitiveQuestion("I agree to the terms and conditions")).toBe(true);
    expect(isSensitiveQuestion("Preferred contact method")).toBe(false);
  });
});

describe("option matching", () => {
  it("matches an exact option case-insensitively", () => {
    expect(matchOption("yes", ["Yes", "No"])).toBe("Yes");
  });

  it("resolves yes/no polarity when the exact phrase differs", () => {
    expect(matchOption("No", ["Yes, I require sponsorship", "No, I do not require sponsorship"])).toBe("No, I do not require sponsorship");
  });

  it("does not let a short value match an unrelated long option by accident", () => {
    // Both options contain "Yes" as a substring; the closer-length one should win.
    expect(matchOption("Yes", ["Yes", "Yes, but I will need relocation assistance in the future"])).toBe("Yes");
  });

  it("only checks a lone standalone checkbox for an affirmative answer", () => {
    expect(matchOption("Yes", ["Subscribe to job alerts"])).toBe("Subscribe to job alerts");
    expect(matchOption("No", ["Subscribe to job alerts"])).toBeNull();
  });

  it("falls back to token overlap for loosely worded options", () => {
    expect(matchOption("5+ years", ["Less than 1 year", "1-3 years", "5+ years of experience"])).toBe("5+ years of experience");
  });

  it("returns null when nothing is a plausible match", () => {
    expect(matchOption("Purple", ["Yes", "No"])).toBeNull();
  });
});
