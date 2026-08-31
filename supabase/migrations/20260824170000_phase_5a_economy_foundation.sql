-- LifeQuest Phase 5A: authoritative economy storage only.
-- No member economy command is exposed by this migration.

create table public.item_catalog (
  item_key text primary key,
  display_name text not null,
  description text not null,
  item_type text not null,
  rarity text not null default 'common',
  currency_type text not null,
  base_price bigint not null,
  catalog_version bigint not null default 1,
  items_version text not null default 'items-v1',
  economy_version text not null default 'economy-v1',
  stackable boolean not null default false,
  max_stack integer,
  usable boolean not null default false,
  equippable boolean not null default false,
  equipment_slot text,
  effect_key text not null,
  equipment_modifiers jsonb not null default '{}'::jsonb,
  member_effects jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint item_catalog_key_format check (item_key ~ '^[a-z][a-z0-9_]{1,63}$'),
  constraint item_catalog_name check (char_length(btrim(display_name)) between 1 and 80),
  constraint item_catalog_description check (char_length(btrim(description)) between 1 and 240),
  constraint item_catalog_type check (item_type in ('potion', 'weapon', 'armor', 'pet', 'reward_ticket')),
  constraint item_catalog_rarity check (rarity in ('common', 'uncommon', 'rare', 'epic', 'legendary')),
  constraint item_catalog_currency check (currency_type in ('gold', 'gems')),
  constraint item_catalog_price check (base_price > 0),
  constraint item_catalog_version_positive check (catalog_version >= 1),
  constraint item_catalog_definition_versions check (items_version = 'items-v1' and economy_version = 'economy-v1'),
  constraint item_catalog_effect_key check (effect_key ~ '^[a-z][a-z0-9_]{1,95}$'),
  constraint item_catalog_equipment_modifiers_object check (jsonb_typeof(equipment_modifiers) = 'object'),
  constraint item_catalog_member_effects_object check (jsonb_typeof(member_effects) = 'object'),
  constraint item_catalog_currency_by_type check (
    (item_type = 'reward_ticket' and currency_type = 'gems')
    or (item_type <> 'reward_ticket' and currency_type = 'gold')
  ),
  constraint item_catalog_inventory_shape check (
    (item_type = 'potion' and stackable and max_stack = 99 and usable and not equippable and equipment_slot is null)
    or (item_type in ('weapon', 'armor', 'pet') and not stackable and max_stack = 1
      and not usable and equippable and equipment_slot = item_type)
    or (item_type = 'reward_ticket' and not stackable and max_stack = 1
      and not usable and not equippable and equipment_slot is null)
  )
);

create table public.player_inventory (
  user_id uuid not null references auth.users(id) on delete cascade,
  item_key text not null references public.item_catalog(item_key) on delete restrict,
  quantity integer not null,
  acquired_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, item_key),
  constraint player_inventory_quantity check (quantity between 1 and 99)
);

create table public.player_equipment (
  user_id uuid not null references auth.users(id) on delete cascade,
  slot text not null,
  item_key text not null,
  equipped_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, slot),
  constraint player_equipment_item_unique unique (user_id, item_key),
  constraint player_equipment_slot check (slot in ('weapon', 'armor', 'pet')),
  constraint player_equipment_owned_item_fk foreign key (user_id, item_key)
    references public.player_inventory(user_id, item_key) on delete restrict
);

create table public.player_reward_tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ticket_key text not null references public.item_catalog(item_key) on delete restrict,
  status text not null default 'unused',
  name_snapshot text not null,
  gem_cost_snapshot bigint not null,
  catalog_version_snapshot bigint not null,
  items_version text not null default 'items-v1',
  economy_version text not null default 'economy-v1',
  source_operation_id text not null,
  acquisition_transaction_id uuid not null,
  issued_at timestamptz not null default now(),
  used_at timestamptz,
  reversed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint player_reward_tickets_id_user unique (id, user_id),
  constraint player_reward_tickets_operation_unique unique (user_id, source_operation_id),
  constraint player_reward_tickets_status check (status in ('unused', 'used', 'reversed')),
  constraint player_reward_tickets_cost check (gem_cost_snapshot > 0),
  constraint player_reward_tickets_catalog_version check (catalog_version_snapshot >= 1),
  constraint player_reward_tickets_definition_versions check (items_version = 'items-v1' and economy_version = 'economy-v1'),
  constraint player_reward_tickets_operation_format check (source_operation_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$'),
  constraint player_reward_tickets_state_timestamps check (
    (status = 'unused' and used_at is null and reversed_at is null)
    or (status = 'used' and used_at is not null and reversed_at is null)
    or (status = 'reversed' and used_at is null and reversed_at is not null)
  )
);

create table public.economy_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  operation_id text not null,
  transaction_type text not null,
  item_key text references public.item_catalog(item_key) on delete restrict,
  ticket_id uuid,
  quantity integer not null default 1,
  currency_type text,
  currency_delta bigint,
  base_price_snapshot bigint,
  discount_snapshot jsonb not null default '{}'::jsonb,
  paid_amount_snapshot bigint,
  item_name_snapshot text,
  catalog_version_snapshot bigint,
  items_version text not null default 'items-v1',
  economy_version text not null default 'economy-v1',
  reversal_of_transaction_id uuid,
  detail_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint economy_transactions_id_user unique (id, user_id),
  constraint economy_transactions_operation_unique unique (user_id, operation_id, transaction_type),
  constraint economy_transactions_type check (transaction_type in (
    'purchase_item', 'use_item', 'equip_item', 'unequip_item',
    'redeem_reward_ticket', 'use_reward_ticket', 'reverse_reward_ticket',
    'reward_grant', 'compensation'
  )),
  constraint economy_transactions_quantity check (quantity between 1 and 99),
  constraint economy_transactions_currency check (currency_type is null or currency_type in ('gold', 'gems')),
  constraint economy_transactions_currency_pair check ((currency_type is null) = (currency_delta is null)),
  constraint economy_transactions_snapshot_values check (
    (base_price_snapshot is null or base_price_snapshot > 0)
    and (paid_amount_snapshot is null or paid_amount_snapshot >= 0)
    and (catalog_version_snapshot is null or catalog_version_snapshot >= 1)
  ),
  constraint economy_transactions_definition_versions check (items_version = 'items-v1' and economy_version = 'economy-v1'),
  constraint economy_transactions_operation_format check (operation_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$'),
  constraint economy_transactions_discount_object check (jsonb_typeof(discount_snapshot) = 'object'),
  constraint economy_transactions_detail_object check (jsonb_typeof(detail_snapshot) = 'object'),
  constraint economy_transactions_reversal_not_self check (reversal_of_transaction_id is null or reversal_of_transaction_id <> id),
  constraint economy_transactions_reversal_fk foreign key (reversal_of_transaction_id, user_id)
    references public.economy_transactions(id, user_id) deferrable initially deferred
);

alter table public.player_reward_tickets
  add constraint player_reward_tickets_acquisition_transaction_fk
  foreign key (acquisition_transaction_id, user_id)
  references public.economy_transactions(id, user_id)
  deferrable initially deferred;

alter table public.economy_transactions
  add constraint economy_transactions_ticket_fk
  foreign key (ticket_id, user_id)
  references public.player_reward_tickets(id, user_id)
  deferrable initially deferred;

comment on table public.item_catalog is 'Server-owned items-v1 catalog. Browsers may read active rows but cannot write.';
comment on table public.player_inventory is 'Authoritative member inventory quantities; potion stacks and unique equipment only.';
comment on table public.player_equipment is 'Authoritative equipped slot projection for weapon, armor and pet.';
comment on table public.player_reward_tickets is 'Self-reward permits purchased with Gems; unused tickets alone may be reversed later.';
comment on table public.economy_transactions is 'Append-only economy audit snapshots. No Phase 5A command writes rows yet.';
