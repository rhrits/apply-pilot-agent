-- Phase E follow-up hardening.
--
-- Use this migration when 202609100001_submission_attempts.sql was already applied.
-- It adds only the changes introduced after the original migration: protected approval
-- writes, same-user ownership, controlled approval issuance, idempotent finalization,
-- and the expanded session/status constraints.

-- The client may read drafts, but approval/consumption columns are changed only by the
-- SECURITY DEFINER RPCs below.
revoke update on table public.application_drafts from authenticated;

-- Make it impossible for a user-owned draft to point at another user's session.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'application_sessions_id_user_unique') then
    alter table public.application_sessions add constraint application_sessions_id_user_unique unique (id, user_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'application_drafts_session_user_fk') then
    alter table public.application_drafts add constraint application_drafts_session_user_fk
      foreign key (session_id, user_id) references public.application_sessions(id, user_id) on delete cascade;
  end if;
end $$;

-- Approval issuance is owner-checked and permits renewal only after an old approval
-- expired. Raw tokens never enter the database; the extension sends only a verifier.
create or replace function public.issue_application_approval(
  p_draft_id uuid, p_session_id uuid, p_snapshot_hash text,
  p_token_verifier text, p_expires_at timestamptz
) returns boolean
language plpgsql security definer set search_path = public
as $$
declare changed integer;
begin
  update public.application_drafts
     set approved_at = now(), approval_expires_at = p_expires_at, token_verifier = p_token_verifier
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

-- Keep the existing consume RPC definition but ensure it is still exposed only through
-- the authenticated function boundary after the update privilege was revoked.
revoke all on function public.issue_application_approval(uuid,uuid,text,text,timestamptz) from public;
grant execute on function public.issue_application_approval(uuid,uuid,text,text,timestamptz) to authenticated;
revoke all on function public.consume_application_approval(uuid,uuid,uuid,text,text,timestamptz,timestamptz) from public;
grant execute on function public.consume_application_approval(uuid,uuid,uuid,text,text,timestamptz,timestamptz) to authenticated;

-- Make outcome finalization safe to retry after a network response was lost. If the
-- attempt already has the same terminal outcome, return success; a different outcome
-- remains rejected.
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
  select * into attempt from public.submission_attempts
   where id = p_attempt_id and user_id = auth.uid() and outcome = 'pending' for update;
  if not found then
    return exists(select 1 from public.submission_attempts where id = p_attempt_id and user_id = auth.uid() and outcome = p_outcome);
  end if;
  update public.submission_attempts
     set outcome = p_outcome, evidence = coalesce(p_evidence, '[]'::jsonb), error_reason = p_reason,
         external_application_id = p_external_application_id, completed_at = now()
   where id = p_attempt_id;
  select * into session_row from public.application_sessions where id = attempt.session_id and user_id = auth.uid();
  update public.application_sessions
     set status = case p_outcome when 'confirmed' then 'submitted' when 'unknown' then 'submission_unknown' else 'failed' end,
         updated_at = now()
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

revoke all on function public.finalize_submission_attempt(uuid,text,jsonb,text,text) from public;
grant execute on function public.finalize_submission_attempt(uuid,text,jsonb,text,text) to authenticated;

-- Replace stale constraints from the first version if they exist.
alter table public.application_sessions drop constraint if exists application_sessions_status_check;
alter table public.application_sessions add constraint application_sessions_status_check check (status in (
  'observing','filling','waiting_for_transition','awaiting_user','blocked','stalled','timed_out','max_steps','cancelled',
  'ready_for_review','approved','approval_expired','submitting','submitted','submission_unknown','failed'
));

alter table public.applications drop constraint if exists applications_submission_state_check;
alter table public.applications add constraint applications_submission_state_check check (submission_state in ('not_started','submitting','confirmed','unknown','failed'));
