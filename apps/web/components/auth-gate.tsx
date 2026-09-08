"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "../lib/supabase";

/**
 * Requires an authenticated Supabase session. Signed-in users who have not finished
 * onboarding are sent there first, so the workspace is never shown half-empty.
 */
export function AuthGate({ children, requireOnboarding = true, requireAccess = true }: { children: React.ReactNode; requireOnboarding?: boolean; requireAccess?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const [state, setState] = useState<"loading" | "authenticated" | "unconfigured">("loading");

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) { setState("unconfigured"); return; }
    supabase.auth.getSession().then(async ({ data: sessionData }) => {
      const session = sessionData.session;
      const data = sessionData.session ? { user: sessionData.session.user } : { user: null };
      const destination = `${pathname}${typeof window === "undefined" ? "" : window.location.search}`;
      if (!data.user) { router.replace(`/login?next=${encodeURIComponent(destination)}`); return; }
      const profileResult = requireOnboarding || pathname === "/onboarding"
        ? await supabase.from("profiles").select("onboarding_completed_at").eq("id", data.user.id).maybeSingle()
        : { data: null };
      const profileComplete = Boolean(profileResult.data?.onboarding_completed_at);
      if (requireOnboarding && pathname !== "/onboarding" && !profileComplete) {
        router.replace("/onboarding"); return;
      }
      const accessPath = `/access?next=${encodeURIComponent(pathname)}`;
      if (pathname === "/onboarding" && profileComplete) {
        router.replace(`/access?next=${encodeURIComponent("/dashboard")}`); return;
      }
      if (requireAccess) {
        const response = await fetch("/api/access/status", { headers: { Authorization: `Bearer ${session?.access_token ?? ""}` } });
        const access = await response.json().catch(() => null) as { hasAccess?: boolean } | null;
        if (!response.ok || !access?.hasAccess) { router.replace(accessPath); return; }
      }
      setState("authenticated");
    }).catch(() => router.replace(`/login?next=${encodeURIComponent(`${pathname}${typeof window === "undefined" ? "" : window.location.search}`)}`));
  }, [pathname, requireAccess, requireOnboarding, router]);

  if (state === "unconfigured") return <main className="auth-missing"><div className="auth-missing-card"><span className="logo-mark">✦</span><h1>Connect ApplyPilot</h1><p>Supabase environment variables are missing. Add them to the web deployment before using the authenticated workspace.</p></div></main>;
  if (state !== "authenticated") return <main className="auth-loading"><span className="loading-orbit" /><p>Checking your secure workspace…</p></main>;
  return <>{children}</>;
}
