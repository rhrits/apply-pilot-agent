create extension if not exists vector with schema extensions;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  first_name text not null default '', last_name text not null default '',
  email text not null default '', phone text not null default '', location text not null default '',
  linkedin_url text, github_url text, portfolio_url text, current_title text, summary text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.experiences (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  company text not null, job_title text not null, start_date date, end_date date, description text, achievements jsonb not null default '[]', technologies text[] not null default '{}', created_at timestamptz not null default now()
);
create table if not exists public.skills (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  name text not null, years numeric(4,1), proficiency text, last_used date, created_at timestamptz not null default now()
);
create table if not exists public.education (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  institution text not null, degree text, field text, start_year int, end_year int, gpa text, created_at timestamptz not null default now()
);
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  name text not null, description text, problem text, solution text, impact text, technologies text[] not null default '{}', url text, embedding extensions.vector(1536), created_at timestamptz not null default now()
);
create table if not exists public.resumes (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  name text not null, storage_path text not null, version text, parsed_text text, is_default boolean not null default false, created_at timestamptz not null default now()
);
create table if not exists public.answer_library (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  question text not null, answer text not null, category text, tags text[] not null default '{}', embedding extensions.vector(1536), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  company text, title text, url text, location text, description text, skills text[] not null default '{}', salary text, source text, created_at timestamptz not null default now()
);
create table if not exists public.applications (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid references public.jobs(id) on delete set null, resume_id uuid references public.resumes(id) on delete set null,
  status text not null default 'saved' check (status in ('saved','applying','applied','assessment','interview','rejected','offer','withdrawn')),
  applied_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.application_questions (
  id uuid primary key default gen_random_uuid(), application_id uuid not null references public.applications(id) on delete cascade,
  question text not null, field_type text, detected_value text, confidence numeric(4,3), answer text, was_autofilled boolean not null default false, was_edited boolean not null default false, created_at timestamptz not null default now()
);
create table if not exists public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade, answer_length text not null default 'short', tone text not null default 'professional-friendly', auto_fill_level text not null default 'safe_only', preferred_resume uuid references public.resumes(id) on delete set null, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.usage_events (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  event_name text not null, metadata jsonb not null default '{}', created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.experiences enable row level security;
alter table public.skills enable row level security;
alter table public.education enable row level security;
alter table public.projects enable row level security;
alter table public.resumes enable row level security;
alter table public.answer_library enable row level security;
alter table public.jobs enable row level security;
alter table public.applications enable row level security;
alter table public.application_questions enable row level security;
alter table public.user_preferences enable row level security;
alter table public.usage_events enable row level security;

revoke all on table public.profiles, public.experiences, public.skills, public.education, public.projects, public.resumes, public.answer_library, public.jobs, public.applications, public.application_questions, public.user_preferences, public.usage_events from anon, authenticated;
grant select, insert, update, delete on table public.profiles, public.experiences, public.skills, public.education, public.projects, public.resumes, public.answer_library, public.jobs, public.applications, public.application_questions, public.user_preferences, public.usage_events to authenticated;

drop policy if exists "Users own profile" on public.profiles;
create policy "Users own profile" on public.profiles for all to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

do $$
declare table_name text;
begin
  foreach table_name in array array['experiences','skills','education','projects','resumes','answer_library','jobs','applications','user_preferences','usage_events'] loop
    execute format('drop policy if exists "Users own %1$s" on public.%1$s', table_name);
    execute format('create policy "Users own %1$s" on public.%1$s for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', table_name);
    execute format('create index if not exists %1$s_user_id_idx on public.%1$s (user_id)', table_name);
  end loop;
end $$;

drop policy if exists "Users own application_questions" on public.application_questions;
create policy "Users own application_questions" on public.application_questions for all to authenticated using (exists (select 1 from public.applications a where a.id = application_id and a.user_id = (select auth.uid()))) with check (exists (select 1 from public.applications a where a.id = application_id and a.user_id = (select auth.uid())));
