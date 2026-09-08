import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

export interface AuthenticatedServerContext {
  supabase: SupabaseClient;
  user: User;
}

export async function getAuthenticatedServerContext(request: Request): Promise<AuthenticatedServerContext | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const authorization = request.headers.get("authorization");
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!url || !key || !token) return null;

  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return null;
  return { supabase, user: data.user };
}

export async function requireAdmin(context: AuthenticatedServerContext) {
  const configuredAdminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  if (configuredAdminEmail && context.user.email?.toLowerCase() !== configuredAdminEmail) return false;
  const { data, error } = await context.supabase.rpc("is_applypilot_admin");
  if (error || data !== true) return false;
  return true;
}

export function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}
