import { describe, expect, it } from "vitest";
import { insertValue } from "./insertion";

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
});
