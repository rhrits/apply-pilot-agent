import { NextResponse } from "next/server";
import type { LinkEnrichment } from "@uplyfox/shared";

export const runtime = "nodejs";

const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, Authorization", "Access-Control-Allow-Methods": "POST, OPTIONS" };

export function OPTIONS() { return new NextResponse(null, { status: 204, headers }); }

/**
 * Sites that block automated access or forbid it in their terms. We do not attempt
 * these; the onboarding UI asks the user to paste an export instead.
 */
const BLOCKED_HOSTS = [/(^|\.)linkedin\.com$/i, /(^|\.)facebook\.com$/i, /(^|\.)instagram\.com$/i, /(^|\.)x\.com$/i, /(^|\.)twitter\.com$/i];

/**
 * Rejects private/internal addresses to prevent server-side request forgery.
 * Only public http(s) origins are fetched.
 */
function validateUrl(raw: string): { url: URL } | { error: string } {
  let url: URL;
  try { url = new URL(raw.trim()); } catch { return { error: "That does not look like a valid URL." }; }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { error: "Only http and https links are supported." };
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) return { error: "Local addresses are not allowed." };
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    const parts = host.split(".").map(Number);
    const isPrivate = parts[0] === 10 || parts[0] === 127 || parts[0] === 0 || (parts[0] === 192 && parts[1] === 168) || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 169 && parts[1] === 254);
    if (isPrivate) return { error: "Private network addresses are not allowed." };
  }
  if (host === "[::1]" || host.startsWith("[fd") || host.startsWith("[fe80")) return { error: "Private network addresses are not allowed." };
  if (BLOCKED_HOSTS.some((pattern) => pattern.test(host))) return { error: `${url.hostname} blocks automated access. Export your profile from that site and paste the text instead.` };
  return { url };
}

function stripTags(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function metaContent(html: string, name: string) {
  const pattern = new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]*content=["']([^"']*)["']`, "i");
  const reversed = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:name|property)=["']${name}["']`, "i");
  return (html.match(pattern)?.[1] ?? html.match(reversed)?.[1] ?? "").trim();
}

const TECH_KEYWORDS = ["typescript", "javascript", "python", "react", "next.js", "node.js", "supabase", "postgresql", "mongodb", "redis", "docker", "kubernetes", "aws", "azure", "gcp", "graphql", "rest api", "tailwind", "vue", "angular", "svelte", "django", "flask", "fastapi", "rust", "go", "java", "kotlin", "swift", "tensorflow", "pytorch", "langchain", "openai", "llm", "rag"];

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const validation = validateUrl(typeof body.url === "string" ? body.url : "");
  if ("error" in validation) return NextResponse.json({ error: validation.error }, { status: 400, headers });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  let response: Response;
  try {
    response = await fetch(validation.url, { signal: controller.signal, redirect: "follow", headers: { "User-Agent": "UplyFox/1.0 (+profile enrichment; respects robots)", Accept: "text/html,application/xhtml+xml" } });
  } catch {
    clearTimeout(timeout);
    return NextResponse.json({ error: "Could not reach that link. Check the URL or paste the details manually." }, { status: 502, headers });
  }
  clearTimeout(timeout);

  if (!response.ok) return NextResponse.json({ error: `That link returned HTTP ${response.status}.` }, { status: 502, headers });
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("html") && !contentType.includes("text")) return NextResponse.json({ error: "Only web pages can be read automatically." }, { status: 415, headers });

  const html = (await response.text()).slice(0, 400_000);
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").trim() || metaContent(html, "og:title") || validation.url.hostname;
  const description = metaContent(html, "description") || metaContent(html, "og:description");
  const text = stripTags(html).slice(0, 4000);
  const haystack = `${title} ${description} ${text}`.toLowerCase();

  const enrichment: LinkEnrichment = {
    url: validation.url.toString(),
    title: stripTags(title).slice(0, 200),
    description: description.slice(0, 400),
    text,
    technologies: TECH_KEYWORDS.filter((keyword) => haystack.includes(keyword)),
  };
  return NextResponse.json(enrichment, { headers });
}
