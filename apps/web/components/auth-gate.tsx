"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "../lib/supabase";

/**
 * Requires an authenticated Supabase session. Signed-in users who have not finished
 * onboarding are sent there first, so the workspace is never shown half-empty.
 */
export function AuthGate({ children, requireOnboarding = true }: { children: React.ReactNode; requireOnboarding?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const [state, setState] = useState<"loading" | "authenticated" | "unconfigured">("loading");

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) { setState("unconfigured"); return; }
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) { router.replace(`/login?next=${encodeURIComponent(pathname)}`); return; }
      if (requireOnboarding && pathname !== "/onboarding") {
        const { data: profile } = await supabase.from("profiles").select("onboarding_completed_at").eq("id", data.user.id).maybeSingle();
        if (!profile?.onboarding_completed_at) { router.replace("/onboarding"); return; }
      }
      setState("authenticated");
    }).catch(() => router.replace(`/login?next=${encodeURIComponent(pathname)}`));
  }, [pathname, requireOnboarding, router]);

  if (state === "unconfigured") return <main className="auth-missing"><div className="auth-missing-card"><span className="logo-mark">✦</span><h1>Connect ApplyPilot</h1><p>Supabase environment variables are missing. Add them to the web deployment before using the authenticated workspace.</p></div></main>;
  if (state !== "authenticated") return <main className="auth-loading"><span className="loading-orbit" /><p>Checking your secure workspace…</p></main>;
  return <>{children}</>;
}
