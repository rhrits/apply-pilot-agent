"use client";

/**
 * Resume file storage.
 *
 * The parsed text alone is not enough: the browser extension attaches the ORIGINAL file
 * to job-board upload inputs, and it locates that file through a `public.resumes` row
 * plus a `storage_path` in the private `resumes` bucket. Before this module existed the
 * upload paths only parsed the PDF and threw the binary away, so the extension always
 * reported "Upload a resume on the profile page first" even right after a successful
 * onboarding upload.
 *
 * Everything here is deliberately "one default resume": uploading a new file promotes it
 * and removes the previous one, so the extension never has to guess which file to attach.
 */

import { getSupabaseBrowserClient } from "./supabase";

const BUCKET = "resumes";

export interface StoredResume {
  id: string;
  name: string;
  storagePath: string;
  mimeType: string | null;
  fileSize: number | null;
  createdAt: string;
}

export interface ResumeStoreResult {
  ok: boolean;
  error?: string;
  resume?: StoredResume;
}

function rowToResume(row: Record<string, unknown>): StoredResume {
  return {
    id: String(row.id),
    name: String(row.name ?? "Resume"),
    storagePath: String(row.storage_path ?? ""),
    mimeType: row.mime_type == null ? null : String(row.mime_type),
    fileSize: row.file_size == null ? null : Number(row.file_size),
    createdAt: String(row.created_at ?? ""),
  };
}

/** The resume the extension will attach — the most recent upload. */
export async function getStoredResume(): Promise<StoredResume | null> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return null;
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;

  const { data, error } = await supabase
    .from("resumes")
    .select("id,name,storage_path,mime_type,file_size,created_at")
    .eq("user_id", auth.user.id)
    .order("created_at", { ascending: false })
    .limit(1);

  if (error || !data?.length) return null;
  return rowToResume(data[0] as Record<string, unknown>);
}

/**
 * A short-lived signed URL for INLINE preview only. The product intentionally offers
 * "see or replace", never a download button, so this is only used as an iframe source.
 */
export async function getResumePreviewUrl(storagePath: string, expiresInSeconds = 300): Promise<string | null> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase || !storagePath) return null;
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, expiresInSeconds);
  return error ? null : data?.signedUrl ?? null;
}

/**
 * Downloads the already-saved original so extraction can be an explicit second step.
 *
 * Uploading and parsing are intentionally separate: the candidate can first confirm
 * that the exact PDF is stored and previewable, then choose when to spend the parsing
 * request. The signed URL is short-lived and the bytes never pass through our server
 * again except when the user explicitly clicks Extract.
 */
export async function getStoredResumeFile(resume?: Pick<StoredResume, "name" | "storagePath" | "mimeType">): Promise<File | null> {
  const stored = resume ?? await getStoredResume();
  if (!stored?.storagePath) return null;
  const url = await getResumePreviewUrl(stored.storagePath, 300);
  if (!url) return null;
  const response = await fetch(url);
  if (!response.ok) return null;
  const blob = await response.blob();
  return new File([blob], stored.name, { type: stored.mimeType || blob.type || "application/pdf" });
}

/** Stores parsed text after explicit extraction without replacing the original file. */
export async function markResumeParsed(id: string, parsedText: string): Promise<boolean> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return false;
  const { error } = await supabase.from("resumes").update({ parsed_text: parsedText.slice(0, 200_000), parsing_status: "parsed" }).eq("id", id);
  return !error;
}

/** Removes both the storage object and its row. Used by replace and by manual delete. */
export async function deleteStoredResume(resume: Pick<StoredResume, "id" | "storagePath">): Promise<ResumeStoreResult> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return { ok: false, error: "Not signed in" };

  if (resume.storagePath) await supabase.storage.from(BUCKET).remove([resume.storagePath]);
  const { error } = await supabase.from("resumes").delete().eq("id", resume.id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

/**
 * Uploads the original file, records it, and retires the previous resume so exactly one
 * default remains. `parsedText` is stored alongside so the file can be re-analyzed later
 * without asking the candidate to upload again.
 */
export async function storeResumeFile(file: File, parsedText?: string): Promise<ResumeStoreResult> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return { ok: false, error: "Supabase is not configured" };
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: "Not signed in" };

  const previous = await getStoredResume();

  const extension = file.name.includes(".") ? file.name.split(".").pop() : "pdf";
  const storagePath = `${auth.user.id}/${crypto.randomUUID()}.${extension}`;

  const upload = await supabase.storage.from(BUCKET).upload(storagePath, file, {
    contentType: file.type || "application/pdf",
    upsert: false,
  });
  if (upload.error) return { ok: false, error: upload.error.message };

  const { data, error } = await supabase
    .from("resumes")
    .insert({
      user_id: auth.user.id,
      name: file.name,
      storage_path: storagePath,
      mime_type: file.type || "application/pdf",
      file_size: file.size,
      parsed_text: parsedText?.slice(0, 200_000) ?? null,
      parsing_status: parsedText ? "parsed" : "pending",
      is_default: true,
    })
    .select("id,name,storage_path,mime_type,file_size,created_at")
    .single();

  if (error) {
    // Never leave an orphaned object behind if the row could not be written.
    await supabase.storage.from(BUCKET).remove([storagePath]);
    return { ok: false, error: error.message };
  }

  if (previous) await deleteStoredResume(previous);

  return { ok: true, resume: rowToResume(data as Record<string, unknown>) };
}
