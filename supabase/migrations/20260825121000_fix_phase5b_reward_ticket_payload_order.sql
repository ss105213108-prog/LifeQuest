-- Phase 5B: jsonb_object_keys() returns keys in canonical order. For reward
-- ticket redemption the canonical two-key order is
-- seenCatalogVersion,ticketKey (not ticketKey,seenCatalogVersion).
do $migration$
declare
  v_definition text;
  v_original text := $needle$or (v_keys = array[case when v_type = 'PURCHASE_ITEM' then 'itemKey' else 'ticketKey' end, 'seenCatalogVersion'])$needle$;
  v_replacement text := $replacement$or (v_keys = case
        when v_type = 'PURCHASE_ITEM' then array['itemKey', 'seenCatalogVersion']
        else array['seenCatalogVersion', 'ticketKey']
      end)$replacement$;
begin
  select pg_get_functiondef(
    'private.execute_phase5b_economy_command(uuid,jsonb,bigint)'::regprocedure
  ) into v_definition;

  if position(v_original in v_definition) = 0 then
    raise exception 'Expected Phase 5B payload validation expression was not found';
  end if;

  v_definition := replace(v_definition, v_original, v_replacement);
  execute v_definition;
end;
$migration$;

revoke all on function private.execute_phase5b_economy_command(uuid, jsonb, bigint)
  from public, anon, authenticated;
grant execute on function private.execute_phase5b_economy_command(uuid, jsonb, bigint)
  to service_role;
