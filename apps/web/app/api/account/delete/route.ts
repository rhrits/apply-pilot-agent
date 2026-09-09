import { createClient } from "@supabase/supabase-js";
import { getAuthenticatedServerContext, jsonError } from "../../../../lib/server-auth";

/**
 * Permanently deletes every row and stored object belonging to the signed-in user.
 *
 * This is deliberately server-side: storage objects and cross-table cleanup cannot be
 * done reliably from the browser, and the previous "clear local data" flow only wiped
 * the browser and left everything on the server intact.
 */
export async function POST(request: Request) {
  const context = await getAuthenticatedServerContext(request);
  if (!context) return jsonError("Authentication required", 401);

  const body = await request.json().catch(() => ({})) as { confirm?: string };
  if (body.confirm !== "DELETE") return jsonError("Type DELETE to confirm", 400);

  const userId = context.user.id;
  const supabase = context.supabase;

  // Remove stored resume objects before their rows, otherwise the paths are lost.
  const { data: resumes } = await supabase.from("resumes").select("storage_path").eq("user_id", userId);
  const paths = (resumes ?? [])
    .map((row) => (row as { storage_path?: string }).storage_path)
    .filter((path): path is string => Boolean(path));
  if (paths.length) await supabase.storage.from("resumes").remove(paths);

  const { data: drafts } = await supabase.from("application_drafts").select("screenshot_path").eq("user_id", userId);
  const evidencePaths = (drafts ?? []).map((row) => (row as { screenshot_path?: string }).screenshot_path).filter((path): path is string => Boolean(path));
  if (evidencePaths.length) await supabase.storage.from("application-evidence").remove(evidencePaths);

  // Child rows first so foreign keys never block the profile delete.
  const tables = [
    "submission_attempts",
    "application_drafts",
    "application_sessions",
    "applications",
    "jobs",
    "answers",
    "profile_signals",
    "experiences",
    "skills",
    "education",
    "projects",
    "resumes",
  ];
  const failures: string[] = [];
  for (const table of tables) {
    const { error } = await supabase.from(table).delete().eq("user_id", userId);
    // A missing table in an older deployment must not abort the whole deletion.
    if (error && !/does not exist/i.test(error.message)) failures.push(`${table}: ${error.message}`);
  }

  const { error: profileError } = await supabase.from("profiles").delete().eq("id", userId);
  if (profileError) failures.push(`profiles: ${profileError.message}`);

  if (failures.length) return jsonError(`Could not fully delete your data — ${failures.join("; ")}`, 500);

  // Removing the auth user itself requires the service role. When it is not configured
  // the data is still gone; the empty login simply remains.
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  let authUserDeleted = false;
  if (serviceKey && url) {
    const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { error } = await admin.auth.admin.deleteUser(userId);
    authUserDeleted = !error;
  }

  return Response.json({ ok: true, authUserDeleted });
}
