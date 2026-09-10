/**
 * Where the extension sends API requests.
 *
 * The default is the production site, not localhost. A packaged build with no
 * `VITE_WEB_APP_URL` previously fell back to `http://localhost:3000`, so every request
 * failed with a bare "Failed to fetch" and suggestions appeared silently broken.
 * Defaulting to production means a forgotten env var degrades to the right target
 * instead of a dead one; local development sets the variable explicitly.
 */
export const PRODUCTION_WEB_APP_URL = "https://uply.foxea.xyz";

const webAppUrl = (import.meta.env.VITE_WEB_APP_URL || PRODUCTION_WEB_APP_URL).replace(/\/$/, "");

export const extensionConfig = {
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL || "",
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY || "",
  webAppUrl,
  aiApiUrl: import.meta.env.VITE_AI_API_URL || `${webAppUrl}/api/ai/answer`,
};

export function isExtensionConfigured() {
  return Boolean(extensionConfig.supabaseUrl && extensionConfig.supabaseAnonKey);
}
