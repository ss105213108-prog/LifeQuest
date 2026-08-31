-- Align the server-authoritative gym_rat achievement with its published rule:
-- five non-reversed exercise_training reports on the same business date.

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
    ), '[]'::jsonb),
    'achievementProgress', jsonb_build_object(
      'gym_rat', least(5, (
        select count(*)
        from public.habit_events h
        where h.user_id = p_user_id
          and h.system_key = 'exercise_training'
          and h.business_date = (now() at time zone coalesce((
            select p.timezone from public.profiles p where p.user_id = p_user_id
          ), 'Asia/Taipei'))::date
          and h.reversed_at is null
      ))
    )
  );
$$;

revoke all on function private.phase4b_state(uuid) from public, anon, authenticated;
grant execute on function private.phase4b_state(uuid) to service_role;

with ranked_exercise_events as (
  select
    h.user_id,
    h.business_date,
    h.occurred_at,
    h.source_operation_id,
    row_number() over (
      partition by h.user_id, h.business_date
      order by h.occurred_at, h.id
    ) as daily_rank
  from public.habit_events h
  where h.system_key = 'exercise_training'
    and h.reversed_at is null
), first_qualifying_event as (
  select distinct on (user_id)
    user_id, business_date, occurred_at, source_operation_id
  from ranked_exercise_events
  where daily_rank = 5
  order by user_id, business_date, occurred_at
), inserted as (
  insert into public.player_achievements(
    user_id, achievement_code, definition_version, target_snapshot, reward_snapshot,
    unlocked_at, reward_state, reward_granted_at, reward_operation_id
  )
  select
    q.user_id,
    'gym_rat',
    'achievements-v1',
    jsonb_build_object(
      'sourceOperationId', q.source_operation_id,
      'businessDate', q.business_date,
      'dailyReports', 5
    ),
    '{}'::jsonb,
    q.occurred_at,
    'granted',
    q.occurred_at,
    q.source_operation_id
  from first_qualifying_event q
  on conflict (user_id, achievement_code) do nothing
  returning user_id
)
update public.member_game_roots r
set repository_version = repository_version + 1,
    updated_at = now()
where r.user_id in (select user_id from inserted);
