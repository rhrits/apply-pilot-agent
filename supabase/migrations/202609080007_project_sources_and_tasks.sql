-- Primary vs supporting projects, and per-application checklists.
--
-- Projects the candidate put on their resume are primary: employers already saw them.
-- Anything discovered from GitHub or a portfolio link is supporting evidence and is
-- stored with its own provenance so the UI can show the two groups separately and the
-- merge engine can keep resume entries authoritative.
alter table public.projects add column if not exists source text not null default 'resume'
  check (source in ('resume', 'github', 'portfolio', 'manual'));

create index if not exists projects_source_idx on public.projects (user_id, source);

-- Follow-up checklist for a tracked opportunity: [{ id, title, done, dueDate }].
alter table public.jobs add column if not exists tasks jsonb not null default '[]'::jsonb;
