import { describe, expect, it } from "vitest";
import { insertValue, selectChoiceElement } from "./insertion";

describe("insertion engine", () => {
  it("updates React-like inputs and emits input", () => {
    const input = document.createElement("input");
    document.body.append(input);
    let emitted = false;
    input.addEventListener("input", () => { emitted = true; });
    expect(insertValue(input, "hello")).toBe(true);
    expect(input.value).toBe("hello");
    expect(emitted).toBe(true);
  });

  it("selects an option by visible label", () => {
    const select = document.createElement("select");
    select.innerHTML = '<option value="b">Bachelor\'s</option>';
    document.body.append(select);
    expect(insertValue(select, "Bachelor's")).toBe(true);
    expect(select.value).toBe("b");
  });

  it("checks a native radio input and emits change", () => {
    const radio = document.createElement("input");
    radio.type = "radio";
    document.body.append(radio);
    let changed = false;
    radio.addEventListener("change", () => { changed = true; });
    expect(selectChoiceElement(radio)).toBe(true);
    expect(radio.checked).toBe(true);
    expect(changed).toBe(true);
  });

  it("is a no-op when the radio is already checked", () => {
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.checked = true;
    document.body.append(radio);
    let changed = false;
    radio.addEventListener("change", () => { changed = true; });
    expect(selectChoiceElement(radio)).toBe(true);
    expect(changed).toBe(false);
  });

  it("clicks a custom ARIA radio widget instead of setting a property", () => {
    const widget = document.createElement("div");
    widget.setAttribute("role", "radio");
    widget.setAttribute("aria-checked", "false");
    document.body.append(widget);
    let clicked = false;
    widget.addEventListener("click", () => { clicked = true; });
    expect(selectChoiceElement(widget)).toBe(true);
    expect(clicked).toBe(true);
  });
});
