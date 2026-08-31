-- No Auth accounts are created. Probe only a random UUID proven not to exist.
-- Any unexpected mutation/exception is rolled back by a PL/pgSQL subtransaction.
begin;
do $verify$
declare
  v_user uuid := gen_random_uuid();
  v_type text;
  v_payload jsonb;
  v_command jsonb;
  v_result jsonb;
  v_version jsonb;
  v_table record;
  v_rows bigint;
begin
  if exists (select 1 from auth.users where id = v_user) then
    raise exception 'Safety guard: probe UUID exists';
  end if;
  set local role service_role;
  foreach v_type in array array['SELECT_MAIN_QUEST','UPDATE_PROFILE','CREATE_CUSTOM_HABIT'] loop
    v_payload := case v_type
      when 'SELECT_MAIN_QUEST' then '{"questId":"sleep"}'::jsonb
      when 'UPDATE_PROFILE' then '{"dailyBudget":500}'::jsonb
      else '{"title":"Probe","direction":"good"}'::jsonb end;
    v_command := jsonb_build_object('contractVersion',1,'type',v_type,
      'operationId','phase6b2-no-account-probe','occurredAt',now(),
      'context',jsonb_build_object('businessDate',(now() at time zone 'Asia/Taipei')::date,'timeZone','Asia/Taipei'),
      'intentKey',v_type || ':phase6b2-probe','payload',v_payload);
    begin
      if v_type = 'SELECT_MAIN_QUEST' then
        v_result := public.select_main_quest(v_user,v_command,null);
      elsif v_type = 'UPDATE_PROFILE' then
        v_result := public.update_member_profile(v_user,v_command,null);
      else
        v_result := public.execute_phase3_command(v_user,v_command,null);
      end if;
    exception when others then
      raise exception 'Missing expectedVersion did not reject before mutation; type %, SQLSTATE %',v_type,SQLSTATE;
    end;
    if v_result ->> 'errorCode' is distinct from 'INVALID_PAYLOAD' then
      raise exception 'Expected INVALID_PAYLOAD for %',v_type;
    end if;
  end loop;
  foreach v_type in array array['PURCHASE_ITEM','REDEEM_REWARD_TICKET'] loop
    for v_version in select value from jsonb_array_elements('[null,0,-1,"1",1.5,9007199254740992]'::jsonb) loop
      v_payload := case v_type when 'PURCHASE_ITEM' then '{"itemKey":"potion_red"}'::jsonb
        else '{"ticketKey":"rest_30"}'::jsonb end;
      if v_version <> 'null'::jsonb then
        v_payload := v_payload || jsonb_build_object('seenCatalogVersion',v_version);
      end if;
      v_command := jsonb_build_object('contractVersion',1,'type',v_type,
        'operationId','phase6b2-no-account-catalog','payload',v_payload);
      v_result := public.execute_phase5b_economy_command(v_user,v_command,0);
      if v_result ->> 'errorCode' is distinct from 'INVALID_PAYLOAD' then
        raise exception 'Invalid catalog version accepted for %',v_type;
      end if;
    end loop;
  end loop;
  reset role;
  for v_table in select n.nspname,c.relname from pg_class c
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname in ('public','private') and c.relkind='r'
    and exists(select 1 from pg_attribute a where a.attrelid=c.oid and a.attname='user_id' and not a.attisdropped)
  loop
    execute format('select count(*) from %I.%I where user_id=$1',v_table.nspname,v_table.relname)
      into v_rows using v_user;
    if v_rows <> 0 then raise exception 'Rejected probe left rows in %.%',v_table.nspname,v_table.relname; end if;
  end loop;
end;
$verify$;
select 'PASS: service_role 3 missing-version + 12 invalid-catalog probes; zero rows across all user-owned tables' as result;
rollback;
