-- LifeQuest Phase 5A: cross-table invariants, read-only browser RLS and grants.

create or replace function private.phase5_guard_inventory_row()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_item public.item_catalog%rowtype;
begin
  select * into v_item from public.item_catalog where item_key = new.item_key;
  if not found or v_item.item_type = 'reward_ticket' then
    raise exception 'PHASE5_INVALID_INVENTORY_ITEM';
  end if;
  if v_item.item_type = 'potion' and new.quantity > v_item.max_stack then
    raise exception 'PHASE5_INVENTORY_STACK_LIMIT';
  end if;
  if v_item.item_type in ('weapon', 'armor', 'pet') and new.quantity <> 1 then
    raise exception 'PHASE5_EQUIPMENT_MUST_BE_UNIQUE';
  end if;
  return new;
end;
$$;

create or replace function private.phase5_guard_equipment_row()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_item public.item_catalog%rowtype;
begin
  select * into v_item from public.item_catalog where item_key = new.item_key;
  if not found or not v_item.equippable or v_item.equipment_slot <> new.slot then
    raise exception 'PHASE5_INVALID_EQUIPMENT_SLOT';
  end if;
  return new;
end;
$$;

create or replace function private.phase5_guard_reward_ticket_row()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_item public.item_catalog%rowtype;
begin
  select * into v_item from public.item_catalog where item_key = new.ticket_key;
  if not found or v_item.item_type <> 'reward_ticket' or v_item.currency_type <> 'gems' then
    raise exception 'PHASE5_INVALID_REWARD_TICKET';
  end if;
  return new;
end;
$$;

create or replace function private.phase5_reject_economy_history_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'PHASE5_ECONOMY_HISTORY_IMMUTABLE';
end;
$$;

create trigger player_inventory_shape_guard
before insert or update on public.player_inventory
for each row execute function private.phase5_guard_inventory_row();

create trigger player_equipment_shape_guard
before insert or update on public.player_equipment
for each row execute function private.phase5_guard_equipment_row();

create trigger player_reward_ticket_shape_guard
before insert or update on public.player_reward_tickets
for each row execute function private.phase5_guard_reward_ticket_row();

create trigger economy_transactions_immutable
before update on public.economy_transactions
for each row execute function private.phase5_reject_economy_history_update();

revoke all on function private.phase5_guard_inventory_row() from public, anon, authenticated;
revoke all on function private.phase5_guard_equipment_row() from public, anon, authenticated;
revoke all on function private.phase5_guard_reward_ticket_row() from public, anon, authenticated;
revoke all on function private.phase5_reject_economy_history_update() from public, anon, authenticated;

create index player_inventory_item_key_idx on public.player_inventory(item_key);
create index player_inventory_user_updated_idx on public.player_inventory(user_id, updated_at desc);
create index player_equipment_item_key_idx on public.player_equipment(item_key);
create index player_reward_tickets_user_status_idx on public.player_reward_tickets(user_id, status, issued_at desc);
create index player_reward_tickets_ticket_key_idx on public.player_reward_tickets(ticket_key);
create index player_reward_tickets_acquisition_transaction_idx on public.player_reward_tickets(acquisition_transaction_id);
create index economy_transactions_user_created_idx on public.economy_transactions(user_id, created_at desc);
create index economy_transactions_item_key_idx on public.economy_transactions(item_key) where item_key is not null;
create index economy_transactions_ticket_id_idx on public.economy_transactions(ticket_id) where ticket_id is not null;
create index economy_transactions_reversal_idx on public.economy_transactions(reversal_of_transaction_id)
  where reversal_of_transaction_id is not null;
create index item_catalog_active_type_idx on public.item_catalog(active, item_type, display_name);

alter table public.item_catalog enable row level security;
alter table public.player_inventory enable row level security;
alter table public.player_equipment enable row level security;
alter table public.player_reward_tickets enable row level security;
alter table public.economy_transactions enable row level security;

create policy item_catalog_select_active on public.item_catalog
  for select to authenticated using (active = true);
create policy player_inventory_select_own on public.player_inventory
  for select to authenticated using ((select auth.uid()) = user_id);
create policy player_equipment_select_own on public.player_equipment
  for select to authenticated using ((select auth.uid()) = user_id);
create policy player_reward_tickets_select_own on public.player_reward_tickets
  for select to authenticated using ((select auth.uid()) = user_id);
create policy economy_transactions_select_own on public.economy_transactions
  for select to authenticated using ((select auth.uid()) = user_id);

revoke all on table
  public.item_catalog, public.player_inventory, public.player_equipment,
  public.player_reward_tickets, public.economy_transactions
from public, anon, authenticated;

grant select on table
  public.item_catalog, public.player_inventory, public.player_equipment,
  public.player_reward_tickets, public.economy_transactions
to authenticated;

revoke insert, update, delete, truncate, references, trigger on table
  public.item_catalog, public.player_inventory, public.player_equipment,
  public.player_reward_tickets, public.economy_transactions
from authenticated;

grant select, insert, update, delete on table
  public.item_catalog, public.player_inventory, public.player_equipment,
  public.player_reward_tickets, public.economy_transactions
to service_role;

comment on function private.phase5_guard_inventory_row() is 'Enforces potion stack 99 and unique equipment inventory invariants.';
comment on function private.phase5_guard_equipment_row() is 'Requires an owned equippable item whose catalog slot matches weapon, armor or pet.';
comment on function private.phase5_reject_economy_history_update() is 'Keeps economy transaction history append-only while still permitting user deletion cascades.';
