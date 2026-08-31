-- LifeQuest Phase 4A: authoritative game-domain storage and transaction kernel.
-- This migration creates no public gameplay command and grants browsers read-only own-data access.

create or replace function private.level_v1(p_total_xp bigint)
returns bigint
language sql
immutable
strict
security invoker
set search_path = ''
as $$
  select floor((1 + sqrt(1 + (4 * p_total_xp::numeric / 25))) / 2)::bigint
  where p_total_xp >= 0
$$;

create or replace function private.max_hp_v1(p_total_xp bigint)
returns bigint
language sql
immutable
strict
security invoker
set search_path = ''
as $$
  select 50 + ((private.level_v1(p_total_xp) - 1) * 5)
$$;

revoke all on function private.level_v1(bigint) from public, anon, authenticated;
revoke all on function private.max_hp_v1(bigint) from public, anon, authenticated;
grant execute on function private.level_v1(bigint) to service_role;
grant execute on function private.max_hp_v1(bigint) to service_role;

create table public.player_states (
  user_id uuid primary key references auth.users(id) on delete cascade,
  total_xp bigint not null default 0,
  hp bigint not null default 50,
  gold bigint not null default 0,
  gems bigint not null default 0,
  base_health integer not null default 10,
  base_energy integer not null default 10,
  base_wealth integer not null default 10,
  base_growth integer not null default 10,
  level_curve_version text not null default 'level-v1',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint player_states_total_xp_nonnegative check (total_xp >= 0),
  constraint player_states_hp_boundary check (hp >= 0 and hp <= private.max_hp_v1(total_xp)),
  constraint player_states_gold_nonnegative check (gold >= 0),
  constraint player_states_gems_nonnegative check (gems >= 0),
  constraint player_states_base_health_positive check (base_health between 1 and 1000000),
  constraint player_states_base_energy_positive check (base_energy between 1 and 1000000),
  constraint player_states_base_wealth_positive check (base_wealth between 1 and 1000000),
  constraint player_states_base_growth_positive check (base_growth between 1 and 1000000),
  constraint player_states_level_curve_version check (level_curve_version = 'level-v1')
);

insert into public.player_states(user_id)
select user_id from public.member_game_roots
on conflict (user_id) do nothing;

create table public.daily_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  business_date date not null,
  current_revision integer not null default 1,
  sleep numeric(4,2),
  water integer not null default 0,
  exercise integer not null default 0,
  study integer not null default 0,
  expense bigint,
  impulse integer not null default 0,
  sugary_drinks integer not null default 0,
  timezone text not null default 'Asia/Taipei',
  budget_snapshot bigint not null,
  effective_input jsonb not null default '{}'::jsonb,
  settlement_snapshot jsonb not null default '{}'::jsonb,
  engine_version text not null default 'phase4-v1',
  rules_version text not null default 'rules-v1',
  habits_version text not null default 'habits-v1',
  bosses_version text not null default 'bosses-v1',
  achievements_version text not null default 'achievements-v1',
  level_curve_version text not null default 'level-v1',
  settled_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint daily_entries_user_business_date unique (user_id, business_date),
  constraint daily_entries_id_user unique (id, user_id),
  constraint daily_entries_revision_positive check (current_revision >= 1),
  constraint daily_entries_sleep check (sleep is null or sleep between 0 and 24),
  constraint daily_entries_water check (water between 0 and 100000),
  constraint daily_entries_exercise check (exercise between 0 and 1440),
  constraint daily_entries_study check (study between 0 and 1440),
  constraint daily_entries_expense check (expense is null or expense between 0 and 1000000000),
  constraint daily_entries_impulse check (impulse between 0 and 1000),
  constraint daily_entries_sugary_drinks check (sugary_drinks between 0 and 1000),
  constraint daily_entries_budget_snapshot check (budget_snapshot between 1 and 1000000000),
  constraint daily_entries_timezone check (timezone = 'Asia/Taipei'),
  constraint daily_entries_effective_input_object check (jsonb_typeof(effective_input) = 'object'),
  constraint daily_entries_settlement_snapshot_object check (jsonb_typeof(settlement_snapshot) = 'object'),
  constraint daily_entries_definition_versions check (
    engine_version = 'phase4-v1' and rules_version = 'rules-v1'
    and habits_version = 'habits-v1' and bosses_version = 'bosses-v1'
    and achievements_version = 'achievements-v1' and level_curve_version = 'level-v1'
  )
);

create table public.daily_entry_revisions (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  daily_entry_id uuid not null,
  revision_no integer not null,
  correction_of_revision integer,
  raw_input jsonb not null,
  effective_input jsonb not null,
  settlement_snapshot jsonb not null,
  operation_id text not null,
  created_at timestamptz not null default now(),
  constraint daily_entry_revisions_entry_user_fk
    foreign key (daily_entry_id, user_id)
    references public.daily_entries(id, user_id) on delete cascade,
  constraint daily_entry_revisions_number unique (daily_entry_id, revision_no),
  constraint daily_entry_revisions_operation unique (user_id, operation_id),
  constraint daily_entry_revisions_id_user unique (id, user_id),
  constraint daily_entry_revisions_revision_positive check (revision_no >= 1),
  constraint daily_entry_revisions_correction_order check (
    correction_of_revision is null or (correction_of_revision >= 1 and correction_of_revision < revision_no)
  ),
  constraint daily_entry_revisions_raw_input_object check (jsonb_typeof(raw_input) = 'object'),
  constraint daily_entry_revisions_effective_input_object check (jsonb_typeof(effective_input) = 'object'),
  constraint daily_entry_revisions_settlement_snapshot_object check (jsonb_typeof(settlement_snapshot) = 'object'),
  constraint daily_entry_revisions_operation_format check (operation_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$')
);

alter table public.custom_habits
  add constraint custom_habits_id_user_unique unique (id, user_id);

create table public.habit_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  business_date date not null,
  habit_kind text not null,
  system_key text,
  custom_habit_id uuid,
  direction text not null,
  title_snapshot text not null,
  policy_snapshot jsonb not null,
  definition_version text not null default 'habits-v1',
  source_operation_id text not null,
  occurred_at timestamptz not null default now(),
  reversed_at timestamptz,
  reversed_by_operation_id text,
  reversal_reason text,
  constraint habit_events_custom_habit_fk
    foreign key (custom_habit_id, user_id)
    references public.custom_habits(id, user_id) on delete cascade,
  constraint habit_events_operation unique (user_id, source_operation_id),
  constraint habit_events_direction check (direction in ('good', 'bad')),
  constraint habit_events_kind check (habit_kind in ('system', 'custom')),
  constraint habit_events_identity check (
    (habit_kind = 'system' and system_key is not null and custom_habit_id is null)
    or (habit_kind = 'custom' and system_key is null and custom_habit_id is not null)
  ),
  constraint habit_events_title_snapshot check (char_length(btrim(title_snapshot)) between 1 and 80),
  constraint habit_events_policy_snapshot_object check (jsonb_typeof(policy_snapshot) = 'object'),
  constraint habit_events_definition_version check (definition_version = 'habits-v1'),
  constraint habit_events_operation_format check (source_operation_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$'),
  constraint habit_events_reversal_consistency check (
    (reversed_at is null and reversed_by_operation_id is null and reversal_reason is null)
    or (reversed_at is not null and reversed_by_operation_id is not null)
  )
);

create unique index habit_events_reversal_operation_unique
  on public.habit_events(user_id, reversed_by_operation_id)
  where reversed_by_operation_id is not null;

create table public.resource_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  resource_type text not null,
  delta bigint not null,
  balance_after bigint not null,
  reason text not null,
  source_type text not null,
  source_id text not null,
  operation_id text not null,
  reverses_ledger_id bigint,
  created_at timestamptz not null default now(),
  constraint resource_ledger_id_user unique (id, user_id),
  constraint resource_ledger_reverses_fk foreign key (reverses_ledger_id, user_id)
    references public.resource_ledger(id, user_id) on delete cascade,
  constraint resource_ledger_source_unique unique (user_id, resource_type, source_type, source_id, reason),
  constraint resource_ledger_operation_unique unique (user_id, operation_id, resource_type, reason),
  constraint resource_ledger_type check (resource_type in (
    'xp', 'hp', 'gold', 'gems', 'health', 'energy', 'wealth', 'growth'
  )),
  constraint resource_ledger_delta_nonzero check (delta <> 0),
  constraint resource_ledger_balance_nonnegative check (balance_after >= 0),
  constraint resource_ledger_reason check (reason in (
    'daily_reward', 'daily_failure', 'habit_reward', 'habit_damage',
    'death_penalty', 'boss_reward', 'achievement_reward', 'reversal'
  )),
  constraint resource_ledger_source_type check (source_type in (
    'daily_entry_revision', 'habit_event', 'death', 'boss_action', 'achievement', 'reversal', 'system'
  )),
  constraint resource_ledger_operation_format check (operation_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$'),
  constraint resource_ledger_not_self_reversal check (reverses_ledger_id is null or reverses_ledger_id <> id),
  constraint resource_ledger_reversal_reference check (
    (reason = 'reversal' and reverses_ledger_id is not null)
    or (reason <> 'reversal' and reverses_ledger_id is null)
  )
);

create unique index resource_ledger_reversal_once
  on public.resource_ledger(reverses_ledger_id)
  where reverses_ledger_id is not null;

create table public.status_effects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  effect_key text not null,
  effect_type text not null,
  title_snapshot text not null,
  modifier_snapshot jsonb not null,
  applied_on date not null,
  expires_on date not null,
  state text not null,
  source_type text not null,
  source_id text not null,
  definition_version text not null,
  state_changed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint status_effects_source_unique unique (user_id, source_type, source_id, effect_key),
  constraint status_effects_type check (effect_type in ('buff', 'debuff')),
  constraint status_effects_state check (state in ('active', 'expired', 'cleared', 'reversed', 'historical_only')),
  constraint status_effects_dates check (expires_on > applied_on),
  constraint status_effects_modifier_snapshot_object check (jsonb_typeof(modifier_snapshot) = 'object'),
  constraint status_effects_definition_version check (definition_version in ('rules-v1', 'habits-v1', 'bosses-v1', 'achievements-v1')),
  constraint status_effects_title_snapshot check (char_length(btrim(title_snapshot)) between 1 and 80)
);

create unique index status_effects_one_active_key
  on public.status_effects(user_id, effect_key)
  where state = 'active';

create table public.player_achievements (
  user_id uuid not null references auth.users(id) on delete cascade,
  achievement_code text not null,
  definition_version text not null default 'achievements-v1',
  target_snapshot jsonb not null,
  reward_snapshot jsonb not null,
  unlocked_at timestamptz not null,
  reward_state text not null default 'not_granted',
  reward_granted_at timestamptz,
  reward_operation_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, achievement_code),
  constraint player_achievements_definition_version check (definition_version = 'achievements-v1'),
  constraint player_achievements_target_snapshot_object check (jsonb_typeof(target_snapshot) = 'object'),
  constraint player_achievements_reward_snapshot_object check (jsonb_typeof(reward_snapshot) = 'object'),
  constraint player_achievements_reward_state check (reward_state in ('not_granted', 'granted', 'reversed')),
  constraint player_achievements_reward_consistency check (
    (reward_state = 'not_granted' and reward_granted_at is null and reward_operation_id is null)
    or (reward_state in ('granted', 'reversed') and reward_granted_at is not null and reward_operation_id is not null)
  )
);

create unique index player_achievements_reward_operation_unique
  on public.player_achievements(user_id, reward_operation_id)
  where reward_operation_id is not null;

create table public.boss_encounters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  boss_key text not null,
  incident_key text not null,
  name_snapshot text not null,
  max_hp bigint not null,
  hp bigint not null,
  challenge_snapshot jsonb not null,
  reward_snapshot jsonb not null,
  definition_version text not null default 'bosses-v1',
  state text not null default 'active',
  summoned_on date not null,
  defeated_at timestamptz,
  reward_granted_at timestamptz,
  reward_operation_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint boss_encounters_id_user unique (id, user_id),
  constraint boss_encounters_incident_unique unique (user_id, incident_key),
  constraint boss_encounters_hp check (max_hp > 0 and hp between 0 and max_hp),
  constraint boss_encounters_state check (state in ('active', 'defeated', 'closed', 'reversed')),
  constraint boss_encounters_state_hp check (
    (state = 'active' and hp > 0 and defeated_at is null)
    or (state = 'defeated' and hp = 0 and defeated_at is not null)
    or state in ('closed', 'reversed')
  ),
  constraint boss_encounters_challenge_snapshot_object check (jsonb_typeof(challenge_snapshot) = 'object'),
  constraint boss_encounters_reward_snapshot_object check (jsonb_typeof(reward_snapshot) = 'object'),
  constraint boss_encounters_definition_version check (definition_version = 'bosses-v1'),
  constraint boss_encounters_reward_consistency check (
    (reward_granted_at is null and reward_operation_id is null)
    or (reward_granted_at is not null and reward_operation_id is not null)
  )
);

create unique index boss_encounters_one_active
  on public.boss_encounters(user_id)
  where state = 'active';

create unique index boss_encounters_reward_operation_unique
  on public.boss_encounters(user_id, reward_operation_id)
  where reward_operation_id is not null;

create table public.boss_actions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  encounter_id uuid not null,
  action_type text not null,
  business_date date not null,
  damage bigint not null default 0,
  progress_delta integer not null default 0,
  source_type text not null,
  source_id text not null,
  operation_id text not null,
  action_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint boss_actions_encounter_user_fk foreign key (encounter_id, user_id)
    references public.boss_encounters(id, user_id) on delete cascade,
  constraint boss_actions_operation_unique unique (user_id, operation_id, action_type),
  constraint boss_actions_source_unique unique (encounter_id, source_type, source_id, action_type),
  constraint boss_actions_type check (action_type in ('summon', 'progress', 'damage', 'defeat', 'reward', 'correction')),
  constraint boss_actions_damage_nonnegative check (damage >= 0),
  constraint boss_actions_source_type check (source_type in ('habit_event', 'daily_entry_revision', 'boss_encounter', 'system')),
  constraint boss_actions_snapshot_object check (jsonb_typeof(action_snapshot) = 'object'),
  constraint boss_actions_operation_format check (operation_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$')
);

create unique index boss_actions_daily_progress_unique
  on public.boss_actions(encounter_id, business_date)
  where action_type = 'progress';

create index daily_entries_user_settled_idx on public.daily_entries(user_id, settled_at desc);
create index daily_entry_revisions_user_created_idx on public.daily_entry_revisions(user_id, created_at desc);
create index habit_events_user_date_idx on public.habit_events(user_id, business_date desc, occurred_at desc);
create index habit_events_custom_habit_idx on public.habit_events(custom_habit_id) where custom_habit_id is not null;
create index resource_ledger_user_created_idx on public.resource_ledger(user_id, created_at desc);
create index status_effects_user_expires_idx on public.status_effects(user_id, expires_on, state);
create index boss_actions_user_created_idx on public.boss_actions(user_id, created_at desc);

alter table public.player_states enable row level security;
alter table public.daily_entries enable row level security;
alter table public.daily_entry_revisions enable row level security;
alter table public.habit_events enable row level security;
alter table public.resource_ledger enable row level security;
alter table public.status_effects enable row level security;
alter table public.player_achievements enable row level security;
alter table public.boss_encounters enable row level security;
alter table public.boss_actions enable row level security;

create policy player_states_select_own on public.player_states
  for select to authenticated using ((select auth.uid()) = user_id);
create policy daily_entries_select_own on public.daily_entries
  for select to authenticated using ((select auth.uid()) = user_id);
create policy daily_entry_revisions_select_own on public.daily_entry_revisions
  for select to authenticated using ((select auth.uid()) = user_id);
create policy habit_events_select_own on public.habit_events
  for select to authenticated using ((select auth.uid()) = user_id);
create policy resource_ledger_select_own on public.resource_ledger
  for select to authenticated using ((select auth.uid()) = user_id);
create policy status_effects_select_own on public.status_effects
  for select to authenticated using ((select auth.uid()) = user_id);
create policy player_achievements_select_own on public.player_achievements
  for select to authenticated using ((select auth.uid()) = user_id);
create policy boss_encounters_select_own on public.boss_encounters
  for select to authenticated using ((select auth.uid()) = user_id);
create policy boss_actions_select_own on public.boss_actions
  for select to authenticated using ((select auth.uid()) = user_id);

revoke all on table
  public.player_states, public.daily_entries, public.daily_entry_revisions,
  public.habit_events, public.resource_ledger, public.status_effects,
  public.player_achievements, public.boss_encounters, public.boss_actions
from public, anon, authenticated;

grant select on table
  public.player_states, public.daily_entries, public.daily_entry_revisions,
  public.habit_events, public.resource_ledger, public.status_effects,
  public.player_achievements, public.boss_encounters, public.boss_actions
to authenticated;

grant select, insert, update, delete on table
  public.player_states, public.daily_entries, public.daily_entry_revisions,
  public.habit_events, public.resource_ledger, public.status_effects,
  public.player_achievements, public.boss_encounters, public.boss_actions
to service_role;

grant usage, select on sequence public.daily_entry_revisions_id_seq to service_role;
grant usage, select on sequence public.resource_ledger_id_seq to service_role;

create or replace function private.phase4_reserve_operation(
  p_user_id uuid,
  p_operation_id text,
  p_command_type text,
  p_request_hash text,
  p_expected_version bigint
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_inserted integer;
  v_operation private.command_operations%rowtype;
  v_root public.member_game_roots%rowtype;
  v_player public.player_states%rowtype;
begin
  if p_user_id is null or p_operation_id is null or p_request_hash is null
    or p_command_type not in ('REPORT_HABIT_EVENT', 'REVERSE_HABIT_EVENT', 'SUBMIT_DAILY_ENTRY')
    or p_expected_version is null or p_expected_version < 0 then
    return jsonb_build_object('ok', false, 'errorCode', 'INVALID_PAYLOAD');
  end if;

  insert into private.command_operations(user_id, operation_id, command_type, request_hash, status)
  values (p_user_id, p_operation_id, p_command_type, p_request_hash, 'pending')
  on conflict (user_id, operation_id) do nothing;
  get diagnostics v_inserted = row_count;

  select * into v_operation
  from private.command_operations
  where user_id = p_user_id and operation_id = p_operation_id
  for update;

  if v_inserted = 0 then
    if v_operation.command_type <> p_command_type or v_operation.request_hash <> p_request_hash then
      return jsonb_build_object('ok', false, 'errorCode', 'OPERATION_ID_REUSED');
    end if;
    if v_operation.status = 'completed' then
      return coalesce(v_operation.result, '{}'::jsonb)
        || jsonb_build_object('ok', true, 'duplicate', true);
    end if;
    return jsonb_build_object('ok', false, 'errorCode', 'OPERATION_IN_PROGRESS');
  end if;

  -- Fixed lock order for every Phase 4 command: receipt -> aggregate root -> player state.
  select * into v_root from public.member_game_roots
  where user_id = p_user_id for update;
  if not found then
    delete from private.command_operations where user_id = p_user_id and operation_id = p_operation_id;
    return jsonb_build_object('ok', false, 'errorCode', 'NOT_FOUND');
  end if;

  select * into v_player from public.player_states
  where user_id = p_user_id for update;
  if not found then
    delete from private.command_operations where user_id = p_user_id and operation_id = p_operation_id;
    return jsonb_build_object('ok', false, 'errorCode', 'NOT_FOUND');
  end if;

  if v_root.repository_version <> p_expected_version then
    delete from private.command_operations where user_id = p_user_id and operation_id = p_operation_id;
    return jsonb_build_object(
      'ok', false, 'errorCode', 'VERSION_CONFLICT',
      'currentVersion', v_root.repository_version
    );
  end if;

  return jsonb_build_object(
    'ok', true, 'duplicate', false, 'reserved', true,
    'repositoryVersion', v_root.repository_version
  );
end;
$$;

create or replace function private.phase4_complete_operation(
  p_user_id uuid,
  p_operation_id text,
  p_result jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_operation private.command_operations%rowtype;
  v_root public.member_game_roots%rowtype;
  v_player public.player_states%rowtype;
  v_version bigint;
  v_result jsonb;
begin
  if p_user_id is null or p_operation_id is null or p_result is null
    or jsonb_typeof(p_result) <> 'object' then
    return jsonb_build_object('ok', false, 'errorCode', 'INVALID_PAYLOAD');
  end if;

  select * into v_operation from private.command_operations
  where user_id = p_user_id and operation_id = p_operation_id for update;
  if not found then return jsonb_build_object('ok', false, 'errorCode', 'NOT_FOUND'); end if;
  if v_operation.status = 'completed' then
    return coalesce(v_operation.result, '{}'::jsonb)
      || jsonb_build_object('ok', true, 'duplicate', true);
  end if;

  select * into v_root from public.member_game_roots
  where user_id = p_user_id for update;
  if not found then return jsonb_build_object('ok', false, 'errorCode', 'NOT_FOUND'); end if;
  select * into v_player from public.player_states
  where user_id = p_user_id for update;
  if not found then return jsonb_build_object('ok', false, 'errorCode', 'NOT_FOUND'); end if;

  update public.member_game_roots
  set repository_version = repository_version + 1, updated_at = now()
  where user_id = p_user_id
  returning repository_version into v_version;

  v_result := p_result || jsonb_build_object(
    'ok', true, 'duplicate', false, 'repositoryVersion', v_version
  );
  update private.command_operations
  set status = 'completed', result = v_result, completed_at = now()
  where user_id = p_user_id and operation_id = p_operation_id;
  return v_result;
end;
$$;

comment on function private.phase4_reserve_operation(uuid, text, text, text, bigint) is
  'Phase 4 transaction kernel helper. Must be called inside the same database transaction as domain writes and phase4_complete_operation.';
comment on function private.phase4_complete_operation(uuid, text, jsonb) is
  'Completes a reserved Phase 4 operation and increments repositoryVersion in the caller transaction.';

revoke all on function private.phase4_reserve_operation(uuid, text, text, text, bigint)
  from public, anon, authenticated;
revoke all on function private.phase4_complete_operation(uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function private.phase4_reserve_operation(uuid, text, text, text, bigint)
  to service_role;
grant execute on function private.phase4_complete_operation(uuid, text, jsonb)
  to service_role;
