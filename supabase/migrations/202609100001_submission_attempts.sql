-- Phase E: atomically consume approved drafts and record strict outcomes.

alter table public.application_drafts add column if not exists token_verifier text;
revoke update on table public.application_drafts from authenticated;
alter table public.applications add column if not exists submission_state text not null default 'not_started'
  check (submission_state in ('not_started','submitting','confirmed','unknown','failed'));
alter table public.applications add column if not exists submission_attempt_id uuid;
alter table public.applications add column if not exists submission_evidence jsonb;
alter table public.applications add column if not exists external_application_id text;

create table if not exists public.submission_attempts (
  id uuid primary key,
  session_id uuid not null references public.application_sessions(id) on delete cascade,
  draft_id uuid not null references public.application_drafts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  snapshot_hash text not null,
  started_at timestamptz not null,
  deadline_at timestamptz not null,
  outcome text not null default 'pending' check (outcome in ('pending','confirmed','unknown','failed')),
  evidence jsonb not null default '[]'::jsonb,
  error_reason text,
  external_application_id text,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.submission_attempts enable row level security;
revoke all on table public.submission_attempts from anon, authenticated;
grant select on table public.submission_attempts to authenticated;
drop policy if exists "Users read own submission attempts" on public.submission_attempts;
create policy "Users read own submission attempts" on public.submission_attempts
  for select to authenticated using (user_id = (select auth.uid()));
create index if not exists submission_attempts_user_idx on public.submission_attempts (user_id, created_at desc);
create index if not exists submission_attempts_deadline_idx on public.submission_attempts (outcome, deadline_at);

-- Enforce that a draft and its parent session belong to the same user.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'application_sessions_id_user_unique') then
    alter table public.application_sessions add constraint application_sessions_id_user_unique unique (id, user_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'application_drafts_session_user_fk') then
    alter table public.application_drafts add constraint application_drafts_session_user_fk
      foreign key (session_id, user_id) references public.application_sessions(id, user_id) on delete cascade;
  end if;
end $$;

create or replace function public.issue_application_approval(
  p_draft_id uuid, p_session_id uuid, p_snapshot_hash text,
  p_token_verifier text, p_expires_at timestamptz
) returns boolean
language plpgsql security definer set search_path = public
as $$
declare changed integer;
begin
  update public.application_drafts set approved_at = now(), approval_expires_at = p_expires_at, token_verifier = p_token_verifier
   where id = p_draft_id and session_id = p_session_id and user_id = auth.uid()
     and snapshot_hash = p_snapshot_hash and consumed_at is null
     and (approved_at is null or approval_expires_at <= now());
  get diagnostics changed = row_count;
  if changed <> 1 then return false; end if;
  update public.application_sessions set status = 'approved', updated_at = now()
   where id = p_session_id and user_id = auth.uid();
  return true;
end;
$$;

-- The only operation that can consume approval. Raw tokens never enter the database;
-- only their SHA-256 verifier is compared.
create or replace function public.consume_application_approval(
  p_attempt_id uuid, p_draft_id uuid, p_session_id uuid, p_snapshot_hash text,
  p_token_verifier text, p_started_at timestamptz, p_deadline_at timestamptz
) returns boolean
language plpgsql security definer set search_path = public
as $$
declare
  changed integer;
begin
  update public.application_drafts
     set consumed_at = p_started_at
   where id = p_draft_id and session_id = p_session_id and user_id = auth.uid()
     and snapshot_hash = p_snapshot_hash and token_verifier = p_token_verifier
     and approved_at is not null and approval_expires_at > p_started_at and consumed_at is null;
  get diagnostics changed = row_count;
  if changed <> 1 then return false; end if;

  insert into public.submission_attempts(id, session_id, draft_id, user_id, snapshot_hash, started_at, deadline_at)
  values (p_attempt_id, p_session_id, p_draft_id, auth.uid(), p_snapshot_hash, p_started_at, p_deadline_at);
  update public.application_sessions set status = 'submitting', updated_at = now()
   where id = p_session_id and user_id = auth.uid();
  update public.applications a set submission_state = 'submitting', submission_attempt_id = p_attempt_id
   from public.application_sessions s where s.id = p_session_id and s.user_id = auth.uid() and a.job_id = s.job_id and a.user_id = auth.uid();
  return true;
end;
$$;

create or replace function public.finalize_submission_attempt(
  p_attempt_id uuid, p_outcome text, p_evidence jsonb, p_reason text default null,
  p_external_application_id text default null
) returns boolean
language plpgsql security definer set search_path = public
as $$
declare
  attempt public.submission_attempts%rowtype;
  session_row public.application_sessions%rowtype;
begin
  if p_outcome not in ('confirmed','unknown','failed') then return false; end if;
  select * into attempt from public.submission_attempts where id = p_attempt_id and user_id = auth.uid() and outcome = 'pending' for update;
  if not found then
    return exists(select 1 from public.submission_attempts where id = p_attempt_id and user_id = auth.uid() and outcome = p_outcome);
  end if;
  update public.submission_attempts set outcome = p_outcome, evidence = coalesce(p_evidence, '[]'::jsonb), error_reason = p_reason,
    external_application_id = p_external_application_id, completed_at = now() where id = p_attempt_id;
  select * into session_row from public.application_sessions where id = attempt.session_id and user_id = auth.uid();
  update public.application_sessions set status = case p_outcome when 'confirmed' then 'submitted' when 'unknown' then 'submission_unknown' else 'failed' end, updated_at = now()
   where id = attempt.session_id and user_id = auth.uid();
  update public.applications set
    submission_state = p_outcome,
    status = case when p_outcome = 'confirmed' then 'applied' else 'applying' end,
    applied_at = case when p_outcome = 'confirmed' then now() else applied_at end,
    submission_evidence = coalesce(p_evidence, '[]'::jsonb),
    external_application_id = p_external_application_id,
    submission_attempt_id = p_attempt_id,
    updated_at = now()
   where user_id = auth.uid() and job_id = session_row.job_id;
  return true;
end;
$$;

revoke all on function public.consume_application_approval(uuid,uuid,uuid,text,text,timestamptz,timestamptz) from public;
grant execute on function public.consume_application_approval(uuid,uuid,uuid,text,text,timestamptz,timestamptz) to authenticated;
revoke all on function public.issue_application_approval(uuid,uuid,text,text,timestamptz) from public;
grant execute on function public.issue_application_approval(uuid,uuid,text,text,timestamptz) to authenticated;
revoke all on function public.finalize_submission_attempt(uuid,text,jsonb,text,text) from public;
grant execute on function public.finalize_submission_attempt(uuid,text,jsonb,text,text) to authenticated;

-- Extend the session status check installed by Phase D.
alter table public.application_sessions drop constraint if exists application_sessions_status_check;
alter table public.application_sessions add constraint application_sessions_status_check check (status in (
  'observing','filling','waiting_for_transition','awaiting_user','blocked','stalled','timed_out','max_steps','cancelled',
  'ready_for_review','approved','approval_expired','submitting','submitted','submission_unknown','failed'
));
