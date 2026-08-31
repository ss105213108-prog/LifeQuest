-- LifeQuest Phase 5A: extend the existing receipt/root/player transaction reservation seam.
-- These command types remain unreachable from the Edge route and member UI until Phase 5B.

create or replace function private.phase4_reserve_operation(
  p_user_id uuid,
  p_operation_id text,
  p_command_type text,
  p_request_hash text,
  p_expected_version bigint
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_inserted integer;
  v_operation private.command_operations%rowtype;
  v_root public.member_game_roots%rowtype;
  v_player public.player_states%rowtype;
begin
  if p_user_id is null or p_operation_id is null or p_request_hash is null
    or p_command_type not in (
      'REPORT_HABIT_EVENT', 'REVERSE_HABIT_EVENT', 'SUBMIT_DAILY_ENTRY',
      'PURCHASE_ITEM', 'USE_ITEM', 'EQUIP_ITEM', 'UNEQUIP_ITEM',
      'REDEEM_REWARD_TICKET', 'USE_REWARD_TICKET', 'REVERSE_REWARD_TICKET'
    )
    or p_expected_version is null or p_expected_version < 0 then
    return jsonb_build_object('ok', false, 'errorCode', 'INVALID_PAYLOAD');
  end if;

  insert into private.command_operations(user_id, operation_id, command_type, request_hash, status)
  values (p_user_id, p_operation_id, p_command_type, p_request_hash, 'pending')
  on conflict (user_id, operation_id) do nothing;
  get diagnostics v_inserted = row_count;

  select * into v_operation
  from private.command_operations
  where user_id = p_user_id and operation_id = p_operation_id
  for update;

  if v_inserted = 0 then
    if v_operation.command_type <> p_command_type or v_operation.request_hash <> p_request_hash then
      return jsonb_build_object('ok', false, 'errorCode', 'OPERATION_ID_REUSED');
    end if;
    if v_operation.status = 'completed' then
      return coalesce(v_operation.result, '{}'::jsonb)
        || jsonb_build_object('ok', true, 'duplicate', true);
    end if;
    return jsonb_build_object('ok', false, 'errorCode', 'OPERATION_IN_PROGRESS');
  end if;

  -- Fixed per-user lock order: operation receipt -> aggregate root -> player state.
  -- The locked root serializes all Phase 4/5 mutations before future economy rows are touched.
  select * into v_root from public.member_game_roots
  where user_id = p_user_id for update;
  if not found then
    delete from private.command_operations where user_id = p_user_id and operation_id = p_operation_id;
    return jsonb_build_object('ok', false, 'errorCode', 'NOT_FOUND');
  end if;

  select * into v_player from public.player_states
  where user_id = p_user_id for update;
  if not found then
    delete from private.command_operations where user_id = p_user_id and operation_id = p_operation_id;
    return jsonb_build_object('ok', false, 'errorCode', 'NOT_FOUND');
  end if;

  if v_root.repository_version <> p_expected_version then
    delete from private.command_operations where user_id = p_user_id and operation_id = p_operation_id;
    return jsonb_build_object(
      'ok', false, 'errorCode', 'VERSION_CONFLICT',
      'currentVersion', v_root.repository_version
    );
  end if;

  return jsonb_build_object(
    'ok', true, 'duplicate', false, 'reserved', true,
    'repositoryVersion', v_root.repository_version
  );
end;
$$;

comment on function private.phase4_reserve_operation(uuid, text, text, text, bigint) is
  'Shared Phase 4/5 transaction reservation seam. Phase 5 types are server-only and remain unrouted until Phase 5B.';

revoke all on function private.phase4_reserve_operation(uuid, text, text, text, bigint)
  from public, anon, authenticated;
grant execute on function private.phase4_reserve_operation(uuid, text, text, text, bigint)
  to service_role;
