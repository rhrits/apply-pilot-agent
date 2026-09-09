-- Profile v2: manual ordering and the free-text fields the UI already models.
--
-- Two problems this fixes:
--
-- 1. Order was not representable. The save path deletes and reinserts every child row,
--    so without an explicit position the candidate's chosen order was lost on every
--    save and rows came back in whatever order Postgres returned them. Recruiters read
--    the most recent role first, so order is meaningful data, not presentation.
--
-- 2. `period`, `location`, `role` were dropped on save. `UserProfile` models them as
--    free text ("2022 — Present", "Remote", "Tech lead") because that is how resumes
--    actually write them, but only `start_date`/`end_date` date columns existed, so a
--    resume period that was not a parseable date range could not round-trip at all.

alter table public.experiences add column if not exists position integer not null default 0;
alter table public.education   add column if not exists position integer not null default 0;
alter table public.projects    add column if not exists position integer not null default 0;
alter table public.skills      add column if not exists position integer not null default 0;

-- Free-text period/location keep the resume's own wording instead of forcing a date cast.
alter table public.experiences add column if not exists period text;
alter table public.experiences add column if not exists location text;
alter table public.education   add column if not exists period text;
alter table public.projects    add column if not exists period text;
alter table public.projects    add column if not exists role text;

-- Ordered reads are the only reads these tables get.
create index if not exists experiences_position_idx on public.experiences (user_id, position);
create index if not exists education_position_idx   on public.education (user_id, position);
create index if not exists projects_position_idx    on public.projects (user_id, position);
create index if not exists skills_position_idx      on public.skills (user_id, position);
