import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./src/manifest";

export default defineConfig(({ mode }) => {
  const extensionEnv = loadEnv(mode, process.cwd(), "VITE_");
  const webEnv = loadEnv(mode, new URL("../web", import.meta.url).pathname, "");
  const supabaseUrl = extensionEnv.VITE_SUPABASE_URL || webEnv.NEXT_PUBLIC_SUPABASE_URL || "";
  const supabaseAnonKey = extensionEnv.VITE_SUPABASE_ANON_KEY || webEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY || webEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "";
  const webAppUrl = extensionEnv.VITE_WEB_APP_URL || (mode === "production" ? "https://uply.foxea.xyz" : webEnv.NEXT_PUBLIC_APP_URL || "http://localhost:3000");
  return {
    plugins: [react(), crx({ manifest })],
    resolve: {
      alias: {
        "@shared": new URL("../../packages/shared/src", import.meta.url).pathname,
      },
    },
    build: { outDir: "dist", emptyOutDir: true },
    define: {
      "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(supabaseUrl),
      "import.meta.env.VITE_SUPABASE_ANON_KEY": JSON.stringify(supabaseAnonKey),
      "import.meta.env.VITE_WEB_APP_URL": JSON.stringify(webAppUrl),
      "import.meta.env.VITE_AI_API_URL": JSON.stringify(`${webAppUrl.replace(/\/$/, "")}/api/ai/answer`),
    },
  };
});
