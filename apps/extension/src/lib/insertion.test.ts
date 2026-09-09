import { describe, expect, it } from "vitest";
import { canonicalDateValue, fillComboboxVerified, insertValue, insertValueVerified, selectChoiceElement, selectChoiceVerified } from "./insertion";

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
    widget.addEventListener("click", () => { clicked = true; widget.setAttribute("aria-checked", "true"); });
    expect(selectChoiceElement(widget)).toBe(true);
    expect(clicked).toBe(true);
  });

  it("does not double-toggle an unchecked native checkbox", () => {
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    document.body.append(checkbox);
    expect(selectChoiceElement(checkbox)).toBe(true);
    expect(checkbox.checked).toBe(true);
  });

  it("rejects disabled choice controls", async () => {
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.disabled = true;
    expect((await selectChoiceVerified(checkbox)).reason).toBe("disabled");
  });

  it("fails ARIA verification when the widget ignores the click", async () => {
    const widget = document.createElement("div");
    widget.setAttribute("role", "radio");
    widget.setAttribute("aria-checked", "false");
    document.body.append(widget);
    const result = await selectChoiceVerified(widget);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("verification_failed");
  });

  it("verifies an ARIA widget that updates state on click", async () => {
    const widget = document.createElement("div");
    widget.setAttribute("role", "radio");
    widget.setAttribute("aria-checked", "false");
    widget.addEventListener("click", () => widget.setAttribute("aria-checked", "true"));
    document.body.append(widget);
    expect((await selectChoiceVerified(widget)).ok).toBe(true);
  });

  it("matches and verifies a native select by option value", async () => {
    const select = document.createElement("select");
    select.innerHTML = '<option value="">Choose</option><option value="remote_job">Remote</option>';
    document.body.append(select);
    const write = await insertValueVerified(select, "remote_job");
    expect(write.ok).toBe(true);
    expect(write.actualValue).toBe("Remote");
  });

  it("matches a conservatively fuzzy native select label", async () => {
    const select = document.createElement("select");
    select.innerHTML = '<option value="no">No, I do not require sponsorship</option><option value="yes">Yes, I require sponsorship</option>';
    document.body.append(select);
    expect((await insertValueVerified(select, "No")).actualValue).toContain("No");
  });

  it("rejects locale-ambiguous dates rather than guessing", () => {
    expect(canonicalDateValue("date", "01/02/2026")).toBeNull();
    expect(canonicalDateValue("date", "2026-02-01")).toBe("2026-02-01");
  });

  it("writes and verifies a native date", async () => {
    const input = document.createElement("input");
    input.type = "date";
    document.body.append(input);
    const write = await insertValueVerified(input, "2026-09-15");
    expect(write.ok).toBe(true);
    expect(input.value).toBe("2026-09-15");
  });

  it("detects a controlled input that reverts after the input event", async () => {
    const input = document.createElement("input");
    input.value = "old";
    input.addEventListener("input", () => queueMicrotask(() => { input.value = "old"; }));
    document.body.append(input);
    const write = await insertValueVerified(input, "new");
    expect(write.ok).toBe(false);
    expect(write.reason).toBe("verification_failed");
    expect(write.actualValue).toBe("old");
  });

  it("fills a custom combobox only after a matching listbox option appears", async () => {
    const input = document.createElement("input");
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-controls", "cities");
    const list = document.createElement("div");
    list.id = "cities";
    list.setAttribute("role", "listbox");
    const option = document.createElement("div");
    option.setAttribute("role", "option");
    option.textContent = "Bengaluru";
    option.addEventListener("click", () => { option.setAttribute("aria-selected", "true"); input.value = "Bengaluru"; });
    list.append(option);
    document.body.append(input, list);
    expect((await fillComboboxVerified(input, "Bengaluru", 50)).ok).toBe(true);
  });

  it("never guesses when a combobox exposes no options", async () => {
    document.body.innerHTML = "";
    const input = document.createElement("input");
    input.setAttribute("role", "combobox");
    document.body.append(input);
    const write = await fillComboboxVerified(input, "Bengaluru", 1);
    expect(write.ok).toBe(false);
    expect(write.reason).toBe("no_option");
  });
});
