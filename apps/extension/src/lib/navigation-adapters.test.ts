import { describe, expect, it } from "vitest";
import { adapterForHost, isSafeNextElement } from "./navigation-adapters";

describe("strict navigation adapters", () => {
  it("supports only allowlisted ATS hosts", () => {
    expect(adapterForHost("company.wd5.myworkdayjobs.com")?.id).toBe("workday");
    expect(adapterForHost("jobs.greenhouse.io")?.id).toBe("greenhouse");
    expect(adapterForHost("unknown.example.com")).toBeNull();
  });

  it("accepts an allowlisted native type=button Next control", () => {
    const adapter = adapterForHost("company.wd5.myworkdayjobs.com")!;
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.automationId = "bottom-navigation-next-button";
    button.textContent = "Next";
    expect(isSafeNextElement(button, adapter)).toBe(true);
  });

  it("rejects the same selector if its effective type is submit", () => {
    const adapter = adapterForHost("company.wd5.myworkdayjobs.com")!;
    const button = document.createElement("button");
    button.type = "submit";
    button.dataset.automationId = "bottom-navigation-next-button";
    button.textContent = "Next";
    expect(isSafeNextElement(button, adapter)).toBe(false);
  });

  it("rejects submit/review/apply wording even on an allowlisted selector", () => {
    const adapter = adapterForHost("company.wd5.myworkdayjobs.com")!;
    for (const label of ["Submit application", "Review and submit", "Apply now", "Finish"]) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.automationId = "bottom-navigation-next-button";
      button.textContent = label;
      expect(isSafeNextElement(button, adapter), label).toBe(false);
    }
  });

  it("rejects disabled and non-native controls", () => {
    const adapter = adapterForHost("company.wd5.myworkdayjobs.com")!;
    const disabled = document.createElement("button");
    disabled.type = "button";
    disabled.disabled = true;
    disabled.dataset.automationId = "bottom-navigation-next-button";
    disabled.textContent = "Next";
    expect(isSafeNextElement(disabled, adapter)).toBe(false);

    const fake = document.createElement("div");
    fake.setAttribute("role", "button");
    fake.dataset.automationId = "bottom-navigation-next-button";
    fake.textContent = "Next";
    expect(isSafeNextElement(fake, adapter)).toBe(false);
  });
});
