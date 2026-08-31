-- Phase 5C-1 regression repair: Boss defeat must unlock boss_slayer exactly once.
-- This migration updates the existing Phase 4B transaction kernel in place and
-- backfills only users whose defeated Boss never produced the achievement row
-- or its achievement reward ledger entry.

do $migration$
declare
  v_definition text;
  v_old_snapshot text := $old$
        case when v_achievement = 'exercise_streak_3'
          then jsonb_build_object('gems', 5, 'status', 'vitality') else '{}'::jsonb end,$old$;
  v_new_snapshot text := $new$
        case
          when v_achievement = 'exercise_streak_3'
            then jsonb_build_object('gems', 5, 'status', 'vitality')
          when v_achievement = 'boss_slayer'
            then jsonb_build_object('gems', 5)
          else '{}'::jsonb
        end,$new$;
  v_old_ledger text := $old$
          v_component := coalesce((p_plan #>> array['rewardBreakdown', 'achievement', v_resource.key])::bigint, 0);
          if v_component <> 0 then
            v_running_balance := v_running_balance + v_component;
            insert into public.resource_ledger(user_id, resource_type, delta, balance_after, reason,
              source_type, source_id, operation_id)
            values (p_user_id, v_resource.key, v_component, v_running_balance, 'achievement_reward',
              'achievement', coalesce(p_plan #>> '{achievementEvents,0}', v_source_id), v_operation_id);
          end if;$old$;
  v_new_ledger text := $new$
          if v_resource.key = 'gems' then
            for v_achievement in
              select jsonb_array_elements_text(coalesce(p_plan -> 'achievementEvents', '[]'::jsonb))
            loop
              v_component := case
                when v_achievement in ('exercise_streak_3', 'boss_slayer') then 5
                else 0
              end;
              if v_component <> 0 then
                v_running_balance := v_running_balance + v_component;
                insert into public.resource_ledger(user_id, resource_type, delta, balance_after, reason,
                  source_type, source_id, operation_id)
                values (p_user_id, v_resource.key, v_component, v_running_balance, 'achievement_reward',
                  'achievement', v_achievement, v_operation_id);
              end if;
            end loop;
          end if;$new$;
begin
  select pg_get_functiondef(
    'private.execute_phase4b_command(uuid,jsonb,bigint,jsonb)'::regprocedure
  ) into v_definition;

  if strpos(v_definition, v_old_snapshot) = 0 then
    raise exception 'Expected Phase 4B achievement snapshot block was not found';
  end if;
  if strpos(v_definition, v_old_ledger) = 0 then
    raise exception 'Expected Phase 4B achievement ledger block was not found';
  end if;

  v_definition := replace(v_definition, v_old_snapshot, v_new_snapshot);
  v_definition := replace(v_definition, v_old_ledger, v_new_ledger);
  execute v_definition;
end;
$migration$;

revoke all on function private.execute_phase4b_command(uuid, jsonb, bigint, jsonb)
  from public, anon, authenticated;
grant execute on function private.execute_phase4b_command(uuid, jsonb, bigint, jsonb)
  to service_role;

do $backfill$
declare
  v_candidate record;
  v_operation_id text;
  v_balance_after bigint;
begin
  for v_candidate in
    select distinct on (b.user_id)
      b.user_id,
      b.id as encounter_id,
      b.defeated_at,
      b.reward_operation_id
    from public.boss_encounters b
    where b.state = 'defeated'
      and not exists (
        select 1
        from public.player_achievements a
        where a.user_id = b.user_id
          and a.achievement_code = 'boss_slayer'
      )
      and not exists (
        select 1
        from public.resource_ledger l
        where l.user_id = b.user_id
          and l.resource_type = 'gems'
          and l.reason = 'achievement_reward'
          and l.source_type = 'achievement'
          and l.source_id = 'boss_slayer'
      )
    order by b.user_id, b.defeated_at, b.id
  loop
    v_operation_id := 'repair-boss-slayer:' || v_candidate.encounter_id::text;

    insert into public.player_achievements(
      user_id,
      achievement_code,
      definition_version,
      target_snapshot,
      reward_snapshot,
      unlocked_at,
      reward_state,
      reward_granted_at,
      reward_operation_id
    ) values (
      v_candidate.user_id,
      'boss_slayer',
      'achievements-v1',
      jsonb_build_object(
        'bossDefeats', 1,
        'bossEncounterId', v_candidate.encounter_id,
        'sourceOperationId', v_candidate.reward_operation_id
      ),
      jsonb_build_object('gems', 5),
      v_candidate.defeated_at,
      'granted',
      now(),
      v_operation_id
    )
    on conflict (user_id, achievement_code) do nothing;

    if found then
      update public.player_states
      set gems = gems + 5,
          updated_at = now()
      where user_id = v_candidate.user_id
      returning gems into v_balance_after;

      if v_balance_after is null then
        raise exception 'Missing player state for boss_slayer backfill user %', v_candidate.user_id;
      end if;

      insert into public.resource_ledger(
        user_id,
        resource_type,
        delta,
        balance_after,
        reason,
        source_type,
        source_id,
        operation_id
      ) values (
        v_candidate.user_id,
        'gems',
        5,
        v_balance_after,
        'achievement_reward',
        'achievement',
        'boss_slayer',
        v_operation_id
      );

      update public.member_game_roots
      set repository_version = repository_version + 1,
          updated_at = now()
      where user_id = v_candidate.user_id;
    end if;
  end loop;
end;
$backfill$;
