-- Phase 6B-2: mandatory request versions, without replacing any transaction kernel.
-- Fail closed if the deployed function body no longer has the reviewed single insertion seam.
-- This is a new migration; historical migrations and old receipts are not replayed.
-- Rollback requires a separately reviewed migration using the before definitions.
begin;
do $migration$
declare
  v_function regprocedure;
  v_definition text;
  v_anchor text := '  insert into private.command_operations (';
  v_guard text := $guard$  -- Phase 6B-2: presence is contract validation; receipt replay still precedes version comparison.
  if p_expected_version is null or p_expected_version < 0 then
    return jsonb_build_object('ok', false, 'errorCode', 'INVALID_PAYLOAD', 'retryable', false);
  end if;

$guard$;
begin
  foreach v_function in array array[
    'private.select_main_quest(uuid,jsonb,bigint)'::regprocedure,
    'private.update_member_profile(uuid,jsonb,bigint)'::regprocedure,
    'private.execute_phase3_command(uuid,jsonb,bigint)'::regprocedure
  ] loop
    v_definition := pg_get_functiondef(v_function);
    if (length(v_definition)-length(replace(v_definition,v_anchor,'')))/length(v_anchor) <> 1
      or position('Phase 6B-2:' in v_definition)>0 then
      raise exception 'Unreviewed or already hardened definition: %',v_function;
    end if;
    execute replace(v_definition,v_anchor,v_guard || v_anchor);
  end loop;
end;
$migration$;
do $migration$
declare
  v_function regprocedure := 'private.execute_phase5b_economy_command(uuid,jsonb,bigint)'::regprocedure;
  v_definition text;
  v_anchor text := '  select array_agg(key order by key) into v_keys from jsonb_object_keys(v_payload) key;';
  v_guard text := $guard$  -- Phase 6B-2: require the catalog version before reservation. No client price authority.
  if v_type in ('PURCHASE_ITEM', 'REDEEM_REWARD_TICKET') and not (
    case when jsonb_typeof(v_payload -> 'seenCatalogVersion') = 'number'
      and (v_payload ->> 'seenCatalogVersion') ~ '^[1-9][0-9]*$'
    then (v_payload ->> 'seenCatalogVersion')::numeric <= 9007199254740991
    else false end
  ) then
    return jsonb_build_object('ok', false, 'errorCode', 'INVALID_PAYLOAD');
  end if;

$guard$;
begin
  v_definition := pg_get_functiondef(v_function);
  if (length(v_definition)-length(replace(v_definition,v_anchor,'')))/length(v_anchor) <> 1
    or position('Phase 6B-2:' in v_definition)>0 then
    raise exception 'Unreviewed or already hardened definition: %',v_function;
  end if;
  execute replace(v_definition,v_anchor,v_guard || v_anchor);
end;
$migration$;
commit;
