import { NextResponse } from "next/server";
import pdfParse from "pdf-parse";
import { cleanTitle, type ResumeAnalysis, type UserProfile } from "@applypilot/shared";

export const runtime = "nodejs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

function clean(value: string) {
  return value.replace(/\u0000/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

const HEADING_PATTERN = /^(summary|professional summary|profile|about( me)?|objective|experience|work experience|professional experience|employment( history)?|career history|education|academic background|skills|technical skills|core competencies|areas of expertise|tools( (and|&) technologies)?|projects|personal projects|certifications?|licenses?( (and|&) certifications)?|awards?( (and|&) honors)?|achievements|honors|volunteer( experience)?|publications|languages)\s*:?$/i;

// A shorter, exact-match unit list used to validate each side of compound headings like
// "Education & Certifications" or "Skills and Tools" that HEADING_PATTERN alone would miss.
const HEADING_UNIT = /^(summary|profile|objective|experience|professional experience|employment|education|academic background|skills|technical skills|core competencies|areas of expertise|tools|projects|personal projects|certifications?|licenses?|awards?|honors?|achievements|volunteer( experience)?|publications|languages)$/i;

function looksLikeHeading(line: string) {
  const value = line.trim();
  if (!value || value.length > 48) return false;
  if (HEADING_PATTERN.test(value)) return true;
  // All-caps short lines (e.g. "WORK EXPERIENCE") that aren't sentences are usually headings too.
  if (/^[A-Z][A-Z &/]{2,40}$/.test(value) && !/[.,]/.test(value)) return true;
  // Compound headings such as "Education & Certifications" or "Skills and Tools": every
  // segment split on "&"/"and" must independently look like a heading keyword.
  if (/[.!?]$/.test(value)) return false;
  const segments = value.replace(/:$/, "").split(/\s*(?:&|\band\b)\s*/i).map((segment) => segment.trim());
  return segments.length >= 2 && segments.length <= 3 && segments.every((segment) => HEADING_UNIT.test(segment));
}

function sectionize(text: string) {
  const sections: Array<{ title: string; content: string }> = [];
  let current = { title: "Contact", content: "" };
  for (const line of text.split("\n")) {
    if (looksLikeHeading(line)) {
      if (current.content.trim()) sections.push({ ...current, content: clean(current.content) });
      current = { title: line.trim().replace(/:$/, ""), content: "" };
    } else {
      current.content += `${line}\n`;
    }
  }
  if (current.content.trim()) sections.push({ ...current, content: clean(current.content) });
  return sections;
}

function normalizeUrl(value: string) {
  const trimmed = value.trim().replace(/[.,;)]+$/, "");
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function findLink(text: string, matcher: RegExp) {
  const withProtocol = [...text.matchAll(/https?:\/\/[^\s|,)]+/gi)].map((match) => match[0]).find((link) => matcher.test(link));
  if (withProtocol) return normalizeUrl(withProtocol);
  const bareDomain = [...text.matchAll(/(?<!@)\b((?:www\.)?[a-z0-9-]+\.(?:com|dev|io|me|net)(?:\/[^\s|,)]*)?)/gi)].map((match) => match[0]).find((link) => matcher.test(link) && !/\.(?:png|jpg|jpeg|svg|gif)$/i.test(link));
  return bareDomain ? normalizeUrl(bareDomain) : "";
}

function findLocation(text: string) {
  const headerBlock = text.split("\n").slice(0, 6).join(" | ");
  const match = headerBlock.match(/\b([A-Z][a-zA-Z.'\- ]{2,25},\s?[A-Z]{2}(?:\b|,)|[A-Z][a-zA-Z.'\- ]{2,25},\s?[A-Z][a-zA-Z.'\- ]{2,25})\b/);
  return match ? match[1].replace(/,$/, "").trim() : "";
}

function category(title: string): "summary" | "experience" | "skills" | "education" | "projects" | "certifications" | "other" {
  const value = title.toLowerCase();
  if (value.includes("summary") || value === "profile" || value.includes("about") || value.includes("objective")) return "summary";
  if (value.includes("experience") || value.includes("employment") || value.includes("career history")) return "experience";
  if (value.includes("skill") || value.includes("competenc") || value.includes("expertise") || value.includes("tools")) return "skills";
  if (value.includes("education") || value.includes("academic")) return "education";
  if (value.includes("project")) return "projects";
  if (value.includes("certif") || value.includes("award") || value.includes("honor") || value.includes("licens")) return "certifications";
  return "other";
}

const DATE_RANGE = /((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*)?(?:\d{4}|present|current)\s*(?:-|–|—|to)\s*(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*)?(?:\d{4}|present|current)/i;

function extractPeriod(text: string) {
  const parenthetical = text.match(/\(([^)]*\d{4}[^)]*)\)/);
  if (parenthetical) return parenthetical[1].trim();
  const inline = text.match(DATE_RANGE);
  return inline ? inline[0].trim() : "";
}

function parseExperienceHeader(header: string) {
  const period = extractPeriod(header);
  const withoutPeriod = header.replace(/\([^)]*\)/, "").replace(DATE_RANGE, "").replace(/[|,-]\s*$/, "").trim();
  let title = withoutPeriod;
  let company = "";
  const atMatch = withoutPeriod.match(/^(.+?)\s+(?:at|@)\s+(.+)$/i);
  const dashMatch = withoutPeriod.match(/^(.+?)\s*[|–—-]\s*(.+)$/);
  const commaMatch = withoutPeriod.match(/^(.+?),\s*(.+)$/);
  if (atMatch) { title = atMatch[1].trim(); company = atMatch[2].trim(); }
  else if (commaMatch) { title = commaMatch[1].trim(); company = commaMatch[2].trim(); }
  else if (dashMatch) { title = dashMatch[1].trim(); company = dashMatch[2].trim(); }
  return { title, company, period };
}

const JOB_TITLE_KEYWORDS = /engineer|developer|designer|manager|analyst|scientist|architect|consultant|specialist|lead|director|intern/i;
const BULLET_PREFIX = /^[-*•–—]\s+/;

function parseExperienceSection(content: string) {
  // Split into role blocks on blank lines, and also mid-block whenever a new non-bullet line
  // contains a date range after bullets have already started (resumes that omit blank lines
  // between roles within the same "Experience" heading).
  const lines = content.split("\n").map((line) => line.trim()).filter(Boolean);
  const blocks: string[][] = [];
  let current: string[] = [];
  for (const line of lines) {
    const isBullet = BULLET_PREFIX.test(line);
    const startsNewRole = !isBullet && current.some((prev) => BULLET_PREFIX.test(prev)) && extractPeriod(line) !== "";
    if (startsNewRole) { blocks.push(current); current = [line]; } else { current.push(line); }
  }
  if (current.length) blocks.push(current);

  return blocks.map((blockLines) => {
    const bulletStart = blockLines.findIndex((line) => BULLET_PREFIX.test(line));
    const headerLines = bulletStart === -1 ? blockLines.slice(0, 2) : blockLines.slice(0, Math.min(2, bulletStart));
    const bulletLines = bulletStart === -1 ? [] : blockLines.slice(bulletStart);

    const parsedHeader = parseExperienceHeader(headerLines[0] ?? "");
    let { title, company, period } = parsedHeader;
    const secondLine = headerLines[1] ?? "";

    // Two-line layout where the header has no separator (e.g. "Company\nJob Title, Location"):
    // trust whichever line contains a recognizable job-title keyword as the title.
    if (!parsedHeader.company && secondLine) {
      if (JOB_TITLE_KEYWORDS.test(secondLine) && !JOB_TITLE_KEYWORDS.test(headerLines[0] ?? "")) {
        company = title;
        title = secondLine.replace(/\([^)]*\)\s*$/, "").trim();
      } else if (!period) {
        period = extractPeriod(secondLine);
      }
    }

    const achievements = bulletLines.map((line) => line.replace(BULLET_PREFIX, "").trim()).filter(Boolean);
    return { company, title: cleanTitle(title), period, summary: achievements.join(" "), achievements };
  });
}


function parseEducationSection(content: string) {
  return content.split(/\n+/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const period = extractPeriod(line);
    const withoutPeriod = line.replace(/\([^)]*\)/, "").replace(DATE_RANGE, "").trim();
    const [degreePart, institutionPart] = withoutPeriod.split(/,\s*/, 2);
    return { institution: institutionPart?.trim() || (degreePart && !institutionPart ? "" : ""), degree: degreePart?.trim() || "", field: "", period };
  }).map((entry, index, all) => all.length === 1 && !entry.institution ? { ...entry, institution: entry.degree, degree: "" } : entry);
}

function parseProjectsSection(content: string) {
  return content.split(/\n+/).map((line) => line.replace(BULLET_PREFIX, "").trim()).filter(Boolean).map((line) => {
    const separatorMatch = line.match(/^(.+?)\s*[-:–—]\s*(.+)$/);
    return separatorMatch ? { name: separatorMatch[1].trim(), description: separatorMatch[2].trim() } : { name: line, description: "" };
  });
}

function estimateTotalExperience(experiences: Array<{ period?: string }>) {
  const years = experiences.flatMap((experience) => experience.period?.match(/\b(19|20)\d{2}\b/g) ?? []).map(Number).filter(Number.isFinite);
  if (!years.length) return "";
  const start = Math.min(...years);
  const end = experiences.some((experience) => /present|current/i.test(experience.period ?? "")) ? new Date().getFullYear() : Math.max(...years);
  const total = Math.max(1, end - start);
  return `${total} years`;
}

function heuristicAnalysis(rawText: string): ResumeAnalysis {
  const text = clean(rawText);
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const email = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? "";
  const phone = text.match(/(?:\+?\d[\d ()-]{7,}\d)/)?.[0]?.trim() ?? "";
  const linkedin = findLink(text, /linkedin\.com/i);
  const github = findLink(text, /github\.com/i);
  const portfolio = findLink(text, /^(?!.*linkedin\.com)(?!.*github\.com).+$/i);
  const location = findLocation(text);
  const firstLine = lines.find((line) => !/@|resume|curriculum vitae/i.test(line) && !looksLikeHeading(line)) ?? "";
  const nameParts = firstLine.split(/\s+/).slice(0, 4);
  const sections = sectionize(text).map((section) => ({ ...section, category: category(section.title) }));
  const skillsSection = sections.find((section) => section.category === "skills")?.content ?? "";
  const skillNames = skillsSection.split(/[|,•·]|\s{2,}/).map((skill) => skill.replace(/^[-*]\s*/, "").trim()).filter((skill) => skill.length > 1 && skill.length < 45).slice(0, 30);
  const summary = sections.find((section) => section.category === "summary")?.content ?? "";
  const experienceSection = sections.find((section) => section.category === "experience")?.content ?? "";
  const educationSection = sections.find((section) => section.category === "education")?.content ?? "";
  const experiences = experienceSection ? parseExperienceSection(experienceSection) : [];
  const education = educationSection ? parseEducationSection(educationSection) : [];
  const projects = sections.filter((section) => section.category === "projects").flatMap((section) => parseProjectsSection(section.content));
  const currentTitle = experiences[0]?.title || cleanTitle(lines.find((line) => /engineer|developer|designer|manager|analyst|scientist|architect|consultant|specialist|lead|director/i.test(line) && line.length < 80 && !looksLikeHeading(line)) || "");
  return {
    formattedText: sections.map((section) => `## ${section.title}\n${section.content}`).join("\n\n"),
    profile: {
      firstName: nameParts[0] ?? "",
      lastName: nameParts.slice(1).join(" "),
      email,
      phone,
      location,
      linkedin,
      github,
      portfolio,
      currentTitle,
      summary,
      totalExperience: estimateTotalExperience(experiences),
      skills: skillNames.map((name) => ({ name })),
      experiences,
      education,
      projects,
    },
    sections,
    suggestions: [
      email ? "Review the extracted contact details." : "Add an email address to your profile.",
      skillNames.length ? "Review skills and add years of experience." : "Add a dedicated skills section with tools and proficiency.",
      experiences.length ? "Confirm each role's company, title, and dates split correctly." : "Add role titles, employers, dates, and quantified impact.",
    ],
    source: "heuristic",
  };
}

function parseModelJson(content: string): ResumeAnalysis | null {
  try {
    const json = content.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
    const value = JSON.parse(json) as Partial<ResumeAnalysis>;
    if (!value.profile || !value.formattedText || !Array.isArray(value.sections)) return null;
    return { ...value, suggestions: value.suggestions ?? [], source: "ai" } as ResumeAnalysis;
  } catch {
    return null;
  }
}

async function improveWithMistral(analysis: ResumeAnalysis): Promise<ResumeAnalysis> {
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) return analysis;
  let response: Response;
  try {
    response = await fetch("https://api.mistral.ai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.MISTRAL_MODEL || "mistral-small-latest",
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "You are a careful resume information architect. Extract only facts present in the resume. Never invent employers, dates, skills, metrics, education, or URLs. Return valid JSON with keys formattedText, profile, sections, suggestions. profile must contain firstName, lastName, email, phone, location, linkedin, github, portfolio, currentTitle, summary, skills [{name, years, proficiency}], experiences [{company, title, period, summary, achievements}], education [{institution, degree, field, period}], projects [{name, description, technologies, impact}]. sections must contain title, content, category where category is summary, experience, skills, education, projects, certifications, or other. Format the resume into a clear, ATS-friendly structure without changing facts." },
          { role: "user", content: JSON.stringify({ rawResume: analysis.formattedText, initialExtraction: analysis.profile }) },
        ],
      }),
    });
  } catch {
    return { ...analysis, aiNotice: "Could not reach Mistral. Showing the locally extracted profile instead." };
  }
  if (response.status === 429) return { ...analysis, aiNotice: "AI enhancement is temporarily unavailable. Showing the locally extracted profile instead." };
  if (!response.ok) return { ...analysis, aiNotice: `Mistral request failed (HTTP ${response.status}). Showing the locally extracted profile instead.` };
  const payload = await response.json();
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content !== "string") return { ...analysis, aiNotice: "Mistral returned an unexpected response. Showing the locally extracted profile instead." };
  const parsed = parseModelJson(content);
  return parsed ?? { ...analysis, aiNotice: "Mistral's response could not be parsed as structured JSON. Showing the locally extracted profile instead." };
}

export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const pastedText = form?.get("text");
  const file = form?.get("file");
  let text = typeof pastedText === "string" ? pastedText : "";

  if (file instanceof File) {
    if (file.size > 8 * 1024 * 1024) return NextResponse.json({ error: "Resume files must be 8 MB or smaller." }, { status: 413, headers: corsHeaders });
    if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
      const parsed = await pdfParse(Buffer.from(await file.arrayBuffer()));
      text = parsed.text;
    } else if (file.type.startsWith("text/") || /\.txt$|\.md$/i.test(file.name)) {
      text = await file.text();
    } else {
      return NextResponse.json({ error: "Upload a PDF, TXT, or Markdown resume for now." }, { status: 415, headers: corsHeaders });
    }
  }

  if (text.trim().length < 40) return NextResponse.json({ error: "Add more resume text or upload a readable file." }, { status: 400, headers: corsHeaders });
  const analysis = await improveWithMistral(heuristicAnalysis(text));
  return NextResponse.json(analysis, { headers: corsHeaders });
}
