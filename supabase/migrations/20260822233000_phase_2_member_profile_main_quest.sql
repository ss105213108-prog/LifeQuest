-- LifeQuest Phase 2: authoritative member profile, first main quest onboarding,
-- and safe profile updates. Gameplay state remains outside this migration.

alter table public.profiles
  add column onboarding_completed boolean not null default false,
  add column main_quest_code text,
  add column daily_budget integer not null default 500,
  add column timezone text not null default 'Asia/Taipei';

alter table public.profiles
  drop constraint profiles_onboarding_status,
  add constraint profiles_onboarding_status
    check (onboarding_status in ('profile_initialized', 'main_quest_selected')),
  add constraint profiles_main_quest_code
    check (main_quest_code is null or main_quest_code in ('sleep', 'spending', 'exercise', 'learning')),
  add constraint profiles_daily_budget
    check (daily_budget between 1 and 100000000),
  add constraint profiles_timezone_v1
    check (timezone = 'Asia/Taipei'),
  add constraint profiles_onboarding_consistency
    check (
      (onboarding_completed = false
        and main_quest_code is null
        and onboarding_status = 'profile_initialized')
      or
      (onboarding_completed = true
        and main_quest_code is not null
        and onboarding_status = 'main_quest_selected')
    );

revoke insert, update, delete on public.profiles from public, anon, authenticated;
grant select on public.profiles to authenticated;

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
    )
  )
  from public.profiles p
  join public.member_game_roots r on r.user_id = p.user_id
  where p.user_id = p_user_id;
$$;

revoke all on function private.member_profile_state(uuid) from public, anon, authenticated;
grant execute on function private.member_profile_state(uuid) to service_role;

create or replace function private.select_main_quest(
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
  v_quest_id text := btrim(coalesce(p_command #>> '{payload,questId}', ''));
  v_request_hash text := encode(
    extensions.digest(convert_to(p_command::text, 'UTF8'), 'sha256'),
    'hex'
  );
  v_inserted_count bigint := 0;
  v_existing private.command_operations%rowtype;
  v_profile public.profiles%rowtype;
  v_root public.member_game_roots%rowtype;
  v_state jsonb;
  v_result jsonb;
begin
  if p_user_id is null then
    return jsonb_build_object('ok', false, 'errorCode', 'AUTH_REQUIRED', 'retryable', false);
  end if;

  if p_command is null
    or jsonb_typeof(p_command) <> 'object'
    or coalesce(p_command ->> 'contractVersion', '') <> '1'
    or v_command_type <> 'SELECT_MAIN_QUEST'
    or v_operation_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$'
    or jsonb_typeof(p_command -> 'payload') <> 'object'
    or jsonb_object_length(p_command -> 'payload') <> 1
    or not (p_command -> 'payload' ? 'questId')
    or v_quest_id not in ('sleep', 'spending', 'exercise', 'learning')
  then
    return jsonb_build_object(
      'ok', false, 'errorCode', 'INVALID_PAYLOAD', 'retryable', false,
      'operationId', nullif(v_operation_id, '')
    );
  end if;

  insert into private.command_operations (
    user_id, operation_id, command_type, request_hash, status
  ) values (
    p_user_id, v_operation_id, v_command_type, v_request_hash, 'pending'
  ) on conflict (user_id, operation_id) do nothing;
  get diagnostics v_inserted_count = row_count;

  select * into v_existing
    from private.command_operations
   where user_id = p_user_id and operation_id = v_operation_id
   for update;

  if v_inserted_count = 0 then
    if v_existing.request_hash <> v_request_hash or v_existing.command_type <> v_command_type then
      return jsonb_build_object(
        'ok', false, 'errorCode', 'OPERATION_ID_REUSED', 'retryable', false,
        'operationId', v_operation_id
      );
    end if;
    if v_existing.status = 'completed' and v_existing.result is not null then
      return v_existing.result || jsonb_build_object('duplicate', true);
    end if;
    return jsonb_build_object(
      'ok', false, 'errorCode', 'OPERATION_IN_PROGRESS', 'retryable', true,
      'operationId', v_operation_id
    );
  end if;

  select * into v_root
    from public.member_game_roots
   where user_id = p_user_id
   for update;

  select * into v_profile
    from public.profiles
   where user_id = p_user_id
   for update;

  if not found or v_root.user_id is null then
    delete from private.command_operations
     where user_id = p_user_id and operation_id = v_operation_id;
    return jsonb_build_object(
      'ok', false, 'errorCode', 'NOT_FOUND', 'retryable', false,
      'operationId', v_operation_id
    );
  end if;

  if p_expected_version is not null and p_expected_version <> v_root.repository_version then
    delete from private.command_operations
     where user_id = p_user_id and operation_id = v_operation_id;
    return jsonb_build_object(
      'ok', false, 'errorCode', 'VERSION_CONFLICT', 'retryable', true,
      'operationId', v_operation_id, 'currentVersion', v_root.repository_version
    );
  end if;

  if v_profile.onboarding_completed then
    delete from private.command_operations
     where user_id = p_user_id and operation_id = v_operation_id;
    return jsonb_build_object(
      'ok', false, 'errorCode', 'FORBIDDEN', 'retryable', false,
      'operationId', v_operation_id
    );
  end if;

  update public.profiles
     set main_quest_code = v_quest_id,
         onboarding_completed = true,
         onboarding_status = 'main_quest_selected',
         updated_at = now()
   where user_id = p_user_id;

  update public.member_game_roots
     set repository_version = repository_version + 1,
         updated_at = now()
   where user_id = p_user_id
   returning * into v_root;

  v_state := private.member_profile_state(p_user_id);
  v_result := jsonb_build_object(
    'ok', true,
    'operationId', v_operation_id,
    'repositoryVersion', v_root.repository_version,
    'duplicate', false,
    'serverTimestamp', now(),
    'result', jsonb_build_object(
      'questId', v_quest_id,
      'onboardingCompleted', true
    ),
    'state', v_state
  );

  update private.command_operations
     set status = 'completed', result = v_result, completed_at = now()
   where user_id = p_user_id and operation_id = v_operation_id;

  return v_result;
end;
$$;

create or replace function private.update_member_profile(
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
  v_has_name boolean := v_payload ? 'adventurerName';
  v_has_budget boolean := v_payload ? 'dailyBudget';
  v_adventurer_name text := btrim(coalesce(v_payload ->> 'adventurerName', ''));
  v_daily_budget_text text := coalesce(v_payload ->> 'dailyBudget', '');
  v_request_hash text := encode(
    extensions.digest(convert_to(p_command::text, 'UTF8'), 'sha256'),
    'hex'
  );
  v_inserted_count bigint := 0;
  v_existing private.command_operations%rowtype;
  v_profile public.profiles%rowtype;
  v_root public.member_game_roots%rowtype;
  v_state jsonb;
  v_result jsonb;
  v_updated_fields jsonb := '[]'::jsonb;
begin
  if p_user_id is null then
    return jsonb_build_object('ok', false, 'errorCode', 'AUTH_REQUIRED', 'retryable', false);
  end if;

  if p_command is null
    or jsonb_typeof(p_command) <> 'object'
    or coalesce(p_command ->> 'contractVersion', '') <> '1'
    or v_command_type <> 'UPDATE_PROFILE'
    or v_operation_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$'
    or jsonb_typeof(p_command -> 'payload') <> 'object'
    or jsonb_object_length(v_payload) not between 1 and 2
    or (v_payload - 'adventurerName' - 'dailyBudget') <> '{}'::jsonb
    or (v_has_name and (
      char_length(v_adventurer_name) not between 2 and 16
      or v_adventurer_name !~ '^[[:alnum:]]+$'
    ))
    or (v_has_budget and (
      v_daily_budget_text !~ '^[0-9]+$'
      or v_daily_budget_text::numeric not between 1 and 100000000
    ))
  then
    return jsonb_build_object(
      'ok', false, 'errorCode', 'INVALID_PAYLOAD', 'retryable', false,
      'operationId', nullif(v_operation_id, '')
    );
  end if;

  insert into private.command_operations (
    user_id, operation_id, command_type, request_hash, status
  ) values (
    p_user_id, v_operation_id, v_command_type, v_request_hash, 'pending'
  ) on conflict (user_id, operation_id) do nothing;
  get diagnostics v_inserted_count = row_count;

  select * into v_existing
    from private.command_operations
   where user_id = p_user_id and operation_id = v_operation_id
   for update;

  if v_inserted_count = 0 then
    if v_existing.request_hash <> v_request_hash or v_existing.command_type <> v_command_type then
      return jsonb_build_object(
        'ok', false, 'errorCode', 'OPERATION_ID_REUSED', 'retryable', false,
        'operationId', v_operation_id
      );
    end if;
    if v_existing.status = 'completed' and v_existing.result is not null then
      return v_existing.result || jsonb_build_object('duplicate', true);
    end if;
    return jsonb_build_object(
      'ok', false, 'errorCode', 'OPERATION_IN_PROGRESS', 'retryable', true,
      'operationId', v_operation_id
    );
  end if;

  select * into v_root
    from public.member_game_roots
   where user_id = p_user_id
   for update;

  select * into v_profile
    from public.profiles
   where user_id = p_user_id
   for update;

  if not found or v_root.user_id is null then
    delete from private.command_operations
     where user_id = p_user_id and operation_id = v_operation_id;
    return jsonb_build_object(
      'ok', false, 'errorCode', 'NOT_FOUND', 'retryable', false,
      'operationId', v_operation_id
    );
  end if;

  if p_expected_version is not null and p_expected_version <> v_root.repository_version then
    delete from private.command_operations
     where user_id = p_user_id and operation_id = v_operation_id;
    return jsonb_build_object(
      'ok', false, 'errorCode', 'VERSION_CONFLICT', 'retryable', true,
      'operationId', v_operation_id, 'currentVersion', v_root.repository_version
    );
  end if;

  update public.profiles
     set adventurer_name = case when v_has_name then v_adventurer_name else adventurer_name end,
         daily_budget = case when v_has_budget then v_daily_budget_text::integer else daily_budget end,
         updated_at = now()
   where user_id = p_user_id;

  if v_has_name then v_updated_fields := v_updated_fields || '"adventurerName"'::jsonb; end if;
  if v_has_budget then v_updated_fields := v_updated_fields || '"dailyBudget"'::jsonb; end if;

  update public.member_game_roots
     set repository_version = repository_version + 1,
         updated_at = now()
   where user_id = p_user_id
   returning * into v_root;

  v_state := private.member_profile_state(p_user_id);
  v_result := jsonb_build_object(
    'ok', true,
    'operationId', v_operation_id,
    'repositoryVersion', v_root.repository_version,
    'duplicate', false,
    'serverTimestamp', now(),
    'result', jsonb_build_object('updatedFields', v_updated_fields),
    'state', v_state
  );

  update private.command_operations
     set status = 'completed', result = v_result, completed_at = now()
   where user_id = p_user_id and operation_id = v_operation_id;

  return v_result;
end;
$$;

revoke all on function private.select_main_quest(uuid, jsonb, bigint)
  from public, anon, authenticated;
grant execute on function private.select_main_quest(uuid, jsonb, bigint)
  to service_role;
revoke all on function private.update_member_profile(uuid, jsonb, bigint)
  from public, anon, authenticated;
grant execute on function private.update_member_profile(uuid, jsonb, bigint)
  to service_role;

create or replace function public.select_main_quest(
  p_user_id uuid,
  p_command jsonb,
  p_expected_version bigint default null
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.select_main_quest(p_user_id, p_command, p_expected_version);
$$;

create or replace function public.update_member_profile(
  p_user_id uuid,
  p_command jsonb,
  p_expected_version bigint default null
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.update_member_profile(p_user_id, p_command, p_expected_version);
$$;

revoke all on function public.select_main_quest(uuid, jsonb, bigint)
  from public, anon, authenticated;
grant execute on function public.select_main_quest(uuid, jsonb, bigint)
  to service_role;
revoke all on function public.update_member_profile(uuid, jsonb, bigint)
  from public, anon, authenticated;
grant execute on function public.update_member_profile(uuid, jsonb, bigint)
  to service_role;

comment on function public.select_main_quest(uuid, jsonb, bigint) is
  'Phase 2 first-onboarding command. p_user_id must come from a server-verified Auth user.';
comment on function public.update_member_profile(uuid, jsonb, bigint) is
  'Phase 2 safe profile update command. Only adventurerName and dailyBudget are accepted.';
