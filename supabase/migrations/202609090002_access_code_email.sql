-- Allow the server to verify that the plaintext invite being emailed matches the
-- stored digest. The plaintext is never returned by this RPC or stored in Postgres.
create or replace function public.admin_prepare_access_code_email(p_code_id uuid, p_code_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
  declare
    v_code public.access_codes;
    v_email text;
  begin
    if not public.is_applypilot_admin() then raise exception 'not_authorized'; end if;

    select ac.* into v_code
    from public.access_codes ac
    join public.access_requests ar on ar.id = ac.request_id
    where ac.id = p_code_id and ac.code_hash = lower(trim(p_code_hash))
    for update;

    if v_code.id is null or v_code.status <> 'active' or v_code.expires_at <= now() then
      raise exception 'code_not_active';
    end if;

    select ar.email into v_email
    from public.access_requests ar
    where ar.id = v_code.request_id;

    return jsonb_build_object(
      'email', v_email,
      'expiresAt', v_code.expires_at,
      'codePrefix', v_code.code_prefix
    );
  end;
$$;

revoke all on function public.admin_prepare_access_code_email(uuid, text) from public;
grant execute on function public.admin_prepare_access_code_email(uuid, text) to authenticated;
