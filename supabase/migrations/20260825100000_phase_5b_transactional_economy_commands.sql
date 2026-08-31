-- LifeQuest Phase 5B: transactional server-authoritative economy commands.
-- Member supply UI remains gated; writes are reachable only through the verified Edge runtime.

update public.item_catalog
set member_effects = '{"healAmount":15}'::jsonb, updated_at = now()
where item_key = 'potion_red';

create or replace function private.phase5b_equipment_modifiers(p_user_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'health', coalesce(sum((c.equipment_modifiers ->> 'health')::integer), 0),
    'energy', coalesce(sum((c.equipment_modifiers ->> 'energy')::integer), 0),
    'wealth', coalesce(sum((c.equipment_modifiers ->> 'wealth')::integer), 0),
    'growth', coalesce(sum((c.equipment_modifiers ->> 'growth')::integer), 0)
  )
  from public.player_equipment e
  join public.item_catalog c on c.item_key = e.item_key
  where e.user_id = p_user_id
$$;

create or replace function private.phase5b_active_status_modifiers(p_user_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'health', coalesce(sum((s.modifier_snapshot ->> 'health')::integer), 0),
    'energy', coalesce(sum((s.modifier_snapshot ->> 'energy')::integer), 0),
    'wealth', coalesce(sum((s.modifier_snapshot ->> 'wealth')::integer), 0),
    'growth', coalesce(sum((s.modifier_snapshot ->> 'growth')::integer), 0)
  )
  from public.status_effects s
  where s.user_id = p_user_id
    and s.state = 'active'
    and s.expires_on > (now() at time zone 'Asia/Taipei')::date
$$;

create or replace function private.phase5b_economy_state(p_user_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with equipment_modifiers as (
    select private.phase5b_equipment_modifiers(p_user_id) value
  ), status_modifiers as (
    select private.phase5b_active_status_modifiers(p_user_id) value
  )
  select jsonb_build_object(
    'inventory', coalesce((
      select jsonb_agg(jsonb_build_object(
        'itemKey', i.item_key, 'displayName', c.display_name, 'itemType', c.item_type,
        'quantity', i.quantity, 'acquiredAt', i.acquired_at, 'updatedAt', i.updated_at
      ) order by c.item_type, c.display_name)
      from public.player_inventory i
      join public.item_catalog c on c.item_key = i.item_key
      where i.user_id = p_user_id
    ), '[]'::jsonb),
    'equipment', coalesce((
      select jsonb_agg(jsonb_build_object(
        'slot', e.slot, 'itemKey', e.item_key, 'displayName', c.display_name,
        'equipmentModifiers', c.equipment_modifiers, 'memberEffects', c.member_effects,
        'equippedAt', e.equipped_at, 'updatedAt', e.updated_at
      ) order by e.slot)
      from public.player_equipment e
      join public.item_catalog c on c.item_key = e.item_key
      where e.user_id = p_user_id
    ), '[]'::jsonb),
    'rewardTickets', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'ticketKey', t.ticket_key, 'name', t.name_snapshot,
        'status', t.status, 'gemCost', t.gem_cost_snapshot,
        'catalogVersion', t.catalog_version_snapshot, 'issuedAt', t.issued_at,
        'usedAt', t.used_at, 'reversedAt', t.reversed_at, 'updatedAt', t.updated_at
      ) order by t.issued_at desc)
      from public.player_reward_tickets t where t.user_id = p_user_id
    ), '[]'::jsonb),
    'economySummary', jsonb_build_object(
      'gold', coalesce((select gold from public.player_states where user_id = p_user_id), 0),
      'gems', coalesce((select gems from public.player_states where user_id = p_user_id), 0),
      'transactionCount', (select count(*) from public.economy_transactions where user_id = p_user_id),
      'itemsVersion', 'items-v1', 'economyVersion', 'economy-v1'
    ),
    'derivedEquipmentModifiers', (select value from equipment_modifiers),
    'derivedStats', (
      select jsonb_build_object(
        'health', s.base_health + (em.value ->> 'health')::integer + (sm.value ->> 'health')::integer,
        'energy', s.base_energy + (em.value ->> 'energy')::integer + (sm.value ->> 'energy')::integer,
        'wealth', s.base_wealth + (em.value ->> 'wealth')::integer + (sm.value ->> 'wealth')::integer,
        'growth', s.base_growth + (em.value ->> 'growth')::integer + (sm.value ->> 'growth')::integer
      )
      from public.player_states s cross join equipment_modifiers em cross join status_modifiers sm
      where s.user_id = p_user_id
    ),
    'recentEconomyTransactions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', x.id, 'operationId', x.operation_id, 'type', x.transaction_type,
        'itemKey', x.item_key, 'ticketId', x.ticket_id, 'quantity', x.quantity,
        'currency', x.currency_type, 'currencyDelta', x.currency_delta,
        'basePrice', x.base_price_snapshot, 'paidAmount', x.paid_amount_snapshot,
        'itemName', x.item_name_snapshot, 'catalogVersion', x.catalog_version_snapshot,
        'discount', x.discount_snapshot, 'detail', x.detail_snapshot, 'createdAt', x.created_at
      ) order by x.created_at desc)
      from (select * from public.economy_transactions
        where user_id = p_user_id order by created_at desc limit 30) x
    ), '[]'::jsonb)
  );
$$;

create or replace function public.get_phase5b_economy_state(p_user_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$ select private.phase5b_economy_state(p_user_id) $$;

revoke all on function private.phase5b_equipment_modifiers(uuid) from public, anon, authenticated;
revoke all on function private.phase5b_active_status_modifiers(uuid) from public, anon, authenticated;
revoke all on function private.phase5b_economy_state(uuid) from public, anon, authenticated;
revoke all on function public.get_phase5b_economy_state(uuid) from public, anon, authenticated;
grant execute on function private.phase5b_equipment_modifiers(uuid) to service_role;
grant execute on function private.phase5b_active_status_modifiers(uuid) to service_role;
grant execute on function private.phase5b_economy_state(uuid) to service_role;
grant execute on function public.get_phase5b_economy_state(uuid) to service_role;

create or replace function private.phase5b_validate_daily_equipment_effect()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_expected bigint;
  v_supplied bigint;
begin
  select coalesce((c.member_effects ->> 'settlementGoldBonus')::bigint, 0)
    into v_expected
  from public.player_equipment e
  join public.item_catalog c on c.item_key = e.item_key
  where e.user_id = new.user_id and e.slot = 'pet' and c.active;
  v_expected := coalesce(v_expected, 0);
  v_supplied := coalesce((new.settlement_snapshot #>> '{equipmentEffects,settlementGoldBonus}')::bigint, 0);
  if v_supplied <> v_expected then
    raise exception 'PHASE5_EQUIPMENT_SETTLEMENT_MISMATCH';
  end if;
  return new;
end;
$$;

create trigger daily_entry_revision_equipment_effect_guard
before insert on public.daily_entry_revisions
for each row execute function private.phase5b_validate_daily_equipment_effect();

revoke all on function private.phase5b_validate_daily_equipment_effect() from public, anon, authenticated;

create or replace function private.execute_phase5b_economy_command(
  p_user_id uuid,
  p_command jsonb,
  p_expected_version bigint
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_type text := p_command ->> 'type';
  v_operation_id text := p_command ->> 'operationId';
  v_payload jsonb := p_command -> 'payload';
  v_request_hash text;
  v_reserved jsonb;
  v_completed jsonb;
  v_operation_version bigint;
  v_current_version bigint;
  v_result jsonb := '{}'::jsonb;
  v_catalog public.item_catalog%rowtype;
  v_player public.player_states%rowtype;
  v_inventory public.player_inventory%rowtype;
  v_ticket public.player_reward_tickets%rowtype;
  v_base_wealth bigint;
  v_discount numeric;
  v_final_price bigint;
  v_heal bigint;
  v_max_hp bigint;
  v_transaction_id uuid := gen_random_uuid();
  v_ticket_id uuid := gen_random_uuid();
  v_existing_item text;
  v_slot text;
  v_keys text[];
begin
  if p_user_id is null or p_command is null or jsonb_typeof(p_command) <> 'object'
    or v_type not in ('PURCHASE_ITEM', 'USE_ITEM', 'EQUIP_ITEM', 'UNEQUIP_ITEM',
      'REDEEM_REWARD_TICKET', 'USE_REWARD_TICKET', 'REVERSE_REWARD_TICKET')
    or p_command ->> 'contractVersion' <> '1'
    or v_operation_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$'
    or p_expected_version is null or p_expected_version < 0
    or jsonb_typeof(v_payload) <> 'object' then
    return jsonb_build_object('ok', false, 'errorCode', 'INVALID_PAYLOAD');
  end if;

  select array_agg(key order by key) into v_keys from jsonb_object_keys(v_payload) key;
  if v_type in ('PURCHASE_ITEM', 'REDEEM_REWARD_TICKET') then
    if not ((v_keys = array[case when v_type = 'PURCHASE_ITEM' then 'itemKey' else 'ticketKey' end])
      or (v_keys = array[case when v_type = 'PURCHASE_ITEM' then 'itemKey' else 'ticketKey' end, 'seenCatalogVersion']))
      or coalesce(v_payload ->> case when v_type = 'PURCHASE_ITEM' then 'itemKey' else 'ticketKey' end, '')
        !~ '^[a-z][a-z0-9_]{1,63}$'
      or (v_payload ? 'seenCatalogVersion' and (v_payload ->> 'seenCatalogVersion') !~ '^[1-9][0-9]*$') then
      return jsonb_build_object('ok', false, 'errorCode', 'INVALID_PAYLOAD');
    end if;
  elsif v_type in ('USE_ITEM', 'EQUIP_ITEM') then
    if v_keys <> array['itemKey'] or coalesce(v_payload ->> 'itemKey', '') !~ '^[a-z][a-z0-9_]{1,63}$' then
      return jsonb_build_object('ok', false, 'errorCode', 'INVALID_PAYLOAD');
    end if;
  elsif v_type = 'UNEQUIP_ITEM' then
    if v_keys <> array['slot'] or v_payload ->> 'slot' not in ('weapon', 'armor', 'pet') then
      return jsonb_build_object('ok', false, 'errorCode', 'INVALID_PAYLOAD');
    end if;
  else
    if v_keys <> array['ticketInstanceId']
      or coalesce(v_payload ->> 'ticketInstanceId', '') !~ '^[0-9a-fA-F-]{36}$' then
      return jsonb_build_object('ok', false, 'errorCode', 'INVALID_PAYLOAD');
    end if;
  end if;

  v_request_hash := encode(extensions.digest(convert_to(p_command::text, 'UTF8'), 'sha256'), 'hex');
  v_reserved := private.phase4_reserve_operation(
    p_user_id, v_operation_id, v_type, v_request_hash, p_expected_version
  );
  if v_reserved ->> 'ok' <> 'true' then return v_reserved; end if;
  if coalesce((v_reserved ->> 'duplicate')::boolean, false) then
    select repository_version into v_current_version
      from public.member_game_roots where user_id = p_user_id;
    v_operation_version := coalesce((v_reserved ->> 'repositoryVersion')::bigint, v_current_version);
    return v_reserved || jsonb_build_object(
      'operationId', v_operation_id,
      'operationRepositoryVersion', v_operation_version,
      'repositoryVersion', v_current_version,
      'state', private.phase4b_state(p_user_id) || private.phase5b_economy_state(p_user_id),
      'serverTimestamp', now(), 'duplicate', true
    );
  end if;

  select * into v_player from public.player_states where user_id = p_user_id for update;

  if v_type in ('PURCHASE_ITEM', 'REDEEM_REWARD_TICKET') then
    select * into v_catalog from public.item_catalog
      where item_key = v_payload ->> case when v_type = 'PURCHASE_ITEM' then 'itemKey' else 'ticketKey' end
      for share;
    if not found then
      delete from private.command_operations where user_id = p_user_id and operation_id = v_operation_id;
      return jsonb_build_object('ok', false, 'errorCode', 'ITEM_NOT_FOUND');
    end if;
    if not v_catalog.active then
      delete from private.command_operations where user_id = p_user_id and operation_id = v_operation_id;
      return jsonb_build_object('ok', false, 'errorCode', 'ITEM_NOT_AVAILABLE');
    end if;
    if v_payload ? 'seenCatalogVersion'
      and (v_payload ->> 'seenCatalogVersion')::bigint <> v_catalog.catalog_version then
      delete from private.command_operations where user_id = p_user_id and operation_id = v_operation_id;
      return jsonb_build_object('ok', false, 'errorCode', 'CATALOG_CHANGED');
    end if;
  end if;

  if v_type = 'PURCHASE_ITEM' then
    if v_catalog.item_type = 'reward_ticket' or v_catalog.currency_type <> 'gold' then
      delete from private.command_operations where user_id = p_user_id and operation_id = v_operation_id;
      return jsonb_build_object('ok', false, 'errorCode', 'ITEM_NOT_AVAILABLE');
    end if;
    v_base_wealth := v_player.base_wealth;
    v_discount := least(v_base_wealth * 0.01, 0.20);
    v_final_price := floor(v_catalog.base_price * (1 - v_discount));
    if v_player.gold < v_final_price then
      delete from private.command_operations where user_id = p_user_id and operation_id = v_operation_id;
      return jsonb_build_object('ok', false, 'errorCode', 'INSUFFICIENT_RESOURCE');
    end if;
    select * into v_inventory from public.player_inventory
      where user_id = p_user_id and item_key = v_catalog.item_key for update;
    if v_catalog.item_type = 'potion' and found and v_inventory.quantity >= 99 then
      delete from private.command_operations where user_id = p_user_id and operation_id = v_operation_id;
      return jsonb_build_object('ok', false, 'errorCode', 'INVENTORY_LIMIT_REACHED');
    end if;
    if v_catalog.item_type in ('weapon', 'armor', 'pet') and found then
      delete from private.command_operations where user_id = p_user_id and operation_id = v_operation_id;
      return jsonb_build_object('ok', false, 'errorCode', 'ITEM_ALREADY_OWNED');
    end if;
    update public.player_states set gold = gold - v_final_price, updated_at = now() where user_id = p_user_id;
    insert into public.player_inventory(user_id, item_key, quantity)
      values (p_user_id, v_catalog.item_key, 1)
      on conflict (user_id, item_key) do update
      set quantity = public.player_inventory.quantity + 1, updated_at = now();
    insert into public.economy_transactions(
      id, user_id, operation_id, transaction_type, item_key, currency_type, currency_delta,
      base_price_snapshot, discount_snapshot, paid_amount_snapshot, item_name_snapshot,
      catalog_version_snapshot, detail_snapshot
    ) values (
      v_transaction_id, p_user_id, v_operation_id, 'purchase_item', v_catalog.item_key,
      'gold', -v_final_price, v_catalog.base_price,
      jsonb_build_object('baseWealth', v_base_wealth, 'rate', v_discount), v_final_price,
      v_catalog.display_name, v_catalog.catalog_version,
      jsonb_build_object('itemType', v_catalog.item_type, 'effectKey', v_catalog.effect_key)
    );
    insert into public.resource_ledger(user_id, resource_type, delta, balance_after, reason,
      source_type, source_id, operation_id)
    values (p_user_id, 'gold', -v_final_price, v_player.gold - v_final_price, 'item_purchase',
      'economy_transaction', v_transaction_id::text, v_operation_id);
    v_result := jsonb_build_object('transactionId', v_transaction_id, 'itemKey', v_catalog.item_key,
      'quantity', coalesce(v_inventory.quantity, 0) + 1, 'paidAmount', v_final_price,
      'currency', 'gold', 'catalogVersion', v_catalog.catalog_version);

  elsif v_type = 'USE_ITEM' then
    select * into v_catalog from public.item_catalog
      where item_key = v_payload ->> 'itemKey' and active for share;
    if not found then
      delete from private.command_operations where user_id = p_user_id and operation_id = v_operation_id;
      return jsonb_build_object('ok', false, 'errorCode', 'ITEM_NOT_FOUND');
    end if;
    if v_catalog.item_type <> 'potion' or not v_catalog.usable then
      delete from private.command_operations where user_id = p_user_id and operation_id = v_operation_id;
      return jsonb_build_object('ok', false, 'errorCode', 'ITEM_NOT_USABLE');
    end if;
    select * into v_inventory from public.player_inventory
      where user_id = p_user_id and item_key = v_catalog.item_key for update;
    if not found then
      delete from private.command_operations where user_id = p_user_id and operation_id = v_operation_id;
      return jsonb_build_object('ok', false, 'errorCode', 'ITEM_NOT_OWNED');
    end if;
    v_max_hp := private.max_hp_v1(v_player.total_xp);
    if v_player.hp >= v_max_hp then
      delete from private.command_operations where user_id = p_user_id and operation_id = v_operation_id;
      return jsonb_build_object('ok', false, 'errorCode', 'HP_ALREADY_FULL');
    end if;
    v_heal := least(coalesce((v_catalog.member_effects ->> 'healAmount')::bigint, 0), v_max_hp - v_player.hp);
    if v_heal <= 0 then
      delete from private.command_operations where user_id = p_user_id and operation_id = v_operation_id;
      return jsonb_build_object('ok', false, 'errorCode', 'ITEM_NOT_USABLE');
    end if;
    update public.player_states set hp = hp + v_heal, updated_at = now() where user_id = p_user_id;
    if v_inventory.quantity = 1 then
      delete from public.player_inventory where user_id = p_user_id and item_key = v_catalog.item_key;
    else
      update public.player_inventory set quantity = quantity - 1, updated_at = now()
        where user_id = p_user_id and item_key = v_catalog.item_key;
    end if;
    insert into public.economy_transactions(id, user_id, operation_id, transaction_type,
      item_key, item_name_snapshot, catalog_version_snapshot, detail_snapshot)
    values (v_transaction_id, p_user_id, v_operation_id, 'use_item', v_catalog.item_key,
      v_catalog.display_name, v_catalog.catalog_version,
      jsonb_build_object('healAmount', v_heal, 'hpBefore', v_player.hp, 'hpAfter', v_player.hp + v_heal));
    insert into public.resource_ledger(user_id, resource_type, delta, balance_after, reason,
      source_type, source_id, operation_id)
    values (p_user_id, 'hp', v_heal, v_player.hp + v_heal, 'item_use',
      'economy_transaction', v_transaction_id::text, v_operation_id);
    v_result := jsonb_build_object('transactionId', v_transaction_id, 'itemKey', v_catalog.item_key,
      'healed', v_heal, 'hp', v_player.hp + v_heal, 'maxHp', v_max_hp);

  elsif v_type = 'EQUIP_ITEM' then
    select * into v_catalog from public.item_catalog
      where item_key = v_payload ->> 'itemKey' and active for share;
    if not found then
      delete from private.command_operations where user_id = p_user_id and operation_id = v_operation_id;
      return jsonb_build_object('ok', false, 'errorCode', 'ITEM_NOT_FOUND');
    end if;
    if not v_catalog.equippable or v_catalog.equipment_slot not in ('weapon', 'armor', 'pet') then
      delete from private.command_operations where user_id = p_user_id and operation_id = v_operation_id;
      return jsonb_build_object('ok', false, 'errorCode', 'ITEM_NOT_EQUIPPABLE');
    end if;
    select * into v_inventory from public.player_inventory
      where user_id = p_user_id and item_key = v_catalog.item_key for update;
    if not found then
      delete from private.command_operations where user_id = p_user_id and operation_id = v_operation_id;
      return jsonb_build_object('ok', false, 'errorCode', 'ITEM_NOT_OWNED');
    end if;
    v_slot := v_catalog.equipment_slot;
    select item_key into v_existing_item from public.player_equipment
      where user_id = p_user_id and slot = v_slot for update;
    insert into public.player_equipment(user_id, slot, item_key)
      values (p_user_id, v_slot, v_catalog.item_key)
      on conflict (user_id, slot) do update
      set item_key = excluded.item_key, equipped_at = now(), updated_at = now();
    insert into public.economy_transactions(id, user_id, operation_id, transaction_type,
      item_key, item_name_snapshot, catalog_version_snapshot, detail_snapshot)
    values (v_transaction_id, p_user_id, v_operation_id, 'equip_item', v_catalog.item_key,
      v_catalog.display_name, v_catalog.catalog_version,
      jsonb_build_object('slot', v_slot, 'previousItemKey', v_existing_item,
        'equipmentModifiers', v_catalog.equipment_modifiers, 'memberEffects', v_catalog.member_effects));
    v_result := jsonb_build_object('transactionId', v_transaction_id, 'itemKey', v_catalog.item_key,
      'slot', v_slot, 'previousItemKey', v_existing_item);

  elsif v_type = 'UNEQUIP_ITEM' then
    v_slot := v_payload ->> 'slot';
    select item_key into v_existing_item from public.player_equipment
      where user_id = p_user_id and slot = v_slot for update;
    if not found then
      delete from private.command_operations where user_id = p_user_id and operation_id = v_operation_id;
      return jsonb_build_object('ok', false, 'errorCode', 'ITEM_NOT_OWNED');
    end if;
    delete from public.player_equipment where user_id = p_user_id and slot = v_slot;
    select * into v_catalog from public.item_catalog where item_key = v_existing_item;
    insert into public.economy_transactions(id, user_id, operation_id, transaction_type,
      item_key, item_name_snapshot, catalog_version_snapshot, detail_snapshot)
    values (v_transaction_id, p_user_id, v_operation_id, 'unequip_item', v_existing_item,
      v_catalog.display_name, v_catalog.catalog_version, jsonb_build_object('slot', v_slot));
    v_result := jsonb_build_object('transactionId', v_transaction_id, 'itemKey', v_existing_item,
      'slot', v_slot, 'unequipped', true);

  elsif v_type = 'REDEEM_REWARD_TICKET' then
    if v_catalog.item_type <> 'reward_ticket' or v_catalog.currency_type <> 'gems' then
      delete from private.command_operations where user_id = p_user_id and operation_id = v_operation_id;
      return jsonb_build_object('ok', false, 'errorCode', 'ITEM_NOT_AVAILABLE');
    end if;
    if v_player.gems < v_catalog.base_price then
      delete from private.command_operations where user_id = p_user_id and operation_id = v_operation_id;
      return jsonb_build_object('ok', false, 'errorCode', 'INSUFFICIENT_RESOURCE');
    end if;
    update public.player_states set gems = gems - v_catalog.base_price, updated_at = now() where user_id = p_user_id;
    insert into public.economy_transactions(
      id, user_id, operation_id, transaction_type, item_key, ticket_id,
      currency_type, currency_delta, base_price_snapshot, paid_amount_snapshot,
      item_name_snapshot, catalog_version_snapshot, detail_snapshot
    ) values (
      v_transaction_id, p_user_id, v_operation_id, 'redeem_reward_ticket', v_catalog.item_key, v_ticket_id,
      'gems', -v_catalog.base_price, v_catalog.base_price, v_catalog.base_price,
      v_catalog.display_name, v_catalog.catalog_version,
      jsonb_build_object('effectKey', v_catalog.effect_key)
    );
    insert into public.player_reward_tickets(
      id, user_id, ticket_key, name_snapshot, gem_cost_snapshot,
      catalog_version_snapshot, source_operation_id, acquisition_transaction_id
    ) values (
      v_ticket_id, p_user_id, v_catalog.item_key, v_catalog.display_name, v_catalog.base_price,
      v_catalog.catalog_version, v_operation_id, v_transaction_id
    );
    insert into public.resource_ledger(user_id, resource_type, delta, balance_after, reason,
      source_type, source_id, operation_id)
    values (p_user_id, 'gems', -v_catalog.base_price, v_player.gems - v_catalog.base_price,
      'ticket_redemption', 'reward_ticket', v_ticket_id::text, v_operation_id);
    v_result := jsonb_build_object('transactionId', v_transaction_id,
      'ticketInstanceId', v_ticket_id, 'ticketKey', v_catalog.item_key,
      'paidAmount', v_catalog.base_price, 'currency', 'gems');

  else
    begin
      select * into v_ticket from public.player_reward_tickets
        where id = (v_payload ->> 'ticketInstanceId')::uuid and user_id = p_user_id for update;
    exception when invalid_text_representation then
      delete from private.command_operations where user_id = p_user_id and operation_id = v_operation_id;
      return jsonb_build_object('ok', false, 'errorCode', 'INVALID_PAYLOAD');
    end;
    if not found then
      delete from private.command_operations where user_id = p_user_id and operation_id = v_operation_id;
      return jsonb_build_object('ok', false, 'errorCode', 'TICKET_NOT_FOUND');
    end if;
    if v_ticket.status <> 'unused' then
      delete from private.command_operations where user_id = p_user_id and operation_id = v_operation_id;
      return jsonb_build_object('ok', false, 'errorCode', 'TICKET_ALREADY_USED');
    end if;
    select * into v_catalog from public.item_catalog where item_key = v_ticket.ticket_key;
    if v_type = 'USE_REWARD_TICKET' then
      update public.player_reward_tickets set status = 'used', used_at = now(), updated_at = now()
        where id = v_ticket.id;
      insert into public.economy_transactions(id, user_id, operation_id, transaction_type,
        item_key, ticket_id, item_name_snapshot, catalog_version_snapshot, detail_snapshot)
      values (v_transaction_id, p_user_id, v_operation_id, 'use_reward_ticket',
        v_ticket.ticket_key, v_ticket.id, v_ticket.name_snapshot, v_ticket.catalog_version_snapshot,
        jsonb_build_object('issuedAt', v_ticket.issued_at));
      v_result := jsonb_build_object('transactionId', v_transaction_id,
        'ticketInstanceId', v_ticket.id, 'status', 'used');
    else
      update public.player_states set gems = gems + v_ticket.gem_cost_snapshot, updated_at = now()
        where user_id = p_user_id;
      update public.player_reward_tickets set status = 'reversed', reversed_at = now(), updated_at = now()
        where id = v_ticket.id;
      insert into public.economy_transactions(id, user_id, operation_id, transaction_type,
        item_key, ticket_id, currency_type, currency_delta, base_price_snapshot,
        paid_amount_snapshot, item_name_snapshot, catalog_version_snapshot,
        reversal_of_transaction_id, detail_snapshot)
      values (v_transaction_id, p_user_id, v_operation_id, 'reverse_reward_ticket',
        v_ticket.ticket_key, v_ticket.id, 'gems', v_ticket.gem_cost_snapshot,
        v_ticket.gem_cost_snapshot, v_ticket.gem_cost_snapshot, v_ticket.name_snapshot,
        v_ticket.catalog_version_snapshot, v_ticket.acquisition_transaction_id,
        jsonb_build_object('refundFromSnapshot', true));
      insert into public.resource_ledger(user_id, resource_type, delta, balance_after, reason,
        source_type, source_id, operation_id)
      values (p_user_id, 'gems', v_ticket.gem_cost_snapshot,
        v_player.gems + v_ticket.gem_cost_snapshot, 'ticket_refund',
        'reward_ticket', v_ticket.id::text, v_operation_id);
      v_result := jsonb_build_object('transactionId', v_transaction_id,
        'ticketInstanceId', v_ticket.id, 'status', 'reversed',
        'refundedGems', v_ticket.gem_cost_snapshot);
    end if;
  end if;

  v_completed := private.phase4_complete_operation(
    p_user_id, v_operation_id,
    jsonb_build_object('operationId', v_operation_id, 'result', v_result, 'serverTimestamp', now())
  );
  if v_completed ->> 'ok' <> 'true' then return v_completed; end if;
  v_operation_version := (v_completed ->> 'repositoryVersion')::bigint;
  return v_completed || jsonb_build_object(
    'operationRepositoryVersion', v_operation_version,
    'state', private.phase4b_state(p_user_id) || private.phase5b_economy_state(p_user_id),
    'serverTimestamp', now()
  );
end;
$$;

create or replace function public.execute_phase5b_economy_command(
  p_user_id uuid,
  p_command jsonb,
  p_expected_version bigint
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.execute_phase5b_economy_command(p_user_id, p_command, p_expected_version) $$;

revoke all on function private.execute_phase5b_economy_command(uuid, jsonb, bigint)
  from public, anon, authenticated;
revoke all on function public.execute_phase5b_economy_command(uuid, jsonb, bigint)
  from public, anon, authenticated;
grant execute on function private.execute_phase5b_economy_command(uuid, jsonb, bigint) to service_role;
grant execute on function public.execute_phase5b_economy_command(uuid, jsonb, bigint) to service_role;

comment on function public.execute_phase5b_economy_command(uuid, jsonb, bigint) is
  'Phase 5B service-only transactional economy command; ownership comes from verified Edge Auth.';
comment on function public.get_phase5b_economy_state(uuid) is
  'Phase 5B service-only economy projection for the verified member bootstrap.';
