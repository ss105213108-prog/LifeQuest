const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHarness, clone } = require('./helpers/member-economy-ui-harness.cjs');

// These are UI -> actual command transport integration tests with scripted Cloud
// responses. Live Supabase/RLS verification is separately authorized and reported.
function inventory(itemKey, itemType = 'potion', quantity = 1) {
  return { itemKey, itemType, quantity, displayName: itemKey };
}
function receipt(state, type, itemKey, currencyDelta = 0) {
  state.recentEconomyTransactions.push({
    id: 'receipt-' + state.meta.repositoryVersion, type, itemKey, itemName: '取得時名稱',
    currency: type.includes('ticket') ? 'gems' : 'gold', currencyDelta, paidAmount: Math.abs(currencyDelta),
    createdAt: new Date(Date.UTC(2026, 7, 27, 0, 0, state.meta.repositoryVersion)).toISOString()
  });
}

test('5C-3 supply navigation and reload follow Cloud bootstrap; restricted/invalid views stay protected', async () => {
  const h = await createHarness();
  h.context.window.switchToTab('supply');
  assert.ok(h.elements.panes.find(x => x.id === 'pane-supply').classList.contains('active'));
  assert.equal(h.navigation.getItem('currentMemberView'), 'supply');
  h.context.window.switchToTab('privacy-settings');
  assert.match(h.modals.at(-1).title, /尚未對會員開放/);
  assert.equal(h.navigation.getItem('currentMemberView'), 'supply');

  const reload = await createHarness({ server: h.server, local: h.local, navigation: h.navigation, autoStart: false });
  assert.equal(reload.context.activeMember, null);
  assert.equal(reload.getCount(), 0);
  const restored = await reload.coordinator.start();
  assert.equal(reload.getCount(), 1);
  assert.equal(reload.context.restoreMemberGameplayWorkspace(restored), true);
  assert.ok(reload.elements.panes.find(x => x.id === 'pane-supply').classList.contains('active'));
  assert.equal(reload.context.normalizeMemberView('privacy-settings'), 'dashboard');
  assert.equal(reload.context.normalizeMemberView('not-a-page'), 'dashboard');
  const css = fs.readFileSync(path.join(__dirname, '../style.css'), 'utf8');
  assert.doesNotMatch(css, /body\.member-gameplay-mode[^{]*data-tab="supply"/);
  assert.match(css, /body\.member-gameplay-mode[^{]*data-tab="privacy-settings"[\s\S]{0,160}display: none !important/);
});

test('5C-3 rendered purchase confirmation reaches actual remote payload; pending clicks cannot buy twice', async () => {
  const h = await createHarness();
  let release;
  h.queue.push(async command => {
    assert.equal(command.type, 'PURCHASE_ITEM');
    assert.deepEqual(command.payload, { itemKey: 'potion_red', seenCatalogVersion: 1 });
    await new Promise(resolve => { release = resolve; });
    h.server.state.player.gold = 478;
    h.server.state.inventory = [inventory('potion_red')];
    receipt(h.server.state, 'purchase_item', 'potion_red', -22);
    h.server.state.meta.repositoryVersion++;
    return { ok: true, state: clone(h.server.state), repositoryVersion: 21 };
  });
  h.click('member-item-purchase', 'potion_red');
  assert.equal(h.requests.length, 0);
  assert.match(h.modals.at(-1).message, /22/);
  const completing = h.confirm();
  while (!release) await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.context.memberEconomyActionPending, true);
  assert.equal(h.click('member-item-purchase', 'potion_red'), false);
  assert.equal(h.context.state.memberEconomy.resources.gold, 500);
  release();
  await completing;
  assert.equal(h.requests.length, 1);
  assert.equal(h.context.state.memberEconomy.resources.gold, 478);
  assert.equal(h.context.state.memberEconomy.resources.hp, 40, 'purchase does not auto-use potion');
  assert.equal(h.context.state.memberEconomy.inventoryByKey.potion_red.quantity, 1);
  assert.equal(h.context.memberEconomyActionPending, false);
  assert.match(h.markup(), /購買補給/);
  assert.match(h.requests[0].url, /functions\/v1\/lifequest-command$/);
  assert.equal(h.requests[0].headers['If-Match'], '20');
});

test('5C-3 potion uses confirmation and authoritative HP/quantity; full HP failure consumes nothing', async () => {
  const h = await createHarness();
  h.server.state.inventory = [inventory('potion_red', 'potion', 2)];
  await h.coordinator.reloadMember();
  h.success(state => {
    state.player.hp = 50;
    state.inventory[0].quantity = 1;
    receipt(state, 'use_item', 'potion_red');
  });
  h.click('member-item-use', 'potion_red');
  assert.equal(h.requests.length, 0);
  await h.confirm();
  assert.deepEqual(h.requests[0].command.payload, { itemKey: 'potion_red' });
  assert.equal(h.context.state.memberEconomy.resources.hp, 50);
  assert.equal(h.context.state.memberEconomy.inventoryByKey.potion_red.quantity, 1);
  h.failure('HP_ALREADY_FULL');
  h.click('member-item-use', 'potion_red');
  await h.confirm();
  assert.match(h.modals.at(-1).message, /已滿/);
  assert.equal(h.context.state.memberEconomy.inventoryByKey.potion_red.quantity, 1);
  assert.equal(h.context.memberEconomyActionPending, false);
});

test('5C-3 weapon/armor/pet purchase does not auto-equip; direct equip/unequip render derived stats only', async () => {
  const h = await createHarness();
  const base = clone(h.server.state.player.baseStats);
  for (const [slot, itemKey, stat] of [['weapon', 'weapon_sword', 'energy'], ['armor', 'armor_shield', 'health'], ['pet', 'pet_cactus', 'wealth']]) {
    h.success(state => { state.inventory.push(inventory(itemKey, 'equipment')); state.player.gold -= 54; receipt(state, 'purchase_item', itemKey, -54); });
    h.click('member-item-purchase', itemKey);
    await h.confirm();
    assert.equal(h.context.state.memberEconomy.equipmentBySlot[slot], undefined);
    const modalCount = h.modals.length;
    h.success(state => {
      state.equipment = [{ slot, itemKey, displayName: itemKey }];
      state.derivedEquipmentModifiers[stat] = 2;
      state.derivedStats[stat] = base[stat] + 2;
      receipt(state, 'equip_item', itemKey);
    });
    h.click('member-item-equip', itemKey);
    assert.equal(h.modals.length, modalCount, 'equip has no confirmation');
    await h.idle();
    assert.equal(h.requests.at(-1).command.type, 'EQUIP_ITEM');
    assert.equal(h.context.state.memberEconomy.stats.final[stat], 12);
    assert.deepEqual(h.context.state.memberEconomy.stats.base, base);
    await h.coordinator.reloadMember();
    assert.equal(h.context.state.memberEconomy.equipmentBySlot[slot].itemKey, itemKey);
    h.success(state => {
      state.equipment = [];
      state.derivedEquipmentModifiers[stat] = 0;
      state.derivedStats[stat] = base[stat];
      receipt(state, 'unequip_item', itemKey);
    });
    h.click('member-item-unequip', slot);
    await h.idle();
    assert.deepEqual(h.requests.at(-1).command.payload, { slot });
    assert.equal(h.context.state.memberEconomy.stats.final[stat], 10);
    assert.deepEqual(h.context.state.memberEconomy.stats.base, base);
  }
});

test('5C-3 ticket redeem/use/reverse confirmations keep acquisition snapshot and terminal actions unavailable', async () => {
  const h = await createHarness();
  const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];
  for (const id of ids) {
    h.success(state => {
      state.player.gems -= 3;
      state.rewardTickets.push({ id, ticketKey: 'rest_30', name: '原始休憩券', gemCost: 3, catalogVersion: 1, status: 'unused' });
      receipt(state, 'redeem_reward_ticket', 'rest_30', -3);
    });
    const count = h.requests.length;
    h.click('member-ticket-redeem', 'rest_30');
    assert.equal(h.requests.length, count);
    await h.confirm();
  }
  h.success(state => { state.rewardTickets[0].status = 'used'; receipt(state, 'use_reward_ticket', 'rest_30'); });
  h.click('member-ticket-use', ids[0]);
  await h.confirm();
  assert.equal(h.context.state.memberEconomy.rewardTickets[0].status, 'used');
  assert.ok(!h.markup().includes('data-entity-id="' + ids[0] + '"'), 'used ticket has no use/reverse button');
  h.server.state.catalog.find(x => x.itemKey === 'rest_30').basePrice = 9;
  await h.coordinator.reloadMember();
  h.success(state => { state.rewardTickets[1].status = 'reversed'; state.player.gems += 3; receipt(state, 'reverse_reward_ticket', 'rest_30', 3); });
  h.click('member-ticket-reverse', ids[1]);
  await h.confirm();
  assert.deepEqual(h.requests.at(-1).command.payload, { ticketInstanceId: ids[1] }, 'client never specifies refund amount');
  assert.equal(h.context.state.memberEconomy.resources.gems, 17);
  assert.ok(!h.markup().includes('data-entity-id="' + ids[1] + '"'));
});

test('5C-3 newest ten Cloud receipts, reload and logout/login retain economy and boss achievement without Guest writes', async () => {
  const h = await createHarness();
  const guestBefore = h.local.getItem('lifequest_state');
  h.server.state.inventory = [inventory('potion_red', 'potion', 4)];
  h.server.state.equipment = [{ slot: 'pet', itemKey: 'pet_cactus' }];
  for (let i = 0; i < 12; i++) {
    receipt(h.server.state, 'purchase_item', 'potion_red', -22);
    h.server.state.meta.repositoryVersion++;
  }
  await h.coordinator.reloadMember();
  assert.equal(h.context.state.memberEconomy.recentTransactions.length, 10);
  assert.equal(h.context.state.memberEconomy.recentTransactions[0].id, 'receipt-31');
  assert.equal(h.elements.listShopRewards.querySelector('[data-member-transactions]').children.length, 10);
  assert.match(h.markup(), /取得時名稱/);
  h.context.window.switchToTab('supply');
  await h.coordinator.logout();
  assert.equal(h.coordinator.getMemberState(), null);
  assert.equal(h.context.activeMember, null);
  assert.equal(h.navigation.getItem('currentMemberView'), null);
  const login = await h.coordinator.login({ email: 'fixture@example.invalid', password: 'fixture-only' });
  assert.equal(login.ok, true);
  assert.equal(h.context.state.memberEconomy.inventoryByKey.potion_red.quantity, 4);
  assert.equal(h.context.state.memberEconomy.equipmentBySlot.pet.itemKey, 'pet_cactus');
  assert.equal(login.state.achievements[0].code, 'boss_slayer');
  assert.equal(login.state.achievementProgress.boss_slayer, 1);
  assert.equal(login.state.player.gems, 20);
  assert.equal(h.local.getItem('lifequest_state'), guestBefore);
});

test('5C-3 two UI sessions: conflict reloads Cloud without automatic resend; user must reconfirm', async () => {
  const a = await createHarness();
  const b = await createHarness({ server: a.server });
  a.success(state => { state.player.gold = 478; state.inventory = [inventory('potion_red')]; });
  a.click('member-item-purchase', 'potion_red');
  await a.confirm();
  b.queue.push((_command, options) => {
    assert.equal(options.headers['If-Match'], '20');
    assert.equal(b.server.state.meta.repositoryVersion, 21);
    return { ok: false, errorCode: 'VERSION_CONFLICT', retryable: false };
  });
  const reads = b.getCount();
  b.click('member-item-purchase', 'potion_red');
  await b.confirm();
  assert.equal(b.requests.length, 1);
  assert.ok(b.getCount() > reads);
  assert.equal(b.context.state.memberEconomy.resources.gold, 478);
  assert.match(b.modals.at(-1).message, /手動重試/);
  assert.equal(b.context.memberEconomyActionPending, false);
  b.success(state => { state.player.gold = 456; state.inventory[0].quantity = 2; });
  b.click('member-item-purchase', 'potion_red');
  assert.equal(b.requests.length, 1);
  await b.confirm();
  assert.equal(b.requests[1].headers['If-Match'], '21');
  assert.equal(b.requests.length, 2);
});

test('5C-3 committed-but-lost response retries the same operationId and projects duplicate without double resources', async () => {
  const h = await createHarness();
  h.queue.push(() => {
    h.server.state.player.gold = 478;
    h.server.state.inventory = [inventory('potion_red')];
    h.server.state.meta.repositoryVersion = 21;
    receipt(h.server.state, 'purchase_item', 'potion_red', -22);
    throw new Error('simulated response lost after server commit');
  });
  h.click('member-item-purchase', 'potion_red');
  await h.confirm();
  assert.match(h.modals.at(-1).message, /同一操作識別碼/);
  assert.equal(h.context.memberEconomyActionPending, false);
  assert.equal(h.context.state.memberEconomy.resources.gold, 500, 'uncertain result is not fake success');
  h.queue.push(command => {
    assert.equal(command.operationId, h.requests[0].command.operationId);
    return { ok: true, duplicate: true, state: clone(h.server.state), repositoryVersion: 21 };
  });
  h.click('member-item-purchase', 'potion_red');
  await h.confirm();
  assert.equal(h.requests.length, 2);
  assert.equal(h.context.state.memberEconomy.resources.gold, 478);
  assert.equal(h.context.state.memberEconomy.inventoryByKey.potion_red.quantity, 1);
  assert.equal(h.server.state.recentEconomyTransactions.length, 1);
  assert.equal(h.server.state.meta.repositoryVersion, 21);
  assert.match(h.modals.at(-1).message, /沒有再次扣除/);
});

test('5C-3 CATALOG_CHANGED refreshes prices but does not transact until a new user confirmation', async () => {
  const h = await createHarness();
  h.queue.push(() => {
    Object.assign(h.server.state.catalog[0], { catalogVersion: 2, basePrice: 50 });
    return { ok: false, errorCode: 'CATALOG_CHANGED', retryable: false };
  });
  h.click('member-item-purchase', 'potion_red');
  await h.confirm();
  assert.equal(h.requests.length, 1);
  assert.equal(h.context.state.memberEconomy.resources.gold, 500);
  assert.equal(h.context.state.memberEconomy.catalog[0].estimatedPrice, 45);
  assert.match(h.modals.at(-1).message, /沒有完成交易/);
  h.success(state => { state.player.gold -= 45; state.inventory = [inventory('potion_red')]; });
  h.click('member-item-purchase', 'potion_red');
  assert.match(h.modals.at(-1).message, /45/);
  assert.equal(h.requests.length, 1);
  await h.confirm();
  assert.equal(h.requests.at(-1).command.payload.seenCatalogVersion, 2);
});

test('5C-3 auth failure stops transaction, clears pending UI and opens login without touching Guest save', async () => {
  for (const code of ['SESSION_EXPIRED', 'AUTH_REQUIRED']) {
    const h = await createHarness();
    const before = h.local.getItem('lifequest_state');
    h.failure(code);
    h.click('member-item-purchase', 'potion_red');
    await h.confirm();
    assert.equal(h.context.authView, 'login');
    assert.equal(h.context.activeMember, null);
    assert.equal(h.coordinator.getMemberState(), null);
    assert.equal(h.context.memberEconomyActionPending, false);
    assert.equal(h.server.state.player.gold, 500);
    assert.equal(h.local.getItem('lifequest_state'), before);
    assert.equal(h.requests.length, 1);
  }
});

test('5C-3 Cloud bootstrap failure cannot restore supply using a Guest fallback', async () => {
  const h = await createHarness({ autoStart: false });
  h.navigation.setItem('currentMemberView', 'supply');
  h.setGetFailure(true);
  const result = await h.context.initializeMemberAuth();
  assert.equal(result.ok, false);
  assert.ok(result.session.user.id, 'failed bootstrap preserves authenticated identity, never Guest');
  assert.equal(h.context.bootstrapView.loading, false);
  assert.ok(h.context.bootstrapView.error);
  assert.equal(h.context.restoreMemberGameplayWorkspace(result), false);
  assert.equal(h.context.activeMember, null);
  assert.equal(h.context.state.memberEconomy, undefined);
  assert.equal(h.requests.length, 0);
});
