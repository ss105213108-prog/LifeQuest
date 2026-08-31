-- Planner-level ACL attack verification. No Auth account, member identity or DML execution.
-- EXPLAIN without ANALYZE checks permission but does not execute INSERT/UPDATE/DELETE/RPC.
begin;
do $verify$
declare
  t record;
  f record;
  r text;
  statement text;
  denied boolean;
  checked integer := 0;
begin
  for t in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname in ('public','private') and c.relkind='r' loop
    foreach r in array array['anon','authenticated'] loop
      foreach statement in array array[
        format('explain insert into %I.%I default values',t.nspname,t.relname),
        format('explain update %I.%I set %I=%I where false',t.nspname,t.relname,
          case when t.relname='item_catalog' then 'item_key' else 'user_id' end,
          case when t.relname='item_catalog' then 'item_key' else 'user_id' end),
        format('explain delete from %I.%I where false',t.nspname,t.relname)
      ] loop
        denied := false;
        begin
          execute format('set local role %I',r);
          execute statement;
        exception when insufficient_privilege then denied := true;
        end;
        reset role;
        if not denied then raise exception 'Direct write not denied: % %',r,statement; end if;
        checked := checked+1;
      end loop;
      denied := false;
      begin
        execute format('set local role %I',r);
        execute format('explain select * from %I.%I where false',t.nspname,t.relname);
      exception when insufficient_privilege then denied := true;
      end;
      reset role;
      if denied is distinct from (r='anon' or t.nspname='private') then
        raise exception 'Unexpected SELECT ACL: % %.%',r,t.nspname,t.relname;
      end if;
    end loop;
  end loop;
  for f in select n.nspname,p.proname,
      (select string_agg('null::'||format_type(arg,null),',') from unnest(p.proargtypes) arg) args
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','private') and p.proname in (
      'initialize_member_profile','select_main_quest','update_member_profile',
      'execute_phase3_command','execute_phase4b_command','execute_phase5b_economy_command',
      'get_phase4b_operation_receipt','get_phase5b_economy_state') loop
    foreach r in array array['anon','authenticated'] loop
      denied := false;
      begin
        execute format('set local role %I',r);
        execute format('explain select %I.%I(%s)',f.nspname,f.proname,f.args);
      exception when insufficient_privilege then denied := true;
      end;
      reset role;
      if not denied then raise exception 'Direct RPC not denied: % %.%',r,f.nspname,f.proname; end if;
    end loop;
    set local role service_role;
    execute format('explain select %I.%I(%s)',f.nspname,f.proname,f.args);
    reset role;
  end loop;
  if checked <> 120 then raise exception 'Unexpected table coverage %',checked; end if;
end;
$verify$;
select 'PASS: 120 planned direct writes denied; SELECT ACL preserved; Browser RPC denied and service_role RPC allowed' as result;
rollback;
