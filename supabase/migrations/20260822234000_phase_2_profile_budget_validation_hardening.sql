-- LifeQuest Phase 2 hardening: reject malformed dailyBudget JSON before the
-- command writer performs any numeric conversion or creates an operation row.

create or replace function public.update_member_profile(
  p_user_id uuid,
  p_command jsonb,
  p_expected_version bigint default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_payload jsonb := coalesce(p_command -> 'payload', '{}'::jsonb);
  v_budget_text text := coalesce(v_payload ->> 'dailyBudget', '');
  v_budget integer;
begin
  if v_payload ? 'dailyBudget' then
    if jsonb_typeof(v_payload -> 'dailyBudget') <> 'number'
      or v_budget_text !~ '^[0-9]{1,9}$'
    then
      return jsonb_build_object(
        'ok', false,
        'errorCode', 'INVALID_PAYLOAD',
        'retryable', false,
        'operationId', nullif(coalesce(p_command ->> 'operationId', ''), '')
      );
    end if;

    v_budget := v_budget_text::integer;
    if v_budget not between 1 and 100000000 then
      return jsonb_build_object(
        'ok', false,
        'errorCode', 'INVALID_PAYLOAD',
        'retryable', false,
        'operationId', nullif(coalesce(p_command ->> 'operationId', ''), '')
      );
    end if;
  end if;

  return private.update_member_profile(p_user_id, p_command, p_expected_version);
end;
$$;

revoke all on function public.update_member_profile(uuid, jsonb, bigint)
  from public, anon, authenticated;
grant execute on function public.update_member_profile(uuid, jsonb, bigint)
  to service_role;

comment on function public.update_member_profile(uuid, jsonb, bigint) is
  'Phase 2 safe profile update command with pre-cast dailyBudget validation.';
