-- Phase D: immutable pre-submit drafts and review evidence.

create table if not exists public.application_sessions (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid references public.jobs(id) on delete set null,
  url text not null,
  ats text,
  mode text not null check (mode in ('observe','autofill','step','review_before_submit')),
  status text not null check (status in ('observing','filling','waiting_for_transition','awaiting_user','blocked','stalled','timed_out','max_steps','cancelled','ready_for_review','approved','approval_expired','submitted','failed')),
  blockers jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.application_drafts (
  id uuid primary key,
  session_id uuid not null references public.application_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  step_index integer not null check (step_index >= 0),
  answers jsonb not null,
  form_html text,
  screenshot_path text,
  snapshot_hash text not null check (length(snapshot_hash) = 64),
  redaction_version text not null default 'v1',
  approved_at timestamptz,
  approval_expires_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (session_id, snapshot_hash)
);

alter table public.application_sessions enable row level security;
alter table public.application_drafts enable row level security;
revoke all on table public.application_sessions, public.application_drafts from anon, authenticated;
grant select, insert, update, delete on table public.application_sessions, public.application_drafts to authenticated;

drop policy if exists "Users own application sessions" on public.application_sessions;
create policy "Users own application sessions" on public.application_sessions
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "Users own application drafts" on public.application_drafts;
create policy "Users own application drafts" on public.application_drafts
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create index if not exists application_sessions_user_idx on public.application_sessions (user_id, updated_at desc);
create index if not exists application_drafts_session_idx on public.application_drafts (session_id, created_at desc);
create index if not exists application_drafts_user_idx on public.application_drafts (user_id, created_at desc);

insert into storage.buckets (id, name, public)
values ('application-evidence', 'application-evidence', false)
on conflict (id) do update set public = excluded.public;

drop policy if exists "Users manage own application evidence" on storage.objects;
create policy "Users manage own application evidence" on storage.objects
  for all to authenticated
  using (bucket_id = 'application-evidence' and owner_id = (select auth.uid())::text)
  with check (bucket_id = 'application-evidence' and owner_id = (select auth.uid())::text);
