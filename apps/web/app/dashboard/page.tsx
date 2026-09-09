"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AuthGate } from "../../components/auth-gate";
import { getSupabaseBrowserClient } from "../../lib/supabase";
import "../dashboard.css";

interface WorkspaceData {
  email: string;
  firstName: string;
  lastName: string;
  currentTitle: string;
  location: string;
  summary: string;
  skills: string[];
  onboardingCompletedAt: string | null;
  resumeCount: number;
  skillCount: number;
  experienceCount: number;
  jobCount: number;
  answerCount: number;
  statusCounts: Record<string, number>;
}

const EMPTY: WorkspaceData = {
  email: "", firstName: "", lastName: "", currentTitle: "", location: "", summary: "", skills: [],
  onboardingCompletedAt: null, resumeCount: 0, skillCount: 0, experienceCount: 0, jobCount: 0, answerCount: 0, statusCounts: {},
};

export default function Dashboard() { return <AuthGate><DashboardContent /></AuthGate>; }

function initials(firstName: string, lastName: string, email: string) {
  const source = `${firstName} ${lastName}`.trim() || email;
  const parts = source.split(/[\s@.]+/).filter(Boolean);
  return (parts[0]?.[0] ?? "?").toUpperCase() + (parts[1]?.[0] ?? "").toUpperCase();
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function DashboardContent() {
  const [data, setData] = useState<WorkspaceData>(EMPTY);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) { setLoading(false); return; }
    supabase.auth.getUser().then(async ({ data: userData }) => {
      const user = userData.user;
      if (!user) { setLoading(false); return; }
      const userId = user.id;

      const [profileResult, skillsResult, experiencesResult, resumesResult, jobsResult, applicationsResult, answersResult] = await Promise.all([
        supabase.from("profiles").select("first_name,last_name,current_title,location,summary,onboarding_completed_at").eq("id", userId).maybeSingle(),
        supabase.from("skills").select("name").eq("user_id", userId).order("name"),
        supabase.from("experiences").select("id", { count: "exact", head: true }).eq("user_id", userId),
        supabase.from("resumes").select("id", { count: "exact", head: true }).eq("user_id", userId),
        supabase.from("jobs").select("id", { count: "exact", head: true }).eq("user_id", userId),
        supabase.from("applications").select("status").eq("user_id", userId),
        supabase.from("answer_library").select("id", { count: "exact", head: true }).eq("user_id", userId),
      ]);

      const statusCounts: Record<string, number> = {};
      for (const row of applicationsResult.data ?? []) statusCounts[row.status] = (statusCounts[row.status] ?? 0) + 1;

      setData({
        email: user.email ?? "",
        firstName: profileResult.data?.first_name ?? "",
        lastName: profileResult.data?.last_name ?? "",
        currentTitle: profileResult.data?.current_title ?? "",
        location: profileResult.data?.location ?? "",
        summary: profileResult.data?.summary ?? "",
        skills: (skillsResult.data ?? []).map((row) => row.name).filter(Boolean),
        onboardingCompletedAt: profileResult.data?.onboarding_completed_at ?? null,
        resumeCount: resumesResult.count ?? 0,
        skillCount: skillsResult.data?.length ?? 0,
        experienceCount: experiencesResult.count ?? 0,
        jobCount: jobsResult.count ?? 0,
        answerCount: answersResult.count ?? 0,
        statusCounts,
      });
      setLoading(false);
    });
  }, []);

  const completeness = useMemo(() => {
    const checks = [data.firstName, data.lastName, data.currentTitle, data.location, data.summary, data.skillCount > 0 ? "yes" : "", data.experienceCount > 0 ? "yes" : "", data.resumeCount > 0 ? "yes" : ""];
    return Math.round((checks.filter(Boolean).length / checks.length) * 100);
  }, [data]);

  const displayName = data.firstName || data.email.split("@")[0] || "there";
  const totalApplications = Object.values(data.statusCounts).reduce((sum, count) => sum + count, 0);
  const activeApplications = (data.statusCounts.applying ?? 0) + (data.statusCounts.applied ?? 0) + (data.statusCounts.interview ?? 0);

  /**
   * Application funnel. Each stage counts everything that reached it or moved past it,
   * so the bars only ever narrow — that is what makes a drop-off visible at a glance.
   */
  const funnel = useMemo(() => {
    const counts = data.statusCounts;
    const saved = totalApplications;
    const applied = (counts.applied ?? 0) + (counts.assessment ?? 0) + (counts.interview ?? 0) + (counts.offer ?? 0);
    const interview = (counts.interview ?? 0) + (counts.offer ?? 0);
    const offer = counts.offer ?? 0;
    const stages = [
      { label: "Saved", value: saved },
      { label: "Applied", value: applied },
      { label: "Interview", value: interview },
      { label: "Offer", value: offer },
    ];
    const responseRate = applied ? Math.round((interview / applied) * 100) : 0;
    return { stages, responseRate, applied };
  }, [data.statusCounts, totalApplications]);

  const checklist = [
    { done: Boolean(data.onboardingCompletedAt), label: "Complete onboarding", detail: "Your account and initial profile", href: "/onboarding" },
    { done: data.resumeCount > 0, label: "Import a resume", detail: `${data.resumeCount} resume${data.resumeCount === 1 ? "" : "s"} on file`, href: "/profile" },
    { done: data.answerCount > 0, label: "Build your answer library", detail: `${data.answerCount} reusable answer${data.answerCount === 1 ? "" : "s"} saved`, href: "/answer-library" },
    { done: data.jobCount > 0, label: "Track your first opportunity", detail: `${data.jobCount} job${data.jobCount === 1 ? "" : "s"} tracked`, href: "/tracker" },
  ];

  return <div className="dashboard"><aside className="sidebar"><div className="logo"><img src="/uplyfox-pixel-crimson-animated-logo.svg" width={32} height={32} alt="" /><span>Uply<strong style={{color: '#8b1e3f'}}>Fox</strong></span></div><nav className="nav"><Link className="active" href="/dashboard">Overview</Link><Link href="/profile">My profile & resume</Link><Link href="/tracker">Job tracker</Link><Link href="/answer-library">Answer library</Link><Link href="/settings">Settings</Link></nav><div className="sidebar-bottom"><strong>Browser extension</strong><p>Sign in to the extension popup with this same email, then press <em>Refresh profile data</em> to sync.</p></div></aside><main className="main">
    <div className="topbar"><div><div className="eyebrow">Your workspace</div><h1>{greeting()}, {displayName}</h1></div><div className="avatar">{initials(data.firstName, data.lastName, data.email)}</div></div>

    <section className="hero">
      <div>
        <div className="eyebrow">One profile. Every application.</div>
        <h2>{completeness >= 90 ? "Your profile is ready to apply." : "Finish building your profile."}</h2>
        <p>UplyFox answers from your verified facts first, and only asks AI for genuinely open-ended questions.</p>
        <div className="hero-actions"><Link href="/profile" className="hero-button">{data.resumeCount > 0 ? "Edit profile" : "Build profile"}</Link><Link href="/tracker" className="hero-link">Open tracker →</Link></div>
      </div>
      <div className="hero-graphic"><svg viewBox="0 0 120 120" width="112" height="112"><circle cx="60" cy="60" r="52" fill="none" stroke="#e4e0ff" strokeWidth="10"/><circle cx="60" cy="60" r="52" fill="none" stroke="#5546d9" strokeWidth="10" strokeLinecap="round" strokeDasharray={`${completeness * 3.27} 327`} transform="rotate(-90 60 60)"/><text x="60" y="66" textAnchor="middle" fontSize="24" fontWeight="700" fill="#1f2040" fontFamily="Space Grotesk">{completeness}%</text></svg></div>
    </section>

    <div className="grid">
      <section className="card"><h3>Profile completeness</h3><div className="metric">{completeness}%</div><div className="metric-label">{completeness >= 90 ? "Ready for most applications" : "A few more details will help"}</div><div className="progress"><span style={{ width: `${completeness}%` }} /></div><div className="small-note">{data.resumeCount === 0 ? "Import a resume to jump ahead fast." : `${data.skillCount} skills · ${data.experienceCount} roles on file`}</div></section>
      <section className="card"><h3>Opportunities tracked</h3><div className="metric">{loading ? "…" : data.jobCount}</div><div className="metric-label">Across your application board</div><div className="small-note" style={{ marginTop: 20 }}>{totalApplications === 0 ? "Save your first job from the extension or tracker." : `${activeApplications} active · ${data.statusCounts.offer ?? 0} offer(s)`}</div></section>
      <section className="card"><h3>Answer memory</h3><div className="metric">{loading ? "…" : data.answerCount}</div><div className="metric-label">Reusable answers saved</div><div className="small-note" style={{ marginTop: 20 }}>{data.answerCount === 0 ? "Onboarding can generate 30+ for you." : "The extension checks these before calling AI."}</div></section>
    </div>

    <section className="card activity"><div className="section-head"><h3>Setup checklist</h3></div>{checklist.map((item) => <Link className="activity-row" href={item.href} key={item.label}><div className={`activity-icon ${item.done ? "done" : ""}`}>{item.done ? "✓" : "○"}</div><div><strong>{item.label}</strong><span>{item.detail}</span></div><div className={`pill ${item.done ? "" : "pending"}`}>{item.done ? "Done" : "To do"}</div></Link>)}</section>

    <section className="card funnel-card" style={{ marginTop: 18 }}>
      <div className="section-head">
        <h3>Application funnel</h3>
        {funnel.applied > 0 && <span className="card-hint">{funnel.responseRate}% of applications reached an interview</span>}
      </div>
      {totalApplications === 0
        ? <p className="empty-snapshot">No applications yet. Save a job from the extension to start tracking your funnel.</p>
        : <div className="funnel">{funnel.stages.map((stage) => <div className="funnel-stage" key={stage.label}>
          <div className="funnel-meta"><span>{stage.label}</span><strong>{stage.value}</strong></div>
          <div className="funnel-bar"><span style={{ width: `${totalApplications ? Math.round((stage.value / totalApplications) * 100) : 0}%` }} /></div>
        </div>)}</div>}
    </section>

    <section className="card" style={{ marginTop: 18 }}><div className="section-head"><h3>Profile snapshot</h3><Link className="text-link" href="/profile">Edit profile</Link></div>{data.firstName || data.currentTitle ? <div className="profile-list"><div className="profile-item"><span>Name</span><strong>{[data.firstName, data.lastName].filter(Boolean).join(" ") || "Not set"}</strong></div><div className="profile-item"><span>Focus</span><strong>{data.currentTitle || "Not set"}</strong></div><div className="profile-item"><span>Core skills</span><strong>{data.skills.slice(0, 3).join(" · ") || "Add skills on your profile"}</strong></div></div> : <p className="empty-snapshot">Your profile is empty. <Link href="/onboarding">Run onboarding</Link> to build it from your resume and links.</p>}</section>
  </main></div>;
}
