import { getAuthenticatedServerContext, jsonError } from "../../../../lib/server-auth";

export async function POST(request: Request) {
  const context = await getAuthenticatedServerContext(request);
  if (!context) return jsonError("Authentication required", 401);
  const body = await request.json().catch(() => ({})) as { message?: string };
  const { data, error } = await context.supabase.rpc("request_access", { p_message: body.message ?? null });
  if (error) return jsonError("Could not submit access request", 500);
  return Response.json(data, { status: 201 });
}
