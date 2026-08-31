const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const MemberAuth = require('../memberAuth.js');
const MemberEconomyUi = require('../memberEconomyUi.js');

const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const index = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function memberFixture() {
  return MemberAuth.normalizeMemberCloudState({
    meta: { repository_version: 12 },
    player: {
      hp: 42, max_hp: 65, gold: 131, gems: 5,
      base_stats: { health: 10, energy: 11, wealth: 12, growth: 13 }
    },
    catalog: [
      { item_key: 'potion_red', display_name: '紅色藥水', item_type: 'potion', description: '恢復生命', rarity: 'common', currency_type: 'gold', base_price: 60, catalog_version: 2, max_stack: 99 },
      { item_key: 'weapon_sword', display_name: '大劍', item_type: 'weapon', description: '戰士武器', rarity: 'rare', currency_type: 'gold', base_price: 100, catalog_version: 3, equipment_slot: 'weapon' },
      { item_key: 'rest_30', display_name: '短暫休憩券', item_type: 'reward_ticket', description: '安心休息三十分鐘', rarity: 'common', currency_type: 'gems', base_price: 3, catalog_version: 1 }
    ],
    inventory: [
      { item_key: 'potion_red', display_name: '紅色藥水', item_type: 'potion', quantity: 4, acquired_at: '2026-08-25T00:00:00Z' },
      { item_key: 'weapon_sword', display_name: '大劍', item_type: 'weapon', quantity: 1 },
      { item_key: 'unused_zero', display_name: '不存在的持有', item_type: 'potion', quantity: 0 }
    ],
    equipment: [
      { equipment_slot: 'weapon', item_key: 'weapon_sword', display_name: '大劍', equipment_modifiers: { health: 3 }, equipped_at: '2026-08-25T01:00:00Z' }
    ],
    reward_tickets: [
      { id: 'ticket-a', ticket_key: 'rest_30', name_snapshot: '短暫休憩券', gem_cost_snapshot: 3, issued_at: '2026-08-25T02:00:00Z' },
      { id: 'ticket-b', ticket_key: 'rest_30', name_snapshot: '短暫休憩券', gem_cost_snapshot: 3, issued_at: '2026-08-24T02:00:00Z', used_at: '2026-08-25T03:00:00Z' },
      { id: 'ticket-c', ticket_key: 'rest_30', name_snapshot: '短暫休憩券', gem_cost_snapshot: 3, issued_at: '2026-08-23T02:00:00Z', reversed_at: '2026-08-25T04:00:00Z' }
    ],
    derived_equipment_modifiers: { health: 3, energy: 0, wealth: 1, growth: 0 },
    derived_stats: { health: 14, energy: 10, wealth: 13, growth: 15 },
    recent_economy_transactions: Array.from({ length: 12 }, (_, index) => ({
      id: `tx-${index}`,
      operation_id: `op-${index}`,
      type: 'purchase_item',
      item_key: 'potion_red',
      item_name_snapshot: `紅色藥水 ${index}`,
      currency: 'gold',
      currency_delta: -10,
      paid_amount: 10,
      created_at: `2026-08-${String(index + 1).padStart(2, '0')}T10:00:00Z`
    }))
  });
}

test('Phase 5C-1 normalizes authoritative catalog, inventory and equipment fields', () => {
  const state = memberFixture();
  assert.equal(state.catalog[0].currency, 'gold');
  assert.equal(state.catalog[1].equipmentSlot, 'weapon');
  assert.equal(state.inventory[0].quantity, 4);
  assert.equal(state.inventory[0].acquiredAt, '2026-08-25T00:00:00Z');
  assert.equal(state.equipment[0].slot, 'weapon');
});

test('Member economy view model uses Cloud catalog and authoritative resources', () => {
  const view = MemberEconomyUi.createMemberEconomyViewModel(memberFixture());
  assert.equal(view.source, 'member-cloud-authoritative');
  assert.deepEqual(view.resources, { hp: 42, maxHp: 65, gold: 131, gems: 5 });
  assert.equal(view.catalog[0].displayName, '紅色藥水');
  assert.equal(view.catalog[0].estimatedPrice, 52);
  assert.equal(view.repositoryVersion, 12);
});

test('Member inventory hides quantity zero and exposes consumable quantity and equipment ownership', () => {
  const view = MemberEconomyUi.createMemberEconomyViewModel(memberFixture());
  assert.equal(view.inventory.length, 2);
  assert.equal(view.inventoryByKey.potion_red.quantity, 4);
  assert.equal(view.catalog.find(item => item.itemKey === 'weapon_sword').owned, true);
  assert.equal(view.catalog.find(item => item.itemKey === 'weapon_sword').equipped, true);
});

test('Member equipment is keyed by the three authoritative slots without Guest fallback', () => {
  const view = MemberEconomyUi.createMemberEconomyViewModel(memberFixture());
  assert.equal(view.equipmentBySlot.weapon.itemKey, 'weapon_sword');
  assert.equal(view.equipmentBySlot.armor, undefined);
  assert.equal(view.equipmentBySlot.pet, undefined);
});

test('Derived stats expose Base + Equipment + Status = Final', () => {
  const view = MemberEconomyUi.createMemberEconomyViewModel(memberFixture());
  assert.deepEqual(view.stats.base, { health: 10, energy: 11, wealth: 12, growth: 13 });
  assert.deepEqual(view.stats.equipment, { health: 3, energy: 0, wealth: 1, growth: 0 });
  assert.deepEqual(view.stats.status, { health: 1, energy: -1, wealth: 0, growth: 2 });
  assert.deepEqual(view.stats.final, { health: 14, energy: 10, wealth: 13, growth: 15 });
});

test('Reward Ticket read model preserves unused, used and reversed states', () => {
  const view = MemberEconomyUi.createMemberEconomyViewModel(memberFixture());
  assert.deepEqual(view.rewardTickets.map(ticket => ticket.status), ['unused', 'used', 'reversed']);
  assert.equal(view.ticketCatalog[0].itemKey, 'rest_30');
});

test('Economy history is server-backed, newest-first and limited to ten records', () => {
  const view = MemberEconomyUi.createMemberEconomyViewModel(memberFixture());
  assert.equal(view.recentTransactions.length, 10);
  assert.equal(view.recentTransactions[0].id, 'tx-11');
  assert.equal(view.recentTransactions.at(-1).id, 'tx-2');
  assert.equal(view.recentTransactions[0].itemName, '紅色藥水 11');
  assert.equal(view.recentTransactions[0].label, '購買補給');
});

test('Partial member response preserves existing economy slices', () => {
  const current = memberFixture();
  const merged = MemberAuth.mergeMemberCloudState(current, { meta: { repositoryVersion: 13 } });
  assert.equal(merged.catalog.length, 3);
  assert.equal(merged.inventory[0].quantity, 4);
  assert.equal(merged.rewardTickets.length, 3);
  assert.equal(merged.meta.repositoryVersion, 13);
});

test('Member renderer wires Phase 5C-2 economy actions without reusing Guest trade actions', () => {
  const memberRenderer = app.slice(
    app.indexOf('function renderMemberShopRewards()'),
    app.indexOf('function renderShopRewards()')
  );
  [
    'member-item-purchase',
    'member-item-use',
    'member-item-equip',
    'member-item-unequip',
    'member-ticket-redeem',
    'member-ticket-use',
    'member-ticket-reverse'
  ].forEach(action => assert.match(memberRenderer, new RegExp(`memberEconomyButton\\('${action}'`)));
  assert.doesNotMatch(memberRenderer, /PURCHASE_ITEM|USE_ITEM|EQUIP_ITEM|UNEQUIP_ITEM|REDEEM_REWARD_TICKET|USE_REWARD_TICKET|REVERSE_REWARD_TICKET/);
  assert.doesNotMatch(memberRenderer, /data-lifequest-action="(?:equipment-trade|ticket-request|ticket-use|ticket-reverse)"/);
  assert.match(app, /function renderShopRewards\(\) \{\s*if \(activeMember\)/);
  assert.match(app, /SHOP_ITEMS\.forEach\(item =>/);
  assert.match(app, /state\.supplyTransactions\.slice\(-8\)/);
});

test('Phase 5C-3 opens supply only and member economy module still loads before app', () => {
  assert.match(app, /const MEMBER_PHASE5_TABS = new Set\(\['privacy-settings'\]\)/);
  assert.match(app, /MEMBER_RESTORABLE_VIEWS[^;]*supply/);
  assert.ok(index.indexOf('memberEconomyUi.js') < index.indexOf('app.js'));
});
