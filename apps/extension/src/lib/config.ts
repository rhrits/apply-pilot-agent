const webAppUrl = (import.meta.env.VITE_WEB_APP_URL || "http://localhost:3000").replace(/\/$/, "");

export const extensionConfig = {
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL || "",
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY || "",
  webAppUrl,
  aiApiUrl: import.meta.env.VITE_AI_API_URL || `${webAppUrl}/api/ai/answer`,
};

export function isExtensionConfigured() {
  return Boolean(extensionConfig.supabaseUrl && extensionConfig.supabaseAnonKey);
}
