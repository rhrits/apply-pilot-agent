import { createHash, randomBytes } from "node:crypto";
import { getAuthenticatedServerContext, jsonError, requireAdmin } from "../../../../lib/server-auth";

function createCode() {
  const value = randomBytes(24).toString("base64url").replace(/[-_]/g, "").toUpperCase();
  return `UF-${value.slice(0, 6)}-${value.slice(6, 12)}-${value.slice(12, 18)}-${value.slice(18, 24)}`;
}

function normalizeCode(value: string) {
  return value.trim().replace(/[^a-z0-9]/gi, "").toUpperCase();
}

export async function GET(request: Request) {
  const context = await getAuthenticatedServerContext(request);
  if (!context) return jsonError("Authentication required", 401);
  if (!await requireAdmin(context)) return jsonError("Admin access required", 403);
  const { data, error } = await context.supabase.rpc("admin_list_access_codes");
  if (error) return jsonError("Could not load access codes", 500);
  return Response.json(data ?? []);
}

export async function POST(request: Request) {
  const context = await getAuthenticatedServerContext(request);
  if (!context) return jsonError("Authentication required", 401);
  if (!await requireAdmin(context)) return jsonError("Admin access required", 403);
  const body = await request.json().catch(() => ({})) as { requestId?: string; action?: string; codeId?: string };

  if (body.action === "revoke") {
    if (!body.codeId) return jsonError("Code id is required", 400);
    const { data, error } = await context.supabase.rpc("admin_revoke_access_code", { p_code_id: body.codeId });
    if (error) return jsonError("Could not revoke access code", 400);
    return Response.json(data);
  }

  if (!body.requestId) return jsonError("Request id is required", 400);
  const code = createCode();
  const normalized = normalizeCode(code);
  const codeHash = createHash("sha256").update(normalized).digest("hex");
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const { data, error } = await context.supabase.rpc("admin_create_access_code", {
    p_request_id: body.requestId,
    p_code_hash: codeHash,
    p_code_prefix: code.slice(0, 9),
    p_expires_at: expiresAt,
  });
  if (error) return jsonError("Could not create access code", 400);
  return Response.json({ ...data, code }, { status: 201 });
}
