"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ApplicationStatus, JobApplication } from "@applypilot/shared";
import { getSupabaseBrowserClient } from "../../lib/supabase";
import "./tracker.css";

const statuses: Array<{ value: ApplicationStatus; label: string; accent: string }> = [
  { value: "saved", label: "Saved", accent: "#8b7cf6" },
  { value: "applying", label: "Applying", accent: "#f09c73" },
  { value: "applied", label: "Applied", accent: "#22a879" },
  { value: "interview", label: "Interview", accent: "#2b8ed6" },
  { value: "offer", label: "Offer", accent: "#d39a25" },
];

const samples: JobApplication[] = [
  { id: "sample-1", company: "Tario", title: "AI Product Engineer", url: "https://example.com/jobs/tario", location: "Remote", workMode: "remote", employmentType: "full-time", salary: "$140k–$175k", status: "interview", priority: "high", nextStep: "Technical interview", nextStepDate: "2026-09-12", notes: "Highlight the AI application platform project.", source: "Company site", createdAt: "2026-09-01", updatedAt: "2026-09-08" },
  { id: "sample-2", company: "Northstar Labs", title: "Senior Frontend Engineer", url: "https://example.com/jobs/northstar", location: "New York / Hybrid", workMode: "hybrid", employmentType: "full-time", salary: "$155k–$190k", status: "applied", priority: "medium", nextStep: "Follow up with recruiter", nextStepDate: "2026-09-15", notes: "Resume v3 submitted.", source: "LinkedIn", createdAt: "2026-08-28", updatedAt: "2026-09-05" },
  { id: "sample-3", company: "Orbit Health", title: "Full-stack Developer", url: "https://example.com/jobs/orbit", location: "Remote - US", workMode: "remote", employmentType: "contract", salary: "$85/hr", status: "saved", priority: "low", nextStep: "Tailor resume", nextStepDate: "2026-09-18", notes: "Check healthcare domain requirements.", source: "Simplify", createdAt: "2026-09-06", updatedAt: "2026-09-06" },
];

const blankJob: Omit<JobApplication, "id" | "createdAt" | "updatedAt"> = { company: "", title: "", url: "", location: "", workMode: "unknown", employmentType: "full-time", salary: "", status: "saved", priority: "medium", nextStep: "", nextStepDate: "", notes: "", contactName: "", source: "Manual" };

export default function TrackerPage() {
  const [jobs, setJobs] = useState<JobApplication[]>(samples);
  const [filter, setFilter] = useState<"all" | ApplicationStatus>("all");
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState(blankJob);
  const [selected, setSelected] = useState<JobApplication | null>(null);
  const [saveState, setSaveState] = useState("");
  const loaded = useRef(false);

  useEffect(() => {
    const saved = localStorage.getItem("applypilot-jobs");
    if (saved) { try { setJobs(JSON.parse(saved) as JobApplication[]); } catch { /* Keep sample data. */ } }
    const savedDraft = localStorage.getItem("applypilot-job-draft");
    if (savedDraft) { try { setDraft(JSON.parse(savedDraft)); setShowForm(true); } catch { /* Ignore an unreadable draft. */ } }
    loaded.current = true;
  }, []);

  // Pull in anything saved from the extension (or another device) so the board always
  // reflects the authenticated user's full application history, not just this browser.
  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      const { data: rows } = await supabase
        .from("applications")
        .select("id, status, created_at, updated_at, jobs(id, company, title, url, location, work_mode, employment_type, salary, source, priority, next_step, next_step_date, notes, contact_name, tags)")
        .eq("user_id", data.user.id)
        .order("created_at", { ascending: false });
      if (!rows) return;
      const cloudJobs: JobApplication[] = (rows as unknown as Array<{ id: string; status: ApplicationStatus; created_at: string; updated_at: string | null; jobs: Record<string, unknown> | Record<string, unknown>[] | null }>)
        .filter((row) => row.jobs)
        .map((row) => {
          const job = (Array.isArray(row.jobs) ? row.jobs[0] : row.jobs) ?? {};
          return {
            id: `cloud-${row.id}`,
            remoteId: String(job.id ?? ""),
            company: String(job.company ?? ""),
            title: String(job.title ?? ""),
            url: String(job.url ?? ""),
            location: String(job.location ?? ""),
            workMode: (job.work_mode as JobApplication["workMode"]) ?? "unknown",
            employmentType: (job.employment_type as JobApplication["employmentType"]) ?? "full-time",
            salary: String(job.salary ?? ""),
            status: row.status,
            priority: (job.priority as JobApplication["priority"]) ?? "medium",
            nextStep: String(job.next_step ?? ""),
            nextStepDate: String(job.next_step_date ?? ""),
            notes: String(job.notes ?? ""),
            contactName: String(job.contact_name ?? ""),
            source: String(job.source ?? "Cloud sync"),
            tags: Array.isArray(job.tags) ? job.tags.map(String) : [],
            createdAt: row.created_at,
            updatedAt: row.updated_at ?? row.created_at,
          };
        });
      if (!cloudJobs.length) return;
      setJobs((current) => {
        const existingIds = new Set(current.map((item) => item.id));
        const additions = cloudJobs.filter((item) => !existingIds.has(item.id));
        return additions.length ? [...additions, ...current] : current;
      });
    });
  }, []);

  // Autosave: every change to the board or the in-progress form is persisted immediately.
  useEffect(() => {
    if (!loaded.current) return;
    localStorage.setItem("applypilot-jobs", JSON.stringify(jobs));
    setSaveState(`Saved ${new Date().toLocaleTimeString()}`);
  }, [jobs]);

  useEffect(() => {
    if (!loaded.current) return;
    const hasContent = Boolean(draft.company.trim() || draft.title.trim() || draft.notes?.trim());
    if (hasContent) localStorage.setItem("applypilot-job-draft", JSON.stringify(draft));
    else localStorage.removeItem("applypilot-job-draft");
  }, [draft]);

  const visible = useMemo(() => jobs.filter((job) => {
    const matchesFilter = filter === "all" || job.status === filter;
    const query = search.toLowerCase();
    return matchesFilter && (!query || `${job.company} ${job.title} ${job.location} ${job.tags?.join(" ")}`.toLowerCase().includes(query));
  }), [filter, jobs, search]);

  function persist(next: JobApplication[]) { setJobs(next); }
  async function syncJob(job: JobApplication): Promise<string | null> {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return null;
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return null;
    const { data: savedJob } = await supabase.from("jobs").insert({ user_id: userData.user.id, company: job.company, title: job.title, url: job.url, location: job.location, work_mode: job.workMode, employment_type: job.employmentType, salary: job.salary, source: job.source, priority: job.priority, next_step: job.nextStep, next_step_date: job.nextStepDate || null, notes: job.notes, contact_name: job.contactName, tags: job.tags ?? [] }).select("id").single();
    if (!savedJob) return null;
    await supabase.from("applications").insert({ user_id: userData.user.id, job_id: savedJob.id, status: job.status });
    return savedJob.id;
  }

  function addJob() {
    if (!draft.company.trim() || !draft.title.trim()) { setSaveState("Add a company and role before saving."); return; }
    const now = new Date().toISOString();
    const created = { ...draft, id: crypto.randomUUID(), company: draft.company.trim(), title: draft.title.trim(), createdAt: now, updatedAt: now };
    persist([created, ...jobs]);
    void syncJob(created).then((remoteId) => { if (remoteId) setJobs((current) => current.map((item) => item.id === created.id ? { ...item, remoteId } : item)); });
    setDraft(blankJob); setShowForm(false);
    localStorage.removeItem("applypilot-job-draft");
  }
  function move(job: JobApplication, status: ApplicationStatus) {
    persist(jobs.map((item) => item.id === job.id ? { ...item, status, updatedAt: new Date().toISOString() } : item));
    setSelected((current) => current && current.id === job.id ? { ...current, status } : current);
    if (job.remoteId) {
      const supabase = getSupabaseBrowserClient();
      void supabase?.from("applications").update({ status, updated_at: new Date().toISOString() }).eq("id", job.remoteId);
    }
  }

  return <main className="main tracker-page"><div className="topbar"><div><div className="eyebrow">Application command center</div><h1>Job tracker</h1><p className="page-subtitle">Keep every opportunity, next step, contact, and follow-up in one calm view.</p></div><div className="topbar-actions"><Link href="/" className="text-link">Overview</Link><button className="save-button" onClick={() => setShowForm((value) => !value)}>＋ Add opportunity</button></div></div><div className="tracker-toolbar"><div className="tracker-filters"><button className={filter === "all" ? "filter active" : "filter"} onClick={() => setFilter("all")}>All <span>{jobs.length}</span></button>{statuses.map((status) => <button key={status.value} className={filter === status.value ? "filter active" : "filter"} onClick={() => setFilter(status.value)}>{status.label} <span>{jobs.filter((job) => job.status === status.value).length}</span></button>)}</div><input className="search-input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search company, role, location…" /></div>{saveState && <p className="autosave-note">{saveState}</p>}{showForm && <section className="card job-form"><div className="section-head"><div><h3>Add opportunity</h3><p className="card-help">Capture enough context now so the extension and answer engine can use it later.</p></div><button className="close-button" onClick={() => setShowForm(false)}>×</button></div><div className="job-form-grid">{([["company", "Company"], ["title", "Role title"], ["location", "Location"], ["salary", "Salary / range"], ["url", "Job URL"], ["contactName", "Recruiter / contact"], ["nextStep", "Next step"], ["nextStepDate", "Next step date"]] as Array<[keyof typeof blankJob, string]>).map(([field, label]) => <label key={field}>{label}<input value={String(draft[field] ?? "")} onChange={(event) => setDraft({ ...draft, [field]: event.target.value })} type={field === "nextStepDate" ? "date" : "text"} /></label>)}<label>Work mode<select value={draft.workMode} onChange={(event) => setDraft({ ...draft, workMode: event.target.value as JobApplication["workMode"] })}><option value="unknown">Unknown</option><option value="remote">Remote</option><option value="hybrid">Hybrid</option><option value="onsite">On-site</option></select></label><label>Employment<select value={draft.employmentType} onChange={(event) => setDraft({ ...draft, employmentType: event.target.value as JobApplication["employmentType"] })}><option value="full-time">Full-time</option><option value="part-time">Part-time</option><option value="contract">Contract</option><option value="internship">Internship</option></select></label><label>Priority<select value={draft.priority} onChange={(event) => setDraft({ ...draft, priority: event.target.value as JobApplication["priority"] })}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label><label>Status<select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as ApplicationStatus })}>{statuses.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}</select></label><label className="wide-field">Notes<textarea value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} rows={3} /></label></div><button className="save-button" onClick={addJob}>Save opportunity</button></section>}<section className="tracker-board">{statuses.map((status) => <div className="kanban-column" key={status.value}><div className="column-heading"><span style={{ background: status.accent }} /> <strong>{status.label}</strong><em>{visible.filter((job) => job.status === status.value).length}</em></div>{visible.filter((job) => job.status === status.value).map((job) => <article className="job-card" key={job.id} onClick={() => setSelected(job)}><div className="job-card-top"><span className={`priority-dot ${job.priority}`} /><small>{job.source || "Manual"}</small><button onClick={(event) => { event.stopPropagation(); move(job, statuses[(statuses.findIndex((item) => item.value === job.status) + 1) % statuses.length].value); }}>→</button></div><h3>{job.title}</h3><strong className="company-name">{job.company}</strong><span className="job-location">{job.location || "Location not added"} · {job.workMode}</span><div className="job-card-footer"><span>{job.nextStep || "No next step"}</span>{job.nextStepDate && <time>{job.nextStepDate}</time>}</div></article>)}{!visible.some((job) => job.status === status.value) && <div className="empty-column">No opportunities here</div>}</div>)}</section>{selected && <div className="drawer-backdrop" onClick={() => setSelected(null)}><aside className="job-drawer" onClick={(event) => event.stopPropagation()}><button className="close-button" onClick={() => setSelected(null)}>×</button><span className="eyebrow">{selected.company}</span><h2>{selected.title}</h2><p className="drawer-meta">{selected.location} · {selected.employmentType} · {selected.workMode}</p><div className="drawer-actions">{selected.url && <a href={selected.url} target="_blank" rel="noreferrer">Open job ↗</a>}<select value={selected.status} onChange={(event) => move(selected, event.target.value as ApplicationStatus)}>{statuses.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}</select></div><div className="drawer-grid"><div><small>Priority</small><strong>{selected.priority}</strong></div><div><small>Salary</small><strong>{selected.salary || "Not added"}</strong></div><div><small>Next step</small><strong>{selected.nextStep || "Not added"}</strong></div><div><small>Contact</small><strong>{selected.contactName || "Not added"}</strong></div></div><h3>Notes</h3><p className="drawer-notes">{selected.notes || "No notes yet."}</p><button className="text-link" onClick={() => setSelected(null)}>Close details</button></aside></div>}</main>;
}
