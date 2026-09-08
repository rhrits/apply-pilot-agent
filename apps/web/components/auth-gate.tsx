"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "../lib/supabase";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [state, setState] = useState<"loading" | "authenticated" | "unconfigured">("loading");

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) { setState("unconfigured"); return; }
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) setState("authenticated");
      else router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    }).catch(() => router.replace(`/login?next=${encodeURIComponent(pathname)}`));
  }, [pathname, router]);

  if (state === "unconfigured") return <main className="auth-missing"><div className="auth-missing-card"><span className="logo-mark">✦</span><h1>Connect ApplyPilot</h1><p>Supabase environment variables are missing. Add them to the web deployment before using the authenticated workspace.</p></div></main>;
  if (state !== "authenticated") return <main className="auth-loading"><span className="loading-orbit" /><p>Checking your secure workspace…</p></main>;
  return <>{children}</>;
}
