-- LifeQuest Phase 2 repair: PostgreSQL does not provide jsonb_object_length().
-- Replace the two Phase 2 command implementations with equivalent definitions
-- that count object keys through jsonb_object_keys(). The earlier applied
-- migration stays immutable and the repaired definitions remain reproducible.

do $migration$
declare
  v_function regprocedure;
  v_definition text;
begin
  foreach v_function in array array[
    'private.select_main_quest(uuid,jsonb,bigint)'::regprocedure,
    'private.update_member_profile(uuid,jsonb,bigint)'::regprocedure
  ]
  loop
    select pg_get_functiondef(v_function)
      into v_definition;

    if position('jsonb_object_length' in v_definition) = 0 then
      raise exception 'Expected Phase 2 payload length check was not found in %', v_function;
    end if;

    v_definition := replace(
      v_definition,
      'jsonb_object_length(p_command -> ''payload'')',
      '(select count(*) from jsonb_object_keys(p_command -> ''payload''))'
    );
    v_definition := replace(
      v_definition,
      'jsonb_object_length(v_payload)',
      '(select count(*) from jsonb_object_keys(v_payload))'
    );

    if position('jsonb_object_length' in v_definition) > 0 then
      raise exception 'Phase 2 payload length repair was incomplete for %', v_function;
    end if;

    execute v_definition;
  end loop;
end;
$migration$;

comment on function private.select_main_quest(uuid, jsonb, bigint) is
  'Phase 2 authoritative first main quest command with portable JSON payload validation.';

comment on function private.update_member_profile(uuid, jsonb, bigint) is
  'Phase 2 safe profile update command with portable JSON payload validation.';
