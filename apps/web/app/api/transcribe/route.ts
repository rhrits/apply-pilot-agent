import { NextResponse } from "next/server";

export const runtime = "nodejs";

const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, Authorization", "Access-Control-Allow-Methods": "POST, OPTIONS" };

export function OPTIONS() { return new NextResponse(null, { status: 204, headers }); }

const MAX_BYTES = 20 * 1024 * 1024;

/**
 * Server-side speech-to-text.
 *
 * Default provider is Mistral Voxtral (`voxtral-mini-latest`), which reuses the
 * MISTRAL_API_KEY already configured for answer generation. The endpoint is
 * OpenAI-compatible, so pointing STT_BASE_URL/STT_MODEL at a self-hosted
 * faster-whisper or whisper.cpp server works without code changes.
 */
export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const file = form?.get("audio");
  if (!(file instanceof File)) return NextResponse.json({ error: "Attach an audio recording." }, { status: 400, headers });
  if (file.size === 0) return NextResponse.json({ error: "The recording was empty. Try again." }, { status: 400, headers });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "Recording is too long. Keep it under 20 MB." }, { status: 413, headers });

  const apiKey = process.env.STT_API_KEY || process.env.MISTRAL_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "Speech-to-text is not configured on the server." }, { status: 501, headers });

  const baseUrl = (process.env.STT_BASE_URL || "https://api.mistral.ai/v1").replace(/\/$/, "");
  const model = process.env.STT_MODEL || "voxtral-mini-latest";

  const upstream = new FormData();
  upstream.append("file", file, file.name || "recording.webm");
  upstream.append("model", model);
  const language = form?.get("language");
  if (typeof language === "string" && language) upstream.append("language", language);

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/audio/transcriptions`, { method: "POST", headers: { Authorization: `Bearer ${apiKey}` }, body: upstream });
  } catch {
    return NextResponse.json({ error: "Could not reach the transcription service." }, { status: 502, headers });
  }

  if (response.status === 429) return NextResponse.json({ error: "Transcription rate limit reached. Type your answer instead, or try again shortly." }, { status: 429, headers });
  if (!response.ok) return NextResponse.json({ error: `Transcription failed (HTTP ${response.status}).` }, { status: 502, headers });

  const payload = await response.json().catch(() => null);
  const text = typeof payload?.text === "string" ? payload.text.trim() : "";
  if (!text) return NextResponse.json({ error: "Nothing was transcribed. Try recording again." }, { status: 422, headers });
  return NextResponse.json({ text, model }, { headers });
}
