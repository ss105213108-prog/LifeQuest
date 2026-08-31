-- LifeQuest Phase 4A: covering indexes for every multi-column foreign key.

create index boss_actions_encounter_user_fk_idx
  on public.boss_actions(encounter_id, user_id);

create index daily_entry_revisions_entry_user_fk_idx
  on public.daily_entry_revisions(daily_entry_id, user_id);

create index habit_events_custom_habit_user_fk_idx
  on public.habit_events(custom_habit_id, user_id)
  where custom_habit_id is not null;

create index resource_ledger_reverses_user_fk_idx
  on public.resource_ledger(reverses_ledger_id, user_id)
  where reverses_ledger_id is not null;

