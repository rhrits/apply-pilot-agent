import { getAuthenticatedServerContext, jsonError } from "../../../../lib/server-auth";

export async function GET(request: Request) {
  const context = await getAuthenticatedServerContext(request);
  if (!context) return jsonError("Authentication required", 401);
  const { data, error } = await context.supabase.rpc("get_my_access_status");
  if (error) return jsonError("Could not load access status", 500);
  return Response.json(data);
}
