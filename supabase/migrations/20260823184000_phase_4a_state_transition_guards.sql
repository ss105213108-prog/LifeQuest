-- LifeQuest Phase 4A: immutable history and reward-once transition guards.

create or replace function private.guard_achievement_reward_once()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.reward_granted_at is not null and (
    new.reward_granted_at is distinct from old.reward_granted_at
    or new.reward_operation_id is distinct from old.reward_operation_id
  ) then
    raise exception using errcode = '23514', message = 'ACHIEVEMENT_REWARD_ALREADY_RECORDED';
  end if;
  if old.reward_state = 'reversed' and new.reward_state <> 'reversed' then
    raise exception using errcode = '23514', message = 'ACHIEVEMENT_REWARD_REVERSAL_FINAL';
  end if;
  return new;
end;
$$;

create trigger player_achievements_reward_once
before update on public.player_achievements
for each row execute function private.guard_achievement_reward_once();

create or replace function private.guard_boss_reward_once()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.reward_granted_at is not null and (
    new.reward_granted_at is distinct from old.reward_granted_at
    or new.reward_operation_id is distinct from old.reward_operation_id
  ) then
    raise exception using errcode = '23514', message = 'BOSS_REWARD_ALREADY_RECORDED';
  end if;
  return new;
end;
$$;

create trigger boss_encounters_reward_once
before update on public.boss_encounters
for each row execute function private.guard_boss_reward_once();

create or replace function private.guard_habit_event_reversal_once()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if row(
    new.id, new.user_id, new.business_date, new.habit_kind, new.system_key,
    new.custom_habit_id, new.direction, new.title_snapshot, new.policy_snapshot,
    new.definition_version, new.source_operation_id, new.occurred_at
  ) is distinct from row(
    old.id, old.user_id, old.business_date, old.habit_kind, old.system_key,
    old.custom_habit_id, old.direction, old.title_snapshot, old.policy_snapshot,
    old.definition_version, old.source_operation_id, old.occurred_at
  ) then
    raise exception using errcode = '23514', message = 'HABIT_EVENT_FACT_IMMUTABLE';
  end if;
  if old.reversed_at is not null and row(
    new.reversed_at, new.reversed_by_operation_id, new.reversal_reason
  ) is distinct from row(
    old.reversed_at, old.reversed_by_operation_id, old.reversal_reason
  ) then
    raise exception using errcode = '23514', message = 'HABIT_EVENT_ALREADY_REVERSED';
  end if;
  return new;
end;
$$;

create trigger habit_events_reverse_once
before update on public.habit_events
for each row execute function private.guard_habit_event_reversal_once();

create or replace function private.reject_phase4_history_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception using errcode = '23514', message = 'PHASE4_HISTORY_IMMUTABLE';
end;
$$;

create trigger resource_ledger_immutable
before update on public.resource_ledger
for each row execute function private.reject_phase4_history_update();

create trigger daily_entry_revisions_immutable
before update on public.daily_entry_revisions
for each row execute function private.reject_phase4_history_update();

create trigger boss_actions_immutable
before update on public.boss_actions
for each row execute function private.reject_phase4_history_update();

revoke all on function private.guard_achievement_reward_once() from public, anon, authenticated;
revoke all on function private.guard_boss_reward_once() from public, anon, authenticated;
revoke all on function private.guard_habit_event_reversal_once() from public, anon, authenticated;
revoke all on function private.reject_phase4_history_update() from public, anon, authenticated;

