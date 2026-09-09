import { describe, expect, it } from "vitest";
import { finalizeLayoutText, PAGE_BREAK, stripRepeatedHeadersAndFooters } from "./resume-layout";

describe("resume layout cleanup", () => {
  it("removes a header that repeats on every page", () => {
    const pages = [
      "Priya Sharma — Resume\nEXPERIENCE\nStaff Engineer",
      "Priya Sharma — Resume\nEDUCATION\nB.Tech",
    ];
    const cleaned = stripRepeatedHeadersAndFooters(pages).join("\n");
    expect(cleaned).not.toContain("Priya Sharma — Resume");
    expect(cleaned).toContain("Staff Engineer");
    expect(cleaned).toContain("B.Tech");
  });

  it("removes a repeating footer even when the page number changes", () => {
    const pages = [
      "EXPERIENCE\nStaff Engineer\npriya@email.com · Page 1 of 2",
      "EDUCATION\nB.Tech\npriya@email.com · Page 2 of 2",
    ];
    const cleaned = stripRepeatedHeadersAndFooters(pages).join("\n");
    expect(cleaned).not.toContain("Page 1 of 2");
    expect(cleaned).not.toContain("Page 2 of 2");
    expect(cleaned).toContain("Staff Engineer");
  });

  it("drops bare page numbers", () => {
    const cleaned = stripRepeatedHeadersAndFooters(["SKILLS\nTypeScript\n2"]).join("\n");
    expect(cleaned).toContain("TypeScript");
    expect(cleaned.split("\n")).not.toContain("2");
  });

  it("keeps content that only appears on one page", () => {
    const pages = ["EXPERIENCE\nStaff Engineer", "EDUCATION\nB.Tech"];
    const cleaned = stripRepeatedHeadersAndFooters(pages).join("\n");
    expect(cleaned).toContain("EXPERIENCE");
    expect(cleaned).toContain("EDUCATION");
  });

  it("joins pages and strips the page-break marker", () => {
    const raw = `${PAGE_BREAK}Page one body${PAGE_BREAK}Page two body`;
    const text = finalizeLayoutText(raw);
    expect(text).not.toContain(PAGE_BREAK);
    expect(text).toContain("Page one body");
    expect(text).toContain("Page two body");
  });
});
