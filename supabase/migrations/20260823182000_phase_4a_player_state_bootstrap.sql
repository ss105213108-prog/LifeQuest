-- LifeQuest Phase 4A: every future member aggregate receives one player state.
-- Existing roots were backfilled by the foundation migration.

create or replace function private.bootstrap_player_state_from_root()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.player_states(user_id)
  values (new.user_id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

revoke all on function private.bootstrap_player_state_from_root()
  from public, anon, authenticated;

drop trigger if exists member_game_roots_bootstrap_player_state
  on public.member_game_roots;

create trigger member_game_roots_bootstrap_player_state
after insert on public.member_game_roots
for each row execute function private.bootstrap_player_state_from_root();

