import { NextResponse } from "next/server";
import type { GitHubEnrichment } from "@uplyfox/shared";

export const runtime = "nodejs";

const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, Authorization", "Access-Control-Allow-Methods": "POST, OPTIONS" };

export function OPTIONS() { return new NextResponse(null, { status: 204, headers }); }

/** Accepts a username, a profile URL, or any github.com link and returns the username. */
function parseUsername(input: string): string | null {
  const trimmed = input.trim().replace(/\/+$/, "");
  if (!trimmed) return null;
  const urlMatch = trimmed.match(/github\.com\/([A-Za-z0-9-]+)/i);
  const candidate = urlMatch ? urlMatch[1] : trimmed;
  return /^[A-Za-z0-9-]{1,39}$/.test(candidate) ? candidate : null;
}

function githubHeaders() {
  const base: Record<string, string> = { Accept: "application/vnd.github+json", "User-Agent": "UplyFox" };
  // Optional server token for authenticated GitHub API access. Never exposed to the client.
  if (process.env.GITHUB_TOKEN) base.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return base;
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const username = parseUsername(typeof body.username === "string" ? body.username : "");
  if (!username) return NextResponse.json({ error: "Provide a GitHub username or profile URL." }, { status: 400, headers });

  const profileResponse = await fetch(`https://api.github.com/users/${username}`, { headers: githubHeaders() });
  if (profileResponse.status === 404) return NextResponse.json({ error: `GitHub user "${username}" was not found.` }, { status: 404, headers });
  if (profileResponse.status === 403) return NextResponse.json({ error: "GitHub is temporarily unavailable. You can continue without GitHub enrichment." }, { status: 502, headers });
  if (!profileResponse.ok) return NextResponse.json({ error: "Could not reach GitHub." }, { status: 502, headers });
  const profile = await profileResponse.json();

  const reposResponse = await fetch(`https://api.github.com/users/${username}/repos?per_page=100&sort=updated`, { headers: githubHeaders() });
  const repos: Array<Record<string, unknown>> = reposResponse.ok ? await reposResponse.json() : [];

  const owned = repos.filter((repo) => !repo.fork);
  const languageCounts = new Map<string, number>();
  for (const repo of owned) {
    const language = typeof repo.language === "string" ? repo.language : null;
    if (language) languageCounts.set(language, (languageCounts.get(language) ?? 0) + 1);
  }

  const enrichment: GitHubEnrichment = {
    username,
    name: profile.name ?? undefined,
    bio: profile.bio ?? undefined,
    company: profile.company ?? undefined,
    location: profile.location ?? undefined,
    blog: profile.blog || undefined,
    publicRepos: Number(profile.public_repos ?? 0),
    followers: Number(profile.followers ?? 0),
    topLanguages: [...languageCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([language]) => language),
    repositories: owned
      .sort((a, b) => Number(b.stargazers_count ?? 0) - Number(a.stargazers_count ?? 0))
      .slice(0, 20)
      .map((repo) => ({
        name: String(repo.name ?? ""),
        description: typeof repo.description === "string" ? repo.description : undefined,
        language: typeof repo.language === "string" ? repo.language : undefined,
        topics: Array.isArray(repo.topics) ? repo.topics.map(String) : [],
        stars: Number(repo.stargazers_count ?? 0),
        forks: Number(repo.forks_count ?? 0),
        url: String(repo.html_url ?? ""),
        homepage: typeof repo.homepage === "string" && repo.homepage ? repo.homepage : undefined,
        updatedAt: String(repo.updated_at ?? ""),
      })),
  };

  return NextResponse.json(enrichment, { headers });
}
