-- LifeQuest Phase 1: member identity, private command receipts, and repository root.
-- This migration intentionally excludes every Phase 2+ gameplay table.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create extension if not exists pgcrypto with schema extensions;

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  adventurer_name text not null,
  onboarding_status text not null default 'profile_initialized',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_adventurer_name_length
    check (char_length(adventurer_name) between 2 and 16),
  constraint profiles_adventurer_name_format
    check (adventurer_name ~ '^[[:alnum:]]+$'),
  constraint profiles_onboarding_status
    check (onboarding_status in ('profile_initialized'))
);

create table public.member_game_roots (
  user_id uuid primary key references auth.users(id) on delete cascade,
  repository_version bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint member_game_roots_repository_version_nonnegative
    check (repository_version >= 0)
);

create table private.command_operations (
  user_id uuid not null references auth.users(id) on delete cascade,
  operation_id text not null,
  command_type text not null,
  request_hash text not null,
  status text not null default 'pending',
  result jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (user_id, operation_id),
  constraint command_operations_operation_id_format
    check (operation_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$'),
  constraint command_operations_status
    check (status in ('pending', 'completed'))
);

create index command_operations_user_created_at_idx
  on private.command_operations (user_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.member_game_roots enable row level security;
alter table private.command_operations enable row level security;

create policy profiles_select_own
  on public.profiles
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy member_game_roots_select_own
  on public.member_game_roots
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

revoke all on public.profiles from public, anon, authenticated;
revoke all on public.member_game_roots from public, anon, authenticated;
grant select on public.profiles to authenticated;
grant select on public.member_game_roots to authenticated;

revoke all on private.command_operations from public, anon, authenticated;

create or replace function public.initialize_member_profile(
  p_command jsonb,
  p_expected_version bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_operation_id text := coalesce(p_command ->> 'operationId', '');
  v_command_type text := coalesce(p_command ->> 'type', '');
  v_adventurer_name text := btrim(coalesce(p_command #>> '{payload,adventurerName}', ''));
  v_request_hash text := encode(
    extensions.digest(convert_to(p_command::text, 'UTF8'), 'sha256'),
    'hex'
  );
  v_inserted_count bigint := 0;
  v_profile_inserted_count bigint := 0;
  v_existing private.command_operations%rowtype;
  v_profile public.profiles%rowtype;
  v_root public.member_game_roots%rowtype;
  v_result jsonb;
begin
  if v_user_id is null then
    return jsonb_build_object(
      'ok', false,
      'errorCode', 'AUTH_REQUIRED',
      'retryable', false,
      'operationId', null
    );
  end if;

  if p_command is null
    or jsonb_typeof(p_command) <> 'object'
    or coalesce(p_command ->> 'contractVersion', '') <> '1'
    or v_command_type <> 'INITIALIZE_MEMBER_PROFILE'
    or v_operation_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$'
    or jsonb_typeof(p_command -> 'payload') <> 'object'
    or char_length(v_adventurer_name) not between 2 and 16
    or v_adventurer_name !~ '^[[:alnum:]]+$'
  then
    return jsonb_build_object(
      'ok', false,
      'errorCode', 'INVALID_PAYLOAD',
      'retryable', false,
      'operationId', nullif(v_operation_id, '')
    );
  end if;

  insert into private.command_operations (
    user_id,
    operation_id,
    command_type,
    request_hash,
    status
  ) values (
    v_user_id,
    v_operation_id,
    v_command_type,
    v_request_hash,
    'pending'
  )
  on conflict (user_id, operation_id) do nothing;

  get diagnostics v_inserted_count = row_count;

  select *
    into v_existing
    from private.command_operations
   where user_id = v_user_id
     and operation_id = v_operation_id
   for update;

  if v_inserted_count = 0 then
    if v_existing.request_hash <> v_request_hash
      or v_existing.command_type <> v_command_type
    then
      return jsonb_build_object(
        'ok', false,
        'errorCode', 'OPERATION_ID_REUSED',
        'retryable', false,
        'operationId', v_operation_id
      );
    end if;

    if v_existing.status = 'completed' and v_existing.result is not null then
      return v_existing.result || jsonb_build_object('duplicate', true);
    end if;

    return jsonb_build_object(
      'ok', false,
      'errorCode', 'OPERATION_IN_PROGRESS',
      'retryable', true,
      'operationId', v_operation_id
    );
  end if;

  select *
    into v_root
    from public.member_game_roots
   where user_id = v_user_id
   for update;

  if p_expected_version is not null
    and p_expected_version <> coalesce(v_root.repository_version, 0)
  then
    delete from private.command_operations
     where user_id = v_user_id
       and operation_id = v_operation_id;

    return jsonb_build_object(
      'ok', false,
      'errorCode', 'VERSION_CONFLICT',
      'retryable', true,
      'operationId', v_operation_id,
      'currentVersion', coalesce(v_root.repository_version, 0)
    );
  end if;

  insert into public.profiles (user_id, adventurer_name)
  values (v_user_id, v_adventurer_name)
  on conflict (user_id) do nothing;

  get diagnostics v_profile_inserted_count = row_count;

  insert into public.member_game_roots (user_id, repository_version)
  values (v_user_id, 0)
  on conflict (user_id) do nothing;

  update public.member_game_roots
     set repository_version = repository_version + 1,
         updated_at = now()
   where user_id = v_user_id
   returning * into v_root;

  select *
    into v_profile
    from public.profiles
   where user_id = v_user_id;

  v_result := jsonb_build_object(
    'ok', true,
    'operationId', v_operation_id,
    'repositoryVersion', v_root.repository_version,
    'duplicate', false,
    'serverTimestamp', now(),
    'result', jsonb_build_object(
      'initialized', true,
      'profileCreated', v_profile_inserted_count = 1
    ),
    'state', jsonb_build_object(
      'meta', jsonb_build_object(
        'repositoryVersion', v_root.repository_version,
        'operations', jsonb_build_array()
      ),
      'member', jsonb_build_object(
        'adventurerName', v_profile.adventurer_name,
        'onboardingStatus', v_profile.onboarding_status,
        'createdAt', v_profile.created_at,
        'updatedAt', v_profile.updated_at
      )
    )
  );

  update private.command_operations
     set status = 'completed',
         result = v_result,
         completed_at = now()
   where user_id = v_user_id
     and operation_id = v_operation_id;

  return v_result;
exception
  when others then
    raise warning 'INITIALIZE_MEMBER_PROFILE failed for authenticated user';
    raise;
end;
$$;

revoke all on function public.initialize_member_profile(jsonb, bigint) from public, anon;
grant execute on function public.initialize_member_profile(jsonb, bigint) to authenticated;

comment on function public.initialize_member_profile(jsonb, bigint) is
  'Phase 1 authoritative and idempotent member profile bootstrap. Uses auth.uid(); never trusts a client user_id.';
