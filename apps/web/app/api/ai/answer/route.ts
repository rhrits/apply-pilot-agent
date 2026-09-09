import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { answerQuestion, cleanTitle, type DetectedField, type UserProfile } from "@applypilot/shared";
import { runSuggestionAgent } from "../../../../lib/suggestion-agent";

export const runtime = "nodejs";

const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, Authorization", "Access-Control-Allow-Methods": "POST, OPTIONS" };

export function OPTIONS() { return new NextResponse(null, { status: 204, headers }); }

async function authenticatedContext(request: Request) {
  const authorization = request.headers.get("authorization");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!authorization?.startsWith("Bearer ") || !url || !key) return null;
  const supabase = createClient(url, key, { auth: { persistSession: false }, global: { headers: { Authorization: authorization } } });
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return null;
  const userId = userData.user.id;
  const [profileResult, experiencesResult, skillsResult, educationResult, projectsResult] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
    supabase.from("experiences").select("company,job_title,description,achievements,technologies,start_date,end_date").eq("user_id", userId).order("start_date", { ascending: false }).limit(8),
    supabase.from("skills").select("name,years,proficiency").eq("user_id", userId).order("name").limit(50),
    supabase.from("education").select("institution,degree,field,start_year,end_year").eq("user_id", userId).limit(8),
    supabase.from("projects").select("name,description,impact,technologies").eq("user_id", userId).order("created_at", { ascending: false }).limit(12),
  ]);

  if (!profileResult.data?.onboarding_completed_at) return null;
  const { data: accessStatus } = await supabase.rpc("get_my_access_status");
  if (accessStatus?.hasAccess !== true) return null;

  const row = (profileResult.data ?? {}) as Record<string, unknown>;
  const text = (input: unknown) => (typeof input === "string" ? input : "");
  const profile: UserProfile = {
    firstName: text(row.first_name),
    lastName: text(row.last_name),
    email: text(row.email) || userData.user.email || "",
    phone: text(row.phone),
    location: text(row.location),
    linkedin: text(row.linkedin_url),
    github: text(row.github_url),
    portfolio: text(row.portfolio_url),
    currentTitle: text(row.current_title),
    summary: text(row.summary),
    noticePeriod: text(row.notice_period),
    currentSalary: text(row.current_salary),
    expectedSalary: text(row.expected_salary),
    totalExperience: text(row.total_experience),
    willingToRelocate: text(row.willing_to_relocate),
    workAuthorization: text(row.work_authorization),
    availability: text(row.availability),
    customFields: Array.isArray(row.custom_fields) ? row.custom_fields as UserProfile["customFields"] : [],
    skills: (skillsResult.data ?? []).map((item) => ({ name: text(item.name), years: item.years == null ? undefined : Number(item.years), proficiency: text(item.proficiency) || undefined })),
    experiences: (experiencesResult.data ?? []).map((item) => ({ company: text(item.company), title: cleanTitle(text(item.job_title)), period: [text(item.start_date), text(item.end_date) || "Present"].filter(Boolean).join(" – "), summary: text(item.description), achievements: Array.isArray(item.achievements) ? item.achievements.map(String) : [], skills: Array.isArray(item.technologies) ? item.technologies.map(String) : [] })),
    education: (educationResult.data ?? []).map((item) => ({ institution: text(item.institution), degree: text(item.degree), field: text(item.field), period: [item.start_year, item.end_year].filter(Boolean).join(" – ") })),
    projects: (projectsResult.data ?? []).map((item) => ({ name: text(item.name), description: text(item.description), technologies: Array.isArray(item.technologies) ? item.technologies.map(String) : [], impact: text(item.impact) })),
  };
  return { user: userData.user, profile, supabase };
}

/** Word-overlap similarity, mirroring the extension's local memory matcher. */
function similarity(left: string, right: string) {
  const terms = (value: string) => new Set(value.toLowerCase().replace(/[^a-z0-9+#.]+/g, " ").split(/\s+/).filter((word) => word.length > 2));
  const a = terms(left);
  const b = terms(right);
  if (!a.size || !b.size) return 0;
  let overlap = 0;
  for (const word of a) if (b.has(word)) overlap += 1;
  return overlap / Math.max(a.size, b.size);
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const question = typeof body.question === "string" ? body.question.trim() : "";
  const selectedText = typeof body.selectedText === "string" ? body.selectedText.trim() : "";
  const field = body.field && typeof body.field === "object" ? body.field as DetectedField : undefined;
  if (!question) return NextResponse.json({ error: "question is required" }, { status: 400, headers });

  const context = await authenticatedContext(request);
  if (!context) return NextResponse.json({ error: "Complete access approval before generating answers." }, { status: 403, headers });

  // Layer 1 — deterministic profile lookup. Factual questions never spend an AI
  // request and can never be fabricated.
  const engine = answerQuestion(question, context.profile);
  if (engine.source === "profile" && engine.answer) {
    return NextResponse.json({ answer: engine.answer, source: "profile", confidence: engine.confidence, notice: engine.needsReview ? "Sensitive field — confirm this value before submitting." : undefined }, { headers });
  }

  // Layer 2 — the saved answer library. Onboarding pre-generates 30+ answers, so most
  // open-ended questions match here and never reach the model. This is what keeps live
  // suggestion mode usable inside a 15 requests/minute free tier.
  const { data: library } = await context.supabase
    .from("answer_library")
    .select("question,answer,category")
    .eq("user_id", context.user.id)
    .limit(400);

  const best = (library ?? [])
    .map((item) => ({ item, score: similarity(question, String(item.question ?? "")) }))
    .sort((a, b) => b.score - a.score)[0];

  if (best && best.score >= 0.5 && String(best.item.answer ?? "").trim()) {
    return NextResponse.json({
      answer: String(best.item.answer),
      source: "memory",
      confidence: Math.min(0.95, 0.6 + best.score * 0.35),
      notice: best.score < 0.75 ? "Closest saved answer — review before inserting." : undefined,
    }, { headers });
  }

  if (engine.source === "missing") {
    return NextResponse.json({ answer: "", source: "profile", confidence: 0, notice: `Your profile does not have a value for this question yet (${engine.intent.replace(/_/g, " ")}). Add it on the profile page.` }, { headers });
  }

  // Layer 3 — the dedicated grounded suggestion agent.
  const relatedSavedAnswers = (library ?? [])
    .map((item) => ({ item, score: similarity(question, String(item.question ?? "")) }))
    .filter((entry) => entry.score >= 0.2)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map((entry) => ({ question: String(entry.item.question ?? ""), answer: String(entry.item.answer ?? "") }));
  const result = await runSuggestionAgent({ question, profile: context.profile, field, selectedText, page: body.page, relatedSavedAnswers });

  if ("error" in result) {
    return NextResponse.json({
      answer: "", source: "profile", confidence: 0,
      notice: result.throttled
        ? "AI is busy right now. Your saved answers still work — add this one to your library so it answers instantly next time."
        : "AI is unavailable right now. You can write this answer and save it for reuse.",
    }, { headers });
  }

  if (!result.answer) {
    return NextResponse.json({ answer: "", source: "ai", confidence: 0, notice: "Your profile does not contain enough detail to answer this accurately. Add more experience or project detail." }, { headers });
  }
  return NextResponse.json({ answer: result.answer, source: "ai", confidence: result.mode === "short_form" ? 0.78 : 0.75 }, { headers });
}
