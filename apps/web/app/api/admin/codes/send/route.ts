import { createHash } from "node:crypto";
import { getAuthenticatedServerContext, jsonError, requireAdmin } from "../../../../../lib/server-auth";

function normalizeCode(value: string) {
  return value.trim().replace(/[^a-z0-9]/gi, "").toUpperCase();
}

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", "\"": "&quot;" })[character] ?? character);
}

export async function POST(request: Request) {
  const context = await getAuthenticatedServerContext(request);
  if (!context) return jsonError("Authentication required", 401);
  if (!await requireAdmin(context)) return jsonError("Admin access required", 403);

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return jsonError("RESEND_API_KEY is not configured", 503);

  const body = await request.json().catch(() => ({})) as { codeId?: string; code?: string };
  const normalized = normalizeCode(body.code ?? "");
  if (!body.codeId || normalized.length < 16) return jsonError("Code id and code are required", 400);

  const codeHash = createHash("sha256").update(normalized).digest("hex");
  const { data: codeDetails, error: codeError } = await context.supabase.rpc("admin_prepare_access_code_email", { p_code_id: body.codeId, p_code_hash: codeHash });
  if (codeError || !codeDetails?.email) return jsonError("The code is no longer active or does not match", 400);

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
  const accessUrl = new URL("/access", appUrl);
  accessUrl.searchParams.set("code", body.code!.trim());
  const recipient = String(codeDetails.email);
  const safeRecipient = escapeHtml(recipient);
  const safeCode = escapeHtml(body.code!.trim());
  const safeAccessUrl = escapeHtml(accessUrl.toString());
  const fromEmail = process.env.RESEND_FROM_EMAIL || "no-reply@coderstash.dev";
  const fromName = process.env.RESEND_FROM_NAME || "ApplyPilot";
  const expiresAt = new Date(String(codeDetails.expiresAt)).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: `${fromName} <${fromEmail}>`,
      to: [recipient],
      subject: "Your ApplyPilot access code",
      text: `Your ApplyPilot access is ready.\n\nAccess code: ${body.code!.trim()}\n\nThis code expires on ${expiresAt} UTC and can be used once. Open ApplyPilot to continue: ${accessUrl.toString()}\n\nIf you did not request access, you can ignore this email.`,
      html: `<!doctype html><html><body style="margin:0;background:#f6f5fc;color:#252343;font-family:Arial,sans-serif"><div style="max-width:560px;margin:32px auto;padding:0 16px"><div style="border:1px solid #e4e1f2;border-radius:24px;background:#fff;padding:36px;box-shadow:0 18px 55px rgba(55,44,130,.1)"><div style="color:#5546d9;font-size:14px;font-weight:700;letter-spacing:.04em">APPLYPILOT</div><h1 style="margin:22px 0 10px;font-size:30px;line-height:1.1;color:#202040">Your access is ready.</h1><p style="margin:0;color:#716e87;font-size:15px;line-height:1.6">Your request was approved. Use this one-time code to unlock your ApplyPilot workspace.</p><div style="margin:26px 0;padding:18px;border:1px solid #d9d4ff;border-radius:14px;background:#f7f5ff;text-align:center"><div style="color:#79758d;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase">One-time access code</div><div style="margin-top:10px;color:#4032b9;font-size:24px;font-weight:800;letter-spacing:.12em">${safeCode}</div></div><p style="margin:0 0 22px;color:#716e87;font-size:13px;line-height:1.6">This code expires on ${escapeHtml(expiresAt)} UTC, is tied to ${safeRecipient}, and can only be redeemed once.</p><a href="${safeAccessUrl}" style="display:inline-block;padding:13px 18px;border-radius:10px;background:#5546d9;color:#fff;font-size:14px;font-weight:700;text-decoration:none">Open ApplyPilot and unlock access</a><p style="margin:28px 0 0;color:#9a97aa;font-size:12px;line-height:1.5">If the button does not work, open the access page and enter the code manually. If you did not request access, you can ignore this email.</p></div><p style="text-align:center;color:#aaa6b8;font-size:11px">ApplyPilot · Built by Hritik</p></div></body></html>`,
    }),
  });

  if (!response.ok) return jsonError("Resend could not deliver the email", 502);
  return Response.json({ ok: true, email: recipient });
}
