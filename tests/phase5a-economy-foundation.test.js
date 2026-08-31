const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const economyPromise = import('../supabase/functions/_shared/phase5EconomyDomain.mjs');
const BackendContract = require('../backendContract.js');

test('Phase 5A pins the accepted economy and catalog definition versions', async () => {
  const domain = await economyPromise;
  assert.deepEqual(domain.PHASE5_DEFINITION_VERSIONS, {
    items: 'items-v1',
    economy: 'economy-v1'
  });
});

test('items-v1 contains only the five existing supplies and four reward tickets', async () => {
  const { PHASE5_ITEM_DEFINITIONS: items } = await economyPromise;
  assert.deepEqual(Object.keys(items).sort(), [
    'armor_shield', 'favorite_drink', 'free_evening', 'pet_cactus', 'pet_dragon',
    'potion_red', 'rest_30', 'weapon_sword', 'weekend_reward'
  ]);
  assert.equal(items.potion_red.itemType, 'potion');
  assert.equal(items.potion_red.currency, 'gold');
  assert.equal(items.potion_red.maxStack, 99);
  assert.equal(items.weapon_sword.slot, 'weapon');
  assert.equal(items.armor_shield.slot, 'armor');
  assert.equal(items.pet_cactus.slot, 'pet');
  assert.equal(items.rest_30.itemType, 'reward_ticket');
  assert.equal(items.rest_30.currency, 'gems');
});

test('member cactus definition grants exactly Gold +1 and equipment does not change boss damage', async () => {
  const { PHASE5_ITEM_DEFINITIONS: items } = await economyPromise;
  assert.deepEqual(items.pet_cactus.equipmentModifiers, { wealth: 2 });
  assert.deepEqual(items.pet_cactus.memberEffects, { settlementGoldBonus: 1 });
  assert.equal('bossDamageMultiplier' in items.pet_dragon.equipmentModifiers, false);
  assert.equal('bossDamage' in items.weapon_sword.equipmentModifiers, false);
});

test('wealth discount uses base wealth only, floors the price, and caps discount at 20 percent', async () => {
  const { calculateWealthDiscountPrice } = await economyPromise;
  assert.deepEqual(calculateWealthDiscountPrice({ basePrice: 101, baseWealth: 0 }), {
    basePrice: 101, baseWealth: 0, discountRate: 0, finalPrice: 101
  });
  assert.deepEqual(calculateWealthDiscountPrice({ basePrice: 101, baseWealth: 7 }), {
    basePrice: 101, baseWealth: 7, discountRate: 0.07, finalPrice: 93
  });
  assert.deepEqual(calculateWealthDiscountPrice({ basePrice: 101, baseWealth: 999 }), {
    basePrice: 101, baseWealth: 999, discountRate: 0.2, finalPrice: 80
  });
  assert.throws(() => calculateWealthDiscountPrice({ basePrice: -1, baseWealth: 2 }), /basePrice/);
});

test('stale catalog version is rejected while price remains server-authoritative', async () => {
  const { assertCatalogOffer } = await economyPromise;
  assert.deepEqual(assertCatalogOffer({
    item: { catalogVersion: 1, basePrice: 60 },
    seenCatalogVersion: 1
  }), { ok: true });
  assert.deepEqual(assertCatalogOffer({
    item: { catalogVersion: 2, basePrice: 65 },
    seenCatalogVersion: 1
  }), { ok: false, errorCode: 'CATALOG_CHANGED' });
  assert.deepEqual(assertCatalogOffer({
    item: { catalogVersion: 1, basePrice: 65 },
    seenCatalogVersion: 1
  }), { ok: true });
});

test('potion preview heals only missing HP and rejects use at full HP', async () => {
  const { calculatePotionUse } = await economyPromise;
  assert.deepEqual(calculatePotionUse({ currentHp: 40, maxHp: 50, healAmount: 15 }), {
    ok: true, healed: 10, hp: 50
  });
  assert.deepEqual(calculatePotionUse({ currentHp: 50, maxHp: 50, healAmount: 15 }), {
    ok: false, errorCode: 'HP_ALREADY_FULL'
  });
});

test('derived stats combine status and equipment without mutating authoritative base stats', async () => {
  const { deriveCharacterStats } = await economyPromise;
  const baseStats = { health: 10, energy: 11, wealth: 12, growth: 13 };
  const result = deriveCharacterStats({
    baseStats,
    statusModifiers: [{ health: -2, energy: 1 }],
    equipmentModifiers: [{ health: 3 }, { wealth: 2 }]
  });
  assert.deepEqual(result, { health: 11, energy: 12, wealth: 14, growth: 13 });
  assert.deepEqual(baseStats, { health: 10, energy: 11, wealth: 12, growth: 13 });
});

test('inventory mutation planning enforces potion stacks and unique equipment ownership', async () => {
  const { planInventoryMutation } = await economyPromise;
  assert.deepEqual(planInventoryMutation({ itemType: 'potion', currentQuantity: 98, quantity: 1 }), {
    ok: true, nextQuantity: 99
  });
  assert.deepEqual(planInventoryMutation({ itemType: 'potion', currentQuantity: 99, quantity: 1 }), {
    ok: false, errorCode: 'INVENTORY_STACK_LIMIT'
  });
  assert.deepEqual(planInventoryMutation({ itemType: 'weapon', currentQuantity: 1, quantity: 1 }), {
    ok: false, errorCode: 'ITEM_ALREADY_OWNED'
  });
});

test('reward inventory plan is pure and validates only supported item quantities', async () => {
  const { planRewardInventoryMutation } = await economyPromise;
  const catalog = {
    potion_red: { itemType: 'potion' },
    weapon_sword: { itemType: 'weapon' }
  };
  assert.deepEqual(planRewardInventoryMutation({
    catalog,
    inventory: { potion_red: 2 },
    rewards: [{ itemKey: 'potion_red', quantity: 3 }, { itemKey: 'weapon_sword', quantity: 1 }]
  }), {
    ok: true,
    inventoryChanges: [
      { itemKey: 'potion_red', previousQuantity: 2, nextQuantity: 5 },
      { itemKey: 'weapon_sword', previousQuantity: 0, nextQuantity: 1 }
    ]
  });
  assert.deepEqual(planRewardInventoryMutation({
    catalog,
    inventory: {},
    rewards: [{ itemKey: 'unknown', quantity: 1 }]
  }), { ok: false, errorCode: 'ITEM_NOT_FOUND' });
});

test('Phase 5A command contract accepts only intent fields and no authoritative results', () => {
  const purchase = BackendContract.createCommandEnvelope({
    type: 'PURCHASE_ITEM',
    operationId: 'phase5-purchase-0001',
    businessDate: '2026-08-24',
    payload: { itemKey: 'weapon_sword', seenCatalogVersion: 1 }
  });
  assert.equal(BackendContract.validateCommandEnvelope(purchase).ok, true);
  assert.equal(BackendContract.validateCommandEnvelope({
    ...purchase,
    payload: { ...purchase.payload, finalPrice: 1, goldToDeduct: 1 }
  }).reason, 'invalid_payload');
});

test('Phase 5A migrations define five economy tables, server-only writes, and no member command route', () => {
  const migrationDir = path.join(__dirname, '..', 'supabase', 'migrations');
  const migrationText = fs.readdirSync(migrationDir)
    .filter(name => /phase_5a/i.test(name))
    .map(name => fs.readFileSync(path.join(migrationDir, name), 'utf8'))
    .join('\n');
  const edgeSource = fs.readFileSync(path.join(
    __dirname, '..', 'supabase', 'functions', 'lifequest-command', 'index.ts'
  ), 'utf8');

  [
    'item_catalog', 'player_inventory', 'player_equipment',
    'player_reward_tickets', 'economy_transactions'
  ].forEach(table => assert.match(migrationText, new RegExp(`create table public\\.${table}\\b`, 'i')));
  assert.match(migrationText, /max_stack[\s\S]+99/i);
  assert.match(migrationText, /weapon[\s\S]+armor[\s\S]+pet/i);
  assert.match(migrationText, /grant select[\s\S]+to authenticated/i);
  assert.match(migrationText, /revoke insert, update, delete[\s\S]+from authenticated/i);
  assert.match(migrationText, /phase5_reserve_operation|phase4_reserve_operation/i);
  assert.match(migrationText, /economy_transactions\(reversal_of_transaction_id, user_id\)/i);
  assert.match(migrationText, /economy_transactions\(ticket_id, user_id\)/i);
  assert.match(migrationText, /player_reward_tickets\(acquisition_transaction_id, user_id\)/i);
  assert.doesNotMatch(edgeSource, /case\s+['"]PURCHASE_ITEM['"]/i);
  assert.doesNotMatch(edgeSource, /case\s+['"]USE_ITEM['"]/i);
  assert.doesNotMatch(edgeSource, /case\s+['"]EQUIP_ITEM['"]/i);
});
