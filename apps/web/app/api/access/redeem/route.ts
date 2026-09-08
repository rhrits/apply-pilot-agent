import { createHash } from "node:crypto";
import { getAuthenticatedServerContext, jsonError } from "../../../../lib/server-auth";

function normalizeCode(value: string) {
  return value.trim().replace(/[^a-z0-9]/gi, "").toUpperCase();
}

export async function POST(request: Request) {
  const context = await getAuthenticatedServerContext(request);
  if (!context) return jsonError("Authentication required", 401);
  const body = await request.json().catch(() => ({})) as { code?: string };
  const normalized = normalizeCode(body.code ?? "");
  if (normalized.length < 16) return jsonError("Enter a valid access code", 400);

  const codeHash = createHash("sha256").update(normalized).digest("hex");
  const { data, error } = await context.supabase.rpc("redeem_access_code", { p_code_hash: codeHash });
  if (error) return jsonError("The access code could not be redeemed", 400);
  if (!data?.ok) return jsonError("That access code is invalid or unavailable", 400);
  return Response.json({ ok: true });
}
