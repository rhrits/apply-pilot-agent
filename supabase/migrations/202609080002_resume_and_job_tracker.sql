alter table public.resumes add column if not exists mime_type text;
alter table public.resumes add column if not exists file_size bigint;
alter table public.resumes add column if not exists formatted_text text;
alter table public.resumes add column if not exists extracted_profile jsonb not null default '{}';
alter table public.resumes add column if not exists parsing_status text not null default 'pending' check (parsing_status in ('pending','processing','ready','needs_review','failed'));
alter table public.resumes add column if not exists updated_at timestamptz not null default now();

alter table public.jobs add column if not exists company_url text;
alter table public.jobs add column if not exists work_mode text not null default 'unknown' check (work_mode in ('remote','hybrid','onsite','unknown'));
alter table public.jobs add column if not exists employment_type text not null default 'unknown' check (employment_type in ('full-time','part-time','contract','internship','unknown'));
alter table public.jobs add column if not exists salary_min numeric;
alter table public.jobs add column if not exists salary_max numeric;
alter table public.jobs add column if not exists salary_currency text default 'USD';
alter table public.jobs add column if not exists priority text not null default 'medium' check (priority in ('low','medium','high'));
alter table public.jobs add column if not exists next_step text;
alter table public.jobs add column if not exists next_step_date date;
alter table public.jobs add column if not exists notes text;
alter table public.jobs add column if not exists contact_name text;
alter table public.jobs add column if not exists tags text[] not null default '{}';
alter table public.jobs add column if not exists job_description text;

alter table public.applications add column if not exists applied_at timestamptz;
alter table public.applications add column if not exists interview_date timestamptz;
alter table public.applications add column if not exists follow_up_date date;
alter table public.applications add column if not exists rejection_reason text;
alter table public.applications add column if not exists rating int check (rating between 1 and 5);
alter table public.applications add column if not exists notes text;

create index if not exists jobs_status_idx on public.jobs (user_id, created_at desc);
create index if not exists applications_status_idx on public.applications (user_id, status);
create index if not exists resumes_status_idx on public.resumes (user_id, parsing_status);

insert into storage.buckets (id, name, public)
values ('resumes', 'resumes', false)
on conflict (id) do update set public = excluded.public;

drop policy if exists "Users manage own resume files" on storage.objects;
create policy "Users manage own resume files" on storage.objects
for all to authenticated
using (bucket_id = 'resumes' and owner_id = (select auth.uid())::text)
with check (bucket_id = 'resumes' and owner_id = (select auth.uid())::text);
