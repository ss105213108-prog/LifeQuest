const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const BackendContract = require('../backendContract.js');
const economyPromise = import('../supabase/functions/_shared/phase5EconomyDomain.mjs');
const migrationPath = path.join(__dirname, '..', 'supabase', 'migrations',
  '20260825100000_phase_5b_transactional_economy_commands.sql');
const migration = fs.readFileSync(migrationPath, 'utf8');
const payloadOrderRepair = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations',
  '20260825121000_fix_phase5b_reward_ticket_payload_order.sql'), 'utf8');
const edge = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'functions',
  'lifequest-command', 'index.ts'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

function command(type, payload, operationId = `phase5b-${type.toLowerCase()}-0001`) {
  return BackendContract.createCommandEnvelope({
    type, operationId, businessDate: '2026-08-25', payload
  });
}

test('Phase 5B contract accepts only the seven narrow economy intents', () => {
  const valid = [
    command('PURCHASE_ITEM', { itemKey: 'potion_red', seenCatalogVersion: 1 }),
    command('USE_ITEM', { itemKey: 'potion_red' }),
    command('EQUIP_ITEM', { itemKey: 'weapon_sword' }),
    command('UNEQUIP_ITEM', { slot: 'weapon' }),
    command('REDEEM_REWARD_TICKET', { ticketKey: 'rest_30', seenCatalogVersion: 1 }),
    command('USE_REWARD_TICKET', { ticketInstanceId: '11111111-1111-4111-8111-111111111111' }),
    command('REVERSE_REWARD_TICKET', { ticketInstanceId: '22222222-2222-4222-8222-222222222222' })
  ];
  valid.forEach(value => assert.equal(BackendContract.validateCommandEnvelope(value).ok, true));
});

test('Phase 5B contract rejects client-authoritative economy values', () => {
  const forbidden = ['userId', 'price', 'basePrice', 'seenBasePrice', 'paidAmount', 'currency',
    'discount', 'discountRate', 'goldCost', 'gemsCost', 'resourceDelta', 'quantityGranted',
    'hpToHeal', 'effect', 'equipmentModifier', 'reward', 'finalStats', 'catalogItemDefinition'];
  forbidden.forEach(field => {
    const value = command('PURCHASE_ITEM', { itemKey: 'potion_red', [field]: 1 });
    assert.equal(BackendContract.validateCommandEnvelope(value).reason, 'invalid_payload', field);
  });
});

test('cactus settlement effect adds exactly one server-side Gold without mutating input plan', async () => {
  const { applySettlementEquipmentGoldBonus } = await economyPromise;
  const plan = {
    resource: { after: { gold: 20 }, deltas: { gold: 5 } },
    rewardBreakdown: { daily: { gold: 5 } }
  };
  const result = applySettlementEquipmentGoldBonus(plan, 1);
  assert.equal(result.resource.after.gold, 21);
  assert.equal(result.resource.deltas.gold, 6);
  assert.equal(result.rewardBreakdown.daily.gold, 6);
  assert.equal(result.equipmentEffects.settlementGoldBonus, 1);
  assert.equal(plan.resource.after.gold, 20);
});

test('Phase 5B migration uses the shared operation kernel and one transaction RPC', () => {
  assert.match(migration, /private\.phase4_reserve_operation\s*\(/i);
  assert.match(migration, /private\.phase4_complete_operation\s*\(/i);
  assert.match(migration, /create or replace function private\.execute_phase5b_economy_command/i);
  assert.match(migration, /create or replace function public\.execute_phase5b_economy_command/i);
  assert.match(migration, /operationRepositoryVersion/i);
  assert.doesNotMatch(migration, /reverse_item_purchase/i);
});

test('Phase 5B computes price from catalog and base wealth inside the database', () => {
  assert.match(migration, /v_base_wealth\s*:=\s*v_player\.base_wealth/i);
  assert.match(migration, /least\(v_base_wealth \* 0\.01, 0\.20\)/i);
  assert.match(migration, /floor\(v_catalog\.base_price \* \(1 - v_discount\)\)/i);
  assert.match(migration, /CATALOG_CHANGED/i);
  assert.doesNotMatch(migration, /seenBasePrice/i);
});

test('Phase 5B purchase, potion and equipment rules are atomic server writes', () => {
  assert.match(migration, /INVENTORY_LIMIT_REACHED/i);
  assert.match(migration, /ITEM_ALREADY_OWNED/i);
  assert.match(migration, /HP_ALREADY_FULL/i);
  assert.match(migration, /least\([^\n]+v_max_hp - v_player\.hp\)/i);
  assert.match(migration, /on conflict \(user_id, slot\) do update/i);
  assert.match(migration, /private\.phase5b_equipment_modifiers/i);
  assert.doesNotMatch(migration, /set\s+base_(health|energy|wealth|growth)\s*=/i);
});

test('Phase 5B reward tickets use immutable acquisition cost and one UUID instance', () => {
  assert.match(migration, /v_ticket_id uuid := gen_random_uuid\(\)/i);
  assert.match(migration, /gem_cost_snapshot/i);
  assert.match(migration, /v_ticket\.gem_cost_snapshot/i);
  assert.match(migration, /status = 'used'/i);
  assert.match(migration, /status = 'reversed'/i);
  assert.match(migration, /TICKET_ALREADY_USED/i);
});

test('Phase 5B validates reward ticket payload keys in PostgreSQL canonical order', () => {
  assert.match(payloadOrderRepair, /seenCatalogVersion', 'ticketKey/);
  assert.match(payloadOrderRepair, /Expected Phase 5B payload validation expression was not found/);
});

test('Phase 5B projection returns economy data with derived stats and immutable receipts', () => {
  assert.match(migration, /private\.phase5b_economy_state/i);
  assert.match(migration, /derivedEquipmentModifiers/i);
  assert.match(migration, /derivedStats/i);
  assert.match(migration, /recentEconomyTransactions/i);
  assert.match(migration, /private\.phase4b_state\(p_user_id\) \|\| private\.phase5b_economy_state/i);
});

test('Phase 5B RPC and read helper are service-only', () => {
  assert.match(migration, /revoke all on function public\.execute_phase5b_economy_command[\s\S]+from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.execute_phase5b_economy_command[\s\S]+to service_role/i);
  assert.match(migration, /revoke all on function public\.get_phase5b_economy_state[\s\S]+from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.get_phase5b_economy_state[\s\S]+to service_role/i);
});

test('Edge validates and routes every Phase 5B command and loads authoritative projection', () => {
  [
    'PURCHASE_ITEM', 'USE_ITEM', 'EQUIP_ITEM', 'UNEQUIP_ITEM',
    'REDEEM_REWARD_TICKET', 'USE_REWARD_TICKET', 'REVERSE_REWARD_TICKET'
  ].forEach(type => assert.match(edge, new RegExp(`${type}: 'execute_phase5b_economy_command'`)));
  assert.match(edge, /isValidPhase5Payload/i);
  assert.match(edge, /get_phase5b_economy_state/i);
  assert.match(edge, /from\('item_catalog'\)/i);
  assert.match(edge, /getSettlementEquipmentGoldBonus/i);
});

test('Phase 5C-3 retains the private settings gate and does not change Guest authority', () => {
  assert.match(app, /MEMBER_PHASE5_TABS\s*=\s*new Set\(\['privacy-settings'\]\)/);
  assert.doesNotMatch(migration, /lifequest_state|localStorage|guest/i);
});
