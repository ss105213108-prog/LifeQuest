-- LifeQuest Phase 4B: resolve completed operation receipts before rebuilding
-- a plan. The transaction kernel remains the final race-safe authority.

create or replace function private.phase4b_operation_receipt(p_user_id uuid, p_command jsonb)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_operation private.command_operations%rowtype;
  v_operation_id text := p_command ->> 'operationId';
  v_command_type text := p_command ->> 'type';
  v_request_hash text;
  v_current_version bigint;
  v_operation_version bigint;
begin
  if p_user_id is null or p_command is null or jsonb_typeof(p_command) <> 'object'
    or v_command_type not in ('REPORT_HABIT_EVENT', 'REVERSE_HABIT_EVENT', 'SUBMIT_DAILY_ENTRY')
    or p_command ->> 'contractVersion' <> '1'
    or v_operation_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$' then
    return jsonb_build_object('ok', false, 'errorCode', 'INVALID_PAYLOAD');
  end if;

  v_request_hash := encode(extensions.digest(convert_to(p_command::text, 'UTF8'), 'sha256'), 'hex');
  select * into v_operation from private.command_operations
    where user_id = p_user_id and operation_id = v_operation_id;
  if not found then return jsonb_build_object('ok', true, 'duplicate', false); end if;
  if v_operation.command_type <> v_command_type or v_operation.request_hash <> v_request_hash then
    return jsonb_build_object('ok', false, 'errorCode', 'OPERATION_ID_REUSED');
  end if;
  if v_operation.status <> 'completed' or v_operation.result is null then
    return jsonb_build_object('ok', false, 'errorCode', 'OPERATION_IN_PROGRESS', 'retryable', true);
  end if;

  select repository_version into v_current_version
    from public.member_game_roots where user_id = p_user_id;
  if v_current_version is null then return jsonb_build_object('ok', false, 'errorCode', 'NOT_FOUND'); end if;
  v_operation_version := coalesce((v_operation.result ->> 'repositoryVersion')::bigint, v_current_version);
  return v_operation.result || jsonb_build_object(
    'ok', true, 'duplicate', true, 'operationId', v_operation_id,
    'operationRepositoryVersion', v_operation_version,
    'repositoryVersion', v_current_version,
    'state', private.phase4b_state(p_user_id), 'serverTimestamp', now()
  );
end;
$$;

revoke all on function private.phase4b_operation_receipt(uuid, jsonb) from public, anon, authenticated;
grant execute on function private.phase4b_operation_receipt(uuid, jsonb) to service_role;

create or replace function public.get_phase4b_operation_receipt(p_user_id uuid, p_command jsonb)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$ select private.phase4b_operation_receipt(p_user_id, p_command); $$;

revoke all on function public.get_phase4b_operation_receipt(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.get_phase4b_operation_receipt(uuid, jsonb) to service_role;

comment on function public.get_phase4b_operation_receipt(uuid, jsonb) is
  'Phase 4B service-only idempotency preflight. It never reserves or mutates an operation.';
