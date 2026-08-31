-- Phase 4C: a draft-only command must not make an otherwise safe daily correction unsafe.
-- repository_version still serializes every member command; correction dependency safety
-- is restricted to completed Phase 4 gameplay commands after the source settlement.

create or replace function private.phase4b_has_gameplay_dependency(
  p_user_id uuid,
  p_source_operation_id text
)
returns boolean
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_source_version bigint;
begin
  select (operation.result ->> 'repositoryVersion')::bigint
    into v_source_version
  from private.command_operations operation
  where operation.user_id = p_user_id
    and operation.operation_id = p_source_operation_id
    and operation.status = 'completed';

  -- Missing or incomplete source receipts cannot establish a safe correction boundary.
  if v_source_version is null then
    return true;
  end if;

  return exists (
    select 1
    from private.command_operations later_operation
    where later_operation.user_id = p_user_id
      and later_operation.status = 'completed'
      and later_operation.command_type in (
        'REPORT_HABIT_EVENT',
        'REVERSE_HABIT_EVENT',
        'SUBMIT_DAILY_ENTRY'
      )
      and coalesce((later_operation.result ->> 'repositoryVersion')::bigint, -1) > v_source_version
  );
end;
$$;

revoke all on function private.phase4b_has_gameplay_dependency(uuid, text)
  from public, anon, authenticated;
grant execute on function private.phase4b_has_gameplay_dependency(uuid, text)
  to service_role;

do $migration$
declare
  v_definition text;
  v_old_guard text := $old$
        if coalesce((v_previous_operation.result ->> 'repositoryVersion')::bigint, -1) <> p_expected_version
$old$;
  v_new_guard text := $new$
        if private.phase4b_has_gameplay_dependency(p_user_id, v_previous_revision.operation_id)
$new$;
begin
  select pg_get_functiondef(
    'private.execute_phase4b_command(uuid,jsonb,bigint,jsonb)'::regprocedure
  ) into v_definition;

  if strpos(v_definition, v_old_guard) = 0 then
    raise exception 'Expected Phase 4B daily correction guard was not found';
  end if;

  if strpos(v_definition, v_new_guard) > 0 then
    raise exception 'Phase 4C daily correction guard is already installed';
  end if;

  v_definition := replace(v_definition, v_old_guard, v_new_guard);
  execute v_definition;
end;
$migration$;

revoke all on function private.execute_phase4b_command(uuid, jsonb, bigint, jsonb)
  from public, anon, authenticated;
grant execute on function private.execute_phase4b_command(uuid, jsonb, bigint, jsonb)
  to service_role;
