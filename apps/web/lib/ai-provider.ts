/**
 * Multi-provider AI access with automatic failover.
 *
 * Strategy:
 * - Gemini Flash is the primary text provider. Its free tier allows a high daily
 *   volume, which suits onboarding (a handful of large, infrequent calls).
 * - Mistral is the fallback for text and remains the provider for speech-to-text.
 * - Every call is spaced by a local token bucket and retried with backoff, so a
 *   burst of requests degrades into slower responses rather than hard failures.
 *
 * Rate limiting is per warm serverless instance, not global. It smooths bursts from
 * one user rather than enforcing a hard quota, which is exactly what the free tiers
 * need; correctness never depends on it because 429s are still retried and failed
 * over.
 */

export type ProviderName = "gemini" | "mistral";

export interface GenerateOptions {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
  /** Ask the provider for strict JSON output. */
  json?: boolean;
  /** Overrides the default provider order. */
  prefer?: ProviderName[];
  /** Total attempts per provider before failing over. */
  attempts?: number;
}

export interface GenerateResult {
  text: string;
  provider: ProviderName;
}

export interface GenerateFailure {
  error: string;
  /** True when every provider was rate limited rather than misconfigured. */
  throttled: boolean;
}

export type GenerateResponse = GenerateResult | GenerateFailure;

/** Narrows any provider result union to its failure branch. */
export function isFailure<T extends object>(value: T | GenerateFailure): value is GenerateFailure {
  return "error" in value;
}

/** Minimum spacing between calls to one provider, tuned to free-tier limits. */
const MIN_INTERVAL_MS: Record<ProviderName, number> = {
  gemini: 4200,  // ~14 requests/minute, just under the 15 RPM Flash limit
  mistral: 1200,
};

const lastCallAt: Record<ProviderName, number> = { gemini: 0, mistral: 0 };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForSlot(provider: ProviderName) {
  const wait = lastCallAt[provider] + MIN_INTERVAL_MS[provider] - Date.now();
  if (wait > 0) await sleep(wait);
  lastCallAt[provider] = Date.now();
}

function availableProviders(prefer?: ProviderName[]): ProviderName[] {
  const configured: ProviderName[] = [];
  if (process.env.GEMINI_API_KEY) configured.push("gemini");
  if (process.env.MISTRAL_API_KEY) configured.push("mistral");
  if (!prefer) return configured;
  const ordered = prefer.filter((name) => configured.includes(name));
  return [...ordered, ...configured.filter((name) => !ordered.includes(name))];
}

export function hasAiProvider(): boolean {
  return availableProviders().length > 0;
}

/** Strips code fences so a model that ignores the JSON directive still parses. */
export function parseJsonLoose<T>(content: string): T | null {
  const cleaned = content.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // Some models prepend prose. Fall back to the outermost JSON object.
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end <= start) return null;
    try { return JSON.parse(cleaned.slice(start, end + 1)) as T; } catch { return null; }
  }
}

interface CallOutcome { text?: string; status: number; retryable: boolean }

async function callGemini(options: GenerateOptions): Promise<CallOutcome> {
  const model = process.env.GEMINI_MODEL || "gemini-flash-latest";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-goog-api-key": process.env.GEMINI_API_KEY ?? "" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: options.system }] },
        contents: [{ role: "user", parts: [{ text: options.user }] }],
        generationConfig: {
          temperature: options.temperature ?? 0.2,
          maxOutputTokens: options.maxTokens ?? 4000,
          ...(options.json ? { responseMimeType: "application/json" } : {}),
        },
      }),
    });
  } catch { return { status: 0, retryable: true }; }

  if (!response.ok) return { status: response.status, retryable: response.status === 429 || response.status >= 500 };
  const payload = await response.json().catch(() => null);
  const text = payload?.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text ?? "").join("") ?? "";
  return { text, status: 200, retryable: false };
}

async function callMistral(options: GenerateOptions): Promise<CallOutcome> {
  let response: Response;
  try {
    response = await fetch("https://api.mistral.ai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.MISTRAL_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.MISTRAL_MODEL || "mistral-small-latest",
        temperature: options.temperature ?? 0.2,
        max_tokens: options.maxTokens ?? 4000,
        ...(options.json ? { response_format: { type: "json_object" } } : {}),
        messages: [{ role: "system", content: options.system }, { role: "user", content: options.user }],
      }),
    });
  } catch { return { status: 0, retryable: true }; }

  if (!response.ok) return { status: response.status, retryable: response.status === 429 || response.status >= 500 };
  const payload = await response.json().catch(() => null);
  return { text: payload?.choices?.[0]?.message?.content ?? "", status: 200, retryable: false };
}

const CALLERS: Record<ProviderName, (options: GenerateOptions) => Promise<CallOutcome>> = {
  gemini: callGemini,
  mistral: callMistral,
};

/**
 * Generates text, retrying with backoff and failing over between providers.
 * Never throws: callers get a typed failure and decide how to degrade.
 */
export async function generate(options: GenerateOptions): Promise<GenerateResponse> {
  const providers = availableProviders(options.prefer);
  if (!providers.length) return { error: "No AI provider is configured on the server.", throttled: false };

  const attempts = options.attempts ?? 3;
  let throttled = false;
  let lastError = "AI request failed.";

  for (const provider of providers) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      await waitForSlot(provider);
      const outcome = await CALLERS[provider](options);

      if (outcome.status === 200 && outcome.text?.trim()) return { text: outcome.text, provider };
      if (outcome.status === 429) throttled = true;
      lastError = outcome.status === 0 ? `Could not reach ${provider}.` : `${provider} returned HTTP ${outcome.status}.`;
      if (!outcome.retryable) break;

      // Exponential backoff with jitter, so parallel callers do not retry in lockstep.
      await sleep(Math.min(8000, 700 * 2 ** attempt) + Math.random() * 300);
    }
  }

  return { error: lastError, throttled };
}

/** Convenience wrapper that generates and parses JSON in one step. */
export async function generateJson<T>(options: Omit<GenerateOptions, "json">): Promise<{ data: T; provider: ProviderName } | GenerateFailure> {
  const result = await generate({ ...options, json: true });
  if (isFailure(result)) return result;
  const data = parseJsonLoose<T>(result.text);
  if (!data) return { error: "The AI response could not be parsed as JSON.", throttled: false };
  return { data, provider: result.provider };
}
