-- Resume-first profile model.
--
-- The resume is the authoritative source of truth. Everything extracted from it is stored
-- verbatim in `resume_profile` so later enrichment (GitHub, portfolio links, narrative)
-- can only ever FILL GAPS and never overwrite a fact the candidate's own resume stated.

-- Structured JSON extracted from the resume, kept separate from the verified profile.
alter table public.profiles add column if not exists resume_profile jsonb not null default '{}'::jsonb;

-- Plain resume text, retained so extraction can be re-run without a re-upload.
alter table public.profiles add column if not exists resume_text text;

-- Rendered Markdown profile with generated headings (Summary, Skills, Experience, ...).
alter table public.profiles add column if not exists profile_markdown text;

-- Provenance map: { "<profile field>": "resume" | "github" | "typed" | ... } so the UI can
-- show where every value came from and the merge engine can respect precedence.
alter table public.profiles add column if not exists profile_sources jsonb not null default '{}'::jsonb;

-- Autosaved onboarding working copy. Written on every onboarding step so a refresh,
-- crash, or device switch never loses captured data.
alter table public.profiles add column if not exists draft_profile jsonb not null default '{}'::jsonb;
alter table public.profiles add column if not exists draft_updated_at timestamptz;

-- Application answers captured during onboarding, kept as raw candidate input.
alter table public.profiles add column if not exists application_answers jsonb not null default '{}'::jsonb;

-- Deduplicate signals so re-importing the same resume or link updates instead of piling up.
create unique index if not exists profile_signals_user_origin_idx
  on public.profile_signals (user_id, source, origin);
