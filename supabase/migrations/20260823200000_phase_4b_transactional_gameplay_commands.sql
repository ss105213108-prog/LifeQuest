-- LifeQuest Phase 4B: transactional authoritative habit and daily gameplay commands.
-- Browser access remains read-only. All writes enter through the verified Edge runtime.

alter table public.resource_ledger drop constraint resource_ledger_operation_unique;
alter table public.resource_ledger add constraint resource_ledger_operation_reason_source_unique
  unique (user_id, operation_id, resource_type, reason, source_type, source_id);

create or replace function private.phase4b_state(p_user_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select private.member_profile_state(p_user_id) || jsonb_build_object(
    'player', (
      select jsonb_build_object(
        'totalXp', s.total_xp, 'level', private.level_v1(s.total_xp),
        'hp', s.hp, 'maxHp', private.max_hp_v1(s.total_xp),
        'gold', s.gold, 'gems', s.gems,
        'baseStats', jsonb_build_object(
          'health', s.base_health, 'energy', s.base_energy,
          'wealth', s.base_wealth, 'growth', s.base_growth
        ), 'levelCurveVersion', s.level_curve_version, 'updatedAt', s.updated_at
      ) from public.player_states s where s.user_id = p_user_id
    ),
    'dailyEntries', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id, 'businessDate', e.business_date, 'currentRevision', e.current_revision,
        'sleep', e.sleep, 'water', e.water, 'exercise', e.exercise, 'study', e.study,
        'expense', e.expense, 'impulse', e.impulse, 'sugaryDrinks', e.sugary_drinks,
        'effectiveInput', e.effective_input, 'settlement', e.settlement_snapshot,
        'settledAt', e.settled_at
      ) order by e.business_date desc)
      from (select * from public.daily_entries where user_id = p_user_id order by business_date desc limit 30) e
    ), '[]'::jsonb),
    'habitEvents', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', h.id, 'businessDate', h.business_date, 'kind', h.habit_kind,
        'systemKey', h.system_key, 'customHabitId', h.custom_habit_id,
        'direction', h.direction, 'title', h.title_snapshot,
        'policy', h.policy_snapshot, 'occurredAt', h.occurred_at, 'reversedAt', h.reversed_at
      ) order by h.occurred_at desc)
      from (select * from public.habit_events where user_id = p_user_id order by occurred_at desc limit 50) h
    ), '[]'::jsonb),
    'statusEffects', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', x.id, 'key', x.effect_key, 'type', x.effect_type, 'title', x.title_snapshot,
        'modifiers', x.modifier_snapshot, 'appliedOn', x.applied_on,
        'expiresOn', x.expires_on, 'state', x.state
      ) order by x.created_at desc)
      from public.status_effects x where x.user_id = p_user_id
    ), '[]'::jsonb),
    'activeBoss', (
      select jsonb_build_object(
        'id', b.id, 'bossKey', b.boss_key, 'name', b.name_snapshot,
        'hp', b.hp, 'maxHp', b.max_hp, 'state', b.state, 'summonedOn', b.summoned_on
      ) from public.boss_encounters b where b.user_id = p_user_id and b.state = 'active' limit 1
    ),
    'achievements', coalesce((
      select jsonb_agg(jsonb_build_object(
        'code', a.achievement_code, 'unlockedAt', a.unlocked_at,
        'rewardState', a.reward_state, 'definitionVersion', a.definition_version
      ) order by a.unlocked_at)
      from public.player_achievements a where a.user_id = p_user_id
    ), '[]'::jsonb)
  );
$$;

revoke all on function private.phase4b_state(uuid) from public, anon, authenticated;
grant execute on function private.phase4b_state(uuid) to service_role;

create or replace function private.execute_phase4b_command(
  p_user_id uuid,
  p_command jsonb,
  p_expected_version bigint,
  p_plan jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_type text := p_command ->> 'type';
  v_operation_id text := p_command ->> 'operationId';
  v_payload jsonb := p_command -> 'payload';
  v_business_date date;
  v_today date := (now() at time zone 'Asia/Taipei')::date;
  v_request_hash text;
  v_reserved jsonb;
  v_completed jsonb;
  v_result jsonb := '{}'::jsonb;
  v_player public.player_states%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_deltas jsonb;
  v_resource record;
  v_balance bigint;
  v_reason text;
  v_source_type text;
  v_source_id text;
  v_event public.habit_events%rowtype;
  v_entry public.daily_entries%rowtype;
  v_revision public.daily_entry_revisions%rowtype;
  v_previous_revision public.daily_entry_revisions%rowtype;
  v_previous_operation private.command_operations%rowtype;
  v_old_ledger public.resource_ledger%rowtype;
  v_status jsonb;
  v_achievement text;
  v_boss jsonb;
  v_boss_definition jsonb;
  v_encounter public.boss_encounters%rowtype;
  v_boss_action_id uuid;
  v_new_hp bigint;
  v_operation_version bigint;
  v_current_version bigint;
  v_component bigint;
  v_running_balance bigint;
begin
  if p_user_id is null or p_command is null or p_plan is null
    or jsonb_typeof(p_command) <> 'object' or jsonb_typeof(p_plan) <> 'object'
    or v_type not in ('REPORT_HABIT_EVENT', 'REVERSE_HABIT_EVENT', 'SUBMIT_DAILY_ENTRY')
    or p_command ->> 'contractVersion' <> '1'
    or v_operation_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$'
    or p_expected_version is null or p_expected_version < 0
    or p_command #>> '{context,timeZone}' <> 'Asia/Taipei'
    or p_command #>> '{context,businessDate}' !~ '^\d{4}-\d{2}-\d{2}$' then
    return jsonb_build_object('ok', false, 'errorCode', 'INVALID_PAYLOAD');
  end if;
  begin
    v_business_date := (p_command #>> '{context,businessDate}')::date;
  exception when others then
    return jsonb_build_object('ok', false, 'errorCode', 'INVALID_BUSINESS_DATE');
  end;
  if v_type in ('REPORT_HABIT_EVENT', 'REVERSE_HABIT_EVENT') and v_business_date <> v_today then
    return jsonb_build_object('ok', false, 'errorCode', 'HABIT_EVENT_NOT_TODAY');
  end if;
  if v_type = 'SUBMIT_DAILY_ENTRY' then
    if v_business_date > v_today then return jsonb_build_object('ok', false, 'errorCode', 'INVALID_BUSINESS_DATE'); end if;
    if v_business_date < v_today - 7 then return jsonb_build_object('ok', false, 'errorCode', 'BACKFILL_NOT_ALLOWED'); end if;
  end if;
  if (v_type = 'REPORT_HABIT_EVENT' and p_plan ->> 'kind' <> 'habit_event')
    or (v_type = 'REVERSE_HABIT_EVENT' and p_plan ->> 'kind' <> 'habit_reversal')
    or (v_type = 'SUBMIT_DAILY_ENTRY' and p_plan ->> 'kind' <> 'daily_settlement')
    or coalesce(p_plan ->> 'businessDate', v_business_date::text) <> v_business_date::text then
    return jsonb_build_object('ok', false, 'errorCode', 'INVALID_PAYLOAD');
  end if;

  v_request_hash := encode(extensions.digest(convert_to(p_command::text, 'UTF8'), 'sha256'), 'hex');
  v_reserved := private.phase4_reserve_operation(
    p_user_id, v_operation_id, v_type, v_request_hash, p_expected_version
  );
  if v_reserved ->> 'ok' <> 'true' then return v_reserved; end if;
  if coalesce((v_reserved ->> 'duplicate')::boolean, false) then
    select repository_version into v_current_version from public.member_game_roots where user_id = p_user_id;
    v_operation_version := coalesce((v_reserved ->> 'repositoryVersion')::bigint, v_current_version);
    return v_reserved || jsonb_build_object(
      'operationId', v_operation_id, 'operationRepositoryVersion', v_operation_version,
      'repositoryVersion', v_current_version, 'state', private.phase4b_state(p_user_id),
      'serverTimestamp', now(), 'duplicate', true
    );
  end if;

  select * into v_player from public.player_states where user_id = p_user_id for update;

  if v_type = 'REVERSE_HABIT_EVENT' then
    select * into v_event from public.habit_events
      where id = (v_payload ->> 'eventId')::uuid and user_id = p_user_id for update;
    if not found then
      delete from private.command_operations where user_id = p_user_id and operation_id = v_operation_id;
      return jsonb_build_object('ok', false, 'errorCode', 'HABIT_EVENT_NOT_FOUND');
    end if;
    select * into v_previous_operation from private.command_operations
      where user_id = p_user_id and operation_id = v_event.source_operation_id;
    if v_event.reversed_at is not null
      or coalesce((v_previous_operation.result ->> 'repositoryVersion')::bigint, -1) <> p_expected_version
      or coalesce((v_event.policy_snapshot #>> '{resource,died}')::boolean, false)
      or exists (select 1 from public.boss_actions where user_id = p_user_id and source_type = 'habit_event' and source_id = v_event.id::text)
      or exists (select 1 from public.status_effects where user_id = p_user_id and source_type = 'habit_event' and source_id = v_event.id::text)
      or exists (select 1 from public.player_achievements where user_id = p_user_id and target_snapshot ->> 'sourceOperationId' = v_event.source_operation_id) then
      delete from private.command_operations where user_id = p_user_id and operation_id = v_operation_id;
      return jsonb_build_object('ok', false, 'errorCode', 'REVERSAL_BLOCKED');
    end if;
    v_before := v_event.policy_snapshot #> '{resource,before}';
    v_after := v_event.policy_snapshot #> '{resource,after}';
    if v_before is null or v_after is null
      or v_player.total_xp <> (v_after ->> 'totalXp')::bigint
      or v_player.hp <> (v_after ->> 'hp')::bigint
      or v_player.gold <> (v_after ->> 'gold')::bigint
      or v_player.gems <> (v_after ->> 'gems')::bigint then
      delete from private.command_operations where user_id = p_user_id and operation_id = v_operation_id;
      return jsonb_build_object('ok', false, 'errorCode', 'REVERSAL_BLOCKED');
    end if;
    update public.habit_events set reversed_at = now(), reversed_by_operation_id = v_operation_id,
      reversal_reason = 'user_requested' where id = v_event.id;
    for v_old_ledger in select * from public.resource_ledger
      where user_id = p_user_id and operation_id = v_event.source_operation_id order by id
    loop
      v_balance := case v_old_ledger.resource_type
        when 'xp' then (v_before ->> 'totalXp')::bigint
        when 'hp' then (v_before ->> 'hp')::bigint
        when 'gold' then (v_before ->> 'gold')::bigint
        when 'gems' then (v_before ->> 'gems')::bigint
        else (v_before #>> array['baseStats', v_old_ledger.resource_type])::bigint end;
      insert into public.resource_ledger(user_id, resource_type, delta, balance_after, reason,
        source_type, source_id, operation_id, reverses_ledger_id)
      values (p_user_id, v_old_ledger.resource_type, -v_old_ledger.delta, v_balance, 'reversal',
        'reversal', v_old_ledger.id::text, v_operation_id, v_old_ledger.id);
    end loop;
    update public.player_states set
      total_xp = (v_before ->> 'totalXp')::bigint, hp = (v_before ->> 'hp')::bigint,
      gold = (v_before ->> 'gold')::bigint, gems = (v_before ->> 'gems')::bigint,
      base_health = (v_before #>> '{baseStats,health}')::integer,
      base_energy = (v_before #>> '{baseStats,energy}')::integer,
      base_wealth = (v_before #>> '{baseStats,wealth}')::integer,
      base_growth = (v_before #>> '{baseStats,growth}')::integer, updated_at = now()
    where user_id = p_user_id;
    v_result := jsonb_build_object('eventId', v_event.id, 'reversed', true);
  else
    v_before := p_plan #> '{resource,before}';
    v_after := p_plan #> '{resource,after}';
    v_deltas := p_plan #> '{resource,deltas}';
    if v_before is null or v_after is null or v_deltas is null
      or jsonb_typeof(v_before) <> 'object' or jsonb_typeof(v_after) <> 'object'
      or jsonb_typeof(v_deltas) <> 'object' then
      delete from private.command_operations where user_id = p_user_id and operation_id = v_operation_id;
      return jsonb_build_object('ok', false, 'errorCode', 'INVALID_PAYLOAD');
    end if;

    if v_type = 'REPORT_HABIT_EVENT' then
      if v_player.total_xp <> (v_before ->> 'totalXp')::bigint
        or v_player.hp <> (v_before ->> 'hp')::bigint
        or v_player.gold <> (v_before ->> 'gold')::bigint
        or v_player.gems <> (v_before ->> 'gems')::bigint then
        delete from private.command_operations where user_id = p_user_id and operation_id = v_operation_id;
        return jsonb_build_object('ok', false, 'errorCode', 'VERSION_CONFLICT');
      end if;
      insert into public.habit_events(
        user_id, business_date, habit_kind, system_key, custom_habit_id, direction,
        title_snapshot, policy_snapshot, source_operation_id, occurred_at
      ) values (
        p_user_id, v_business_date, p_plan #>> '{habit,kind}', nullif(p_plan #>> '{habit,systemKey}', ''),
        nullif(p_plan #>> '{habit,customHabitId}', '')::uuid, p_plan #>> '{habit,direction}',
        p_plan #>> '{habit,title}', (p_plan #> '{habit,policy}') || jsonb_build_object('resource', p_plan -> 'resource'),
        v_operation_id, now()
      ) returning * into v_event;
      v_source_type := 'habit_event'; v_source_id := v_event.id::text;
      v_reason := case when v_event.direction = 'good' then 'habit_reward' else 'habit_damage' end;
      v_result := jsonb_build_object('eventId', v_event.id, 'rewardGranted',
        coalesce((p_plan #>> '{habit,policy,rewardGranted}')::boolean, false));
    else
      select * into v_entry from public.daily_entries
        where user_id = p_user_id and business_date = v_business_date for update;
      if found then
        select * into v_previous_revision from public.daily_entry_revisions
          where daily_entry_id = v_entry.id and revision_no = v_entry.current_revision for update;
        select * into v_previous_operation from private.command_operations
          where user_id = p_user_id and operation_id = v_previous_revision.operation_id;
        if coalesce((v_previous_operation.result ->> 'repositoryVersion')::bigint, -1) <> p_expected_version
          or coalesce((v_previous_revision.settlement_snapshot #>> '{resource,died}')::boolean, false)
          or jsonb_array_length(coalesce(v_previous_revision.settlement_snapshot -> 'statuses', '[]'::jsonb)) > 0
          or v_previous_revision.settlement_snapshot -> 'boss' <> 'null'::jsonb
          or jsonb_array_length(coalesce(v_previous_revision.settlement_snapshot -> 'achievementEvents', '[]'::jsonb)) > 0 then
          delete from private.command_operations where user_id = p_user_id and operation_id = v_operation_id;
          return jsonb_build_object('ok', false, 'errorCode', 'DAILY_REVISION_BLOCKED');
        end if;
        if v_player.total_xp <> (p_plan #>> '{correction,expectedPlayerAfter,totalXp}')::bigint
          or v_player.hp <> (p_plan #>> '{correction,expectedPlayerAfter,hp}')::bigint
          or v_player.gold <> (p_plan #>> '{correction,expectedPlayerAfter,gold}')::bigint
          or v_player.gems <> (p_plan #>> '{correction,expectedPlayerAfter,gems}')::bigint then
          delete from private.command_operations where user_id = p_user_id and operation_id = v_operation_id;
          return jsonb_build_object('ok', false, 'errorCode', 'DAILY_REVISION_BLOCKED');
        end if;
        for v_old_ledger in select * from public.resource_ledger
          where user_id = p_user_id and operation_id = v_previous_revision.operation_id order by id
        loop
          v_balance := case v_old_ledger.resource_type
            when 'xp' then (v_before ->> 'totalXp')::bigint
            when 'hp' then (v_before ->> 'hp')::bigint
            when 'gold' then (v_before ->> 'gold')::bigint
            when 'gems' then (v_before ->> 'gems')::bigint
            else (v_before #>> array['baseStats', v_old_ledger.resource_type])::bigint end;
          insert into public.resource_ledger(user_id, resource_type, delta, balance_after, reason,
            source_type, source_id, operation_id, reverses_ledger_id)
          values (p_user_id, v_old_ledger.resource_type, -v_old_ledger.delta, v_balance, 'reversal',
            'reversal', v_old_ledger.id::text, v_operation_id, v_old_ledger.id);
        end loop;
        v_entry.current_revision := v_entry.current_revision + 1;
        update public.daily_entries set current_revision = v_entry.current_revision,
          sleep = (v_payload ->> 'sleep')::numeric, water = (v_payload ->> 'water')::integer,
          exercise = (v_payload ->> 'exercise')::integer, study = (v_payload ->> 'study')::integer,
          expense = (v_payload ->> 'expense')::bigint, impulse = (v_payload ->> 'impulse')::integer,
          sugary_drinks = (v_payload ->> 'sugaryDrinks')::integer,
          effective_input = p_plan -> 'effectiveInput', settlement_snapshot = p_plan,
          budget_snapshot = (p_plan ->> 'budgetSnapshot')::bigint, settled_at = now(), updated_at = now()
        where id = v_entry.id;
      else
        if v_player.total_xp <> (v_before ->> 'totalXp')::bigint
          or v_player.hp <> (v_before ->> 'hp')::bigint
          or v_player.gold <> (v_before ->> 'gold')::bigint
          or v_player.gems <> (v_before ->> 'gems')::bigint then
          delete from private.command_operations where user_id = p_user_id and operation_id = v_operation_id;
          return jsonb_build_object('ok', false, 'errorCode', 'VERSION_CONFLICT');
        end if;
        insert into public.daily_entries(
          user_id, business_date, current_revision, sleep, water, exercise, study, expense, impulse,
          sugary_drinks, timezone, budget_snapshot, effective_input, settlement_snapshot, settled_at
        ) values (
          p_user_id, v_business_date, 1, (v_payload ->> 'sleep')::numeric,
          (v_payload ->> 'water')::integer, (v_payload ->> 'exercise')::integer,
          (v_payload ->> 'study')::integer, (v_payload ->> 'expense')::bigint,
          (v_payload ->> 'impulse')::integer, (v_payload ->> 'sugaryDrinks')::integer,
          'Asia/Taipei', (p_plan ->> 'budgetSnapshot')::bigint,
          p_plan -> 'effectiveInput', p_plan, now()
        ) returning * into v_entry;
      end if;
      insert into public.daily_entry_revisions(
        user_id, daily_entry_id, revision_no, correction_of_revision, raw_input,
        effective_input, settlement_snapshot, operation_id
      ) values (
        p_user_id, v_entry.id, v_entry.current_revision,
        case when v_entry.current_revision > 1 then v_entry.current_revision - 1 else null end,
        v_payload, p_plan -> 'effectiveInput', p_plan, v_operation_id
      ) returning * into v_revision;
      v_source_type := 'daily_entry_revision'; v_source_id := v_revision.id::text;
      v_reason := 'daily_reward';
      v_result := jsonb_build_object(
        'entryId', v_entry.id, 'revision', v_entry.current_revision,
        'completedRuleIds', p_plan -> 'completedRuleIds', 'failedRuleIds', p_plan -> 'failedRuleIds',
        'critical', p_plan -> 'critical'
      );
    end if;

    update public.player_states set
      total_xp = (v_after ->> 'totalXp')::bigint, hp = (v_after ->> 'hp')::bigint,
      gold = (v_after ->> 'gold')::bigint, gems = (v_after ->> 'gems')::bigint,
      base_health = (v_after #>> '{baseStats,health}')::integer,
      base_energy = (v_after #>> '{baseStats,energy}')::integer,
      base_wealth = (v_after #>> '{baseStats,wealth}')::integer,
      base_growth = (v_after #>> '{baseStats,growth}')::integer, updated_at = now()
    where user_id = p_user_id;

    for v_resource in select key, value from jsonb_each_text(v_deltas)
    loop
      v_balance := case v_resource.key
        when 'xp' then (v_after ->> 'totalXp')::bigint
        when 'hp' then (v_after ->> 'hp')::bigint
        when 'gold' then (v_after ->> 'gold')::bigint
        when 'gems' then (v_after ->> 'gems')::bigint
        else (v_after #>> array['baseStats', v_resource.key])::bigint end;
      if v_resource.key in ('gold', 'gems') then
        v_running_balance := case v_resource.key
          when 'gold' then (v_before ->> 'gold')::bigint
          else (v_before ->> 'gems')::bigint end;
        if v_type = 'SUBMIT_DAILY_ENTRY' then
          v_component := coalesce((p_plan #>> array['rewardBreakdown', 'daily', v_resource.key])::bigint, 0);
          if v_component <> 0 then
            v_running_balance := v_running_balance + v_component;
            insert into public.resource_ledger(user_id, resource_type, delta, balance_after, reason,
              source_type, source_id, operation_id)
            values (p_user_id, v_resource.key, v_component, v_running_balance, 'daily_reward',
              v_source_type, v_source_id, v_operation_id);
          end if;
          v_component := coalesce((p_plan #>> array['rewardBreakdown', 'boss', v_resource.key])::bigint, 0);
          if v_component <> 0 then
            v_running_balance := v_running_balance + v_component;
            insert into public.resource_ledger(user_id, resource_type, delta, balance_after, reason,
              source_type, source_id, operation_id)
            values (p_user_id, v_resource.key, v_component, v_running_balance, 'boss_reward',
              'boss_action', coalesce(p_plan #>> '{boss,encounterId}', v_source_id), v_operation_id);
          end if;
          v_component := coalesce((p_plan #>> array['rewardBreakdown', 'achievement', v_resource.key])::bigint, 0);
          if v_component <> 0 then
            v_running_balance := v_running_balance + v_component;
            insert into public.resource_ledger(user_id, resource_type, delta, balance_after, reason,
              source_type, source_id, operation_id)
            values (p_user_id, v_resource.key, v_component, v_running_balance, 'achievement_reward',
              'achievement', coalesce(p_plan #>> '{achievementEvents,0}', v_source_id), v_operation_id);
          end if;
        else
          v_component := coalesce((p_plan #>> array['habit', 'policy', 'effects', v_resource.key])::bigint, 0);
          if v_component <> 0 then
            v_running_balance := v_running_balance + v_component;
            insert into public.resource_ledger(user_id, resource_type, delta, balance_after, reason,
              source_type, source_id, operation_id)
            values (p_user_id, v_resource.key, v_component, v_running_balance, v_reason,
              v_source_type, v_source_id, v_operation_id);
          end if;
        end if;
        if v_resource.key = 'gold' and coalesce((p_plan #>> '{resource,goldLost}')::bigint, 0) > 0 then
          v_component := -((p_plan #>> '{resource,goldLost}')::bigint);
          v_running_balance := v_running_balance + v_component;
          insert into public.resource_ledger(user_id, resource_type, delta, balance_after, reason,
            source_type, source_id, operation_id)
          values (p_user_id, 'gold', v_component, v_running_balance, 'death_penalty',
            'death', v_source_id, v_operation_id);
        end if;
        if v_running_balance <> v_balance then
          raise exception 'PHASE4_RESOURCE_BREAKDOWN_MISMATCH';
        end if;
      elsif v_resource.value::bigint <> 0 then
        insert into public.resource_ledger(user_id, resource_type, delta, balance_after, reason,
          source_type, source_id, operation_id)
        values (p_user_id, v_resource.key, v_resource.value::bigint, v_balance,
          case when v_resource.value::bigint < 0 then
            case when v_type = 'REPORT_HABIT_EVENT' then 'habit_damage' else 'daily_failure' end
          else v_reason end,
          v_source_type, v_source_id, v_operation_id);
      end if;
    end loop;

    if coalesce((p_plan #>> '{resource,died}')::boolean, false) then
      update public.status_effects set state = 'cleared', state_changed_at = now()
        where user_id = p_user_id and state = 'active';
    end if;

    for v_status in select value from jsonb_array_elements(coalesce(p_plan -> 'statuses', '[]'::jsonb))
    loop
      update public.status_effects set state = 'cleared', state_changed_at = now()
        where user_id = p_user_id and effect_key = v_status ->> 'key' and state = 'active';
      insert into public.status_effects(
        user_id, effect_key, effect_type, title_snapshot, modifier_snapshot,
        applied_on, expires_on, state, source_type, source_id, definition_version
      ) values (
        p_user_id, v_status ->> 'key', v_status ->> 'effectType', v_status ->> 'title',
        coalesce(v_status -> 'modifiers', '{}'::jsonb), (v_status ->> 'appliedOn')::date,
        (v_status ->> 'expiresOn')::date, v_status ->> 'state', v_source_type, v_source_id,
        v_status ->> 'definitionVersion'
      );
    end loop;

    for v_achievement in select jsonb_array_elements_text(coalesce(p_plan -> 'achievementEvents', '[]'::jsonb))
    loop
      insert into public.player_achievements(
        user_id, achievement_code, target_snapshot, reward_snapshot, unlocked_at,
        reward_state, reward_granted_at, reward_operation_id
      ) values (
        p_user_id, v_achievement,
        jsonb_build_object('sourceOperationId', v_operation_id),
        case when v_achievement = 'exercise_streak_3'
          then jsonb_build_object('gems', 5, 'status', 'vitality') else '{}'::jsonb end,
        now(), 'granted', now(), v_operation_id
      ) on conflict (user_id, achievement_code) do nothing;
    end loop;

    v_boss := p_plan -> 'boss';
    if v_boss is not null and v_boss <> 'null'::jsonb then
      if v_boss ->> 'action' = 'summon' then
        v_boss_definition := p_plan #> array['definitions'];
        insert into public.boss_encounters(
          user_id, boss_key, incident_key, name_snapshot, max_hp, hp,
          challenge_snapshot, reward_snapshot, summoned_on
        ) values (
          p_user_id, v_boss ->> 'bossKey', (v_boss ->> 'bossKey') || ':' || v_business_date::text,
          case v_boss ->> 'bossKey'
            when 'sleep-nightmare' then '睡眠夢魘' when 'budget-vampire' then '預算吸血鬼'
            when 'fried-food-beast' then '油炸暴食獸' when 'laziness-beast' then '怠惰巨獸'
            else '糖分魔獸' end,
          100, 100, jsonb_build_object('targetDays', 3), jsonb_build_object('gold', 150, 'gems', 3),
          v_business_date
        ) on conflict (user_id, incident_key) do nothing returning * into v_encounter;
        if v_encounter.id is not null then
          insert into public.boss_actions(user_id, encounter_id, action_type, business_date,
            source_type, source_id, operation_id, action_snapshot)
          values (p_user_id, v_encounter.id, 'summon', v_business_date,
            v_source_type, v_source_id, v_operation_id, v_boss);
        end if;
      elsif v_boss ->> 'action' = 'progress' then
        select * into v_encounter from public.boss_encounters
          where id = (v_boss ->> 'encounterId')::uuid and user_id = p_user_id and state = 'active' for update;
        if found then
          v_new_hp := greatest(0, v_encounter.hp - (v_boss ->> 'damage')::bigint);
          insert into public.boss_actions(user_id, encounter_id, action_type, business_date,
            damage, progress_delta, source_type, source_id, operation_id, action_snapshot)
          values (p_user_id, v_encounter.id, 'progress', v_business_date,
            (v_boss ->> 'damage')::bigint, case when (v_boss ->> 'matched')::boolean then 1 else 0 end,
            v_source_type, v_source_id, v_operation_id, v_boss) returning id into v_boss_action_id;
          update public.boss_encounters set hp = v_new_hp,
            state = case when v_new_hp = 0 then 'defeated' else 'active' end,
            defeated_at = case when v_new_hp = 0 then now() else null end,
            reward_granted_at = case when v_new_hp = 0 then now() else null end,
            reward_operation_id = case when v_new_hp = 0 then v_operation_id else null end,
            updated_at = now() where id = v_encounter.id;
          if v_new_hp = 0 then
            insert into public.boss_actions(user_id, encounter_id, action_type, business_date,
              source_type, source_id, operation_id, action_snapshot)
            values (p_user_id, v_encounter.id, 'defeat', v_business_date,
              v_source_type, v_source_id, v_operation_id, v_boss);
            insert into public.boss_actions(user_id, encounter_id, action_type, business_date,
              source_type, source_id, operation_id, action_snapshot)
            values (p_user_id, v_encounter.id, 'reward', v_business_date,
              'boss_encounter', v_encounter.id::text, v_operation_id, v_encounter.reward_snapshot);
          end if;
        end if;
      end if;
    end if;
  end if;

  v_completed := private.phase4_complete_operation(
    p_user_id, v_operation_id,
    jsonb_build_object('operationId', v_operation_id, 'result', v_result, 'serverTimestamp', now())
  );
  if v_completed ->> 'ok' <> 'true' then return v_completed; end if;
  v_operation_version := (v_completed ->> 'repositoryVersion')::bigint;
  return v_completed || jsonb_build_object(
    'operationRepositoryVersion', v_operation_version,
    'state', private.phase4b_state(p_user_id), 'serverTimestamp', now()
  );
end;
$$;

revoke all on function private.execute_phase4b_command(uuid, jsonb, bigint, jsonb)
  from public, anon, authenticated;
grant execute on function private.execute_phase4b_command(uuid, jsonb, bigint, jsonb) to service_role;

create or replace function public.execute_phase4b_command(
  p_user_id uuid,
  p_command jsonb,
  p_expected_version bigint,
  p_plan jsonb
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.execute_phase4b_command(p_user_id, p_command, p_expected_version, p_plan);
$$;

revoke all on function public.execute_phase4b_command(uuid, jsonb, bigint, jsonb)
  from public, anon, authenticated;
grant execute on function public.execute_phase4b_command(uuid, jsonb, bigint, jsonb) to service_role;

comment on function public.execute_phase4b_command(uuid, jsonb, bigint, jsonb) is
  'Phase 4B service-only transaction command. user identity must come from a verified Edge Auth session.';
