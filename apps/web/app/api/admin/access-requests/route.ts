import { getAuthenticatedServerContext, jsonError, requireAdmin } from "../../../../lib/server-auth";

export async function GET(request: Request) {
  const context = await getAuthenticatedServerContext(request);
  if (!context) return jsonError("Authentication required", 401);
  if (!await requireAdmin(context)) return jsonError("Admin access required", 403);
  const { data, error } = await context.supabase.rpc("admin_list_access_requests");
  if (error) return jsonError("Could not load access requests", 500);
  return Response.json(data ?? []);
}

export async function POST(request: Request) {
  const context = await getAuthenticatedServerContext(request);
  if (!context) return jsonError("Authentication required", 401);
  if (!await requireAdmin(context)) return jsonError("Admin access required", 403);
  const body = await request.json().catch(() => ({})) as { requestId?: string; decision?: string; note?: string };
  if (!body.requestId || !["approved", "rejected"].includes(body.decision ?? "")) return jsonError("Request id and decision are required", 400);
  const { data, error } = await context.supabase.rpc("admin_review_access_request", { p_request_id: body.requestId, p_decision: body.decision, p_note: body.note ?? null });
  if (error) return jsonError("Could not update access request", 400);
  return Response.json(data);
}
