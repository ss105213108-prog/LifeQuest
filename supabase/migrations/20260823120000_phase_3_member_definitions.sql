-- LifeQuest Phase 3: cloud-authoritative daily drafts, custom habit definitions,
-- and system-rule enabled preferences. No settlement or game resources exist here.

create table public.daily_drafts (
  user_id uuid not null references auth.users(id) on delete cascade,
  entry_date date not null,
  sleep numeric(4,2),
  water integer not null default 0,
  exercise integer not null default 0,
  study integer not null default 0,
  expense integer,
  impulse integer not null default 0,
  sugary_drinks integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, entry_date),
  constraint daily_drafts_sleep check (sleep is null or sleep between 0 and 24),
  constraint daily_drafts_water check (water between 0 and 100000),
  constraint daily_drafts_exercise check (exercise between 0 and 1440),
  constraint daily_drafts_study check (study between 0 and 1440),
  constraint daily_drafts_expense check (expense is null or expense between 0 and 1000000000),
  constraint daily_drafts_impulse check (impulse between 0 and 1000),
  constraint daily_drafts_sugary_drinks check (sugary_drinks between 0 and 1000)
);

create table public.custom_habits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  direction text not null,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint custom_habits_title check (char_length(btrim(title)) between 1 and 80),
  constraint custom_habits_direction check (direction in ('good', 'bad'))
);

create index custom_habits_user_active_idx
  on public.custom_habits(user_id, created_at)
  where deleted_at is null;

create table public.rule_preferences (
  user_id uuid not null references auth.users(id) on delete cascade,
  rule_id text not null,
  enabled boolean not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, rule_id),
  constraint rule_preferences_catalog check (rule_id in (
    'rule_1', 'rule_2', 'rule_water', 'rule_exercise', 'rule_5', 'rule_3',
    'rule_boss_sleep', 'rule_boss_lazy', 'rule_boss_budget',
    'rule_boss_fried_food', 'rule_4', 'rule_6'
  ))
);

alter table public.daily_drafts enable row level security;
alter table public.custom_habits enable row level security;
alter table public.rule_preferences enable row level security;

create policy daily_drafts_select_own on public.daily_drafts
  for select to authenticated using ((select auth.uid()) = user_id);
create policy custom_habits_select_own on public.custom_habits
  for select to authenticated using ((select auth.uid()) = user_id);
create policy rule_preferences_select_own on public.rule_preferences
  for select to authenticated using ((select auth.uid()) = user_id);

revoke insert, update, delete on public.daily_drafts from public, anon, authenticated;
revoke insert, update, delete on public.custom_habits from public, anon, authenticated;
revoke insert, update, delete on public.rule_preferences from public, anon, authenticated;
grant select on public.daily_drafts, public.custom_habits, public.rule_preferences to authenticated;

create or replace function private.member_profile_state(p_user_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'meta', jsonb_build_object(
      'repositoryVersion', r.repository_version,
      'operations', jsonb_build_array()
    ),
    'member', jsonb_build_object(
      'adventurerName', p.adventurer_name,
      'onboardingStatus', p.onboarding_status,
      'onboardingCompleted', p.onboarding_completed,
      'mainQuestId', p.main_quest_code,
      'dailyBudget', p.daily_budget,
      'timeZone', p.timezone,
      'createdAt', p.created_at,
      'updatedAt', p.updated_at
    ),
    'dailyDrafts', coalesce((
      select jsonb_object_agg(d.entry_date::text, jsonb_build_object(
        'date', d.entry_date::text,
        'sleep', d.sleep,
        'water', d.water,
        'exercise', d.exercise,
        'study', d.study,
        'expense', d.expense,
        'impulse', d.impulse,
        'sugaryDrinks', d.sugary_drinks,
        'updatedAt', d.updated_at
      )) from public.daily_drafts d where d.user_id = p_user_id
    ), '{}'::jsonb),
    'customHabits', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', h.id,
        'title', h.title,
        'direction', h.direction,
        'deletedAt', h.deleted_at,
        'createdAt', h.created_at,
        'updatedAt', h.updated_at
      ) order by h.created_at)
      from public.custom_habits h where h.user_id = p_user_id
    ), '[]'::jsonb),
    'rulePreferences', coalesce((
      select jsonb_object_agg(q.rule_id, q.enabled)
      from public.rule_preferences q where q.user_id = p_user_id
    ), '{}'::jsonb)
  )
  from public.profiles p
  join public.member_game_roots r on r.user_id = p.user_id
  where p.user_id = p_user_id;
$$;

revoke all on function private.member_profile_state(uuid) from public, anon, authenticated;
grant execute on function private.member_profile_state(uuid) to service_role;

create or replace function private.execute_phase3_command(
  p_user_id uuid,
  p_command jsonb,
  p_expected_version bigint default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_operation_id text := coalesce(p_command ->> 'operationId', '');
  v_command_type text := coalesce(p_command ->> 'type', '');
  v_payload jsonb := coalesce(p_command -> 'payload', '{}'::jsonb);
  v_request_hash text := encode(
    extensions.digest(convert_to(p_command::text, 'UTF8'), 'sha256'), 'hex'
  );
  v_inserted_count bigint := 0;
  v_existing private.command_operations%rowtype;
  v_root public.member_game_roots%rowtype;
  v_profile public.profiles%rowtype;
  v_result jsonb;
  v_state jsonb;
  v_domain_result jsonb := '{}'::jsonb;
  v_date_text text;
  v_entry_date date;
  v_draft jsonb;
  v_title text;
  v_direction text;
  v_habit_id uuid;
  v_rule_id text;
  v_enabled boolean;
  v_habit public.custom_habits%rowtype;
  v_active_count integer;
begin
  if p_user_id is null then
    return jsonb_build_object('ok', false, 'errorCode', 'AUTH_REQUIRED', 'retryable', false);
  end if;

  if p_command is null
    or jsonb_typeof(p_command) <> 'object'
    or coalesce(p_command ->> 'contractVersion', '') <> '1'
    or v_operation_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$'
    or jsonb_typeof(v_payload) <> 'object'
    or v_command_type not in (
      'SAVE_DAILY_DRAFT', 'CREATE_CUSTOM_HABIT', 'UPDATE_CUSTOM_HABIT',
      'REMOVE_CUSTOM_HABIT', 'RESTORE_CUSTOM_HABIT', 'SET_RULE_ENABLED'
    )
  then
    return jsonb_build_object(
      'ok', false, 'errorCode', 'INVALID_PAYLOAD', 'retryable', false,
      'operationId', nullif(v_operation_id, '')
    );
  end if;

  -- Validate the complete intent before reserving an operation or casting values.
  if v_command_type = 'SAVE_DAILY_DRAFT' then
    v_date_text := coalesce(v_payload ->> 'date', '');
    v_draft := v_payload -> 'draft';
    if (select count(*) from jsonb_object_keys(v_payload)) <> 2
      or (v_payload - 'date' - 'draft') <> '{}'::jsonb
      or v_date_text !~ '^\d{4}-\d{2}-\d{2}$'
      or to_char(to_date(v_date_text, 'YYYY-MM-DD'), 'YYYY-MM-DD') <> v_date_text
      or jsonb_typeof(v_draft) <> 'object'
      or (select count(*) from jsonb_object_keys(v_draft)) <> 7
      or (v_draft - 'sleep' - 'water' - 'exercise' - 'study' - 'expense' - 'impulse' - 'sugaryDrinks') <> '{}'::jsonb
      or exists (
        select 1 from jsonb_each(v_draft) item
        where item.value <> 'null'::jsonb and jsonb_typeof(item.value) <> 'number'
      )
    then
      return jsonb_build_object('ok', false, 'errorCode', 'INVALID_PAYLOAD', 'retryable', false, 'operationId', v_operation_id);
    end if;
    v_entry_date := v_date_text::date;
  elsif v_command_type = 'CREATE_CUSTOM_HABIT' then
    v_title := btrim(coalesce(v_payload ->> 'title', ''));
    v_direction := coalesce(v_payload ->> 'direction', '');
    if (select count(*) from jsonb_object_keys(v_payload)) <> 2
      or (v_payload - 'title' - 'direction') <> '{}'::jsonb
      or char_length(v_title) not between 1 and 80
      or v_direction not in ('good', 'bad')
    then
      return jsonb_build_object('ok', false, 'errorCode', 'INVALID_PAYLOAD', 'retryable', false, 'operationId', v_operation_id);
    end if;
  elsif v_command_type = 'UPDATE_CUSTOM_HABIT' then
    if coalesce(v_payload ->> 'habitId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or (select count(*) from jsonb_object_keys(v_payload)) not between 2 and 3
      or (v_payload - 'habitId' - 'title' - 'direction') <> '{}'::jsonb
      or not (v_payload ? 'title' or v_payload ? 'direction')
      or (v_payload ? 'title' and char_length(btrim(coalesce(v_payload ->> 'title', ''))) not between 1 and 80)
      or (v_payload ? 'direction' and coalesce(v_payload ->> 'direction', '') not in ('good', 'bad'))
    then
      return jsonb_build_object('ok', false, 'errorCode', 'INVALID_PAYLOAD', 'retryable', false, 'operationId', v_operation_id);
    end if;
    v_habit_id := (v_payload ->> 'habitId')::uuid;
  elsif v_command_type in ('REMOVE_CUSTOM_HABIT', 'RESTORE_CUSTOM_HABIT') then
    if (select count(*) from jsonb_object_keys(v_payload)) <> 1
      or (v_payload - 'habitId') <> '{}'::jsonb
      or coalesce(v_payload ->> 'habitId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    then
      return jsonb_build_object('ok', false, 'errorCode', 'INVALID_PAYLOAD', 'retryable', false, 'operationId', v_operation_id);
    end if;
    v_habit_id := (v_payload ->> 'habitId')::uuid;
  elsif v_command_type = 'SET_RULE_ENABLED' then
    v_rule_id := coalesce(v_payload ->> 'ruleId', '');
    if (select count(*) from jsonb_object_keys(v_payload)) <> 2
      or (v_payload - 'ruleId' - 'enabled') <> '{}'::jsonb
      or v_rule_id not in (
        'rule_1', 'rule_2', 'rule_water', 'rule_exercise', 'rule_5', 'rule_3',
        'rule_boss_sleep', 'rule_boss_lazy', 'rule_boss_budget',
        'rule_boss_fried_food', 'rule_4', 'rule_6'
      )
      or jsonb_typeof(v_payload -> 'enabled') <> 'boolean'
    then
      return jsonb_build_object('ok', false, 'errorCode', 'INVALID_PAYLOAD', 'retryable', false, 'operationId', v_operation_id);
    end if;
    v_enabled := (v_payload ->> 'enabled')::boolean;
  end if;

  insert into private.command_operations (
    user_id, operation_id, command_type, request_hash, status
  ) values (
    p_user_id, v_operation_id, v_command_type, v_request_hash, 'pending'
  ) on conflict (user_id, operation_id) do nothing;
  get diagnostics v_inserted_count = row_count;

  select * into v_existing from private.command_operations
   where user_id = p_user_id and operation_id = v_operation_id for update;

  if v_inserted_count = 0 then
    if v_existing.request_hash <> v_request_hash or v_existing.command_type <> v_command_type then
      return jsonb_build_object('ok', false, 'errorCode', 'OPERATION_ID_REUSED', 'retryable', false, 'operationId', v_operation_id);
    end if;
    if v_existing.status = 'completed' and v_existing.result is not null then
      return v_existing.result || jsonb_build_object('duplicate', true);
    end if;
    return jsonb_build_object('ok', false, 'errorCode', 'OPERATION_IN_PROGRESS', 'retryable', true, 'operationId', v_operation_id);
  end if;

  select * into v_root from public.member_game_roots where user_id = p_user_id for update;
  select * into v_profile from public.profiles where user_id = p_user_id for update;
  if v_root.user_id is null or v_profile.user_id is null then
    delete from private.command_operations where user_id = p_user_id and operation_id = v_operation_id;
    return jsonb_build_object('ok', false, 'errorCode', 'NOT_FOUND', 'retryable', false, 'operationId', v_operation_id);
  end if;
  if p_expected_version is not null and p_expected_version <> v_root.repository_version then
    delete from private.command_operations where user_id = p_user_id and operation_id = v_operation_id;
    return jsonb_build_object('ok', false, 'errorCode', 'VERSION_CONFLICT', 'retryable', true, 'operationId', v_operation_id, 'currentVersion', v_root.repository_version);
  end if;

  if v_command_type = 'SAVE_DAILY_DRAFT'
    and v_entry_date > (now() at time zone v_profile.timezone)::date
  then
    delete from private.command_operations where user_id = p_user_id and operation_id = v_operation_id;
    return jsonb_build_object('ok', false, 'errorCode', 'INVALID_BUSINESS_DATE', 'retryable', false, 'operationId', v_operation_id);
  end if;

  if v_command_type = 'SAVE_DAILY_DRAFT' then
    if v_entry_date < (now() at time zone v_profile.timezone)::date - 7 then
      delete from private.command_operations where user_id = p_user_id and operation_id = v_operation_id;
      return jsonb_build_object('ok', false, 'errorCode', 'BACKFILL_NOT_ALLOWED', 'retryable', false, 'operationId', v_operation_id);
    end if;
    if (v_draft ->> 'sleep')::numeric not between 0 and 24
      or (v_draft ->> 'water')::numeric not between 0 and 100000
      or (v_draft ->> 'exercise')::numeric not between 0 and 1440
      or (v_draft ->> 'study')::numeric not between 0 and 1440
      or (v_draft ->> 'expense')::numeric not between 0 and 1000000000
      or (v_draft ->> 'impulse')::numeric not between 0 and 1000
      or (v_draft ->> 'sugaryDrinks')::numeric not between 0 and 1000
      or coalesce(mod((v_draft ->> 'water')::numeric, 1) <> 0, false)
      or coalesce(mod((v_draft ->> 'exercise')::numeric, 1) <> 0, false)
      or coalesce(mod((v_draft ->> 'study')::numeric, 1) <> 0, false)
      or coalesce(mod((v_draft ->> 'expense')::numeric, 1) <> 0, false)
      or coalesce(mod((v_draft ->> 'impulse')::numeric, 1) <> 0, false)
      or coalesce(mod((v_draft ->> 'sugaryDrinks')::numeric, 1) <> 0, false)
    then
      delete from private.command_operations where user_id = p_user_id and operation_id = v_operation_id;
      return jsonb_build_object('ok', false, 'errorCode', 'INVALID_PAYLOAD', 'retryable', false, 'operationId', v_operation_id);
    end if;
    insert into public.daily_drafts (
      user_id, entry_date, sleep, water, exercise, study, expense, impulse, sugary_drinks
    ) values (
      p_user_id, v_entry_date,
      (v_draft ->> 'sleep')::numeric,
      coalesce((v_draft ->> 'water')::integer, 0),
      coalesce((v_draft ->> 'exercise')::integer, 0),
      coalesce((v_draft ->> 'study')::integer, 0),
      (v_draft ->> 'expense')::integer,
      coalesce((v_draft ->> 'impulse')::integer, 0),
      coalesce((v_draft ->> 'sugaryDrinks')::integer, 0)
    ) on conflict (user_id, entry_date) do update set
      sleep = excluded.sleep, water = excluded.water, exercise = excluded.exercise,
      study = excluded.study, expense = excluded.expense, impulse = excluded.impulse,
      sugary_drinks = excluded.sugary_drinks, updated_at = now();
    v_domain_result := jsonb_build_object('date', v_date_text);
  elsif v_command_type = 'CREATE_CUSTOM_HABIT' then
    select count(*) into v_active_count from public.custom_habits where user_id = p_user_id and deleted_at is null;
    if v_active_count >= 50 then
      delete from private.command_operations where user_id = p_user_id and operation_id = v_operation_id;
      return jsonb_build_object('ok', false, 'errorCode', 'LIMIT_REACHED', 'retryable', false, 'operationId', v_operation_id);
    end if;
    insert into public.custom_habits(user_id, title, direction)
      values (p_user_id, v_title, v_direction) returning * into v_habit;
    v_domain_result := jsonb_build_object('habitId', v_habit.id);
  elsif v_command_type = 'UPDATE_CUSTOM_HABIT' then
    update public.custom_habits set
      title = case when v_payload ? 'title' then btrim(v_payload ->> 'title') else title end,
      direction = case when v_payload ? 'direction' then v_payload ->> 'direction' else direction end,
      updated_at = now()
    where id = v_habit_id and user_id = p_user_id and deleted_at is null
    returning * into v_habit;
    if v_habit.id is null then
      delete from private.command_operations where user_id = p_user_id and operation_id = v_operation_id;
      return jsonb_build_object('ok', false, 'errorCode', 'NOT_FOUND', 'retryable', false, 'operationId', v_operation_id);
    end if;
    v_domain_result := jsonb_build_object('habitId', v_habit.id);
  elsif v_command_type = 'REMOVE_CUSTOM_HABIT' then
    update public.custom_habits set deleted_at = now(), updated_at = now()
    where id = v_habit_id and user_id = p_user_id and deleted_at is null
    returning * into v_habit;
    if v_habit.id is null then
      delete from private.command_operations where user_id = p_user_id and operation_id = v_operation_id;
      return jsonb_build_object('ok', false, 'errorCode', 'NOT_FOUND', 'retryable', false, 'operationId', v_operation_id);
    end if;
    v_domain_result := jsonb_build_object('habitId', v_habit.id, 'deletedAt', v_habit.deleted_at);
  elsif v_command_type = 'RESTORE_CUSTOM_HABIT' then
    select count(*) into v_active_count from public.custom_habits where user_id = p_user_id and deleted_at is null;
    if v_active_count >= 50 then
      delete from private.command_operations where user_id = p_user_id and operation_id = v_operation_id;
      return jsonb_build_object('ok', false, 'errorCode', 'LIMIT_REACHED', 'retryable', false, 'operationId', v_operation_id);
    end if;
    update public.custom_habits set deleted_at = null, updated_at = now()
    where id = v_habit_id and user_id = p_user_id and deleted_at is not null
    returning * into v_habit;
    if v_habit.id is null then
      delete from private.command_operations where user_id = p_user_id and operation_id = v_operation_id;
      return jsonb_build_object('ok', false, 'errorCode', 'NOT_FOUND', 'retryable', false, 'operationId', v_operation_id);
    end if;
    v_domain_result := jsonb_build_object('habitId', v_habit.id);
  elsif v_command_type = 'SET_RULE_ENABLED' then
    insert into public.rule_preferences(user_id, rule_id, enabled)
      values (p_user_id, v_rule_id, v_enabled)
    on conflict (user_id, rule_id) do update set enabled = excluded.enabled, updated_at = now();
    v_domain_result := jsonb_build_object('ruleId', v_rule_id, 'enabled', v_enabled);
  end if;

  update public.member_game_roots
    set repository_version = repository_version + 1, updated_at = now()
    where user_id = p_user_id returning * into v_root;
  v_state := private.member_profile_state(p_user_id);
  v_result := jsonb_build_object(
    'ok', true,
    'operationId', v_operation_id,
    'repositoryVersion', v_root.repository_version,
    'duplicate', false,
    'serverTimestamp', now(),
    'result', v_domain_result,
    'state', v_state
  );
  update private.command_operations set status = 'completed', result = v_result, completed_at = now()
    where user_id = p_user_id and operation_id = v_operation_id;
  return v_result;
end;
$$;

revoke all on function private.execute_phase3_command(uuid, jsonb, bigint) from public, anon, authenticated;
grant execute on function private.execute_phase3_command(uuid, jsonb, bigint) to service_role;

create or replace function public.execute_phase3_command(
  p_user_id uuid,
  p_command jsonb,
  p_expected_version bigint default null
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.execute_phase3_command(p_user_id, p_command, p_expected_version);
$$;

revoke all on function public.execute_phase3_command(uuid, jsonb, bigint) from public, anon, authenticated;
grant execute on function public.execute_phase3_command(uuid, jsonb, bigint) to service_role;

comment on function public.execute_phase3_command(uuid, jsonb, bigint) is
  'Phase 3 non-resource member command. p_user_id must come from a server-verified Auth user.';
