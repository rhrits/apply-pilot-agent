-- Records how an application came to be marked as applied.
--
-- Automatic status changes must be auditable: storing the evidence and the confidence
-- lets the user (and support) see exactly why a job moved to "applied", and lets us
-- tune detection thresholds against real data rather than guesswork.

alter table public.applications add column if not exists applied_at timestamptz;
alter table public.applications add column if not exists detection_signals jsonb;
alter table public.applications add column if not exists detection_confidence numeric;

-- Stamp the applied moment automatically so tracker timelines stay accurate even when
-- the status is changed by hand in the dashboard.
create or replace function public.set_application_applied_at()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'applied' and (old.status is distinct from 'applied') and new.applied_at is null then
    new.applied_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists applications_applied_at on public.applications;
create trigger applications_applied_at
  before insert or update on public.applications
  for each row execute function public.set_application_applied_at();

create index if not exists applications_applied_at_idx on public.applications (user_id, applied_at desc);
