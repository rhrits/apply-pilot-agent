-- Controlled beta access: user requests, admin approval, one-time hashed invite codes,
-- and the entitlements created when a code is redeemed.
--
-- The plaintext code never reaches this database. The server generates a high-entropy
-- code, stores only its SHA-256 digest, and passes the digest to the redemption RPC.

create table if not exists public.admin_users (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users(id) on delete cascade,
  email text not null unique,
  role text not null default 'admin' check (role in ('admin', 'super_admin')),
  created_at timestamptz not null default now()
);

-- Bootstrap the initial administrator. The row binds automatically by email until the
-- account signs in; no client can create or modify admin rows.
insert into public.admin_users (email, role)
values ('58crores@gmail.com', 'super_admin')
on conflict (email) do nothing;

create table if not exists public.access_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  email text not null,
  requested_feature text not null default 'workspace',
  message text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  reviewer_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists access_requests_status_idx on public.access_requests (status, created_at desc);

create table if not exists public.access_codes (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.access_requests(id) on delete restrict,
  bound_user_id uuid not null references auth.users(id) on delete cascade,
  code_hash text not null unique,
  code_prefix text not null,
  status text not null default 'active' check (status in ('active', 'redeemed', 'expired', 'revoked')),
  expires_at timestamptz not null,
  redeemed_at timestamptz,
  redeemed_by uuid references auth.users(id),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists access_codes_bound_user_idx on public.access_codes (bound_user_id, created_at desc);
create index if not exists access_codes_status_idx on public.access_codes (status, expires_at);

create table if not exists public.access_code_redemptions (
  id uuid primary key default gen_random_uuid(),
  access_code_id uuid not null unique references public.access_codes(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete cascade,
  entitlement_id uuid,
  redeemed_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists access_code_redemptions_user_idx on public.access_code_redemptions (user_id, redeemed_at desc);

create table if not exists public.entitlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  feature_key text not null default 'workspace',
  status text not null default 'active' check (status in ('active', 'expired', 'revoked')),
  source text not null check (source in ('coupon', 'admin', 'approval', 'subscription')),
  source_id uuid,
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists entitlements_user_idx on public.entitlements (user_id, feature_key, status);
create unique index if not exists entitlements_active_feature_idx
  on public.entitlements (user_id, feature_key)
  where status = 'active';

create table if not exists public.admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null references auth.users(id),
  action text not null,
  target_type text not null,
  target_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists admin_audit_logs_created_idx on public.admin_audit_logs (created_at desc);

alter table public.admin_users enable row level security;
alter table public.access_requests enable row level security;
alter table public.access_codes enable row level security;
alter table public.access_code_redemptions enable row level security;
alter table public.entitlements enable row level security;
alter table public.admin_audit_logs enable row level security;

-- No direct client policies exist for admin-controlled tables. User requests and
-- entitlements are exposed through the narrow RPCs below.
create policy access_requests_select_own on public.access_requests
  for select to authenticated using (user_id = auth.uid());

create policy access_requests_insert_own on public.access_requests
  for insert to authenticated
  with check (user_id = auth.uid() and status = 'pending' and reviewed_by is null);

create policy entitlements_select_own on public.entitlements
  for select to authenticated using (user_id = auth.uid());

create or replace function public.is_applypilot_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_users
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      and (user_id is null or user_id = auth.uid())
  );
$$;

create or replace function public.request_access(p_message text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
  declare
    v_user_id uuid := auth.uid();
    v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
    v_request public.access_requests;
  begin
    if v_user_id is null then raise exception 'not_authenticated'; end if;

    select * into v_request from public.access_requests where user_id = v_user_id for update;
    if v_request.id is not null then
      if v_request.status = 'rejected' then
        update public.access_requests
        set status = 'pending', message = nullif(left(trim(coalesce(p_message, '')), 1000), ''),
            reviewed_by = null, reviewed_at = null, reviewer_note = null, updated_at = now()
        where id = v_request.id
        returning * into v_request;
      end if;
      return to_jsonb(v_request);
    end if;

    insert into public.access_requests (user_id, email, message)
    values (v_user_id, v_email, nullif(left(trim(coalesce(p_message, '')), 1000), ''))
    returning * into v_request;
    return to_jsonb(v_request);
  end;
$$;

create or replace function public.get_my_access_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
  declare
    v_user_id uuid := auth.uid();
    v_profile_completed timestamptz;
    v_request jsonb;
    v_entitlements jsonb;
  begin
    if v_user_id is null then raise exception 'not_authenticated'; end if;

    select onboarding_completed_at into v_profile_completed
    from public.profiles where id = v_user_id;

    select to_jsonb(row) into v_request
    from (
      select id, status, requested_feature, message, reviewer_note, created_at, updated_at, reviewed_at
      from public.access_requests where user_id = v_user_id
    ) row;

    select coalesce(jsonb_agg(to_jsonb(row) order by row.starts_at desc), '[]'::jsonb)
    into v_entitlements
    from (
      select id, feature_key, status, source, starts_at, expires_at, metadata
      from public.entitlements
      where user_id = v_user_id
        and status = 'active'
        and (expires_at is null or expires_at > now())
    ) row;

    return jsonb_build_object(
      'userId', v_user_id,
      'email', lower(coalesce(auth.jwt() ->> 'email', '')),
      'isAdmin', public.is_applypilot_admin(),
      'onboardingCompletedAt', v_profile_completed,
      'request', coalesce(v_request, 'null'::jsonb),
      'entitlements', v_entitlements,
      'hasAccess', exists (
        select 1 from public.entitlements
        where user_id = v_user_id and feature_key = 'workspace' and status = 'active'
          and (expires_at is null or expires_at > now())
      )
    );
  end;
$$;

create or replace function public.redeem_access_code(p_code_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
  declare
    v_user_id uuid := auth.uid();
    v_code public.access_codes;
    v_entitlement public.entitlements;
  begin
    if v_user_id is null then return jsonb_build_object('ok', false, 'reason', 'invalid'); end if;

    select * into v_code from public.access_codes
    where code_hash = lower(trim(p_code_hash))
    for update;

    if v_code.id is null then return jsonb_build_object('ok', false, 'reason', 'invalid'); end if;
    if v_code.status <> 'active' or v_code.expires_at <= now() or v_code.bound_user_id <> v_user_id then
      if v_code.status = 'active' and v_code.expires_at <= now() then
        update public.access_codes set status = 'expired' where id = v_code.id;
      end if;
      return jsonb_build_object('ok', false, 'reason', 'invalid');
    end if;

    insert into public.entitlements (user_id, feature_key, source, source_id, metadata)
    values (v_user_id, 'workspace', 'coupon', v_code.id, jsonb_build_object('code_prefix', v_code.code_prefix))
    on conflict (user_id, feature_key) where status = 'active' do nothing
    returning * into v_entitlement;

    if v_entitlement.id is null then
      select * into v_entitlement from public.entitlements
      where user_id = v_user_id and feature_key = 'workspace' and status = 'active';
    end if;

    update public.access_codes
    set status = 'redeemed', redeemed_at = now(), redeemed_by = v_user_id
    where id = v_code.id;

    insert into public.access_code_redemptions (access_code_id, user_id, entitlement_id)
    values (v_code.id, v_user_id, v_entitlement.id);

    return jsonb_build_object('ok', true, 'entitlementId', v_entitlement.id);
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end;
$$;

create or replace function public.admin_list_access_requests()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_applypilot_admin() then raise exception 'not_authorized'; end if;
  return coalesce((select jsonb_agg(to_jsonb(row) order by row.created_at desc) from (
    select ar.id, ar.user_id, ar.email, ar.requested_feature, ar.message, ar.status,
           ar.reviewed_by, ar.reviewed_at, ar.reviewer_note, ar.created_at, ar.updated_at
    from public.access_requests ar
  ) row), '[]'::jsonb);
end;
$$;

create or replace function public.admin_review_access_request(p_request_id uuid, p_decision text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
  declare
    v_request public.access_requests;
    v_decision text := lower(trim(p_decision));
  begin
    if not public.is_applypilot_admin() then raise exception 'not_authorized'; end if;
    if v_decision not in ('approved', 'rejected') then raise exception 'invalid_decision'; end if;

    update public.access_requests
    set status = v_decision, reviewed_by = auth.uid(), reviewed_at = now(),
        reviewer_note = nullif(left(trim(coalesce(p_note, '')), 1000), ''), updated_at = now()
    where id = p_request_id
    returning * into v_request;
    if v_request.id is null then raise exception 'request_not_found'; end if;

    insert into public.admin_audit_logs (admin_user_id, action, target_type, target_id, metadata)
    values (auth.uid(), 'request_' || v_decision, 'access_request', v_request.id, jsonb_build_object('user_id', v_request.user_id));
    return to_jsonb(v_request);
  end;
$$;

create or replace function public.admin_create_access_code(p_request_id uuid, p_code_hash text, p_code_prefix text, p_expires_at timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
  declare
    v_request public.access_requests;
    v_code public.access_codes;
  begin
    if not public.is_applypilot_admin() then raise exception 'not_authorized'; end if;
    if p_expires_at <= now() or p_expires_at > now() + interval '2 hours' then raise exception 'invalid_expiry'; end if;

    select * into v_request from public.access_requests where id = p_request_id;
    if v_request.id is null or v_request.status <> 'approved' then raise exception 'request_not_approved'; end if;

    insert into public.access_codes (request_id, bound_user_id, code_hash, code_prefix, expires_at, created_by)
    values (v_request.id, v_request.user_id, lower(trim(p_code_hash)), upper(trim(p_code_prefix)), p_expires_at, auth.uid())
    returning * into v_code;

    insert into public.admin_audit_logs (admin_user_id, action, target_type, target_id, metadata)
    values (auth.uid(), 'code_created', 'access_code', v_code.id, jsonb_build_object('request_id', v_request.id, 'expires_at', v_code.expires_at));
    return jsonb_build_object('id', v_code.id, 'expiresAt', v_code.expires_at, 'status', v_code.status);
  end;
$$;

create or replace function public.admin_list_access_codes()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_applypilot_admin() then raise exception 'not_authorized'; end if;
  update public.access_codes set status = 'expired' where status = 'active' and expires_at <= now();
  return coalesce((select jsonb_agg(to_jsonb(row) order by row.created_at desc) from (
    select ac.id, ac.request_id, ac.bound_user_id, ar.email, ac.code_prefix, ac.status,
           ac.expires_at, ac.redeemed_at, ac.redeemed_by, ac.created_at
    from public.access_codes ac join public.access_requests ar on ar.id = ac.request_id
  ) row), '[]'::jsonb);
end;
$$;

create or replace function public.admin_revoke_access_code(p_code_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
  declare v_code public.access_codes;
begin
  if not public.is_applypilot_admin() then raise exception 'not_authorized'; end if;
  update public.access_codes set status = 'revoked'
  where id = p_code_id and status = 'active'
  returning * into v_code;
  if v_code.id is null then raise exception 'code_not_active'; end if;
  insert into public.admin_audit_logs (admin_user_id, action, target_type, target_id)
  values (auth.uid(), 'code_revoked', 'access_code', v_code.id);
  return jsonb_build_object('ok', true, 'id', v_code.id);
end;
$$;

revoke all on function public.is_applypilot_admin() from public;
revoke all on function public.request_access(text) from public;
revoke all on function public.get_my_access_status() from public;
revoke all on function public.redeem_access_code(text) from public;
revoke all on function public.admin_list_access_requests() from public;
revoke all on function public.admin_review_access_request(uuid, text, text) from public;
revoke all on function public.admin_create_access_code(uuid, text, text, timestamptz) from public;
revoke all on function public.admin_list_access_codes() from public;
revoke all on function public.admin_revoke_access_code(uuid) from public;
grant execute on function public.is_applypilot_admin() to authenticated;
grant execute on function public.request_access(text) to authenticated;
grant execute on function public.get_my_access_status() to authenticated;
grant execute on function public.redeem_access_code(text) to authenticated;
grant execute on function public.admin_list_access_requests() to authenticated;
grant execute on function public.admin_review_access_request(uuid, text, text) to authenticated;
grant execute on function public.admin_create_access_code(uuid, text, text, timestamptz) to authenticated;
grant execute on function public.admin_list_access_codes() to authenticated;
grant execute on function public.admin_revoke_access_code(uuid) to authenticated;
