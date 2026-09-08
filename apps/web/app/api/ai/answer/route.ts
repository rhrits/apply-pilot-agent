import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

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
  const [profileResult, experiencesResult, skillsResult, projectsResult] = await Promise.all([
    supabase.from("profiles").select("first_name,last_name,email,current_title,summary,location").eq("id", userId).maybeSingle(),
    supabase.from("experiences").select("company,job_title,description,achievements,technologies").eq("user_id", userId).order("start_date", { ascending: false }).limit(8),
    supabase.from("skills").select("name,years,proficiency").eq("user_id", userId).order("name").limit(50),
    supabase.from("projects").select("name,description,impact,technologies").eq("user_id", userId).order("created_at", { ascending: false }).limit(12),
  ]);
  return { user: userData.user, profile: profileResult.data, experiences: experiencesResult.data ?? [], skills: skillsResult.data ?? [], projects: projectsResult.data ?? [] };
}

function profileFallback(context: Awaited<ReturnType<typeof authenticatedContext>>, notice: string) {
  const displayName = [context?.profile?.first_name, context?.profile?.last_name].filter(Boolean).join(" ") || "my background";
  const title = context?.profile?.current_title || "hands-on engineering";
  return { answer: `I am interested in this opportunity because it aligns with ${displayName}'s experience in ${title}. I would welcome the opportunity to contribute to meaningful product work and discuss how my background can help the team.`, source: "profile", confidence: 0.5, notice };
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (!question) return NextResponse.json({ error: "question is required" }, { status: 400, headers });

  const context = await authenticatedContext(request);
  if (!context) return NextResponse.json({ error: "Sign in to ApplyPilot before generating answers." }, { status: 401, headers });

  const profileContext = JSON.stringify({ profile: context.profile, experiences: context.experiences, skills: context.skills, projects: context.projects });
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) {
    return NextResponse.json(profileFallback(context, "Mistral is not configured; this answer uses your verified profile."), { headers });
  }

  const model = process.env.MISTRAL_MODEL || "mistral-small-latest";
  const response = await fetch("https://api.mistral.ai/v1/chat/completions", { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model, temperature: 0.3, messages: [{ role: "system", content: "You are a concise job application copilot. Answer in first person using only the candidate facts supplied in the context. Never invent experience, employers, dates, metrics, skills, or projects. If the context does not support a claim, say so conservatively. Return only the answer text, under 120 words." }, { role: "user", content: `Question: ${question}\nPage context: ${JSON.stringify(body.page ?? {})}\nAuthenticated candidate context: ${profileContext}` }] }) });
  if (response.status === 429) {
    const retryAfter = response.headers.get("retry-after");
    const retryMessage = retryAfter ? `Mistral rate limit reached. Try again after ${retryAfter} seconds; this answer uses your verified profile.` : "Mistral rate limit reached. This answer uses your verified profile instead.";
    return NextResponse.json(profileFallback(context, retryMessage), { headers });
  }
  if (!response.ok) return NextResponse.json({ error: "AI provider request failed" }, { status: 502, headers });
  const data = await response.json();
  const answer = data.choices?.[0]?.message?.content?.trim();
  return NextResponse.json({ answer: answer || "No answer was generated.", source: "ai", confidence: 0.75 }, { headers });
}
