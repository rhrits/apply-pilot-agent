-- Onboarding state: raw signals, narrative, and completion tracking.
alter table public.profiles add column if not exists onboarding_completed_at timestamptz;
alter table public.profiles add column if not exists narrative jsonb not null default '{}'::jsonb;

-- Captured source material (resume text, GitHub payloads, crawled pages, voice transcripts).
-- Kept separate from the verified profile so the user can re-run extraction at any time.
create table if not exists public.profile_signals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null check (source in ('resume','github','website','project','linkedin_export','typed','voice','answers')),
  origin text not null,
  content text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.profile_signals enable row level security;
revoke all on table public.profile_signals from anon, authenticated;
grant select, insert, update, delete on table public.profile_signals to authenticated;

drop policy if exists "Users own profile_signals" on public.profile_signals;
create policy "Users own profile_signals" on public.profile_signals
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create index if not exists profile_signals_user_id_idx on public.profile_signals (user_id);
create index if not exists profile_signals_source_idx on public.profile_signals (user_id, source);

-- Answer library gains provenance so the user can audit where an answer came from.
alter table public.answer_library add column if not exists source text default 'user';
alter table public.answer_library add column if not exists edited boolean not null default false;
