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
});
