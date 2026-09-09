alter table public.jobs add column if not exists match_score numeric(5,2) check (match_score is null or (match_score >= 0 and match_score <= 100));
alter table public.jobs add column if not exists match_details jsonb not null default '{}';
alter table public.jobs add column if not exists detected_at timestamptz;

create index if not exists jobs_match_score_idx on public.jobs (user_id, match_score desc nulls last);
