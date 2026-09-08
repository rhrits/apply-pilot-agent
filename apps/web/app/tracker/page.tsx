"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ApplicationStatus, JobApplication, TrackerTask } from "@applypilot/shared";
import { getSupabaseBrowserClient } from "../../lib/supabase";
import { AuthGate } from "../../components/auth-gate";
import "./tracker.css";

const statuses: Array<{ value: ApplicationStatus; label: string; accent: string }> = [
  { value: "saved", label: "Saved", accent: "#8b7cf6" },
  { value: "applying", label: "Applying", accent: "#f09c73" },
  { value: "applied", label: "Applied", accent: "#22a879" },
  { value: "assessment", label: "Assessment", accent: "#7c6ce0" },
  { value: "interview", label: "Interview", accent: "#2b8ed6" },
  { value: "offer", label: "Offer", accent: "#d39a25" },
  { value: "rejected", label: "Closed", accent: "#a0a3b8" },
];

const samples: JobApplication[] = [
  { id: "sample-1", company: "Tario", title: "AI Product Engineer", url: "https://example.com/jobs/tario", location: "Remote", workMode: "remote", employmentType: "full-time", salary: "$140k–$175k", status: "interview", priority: "high", nextStep: "Technical interview", nextStepDate: "2026-09-12", notes: "Highlight the AI application platform project.", source: "Company site", tasks: [{ id: "sample-task-1", title: "Review system design notes", done: false }], createdAt: "2026-09-01", updatedAt: "2026-09-08" },
  { id: "sample-2", company: "Northstar Labs", title: "Senior Frontend Engineer", url: "https://example.com/jobs/northstar", location: "New York / Hybrid", workMode: "hybrid", employmentType: "full-time", salary: "$155k–$190k", status: "applied", priority: "medium", nextStep: "Follow up with recruiter", nextStepDate: "2026-09-15", notes: "Resume v3 submitted.", source: "LinkedIn", tasks: [], createdAt: "2026-08-28", updatedAt: "2026-09-05" },
  { id: "sample-3", company: "Orbit Health", title: "Full-stack Developer", url: "https://example.com/jobs/orbit", location: "Remote - US", workMode: "remote", employmentType: "contract", salary: "$85/hr", status: "saved", priority: "low", nextStep: "Tailor resume", nextStepDate: "2026-09-18", notes: "Check healthcare domain requirements.", source: "Simplify", tasks: [], createdAt: "2026-09-06", updatedAt: "2026-09-06" },
];

const blankJob: Omit<JobApplication, "id" | "createdAt" | "updatedAt"> = { company: "", title: "", url: "", location: "", workMode: "unknown", employmentType: "full-time", salary: "", status: "saved", priority: "medium", nextStep: "", nextStepDate: "", notes: "", contactName: "", source: "Manual", tasks: [] };

export default function TrackerPage() { return <AuthGate><TrackerWorkspace /></AuthGate>; }

function TrackerWorkspace() {
  const [jobs, setJobs] = useState<JobApplication[]>(samples);
  const [filter, setFilter] = useState<"all" | ApplicationStatus>("all");
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState(blankJob);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<ApplicationStatus | null>(null);
  const [newTask, setNewTask] = useState("");
  const loaded = useRef(false);

  // The drawer reads from the board rather than holding a copy, so edits made there
  // are the same object the board and autosave already track.
  const selected = useMemo(() => jobs.find((job) => job.id === selectedId) ?? null, [jobs, selectedId]);

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
        .select("id, status, created_at, updated_at, jobs(id, company, title, url, location, work_mode, employment_type, salary, source, priority, next_step, next_step_date, notes, contact_name, tags, tasks)")
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
            tasks: Array.isArray(job.tasks) ? job.tasks as TrackerTask[] : [],
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

  const openTasks = useMemo(() => jobs.flatMap((job) => (job.tasks ?? [])
    .filter((task) => !task.done)
    .map((task) => ({ task, job }))), [jobs]);

  async function syncJob(job: JobApplication): Promise<string | null> {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return null;
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return null;
    const { data: savedJob } = await supabase.from("jobs").insert({ user_id: userData.user.id, company: job.company, title: job.title, url: job.url, location: job.location, work_mode: job.workMode, employment_type: job.employmentType, salary: job.salary, source: job.source, priority: job.priority, next_step: job.nextStep, next_step_date: job.nextStepDate || null, notes: job.notes, contact_name: job.contactName, tags: job.tags ?? [], tasks: job.tasks ?? [] }).select("id").single();
    if (!savedJob) return null;
    await supabase.from("applications").insert({ user_id: userData.user.id, job_id: savedJob.id, status: job.status });
    return savedJob.id;
  }

  /** Applies a local change and mirrors the fields the cloud also stores. */
  function update(id: string, change: Partial<JobApplication>) {
    setJobs((current) => current.map((item) => item.id === id ? { ...item, ...change, updatedAt: new Date().toISOString() } : item));

    const job = jobs.find((item) => item.id === id);
    const supabase = getSupabaseBrowserClient();
    if (!job?.remoteId || !supabase) return;
    if (change.status) void supabase.from("applications").update({ status: change.status, updated_at: new Date().toISOString() }).eq("job_id", job.remoteId);

    const jobFields: Record<string, unknown> = {};
    if (change.notes !== undefined) jobFields.notes = change.notes;
    if (change.tasks !== undefined) jobFields.tasks = change.tasks;
    if (change.nextStep !== undefined) jobFields.next_step = change.nextStep;
    if (change.nextStepDate !== undefined) jobFields.next_step_date = change.nextStepDate || null;
    if (change.priority !== undefined) jobFields.priority = change.priority;
    if (Object.keys(jobFields).length) void supabase.from("jobs").update(jobFields).eq("id", job.remoteId);
  }

  function addJob() {
    if (!draft.company.trim() || !draft.title.trim()) { setSaveState("Add a company and role before saving."); return; }
    const now = new Date().toISOString();
    const created = { ...draft, id: crypto.randomUUID(), company: draft.company.trim(), title: draft.title.trim(), createdAt: now, updatedAt: now };
    setJobs((current) => [created, ...current]);
    void syncJob(created).then((remoteId) => { if (remoteId) setJobs((current) => current.map((item) => item.id === created.id ? { ...item, remoteId } : item)); });
    setDraft(blankJob); setShowForm(false);
    localStorage.removeItem("applypilot-job-draft");
  }

  function removeJob(id: string) {
    setJobs((current) => current.filter((item) => item.id !== id));
    if (selectedId === id) setSelectedId(null);
  }

  function move(job: JobApplication, status: ApplicationStatus) {
    if (job.status === status) return;
    update(job.id, { status });
  }

  function addTask(job: JobApplication, title: string) {
    const value = title.trim();
    if (!value) return;
    update(job.id, { tasks: [...(job.tasks ?? []), { id: crypto.randomUUID(), title: value, done: false }] });
    setNewTask("");
  }

  function toggleTask(job: JobApplication, taskId: string) {
    update(job.id, { tasks: (job.tasks ?? []).map((task) => task.id === taskId ? { ...task, done: !task.done } : task) });
  }

  function removeTask(job: JobApplication, taskId: string) {
    update(job.id, { tasks: (job.tasks ?? []).filter((task) => task.id !== taskId) });
  }

  function dropOn(status: ApplicationStatus) {
    const job = jobs.find((item) => item.id === dragId);
    setDragId(null);
    setDropTarget(null);
    if (job) move(job, status);
  }

  return <main className="main tracker-page">
    <div className="topbar">
      <div>
        <div className="eyebrow">Application command center</div>
        <h1>Job tracker</h1>
        <p className="page-subtitle">Drag a card to change its stage, keep a checklist per role, and never lose a follow-up.</p>
      </div>
      <div className="topbar-actions">
        <Link href="/" className="text-link">Overview</Link>
        <button className="save-button" onClick={() => setShowForm((value) => !value)}>＋ Add opportunity</button>
      </div>
    </div>

    <div className="tracker-toolbar">
      <div className="tracker-filters">
        <button className={filter === "all" ? "filter active" : "filter"} onClick={() => setFilter("all")}>All <span>{jobs.length}</span></button>
        {statuses.map((status) => <button key={status.value} className={filter === status.value ? "filter active" : "filter"} onClick={() => setFilter(status.value)}>
          {status.label} <span>{jobs.filter((job) => job.status === status.value).length}</span>
        </button>)}
      </div>
      <input className="search-input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search company, role, location…" />
    </div>

    {saveState && <p className="autosave-note">{saveState}</p>}

    {openTasks.length > 0 && <section className="card task-inbox">
      <div className="section-head"><h3>Open follow-ups <span className="count">{openTasks.length}</span></h3><span className="card-help">Everything still to do across the board</span></div>
      <ul className="task-inbox-list">{openTasks.slice(0, 8).map(({ task, job }) => <li key={task.id}>
        <label>
          <input type="checkbox" checked={task.done} onChange={() => toggleTask(job, task.id)} />
          <span>{task.title}</span>
        </label>
        <button className="text-link" onClick={() => setSelectedId(job.id)}>{job.company} · {job.title}</button>
      </li>)}</ul>
    </section>}

    {showForm && <section className="card job-form">
      <div className="section-head">
        <div><h3>Add opportunity</h3><p className="card-help">Capture enough context now so the extension and answer engine can use it later.</p></div>
        <button className="close-button" onClick={() => setShowForm(false)}>×</button>
      </div>
      <div className="job-form-grid">
        {([["company", "Company"], ["title", "Role title"], ["location", "Location"], ["salary", "Salary / range"], ["url", "Job URL"], ["contactName", "Recruiter / contact"], ["nextStep", "Next step"], ["nextStepDate", "Next step date"]] as Array<[keyof typeof blankJob, string]>).map(([field, label]) =>
          <label key={field}>{label}<input value={String(draft[field] ?? "")} onChange={(event) => setDraft({ ...draft, [field]: event.target.value })} type={field === "nextStepDate" ? "date" : "text"} /></label>)}
        <label>Work mode<select value={draft.workMode} onChange={(event) => setDraft({ ...draft, workMode: event.target.value as JobApplication["workMode"] })}>
          <option value="unknown">Unknown</option><option value="remote">Remote</option><option value="hybrid">Hybrid</option><option value="onsite">On-site</option>
        </select></label>
        <label>Employment<select value={draft.employmentType} onChange={(event) => setDraft({ ...draft, employmentType: event.target.value as JobApplication["employmentType"] })}>
          <option value="full-time">Full-time</option><option value="part-time">Part-time</option><option value="contract">Contract</option><option value="internship">Internship</option>
        </select></label>
        <label>Priority<select value={draft.priority} onChange={(event) => setDraft({ ...draft, priority: event.target.value as JobApplication["priority"] })}>
          <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
        </select></label>
        <label>Status<select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as ApplicationStatus })}>
          {statuses.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}
        </select></label>
        <label className="wide-field">Notes<textarea value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} rows={3} /></label>
      </div>
      <button className="save-button" onClick={addJob}>Save opportunity</button>
    </section>}

    <section className="tracker-board">{statuses.map((status) => {
      const column = visible.filter((job) => job.status === status.value);
      return <div
        className={`kanban-column ${dropTarget === status.value ? "drop-target" : ""}`}
        key={status.value}
        onDragOver={(event) => { event.preventDefault(); setDropTarget(status.value); }}
        onDragLeave={() => setDropTarget((current) => (current === status.value ? null : current))}
        onDrop={(event) => { event.preventDefault(); dropOn(status.value); }}
      >
        <div className="column-heading"><span style={{ background: status.accent }} /> <strong>{status.label}</strong><em>{column.length}</em></div>
        {column.map((job) => {
          const tasks = job.tasks ?? [];
          const doneCount = tasks.filter((task) => task.done).length;
          return <article
            className={`job-card ${dragId === job.id ? "dragging" : ""}`}
            key={job.id}
            draggable
            onDragStart={() => setDragId(job.id)}
            onDragEnd={() => { setDragId(null); setDropTarget(null); }}
            onClick={() => setSelectedId(job.id)}
          >
            <div className="job-card-top">
              <span className={`priority-dot ${job.priority}`} />
              <small>{job.source || "Manual"}</small>
              <button
                aria-label="Move to the next stage"
                onClick={(event) => { event.stopPropagation(); move(job, statuses[(statuses.findIndex((item) => item.value === job.status) + 1) % statuses.length].value); }}
              >→</button>
            </div>
            <h3>{job.title}</h3>
            <strong className="company-name">{job.company}</strong>
            <span className="job-location">{job.location || "Location not added"} · {job.workMode}</span>
            {tasks.length > 0 && <div className="task-meter"><span style={{ width: `${(doneCount / tasks.length) * 100}%` }} /><em>{doneCount}/{tasks.length} done</em></div>}
            <div className="job-card-footer">
              <span>{job.nextStep || "No next step"}</span>
              {job.nextStepDate && <time>{job.nextStepDate}</time>}
            </div>
          </article>;
        })}
        {!column.length && <div className="empty-column">Drop a card here</div>}
      </div>;
    })}</section>

    {selected && <div className="drawer-backdrop" onClick={() => setSelectedId(null)}>
      <aside className="job-drawer" onClick={(event) => event.stopPropagation()}>
        <button className="close-button" onClick={() => setSelectedId(null)}>×</button>
        <span className="eyebrow">{selected.company}</span>
        <h2>{selected.title}</h2>
        <p className="drawer-meta">{[selected.location, selected.employmentType, selected.workMode].filter(Boolean).join(" · ")}</p>

        <div className="drawer-actions">
          {selected.url && <a href={selected.url} target="_blank" rel="noreferrer">Open job ↗</a>}
          <select value={selected.status} onChange={(event) => move(selected, event.target.value as ApplicationStatus)}>
            {statuses.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}
          </select>
          <select value={selected.priority} onChange={(event) => update(selected.id, { priority: event.target.value as JobApplication["priority"] })}>
            <option value="low">Low priority</option><option value="medium">Medium priority</option><option value="high">High priority</option>
          </select>
        </div>

        <div className="drawer-grid">
          <label><small>Next step</small><input value={selected.nextStep ?? ""} onChange={(event) => update(selected.id, { nextStep: event.target.value })} placeholder="What happens next?" /></label>
          <label><small>Next step date</small><input type="date" value={selected.nextStepDate ?? ""} onChange={(event) => update(selected.id, { nextStepDate: event.target.value })} /></label>
          <div><small>Salary</small><strong>{selected.salary || "Not added"}</strong></div>
          <div><small>Contact</small><strong>{selected.contactName || "Not added"}</strong></div>
        </div>

        <h3>Checklist <span className="count">{(selected.tasks ?? []).filter((task) => task.done).length}/{(selected.tasks ?? []).length}</span></h3>
        <ul className="task-list">{(selected.tasks ?? []).map((task) => <li key={task.id} className={task.done ? "done" : ""}>
          <label><input type="checkbox" checked={task.done} onChange={() => toggleTask(selected, task.id)} /><span>{task.title}</span></label>
          <button onClick={() => removeTask(selected, task.id)} aria-label={`Remove ${task.title}`}>×</button>
        </li>)}</ul>
        <div className="inline-add">
          <input value={newTask} onChange={(event) => setNewTask(event.target.value)} onKeyDown={(event) => event.key === "Enter" && addTask(selected, newTask)} placeholder="Add a follow-up…" />
          <button className="ghost-button" onClick={() => addTask(selected, newTask)}>Add</button>
        </div>

        <h3>Notes</h3>
        <textarea className="drawer-notes-editor" value={selected.notes ?? ""} onChange={(event) => update(selected.id, { notes: event.target.value })} rows={6} placeholder="Interview prep, recruiter conversations, salary expectations…" />

        <div className="drawer-footer">
          <button className="text-link danger" onClick={() => removeJob(selected.id)}>Remove from board</button>
          <button className="text-link" onClick={() => setSelectedId(null)}>Close details</button>
        </div>
      </aside>
    </div>}
  </main>;
}
