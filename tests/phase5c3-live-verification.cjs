// Explicitly authorized live verification only. Never runs as part of npm test.
// Random credentials/session storage remain in process memory; stdout has no secrets.
// Always global-sign-out in finally. Auth deletion is separately performed against
// the exact emitted IDs after verification, then residuals are checked via SQL.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createClient } = require('@supabase/supabase-js');
const { safeVerificationRecord } = require('./helpers/safe-verification-output.cjs');
const Contract = require('../backendContract.js');
const Application = require('../gameApplication.js');
const Auth = require('../memberAuth.js');
const EconomyUi = require('../memberEconomyUi.js');
const REF = 'jwpbwlrdzmfzjlbrktlc';
const checks = {};
const users = [];
const resumeCredentials = new Map();
const phase6b2Mode = process.argv.includes('--authorized-phase6b2');
let stage = 'config';
const report = (event, data = {}) => console.log(JSON.stringify(safeVerificationRecord({ event, ...data })));
const pass = (name, details = {}) => { checks[name] = true; report('PASS', { name, ...details }); };
const clone = x => JSON.parse(JSON.stringify(x));
function storage() {
  const map = new Map();
  return { getItem: k => map.get(k) ?? null, setItem: (k, v) => map.set(k, String(v)), removeItem: k => map.delete(k) };
}
const sandbox = { globalThis: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../supabaseConfig.js'), 'utf8'), sandbox);
const config = sandbox.globalThis.LIFEQUEST_SUPABASE_CONFIG;
assert.equal(new URL(config.url).hostname, REF + '.supabase.co');
const runId = process.env.PHASE5C3_RESUME_RUN_ID || crypto.randomBytes(8).toString('hex');
assert.match(runId, /^[0-9a-f]{16}$/);
const today = Contract.getBusinessDate({ now: new Date().toISOString(), timeZone: 'Asia/Taipei' });
const state = u => u.coordinator.getMemberState();
const version = u => state(u).meta.repositoryVersion;
const qty = (s, key) => s.inventory.find(row => row.itemKey === key)?.quantity || 0;
const offer = (u, key) => ({ itemKey: key, seenCatalogVersion: state(u).catalog.find(x => x.itemKey === key).catalogVersion });
const guestSave = JSON.stringify({ gold: 987, gems: 88, inventory: ['guest-sentinel'] });
function wire(u) {
  u.coordinator = Auth.createMemberAuthCoordinator({ supabaseClient: u.client, projectUrl: config.url,
    publishableKey: config.publishableKey, storage: u.pending, contract: Contract, application: Application,
    fetchImpl: async (url, options) => {
      assert.equal(new URL(url).hostname, REF + '.supabase.co');
      const command = options.body ? JSON.parse(options.body) : null;
      if (command) u.requests.push({ command, expectedVersion: options.headers['If-Match'] });
      const response = await fetch(url, { ...options, signal: AbortSignal.timeout(45000) });
      if (u.dropNext && command?.type === 'PURCHASE_ITEM' && response.ok) {
        u.dropNext = false;
        u.lostResponse = await response.json();
        throw new Error('test-only response loss after real server success');
      }
      return response;
    }
  });
}
async function success(u, method, payload) {
  stage = `${u.label}:${method}`;
  const before = state(u)?.meta.repositoryVersion;
  const result = await u.coordinator[method](payload);
  assert.equal(result.ok, true, `${stage}: ${result.errorCode || result.reason || 'unexpected failure'}`);
  if (method !== 'reloadMember') assert.equal(version(u), before + 1, stage + ' version');
  assert.equal(u.pending.getItem('lifequest_state'), guestSave);
  return result;
}
async function refresh(u) { await success(u, 'reloadMember'); return state(u); }
async function negative(u, method, payload, code) {
  stage = `${u.label}:${method}:expected-${code}`;
  const before = version(u);
  const result = await u.coordinator[method](payload);
  assert.equal(result.ok, false, stage);
  assert.equal(result.errorCode || result.reason, code, stage);
  await refresh(u);
  assert.equal(version(u), before, 'failed command increased version');
  return result;
}
async function raw(u, command, expectedVersion) {
  const transport = Auth.createSupabaseTransport({ client: u.client, projectUrl: config.url, publishableKey: config.publishableKey });
  const prepared = Contract.createApiRequest(command);
  assert.ok(prepared.ok);
  prepared.request.headers['If-Match'] = String(expectedVersion);
  return transport(prepared.request);
}
const command = (type, payload) => Contract.createCommandEnvelope({ type, payload,
  operationId: 'p5c3-' + crypto.randomUUID(), businessDate: today });
async function race(u, type, payloads) {
  stage = `${u.label}:concurrent-${type}`;
  const before = version(u);
  const commands = payloads.map(payload => command(type, payload));
  const results = await Promise.all(commands.map(c => raw(u, c, before)));
  assert.equal(results.filter(x => x.ok).length, 1, stage + ' success count');
  assert.equal(results.filter(x => x.errorCode === 'VERSION_CONFLICT').length, 1, stage + ' conflict count');
  await refresh(u);
  assert.equal(version(u), before + 1, stage + ' version');
  return { commands, results };
}
function snapshot(s) {
  // GET includes database metadata not present in command projections. Compare
  // every gameplay resource explicitly; metadata is not a second balance.
  const player = Object.fromEntries(['totalXp', 'level', 'hp', 'maxHp', 'gold', 'gems',
    'baseStats', 'levelCurveVersion'].map(key => [key, clone(s.player?.[key])]));
  return { player, inventory: s.inventory, equipment: s.equipment,
    tickets: s.rewardTickets, stats: s.derivedStats, achievements: s.achievements,
    history: s.recentEconomyTransactions, version: s.meta.repositoryVersion };
}
async function verifyClosureRemaining() {
  const a = await setup('a');
  const b = await setup('b');
  await earnMinimumFunds(a, () => state(a).player.gold >= price(a, 'weapon_sword') + 2 * price(a, 'potion_red')
    && state(a).player.gems >= 6 && state(a).achievements.some(x => x.code === 'exercise_streak_3'));
  await earnMinimumFunds(b, () => state(b).player.gold >= price(b, 'armor_shield') + price(b, 'potion_red')
    && state(b).player.gems >= 3);
  await refresh(a);
  const achievementBefore = clone(state(a).achievements);
  assert.ok(achievementBefore.length > 0);
  achievementBefore.forEach(row => {
    assert.ok(row.targetSnapshot && Object.keys(row.targetSnapshot).length);
    assert.ok(row.rewardSnapshot && Object.keys(row.rewardSnapshot).length);
  });
  const achievementLedger = await a.client.from('resource_ledger').select('*')
    .eq('user_id', a.id).eq('reason', 'achievement_reward').order('id');
  assert.ok(!achievementLedger.error);
  assert.ok(achievementLedger.data.length > 0);
  // Only create fixtures needed for isolation, history and session restore.
  // No concurrency or response-loss replay of previously completed scenarios.
  for (const [method, payload] of [
    ['purchaseItem', offer(a, 'weapon_sword')],
    ['equipItem', { itemKey: 'weapon_sword' }],
    ['unequipItem', { slot: 'weapon' }],
    ['equipItem', { itemKey: 'weapon_sword' }],
    ['purchaseItem', offer(a, 'potion_red')],
    ['purchaseItem', offer(a, 'potion_red')]
  ]) {
    await success(a, method, payload);
    assert.deepEqual(state(a).achievements, achievementBefore, 'slim economy response lost achievement snapshots');
  }
  await success(a, 'reportHabitEvent', { habitId: 'sedentary_screen' });
  await success(a, 'useItem', { itemKey: 'potion_red' });
  const ticketOffer = u => ({ ticketKey: 'rest_30', seenCatalogVersion: offer(u, 'rest_30').seenCatalogVersion });
  const used = await success(a, 'redeemRewardTicket', ticketOffer(a));
  await success(a, 'useRewardTicket', { ticketInstanceId: used.ticketInstanceId });
  a.ticketId = (await success(a, 'redeemRewardTicket', ticketOffer(a))).ticketInstanceId;
  await success(a, 'unequipItem', { slot: 'weapon' });
  await success(a, 'equipItem', { itemKey: 'weapon_sword' });
  await success(b, 'purchaseItem', offer(b, 'armor_shield'));
  await success(b, 'equipItem', { itemKey: 'armor_shield' });
  await success(b, 'purchaseItem', offer(b, 'potion_red'));
  b.ticketId = (await success(b, 'redeemRewardTicket', ticketOffer(b))).ticketInstanceId;
  for (const u of [a, b]) {
    await refresh(u);
    assert.ok(state(u).inventory.length && state(u).equipment.length && state(u).rewardTickets.length);
  }
  assert.deepEqual(state(a).achievements, achievementBefore);
  const ledgerAfter = await a.client.from('resource_ledger').select('*')
    .eq('user_id', a.id).eq('reason', 'achievement_reward').order('id');
  assert.ok(!ledgerAfter.error);
  assert.deepEqual(ledgerAfter.data, achievementLedger.data);
  pass('achievement-snapshot-live-economy-merge-refresh-no-extra-reward', { achievements: achievementBefore.length,
    achievementLedgerRows: ledgerAfter.data.length });
  for (const [u, other] of [[a, b], [b, a]]) {
    const foreignBefore = snapshot(state(other));
    await negative(u, 'useRewardTicket', { ticketInstanceId: other.ticketId }, 'TICKET_NOT_FOUND');
    await negative(u, 'reverseRewardTicket', { ticketInstanceId: other.ticketId }, 'TICKET_NOT_FOUND');
    for (const [type, payload] of [['EQUIP_ITEM', { itemKey: 'weapon_sword', userId: other.id }],
      ['UNEQUIP_ITEM', { slot: 'armor', userId: other.id }], ['USE_ITEM', { itemKey: 'potion_red', userId: other.id }]]) {
      const transport = Auth.createSupabaseTransport({ client: u.client, projectUrl: config.url, publishableKey: config.publishableKey });
      const denied = await transport({ method: 'POST', path: '/commands', headers: { 'If-Match': String(version(u)) },
        body: command(type, payload) });
      assert.equal(denied.ok, false);
      assert.equal(denied.errorCode, 'INVALID_PAYLOAD');
    }
    await refresh(other);
    assert.deepEqual(snapshot(state(other)), foreignBefore, 'foreign attacks changed the other member');
  }
  pass('bidirectional-foreign-ticket-inventory-equipment-commands-denied');
  assert.ok(state(a).recentEconomyTransactions.length > 10);
  await finishVerification(a, b);
}
async function setup(label) {
  stage = 'signup-' + label;
  const u = { label, email: `lifequest-phase5c3-${label}-${runId}@example.com`,
    password: crypto.randomBytes(24).toString('base64url') + '!Aa9',
    authStorage: storage(), pending: storage(), requests: [] };
  users.push(u);
  u.pending.setItem('lifequest_state', guestSave);
  u.client = createClient(config.url, config.publishableKey, { auth: { persistSession: true,
    storage: u.authStorage, storageKey: 'phase5c3-' + label + '-' + runId,
    autoRefreshToken: false, detectSessionInUrl: false } });
  if (process.env.PHASE5C3_RESUME_RUN_ID) {
    // Credentials supplied only through this process's in-memory resume map.
    const credential = resumeCredentials.get(label);
    assert.ok(credential);
    u.password = credential.password;
    const login = await u.client.auth.signInWithPassword({ email: u.email, password: u.password });
    assert.ok(!login.error && login.data.session, 'temporary resume login failed');
    u.id = login.data.user.id;
    assert.equal(u.id, credential.id);
    wire(u);
    const restored = await u.coordinator.start();
    u.coordinator.stop();
    assert.ok(restored.ok && restored.state);
    report('TEMP_RESUMED', { label, id: u.id });
    return u;
  }
  const signup = await u.client.auth.signUp({ email: u.email, password: u.password,
    options: { data: { adventurer_name: 'P5C' + label.toUpperCase() + runId.slice(0, 6) } } });
  if (signup.data?.user?.id) {
    u.id = signup.data.user.id;
    report('TEMP_ACCOUNT', { label, id: u.id, ...(phase6b2Mode ? {} : { email: u.email }) });
  }
  assert.ok(!signup.error && signup.data?.session, 'signup/session failed ' + label);
  wire(u);
  const initialized = await u.coordinator.start();
  u.coordinator.stop(); // no background listener while the deterministic runner drives commands
  assert.ok(initialized.ok && initialized.state);
  await success(u, 'selectMainQuest', { questId: label === 'a' ? 'sleep' : 'exercise' });
  return u;
}
function price(u, key) {
  const item = state(u).catalog.find(x => x.itemKey === key);
  assert.ok(item && item.currency === 'gold');
  return Math.floor(item.basePrice * (1 - Math.min(state(u).player.baseStats.wealth * .01, .2)));
}
async function earnMinimumFunds(u, ready) {
  // Only new, explicitly named temporary users. All funding has normal Daily
  // receipts/ledger; no balance seeds, correction, catalog edit or existing user.
  assert.equal(u.email, `lifequest-phase5c3-${u.label}-${runId}@example.com`);
  for (let days = 7; !ready() && days >= 0; days--) {
    const date = new Date(today + 'T00:00:00Z');
    date.setUTCDate(date.getUTCDate() - days);
    await success(u, 'submitDailyEntry', { businessDate: date.toISOString().slice(0, 10),
      input: { sleep: 8, water: 2000, exercise: 40, study: 30, expense: 100, impulse: 0, sugaryDrinks: 0 } });
    report('FUNDING_RECEIPT', { label: u.label, businessDate: date.toISOString().slice(0, 10),
      operationId: u.requests.at(-1).command.operationId, gold: state(u).player.gold, gems: state(u).player.gems });
  }
  assert.ok(ready(), 'minimum traced funding could not be prepared');
}
async function verifyPurchaseRace(b) {
  let keys = ['weapon_sword', 'armor_shield'];
  await earnMinimumFunds(b, () => state(b).player.gold >= Math.max(...keys.map(k => price(b, k))) && state(b).player.gems >= 3);
  // Critical rewards can increase fixture funds. Pick two unchanged catalog
  // equipment offers satisfying the invariant instead of assuming fixed prices.
  const available = state(b).catalog.filter(x => ['weapon', 'armor', 'pet'].includes(x.itemType)).map(x => x.itemKey);
  const pairs = available.flatMap((key, i) => available.slice(i + 1).map(other => [key, other]));
  keys = pairs.find(pair => state(b).player.gold >= Math.max(...pair.map(k => price(b, k)))
    && state(b).player.gold < pair.reduce((sum, k) => sum + price(b, k), 0));
  assert.ok(keys, 'no unchanged catalog pair fits the traced fixture balance');
  const prices = keys.map(k => price(b, k));
  const gold = state(b).player.gold;
  assert.ok(gold >= Math.max(...prices) && gold < prices[0] + prices[1], 'race funding must afford either item, not both');
  assert.equal(state(b).inventory.length, 0);
  pass('purchase-race-preconditions', { gold, keys, prices });
  const { commands, results } = await race(b, 'PURCHASE_ITEM', keys.map(k => offer(b, k)));
  const winner = results.findIndex(x => x.ok);
  assert.equal(state(b).player.gold, gold - prices[winner]);
  assert.ok(state(b).player.gold >= 0);
  assert.equal(state(b).inventory.length, 1);
  assert.equal(qty(state(b), keys[winner]), 1);
  assert.equal(qty(state(b), keys[1 - winner]), 0);
  const ops = commands.map(c => c.operationId);
  const tx = await b.client.from('economy_transactions').select('operation_id,currency_delta,paid_amount_snapshot').in('operation_id', ops);
  const ledger = await b.client.from('resource_ledger').select('operation_id').eq('resource_type', 'gold').in('operation_id', ops);
  assert.ok(!tx.error && !ledger.error);
  assert.equal(tx.data.length, 1); assert.equal(ledger.data.length, 1);
  assert.equal(tx.data[0].operation_id, ops[winner]);
  assert.equal(tx.data[0].currency_delta, -prices[winner]);
  assert.equal(tx.data[0].paid_amount_snapshot, prices[winner]);
  assert.equal(ledger.data[0].operation_id, ops[winner]);
  // Retrying the winner replays; retrying the loser with a fresh version still
  // cannot spend the same funds twice. No automatic production retry is added.
  const settledVersion = version(b);
  assert.equal((await raw(b, commands[winner], settledVersion - 1)).duplicate, true);
  const loser = await raw(b, commands[1 - winner], settledVersion);
  assert.equal(loser.ok, false);
  assert.equal(loser.errorCode, 'INSUFFICIENT_RESOURCE');
  await refresh(b);
  assert.equal(version(b), settledVersion);
  assert.equal(state(b).player.gold, gold - prices[winner]);
  pass('purchase-concurrency-one-item-one-debit-one-ledger', { beforeGold: gold, afterGold: state(b).player.gold,
    prices, repositoryVersion: settledVersion });
}
async function verifyRemaining() {
  const a = await setup('a');
  const b = await setup('b');
  await earnMinimumFunds(a, () => state(a).player.gold >= price(a, 'weapon_sword') + price(a, 'potion_red') && state(a).player.gems >= 3);
  await verifyPurchaseRace(b);
  await success(a, 'purchaseItem', offer(a, 'weapon_sword'));
  await success(a, 'equipItem', { itemKey: 'weapon_sword' });
  // A minimal response-loss smoke test; actual committed response is dropped,
  // then the production pending journal must reuse the same operationId.
  const before = clone(state(a));
  a.dropNext = true;
  const uncertain = await a.coordinator.purchaseItem(offer(a, 'potion_red'));
  assert.equal(uncertain.errorCode, 'NETWORK_ERROR');
  assert.equal(state(a).player.gold, before.player.gold);
  const lost = a.requests.at(-1).command;
  const retried = await a.coordinator.purchaseItem(offer(a, 'potion_red'));
  assert.ok(retried.ok && retried.duplicate);
  assert.equal(a.requests.at(-1).command.operationId, lost.operationId);
  assert.equal(version(a), before.meta.repositoryVersion + 1);
  assert.equal(qty(state(a), 'potion_red'), 1);
  const reused = await raw(a, { ...lost, payload: offer(a, 'armor_shield') }, version(a));
  assert.equal(reused.errorCode, 'OPERATION_ID_REUSED');
  pass('remaining-response-loss-journal-retry-and-id-reuse');
  // Both users own a real ticket, so A/B tests do not pass on empty fixtures.
  for (const u of [a, b]) {
    assert.ok(state(u).player.gems >= 3);
    const redeemed = await success(u, 'redeemRewardTicket', {
      ticketKey: 'rest_30', seenCatalogVersion: offer(u, 'rest_30').seenCatalogVersion });
    u.ticketId = redeemed.ticketInstanceId;
  }
  for (const [u, other] of [[a, b], [b, a]]) {
    await negative(u, 'useRewardTicket', { ticketInstanceId: other.ticketId }, 'TICKET_NOT_FOUND');
    await negative(u, 'reverseRewardTicket', { ticketInstanceId: other.ticketId }, 'TICKET_NOT_FOUND');
    const foreignBefore = snapshot(state(other));
    for (const [type, payload] of [['EQUIP_ITEM', { itemKey: 'weapon_sword', userId: other.id }],
      ['USE_ITEM', { itemKey: 'potion_red', userId: other.id }]]) {
      const forged = command(type, payload);
      const transport = Auth.createSupabaseTransport({ client: u.client, projectUrl: config.url, publishableKey: config.publishableKey });
      const denied = await transport({ method: 'POST', path: '/commands', headers: { 'If-Match': String(version(u)) }, body: forged });
      assert.equal(denied.ok, false, 'foreign ownership payload accepted');
      assert.equal(denied.errorCode, 'INVALID_PAYLOAD');
    }
    await refresh(other);
    assert.deepEqual(snapshot(state(other)), foreignBefore);
  }
  pass('bidirectional-foreign-ticket-and-forged-inventory-equipment-owner-denied');
  // Populate only the missing history length with zero-cost equip/unequip.
  for (let i = 0; state(a).recentEconomyTransactions.length < 11 && i < 12; i++) {
    if (state(a).equipment.some(x => x.slot === 'weapon')) await success(a, 'unequipItem', { slot: 'weapon' });
    else await success(a, 'equipItem', { itemKey: 'weapon_sword' });
  }
  assert.ok(state(a).recentEconomyTransactions.length >= 11);
  await finishVerification(a, b);
}
async function verify() {
  const a = await setup('a');
  const b = await setup('b');
  pass('register-bootstrap-two-isolated-members');
  // Real, first-time daily entries prepare legitimate funds. No direct resource seeds,
  // no corrections, no updates to existing users, no changes to catalog or definitions.
  for (let days = 7; days >= 0; days--) {
    const date = new Date(today + 'T00:00:00Z');
    date.setUTCDate(date.getUTCDate() - days);
    await success(a, 'submitDailyEntry', { businessDate: date.toISOString().slice(0, 10),
      input: { sleep: 8, water: 2000, exercise: 40, study: 30, expense: 100, impulse: 0, sugaryDrinks: 0 } });
  }
  assert.ok(state(a).player.gold >= 250 && state(a).player.gems >= 8, 'insufficient real earned test resources');
  pass('resources-earned-via-real-gameplay', { gold: state(a).player.gold, gems: state(a).player.gems });

  const initial = clone(state(a).player);
  const potionOffer = offer(a, 'potion_red');
  const potionPrice = Math.floor(state(a).catalog.find(x => x.itemKey === 'potion_red').basePrice *
    (1 - Math.min(initial.baseStats.wealth * .01, .2)));
  await success(a, 'purchaseItem', potionOffer);
  assert.equal(state(a).player.gold, initial.gold - potionPrice);
  assert.equal(qty(state(a), 'potion_red'), 1);
  assert.equal(state(a).player.hp, initial.hp);
  assert.equal(state(a).equipment.length, 0);
  pass('purchase-price-gold-inventory-no-auto-use');
  await negative(a, 'useItem', { itemKey: 'potion_red' }, 'HP_ALREADY_FULL');
  assert.equal(qty(state(a), 'potion_red'), 1);
  await success(a, 'reportHabitEvent', { habitId: 'sedentary_screen' });
  const damaged = state(a).player.hp;
  const used = await success(a, 'useItem', { itemKey: 'potion_red' });
  assert.equal(state(a).player.hp, Math.min(initial.maxHp, damaged + 15));
  assert.equal(qty(state(a), 'potion_red'), 0);
  pass('potion-full-hp-denied-and-missing-hp-only', { healed: used.healed });

  for (const [slot, key] of [['weapon', 'weapon_sword'], ['armor', 'armor_shield'], ['pet', 'pet_cactus']]) {
    const base = clone(state(a).player.baseStats);
    await success(a, 'purchaseItem', offer(a, key));
    assert.ok(!state(a).equipment.some(x => x.slot === slot));
    await success(a, 'equipItem', { itemKey: key });
    assert.equal(state(a).equipment.find(x => x.slot === slot)?.itemKey, key);
    assert.deepEqual(state(a).player.baseStats, base);
    const view = EconomyUi.createMemberEconomyViewModel(state(a));
    for (const stat of EconomyUi.STAT_KEYS) assert.equal(view.stats.final[stat],
      view.stats.base[stat] + view.stats.equipment[stat] + view.stats.status[stat]);
    await success(a, 'unequipItem', { slot });
    assert.ok(!state(a).equipment.some(x => x.slot === slot));
    await success(a, 'equipItem', { itemKey: key });
  }
  pass('weapon-armor-pet-derived-stats-base-unchanged');

  const gemsBefore = state(a).player.gems;
  const ticketOffer = key => ({ ticketKey: key, seenCatalogVersion: offer(a, key).seenCatalogVersion });
  const redeemed = await success(a, 'redeemRewardTicket', ticketOffer('rest_30'));
  const usedId = redeemed.ticketInstanceId;
  assert.equal(state(a).player.gems, gemsBefore - 3);
  await negative(b, 'useRewardTicket', { ticketInstanceId: usedId }, 'TICKET_NOT_FOUND');
  await race(a, 'USE_REWARD_TICKET', [{ ticketInstanceId: usedId }, { ticketInstanceId: usedId }]);
  assert.equal(state(a).rewardTickets.find(x => x.id === usedId)?.status, 'used');
  await negative(a, 'reverseRewardTicket', { ticketInstanceId: usedId }, 'TICKET_ALREADY_USED');
  const refundable = await success(a, 'redeemRewardTicket', ticketOffer('favorite_drink'));
  const refundId = refundable.ticketInstanceId;
  const acquisition = state(a).rewardTickets.find(x => x.id === refundId);
  const refundBefore = state(a).player.gems;
  const refunded = await success(a, 'reverseRewardTicket', { ticketInstanceId: refundId });
  assert.equal(refunded.refundedGems, acquisition.gemCost);
  assert.equal(state(a).player.gems, refundBefore + acquisition.gemCost);
  assert.equal(state(a).rewardTickets.find(x => x.id === refundId)?.status, 'reversed');
  // Negative terminal-state request checked without assuming error-code naming.
  const terminalVersion = version(a);
  const terminal = await a.coordinator.useRewardTicket({ ticketInstanceId: refundId });
  assert.equal(terminal.ok, false);
  await refresh(a);
  assert.equal(version(a), terminalVersion);
  pass('ticket-lifecycle-snapshot-refund-cross-user-and-concurrent-use');

  // Only response delivery is interrupted. Backend transaction remains untouched.
  const beforeLoss = clone(state(a));
  a.dropNext = true;
  const uncertain = await a.coordinator.purchaseItem(offer(a, 'potion_red'));
  assert.equal(uncertain.ok, false);
  assert.equal(uncertain.errorCode, 'NETWORK_ERROR');
  const lostCommand = a.requests.at(-1).command;
  assert.equal(state(a).player.gold, beforeLoss.player.gold, 'uncertain result shown as success');
  const retry = await a.coordinator.purchaseItem(offer(a, 'potion_red'));
  assert.equal(retry.ok, true);
  assert.equal(retry.duplicate, true);
  assert.equal(a.requests.at(-1).command.operationId, lostCommand.operationId);
  assert.equal(version(a), beforeLoss.meta.repositoryVersion + 1);
  assert.equal(qty(state(a), 'potion_red'), qty(beforeLoss, 'potion_red') + 1);
  const rows = await a.client.from('economy_transactions').select('id').eq('operation_id', lostCommand.operationId);
  assert.ok(!rows.error && rows.data.length === 1);
  const ledger = await a.client.from('resource_ledger').select('id').eq('operation_id', lostCommand.operationId).eq('resource_type', 'gold');
  assert.ok(!ledger.error && ledger.data.length === 1);
  const altered = { ...lostCommand, payload: offer(a, 'armor_shield') };
  const reused = await raw(a, altered, beforeLoss.meta.repositoryVersion);
  assert.equal(reused.errorCode, 'OPERATION_ID_REUSED');
  await refresh(a);
  assert.equal(version(a), beforeLoss.meta.repositoryVersion + 1);
  pass('real-committed-response-loss-retry-once-receipt-ledger', { operationId: lostCommand.operationId });

  await negative(a, 'purchaseItem', { itemKey: 'potion_red', seenCatalogVersion: 999999 }, 'CATALOG_CHANGED');
  pass('catalog-changed-refused-no-price-mutation');
  await success(a, 'reportHabitEvent', { habitId: 'sedentary_screen' });
  await race(a, 'USE_ITEM', [{ itemKey: 'potion_red' }, { itemKey: 'potion_red' }]);
  assert.equal(qty(state(a), 'potion_red'), 0);
  await race(a, 'EQUIP_ITEM', [{ itemKey: 'weapon_sword' }, { itemKey: 'weapon_sword' }]);
  assert.equal(state(a).equipment.filter(x => x.slot === 'weapon').length, 1);
  await verifyPurchaseRace(b);
  pass('purchase-potion-slot-concurrency-and-version-conflict');
  await finishVerification(a, b);
}
async function finishVerification(a, b) {
  const tables = ['profiles', 'member_game_roots', 'player_states', 'player_inventory', 'player_equipment',
    'player_reward_tickets', 'economy_transactions', 'resource_ledger', 'player_achievements'];
  const anon = createClient(config.url, config.publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
  for (const [u, other] of [[a, b], [b, a]]) {
    for (const table of tables) {
      stage = `${u.label}:RLS:${table}`;
      const own = await u.client.from(table).select('user_id').in('user_id', [u.id, other.id]);
      assert.ok(!own.error && own.data.every(x => x.user_id === u.id), stage + ' own SELECT');
      if (['profiles', 'member_game_roots', 'player_states', 'player_inventory', 'player_equipment',
        'player_reward_tickets', 'economy_transactions', 'resource_ledger'].includes(table)) assert.ok(own.data.length, stage + ' fixture must not be empty');
      const foreign = await u.client.from(table).select('user_id').eq('user_id', other.id);
      assert.ok(!foreign.error && foreign.data.length === 0, stage + ' cross SELECT');
      assert.equal((await u.client.from(table).insert({ user_id: u.id })).error?.code, '42501', stage + ' INSERT permission');
      for (const target of [u.id, other.id]) {
        assert.equal((await u.client.from(table).update({ user_id: target }).eq('user_id', target)).error?.code, '42501', stage + ' UPDATE permission');
        assert.equal((await u.client.from(table).delete().eq('user_id', target)).error?.code, '42501', stage + ' DELETE permission');
      }
      const unauthenticated = await anon.from(table).select('user_id').in('user_id', [u.id, other.id]);
      assert.ok(unauthenticated.error || unauthenticated.data.length === 0, stage + ' anon');
    }
    const rpc = await u.client.rpc('execute_phase5b_economy_command', {
      p_user_id: u.id, p_command: {}, p_expected_version: version(u) });
    assert.ok(rpc.error, 'browser economy RPC allowed');
  }
  pass('real-jwt-AB-select-write-isolation-anon-and-sensitive-rpc-denied');

  stage = 'history-latest-ten';
  const history = EconomyUi.createMemberEconomyViewModel(state(a)).recentTransactions;
  assert.equal(history.length, 10);
  const historyRows = await a.client.from('economy_transactions').select('id,created_at,transaction_type,paid_amount_snapshot,item_name_snapshot')
    .order('created_at', { ascending: false }).limit(10);
  assert.ok(!historyRows.error);
  for (const type of ['purchase_item', 'use_item', 'equip_item', 'unequip_item', 'redeem_reward_ticket', 'use_reward_ticket']) {
    assert.ok(history.some(row => row.type === type), 'history missing transaction fixture: ' + type);
  }
  assert.deepEqual(history.map(x => x.id), historyRows.data.map(x => x.id));
  for (const [i, row] of historyRows.data.entries()) {
    assert.equal(history[i].paidAmount, Number(row.paid_amount_snapshot || 0));
    assert.equal(history[i].itemName, row.item_name_snapshot);
    assert.equal(history[i].type, row.transaction_type);
    assert.equal(Date.parse(history[i].createdAt), Date.parse(row.created_at));
  }
  const changedDisplayCatalog = clone(state(a));
  changedDisplayCatalog.catalog.forEach(x => { x.basePrice += 9999; x.title = 'TEST DISPLAY ONLY'; });
  assert.deepEqual(EconomyUi.createMemberEconomyViewModel(changedDisplayCatalog).recentTransactions, history,
    'historical receipts must not be recalculated from the display catalog');
  pass('latest-ten-real-history-through-production-view-model', { projectionRows: state(a).recentEconomyTransactions.length,
    visibleRows: history.length, types: [...new Set(history.map(row => row.type))] });
  stage = 'session-restore';
  await refresh(a);
  await refresh(b);
  const beforeReload = snapshot(state(a));
  a.coordinator.stop();
  // New Auth client reads persisted session from isolated in-memory storage.
  a.client = createClient(config.url, config.publishableKey, { auth: { persistSession: true,
    storage: a.authStorage, storageKey: 'phase5c3-a-' + runId, autoRefreshToken: false, detectSessionInUrl: false } });
  wire(a);
  const reloaded = await a.coordinator.start();
  a.coordinator.stop();
  assert.ok(reloaded.ok && reloaded.session?.user.id === a.id);
  assert.deepEqual(snapshot(state(a)), beforeReload);
  const logout = await a.coordinator.logout();
  assert.equal(logout.ok, true);
  assert.equal(a.coordinator.getMemberState(), null);
  assert.equal((await a.client.auth.getSession()).data.session, null);
  assert.equal(a.pending.getItem('lifequest_state'), guestSave);
  // Reuse the same coordinator for B then A: no A projection during B loading.
  const loginBPromise = a.coordinator.login({ email: b.email, password: b.password });
  assert.equal(a.coordinator.getMemberState(), null);
  assert.ok((await loginBPromise).ok);
  assert.deepEqual(snapshot(state(a)), snapshot(state(b)));
  assert.equal((await a.coordinator.logout()).ok, true);
  assert.equal(a.coordinator.getMemberState(), null);
  const login = await a.coordinator.login({ email: a.email, password: a.password });
  assert.ok(login.ok);
  assert.deepEqual(snapshot(state(a)), beforeReload);
  pass('real-session-restore-cloud-load-logout-login-and-guest-sentinel');
  report('LIVE_RESULT', { ok: true, projectRef: REF, runId, checks,
    users: users.map(u => ({ label: u.label, id: u.id })), versions: users.map(u => ({ label: u.label, version: version(u) })) });
}

const PHASE6B2_TABLES = ['profiles','member_game_roots','daily_drafts','custom_habits','rule_preferences',
  'player_states','daily_entries','daily_entry_revisions','habit_events','resource_ledger',
  'status_effects','player_achievements','boss_encounters','boss_actions','player_inventory',
  'player_equipment','player_reward_tickets','economy_transactions'];
async function phase6b2Http(u, type, payload, expectedVersion, operationId = 'p6b2-' + crypto.randomUUID()) {
  const session = (await u.client.auth.getSession()).data?.session;
  assert.ok(session?.access_token);
  const c = Contract.createCommandEnvelope({ type, payload, operationId, businessDate: today });
  const headers = { apikey: config.publishableKey, Authorization: 'Bearer ' + session.access_token,
    'Content-Type': 'application/json', 'Idempotency-Key': operationId };
  if (expectedVersion !== undefined) headers['If-Match'] = String(expectedVersion);
  const response = await fetch(config.url + '/functions/v1/lifequest-command',
    { method: 'POST', headers, body: JSON.stringify(c), signal: AbortSignal.timeout(45000) });
  let body = {}; try { body = await response.json(); } catch (_) { /* safe empty */ }
  return { status: response.status, body, command: c };
}
async function phase6b2Gate(name) {
  report('MCP_SNAPSHOT_REQUIRED', { name, users: users.map(u => ({ label: u.label, id: u.id })) });
  await new Promise(resolve => {
    const keepAlive = setInterval(() => {}, 1000);
    process.stdin.resume();
    process.stdin.once('data', () => { clearInterval(keepAlive); process.stdin.pause(); resolve(); });
  });
  report('MCP_SNAPSHOT_CONTINUE', { name });
}
async function verifyPhase6B2() {
  const a = await setup('a'), b = await setup('b');
  const actors = [a,b];
  for (const u of actors) {
    await success(u, 'updateProfile', { dailyBudget: u.label === 'a' ? 501 : 502 });
    await success(u, 'createCustomHabit', { title: 'P6B2-' + u.label + '-' + runId, direction: 'good' });
    u.customHabitId = state(u).customHabits.find(x => x.title === 'P6B2-' + u.label + '-' + runId)?.id;
    assert.ok(u.customHabitId);
    const event = await success(u, 'reportHabitEvent', { habitId: u.customHabitId });
    u.habitEventId = event.eventId;
    assert.ok(u.habitEventId);
    await success(u, 'removeCustomHabit', { habitId: u.customHabitId });
    await earnMinimumFunds(u, () => state(u).player.gold >= 180 && state(u).player.gems >= 6);
  }
  await success(a, 'purchaseItem', offer(a, 'weapon_sword'));
  await success(a, 'equipItem', { itemKey: 'weapon_sword' });
  await success(a, 'purchaseItem', offer(a, 'potion_red'));
  await success(b, 'purchaseItem', offer(b, 'armor_shield'));
  await success(b, 'equipItem', { itemKey: 'armor_shield' });
  await success(b, 'purchaseItem', offer(b, 'potion_red'));
  for (const u of actors) {
    const redeemed = await success(u, 'redeemRewardTicket',
      { ticketKey: 'rest_30', seenCatalogVersion: offer(u, 'rest_30').seenCatalogVersion });
    u.ticketId = redeemed.ticketInstanceId;
    assert.ok(u.ticketId);
  }
  pass('legitimate-A-and-B-positive-controls');

  // Successful version path, exact duplicate, changed-payload reuse and true concurrency.
  const originalVersion = version(a);
  const idempotentCommand = command('SET_RULE_ENABLED', { ruleId: 'rule_1', enabled: false });
  let result = await raw(a, idempotentCommand, originalVersion);
  assert.equal(result.ok, true);
  await refresh(a);
  assert.equal(version(a), originalVersion + 1);
  const duplicate = await raw(a, idempotentCommand, originalVersion);
  assert.equal(duplicate.ok, true); assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.repositoryVersion, version(a));
  const reused = await raw(a, { ...idempotentCommand,
    payload: { ruleId: 'rule_1', enabled: true } }, originalVersion);
  assert.equal(reused.errorCode, 'OPERATION_ID_REUSED');
  await race(a, 'UPDATE_PROFILE', [{ dailyBudget: 503 }, { dailyBudget: 504 }]);
  pass('expected-version-concurrency-idempotency-positive-controls');

  // Correct catalog versions have already succeeded above. Negative cases begin after the DB audit fence.
  await phase6b2Gate('before-negative-attacks');
  async function expectRejected(u, type, payload, expectedVersion, codes, operationId) {
    const before = version(u);
    const out = await phase6b2Http(u, type, payload, expectedVersion, operationId);
    assert.ok(codes.includes(out.body.errorCode), type + ':' + JSON.stringify(out.body));
    await refresh(u);
    assert.equal(version(u), before, type + ' changed repositoryVersion');
    return out;
  }
  for (const u of actors) {
    await expectRejected(u, 'UPDATE_PROFILE', { dailyBudget: 510 }, undefined, ['INVALID_PAYLOAD']);
    await expectRejected(u, 'UPDATE_PROFILE', { dailyBudget: 510 }, 'bad', ['INVALID_PAYLOAD']);
    await expectRejected(u, 'UPDATE_PROFILE', { dailyBudget: 510 }, Math.max(0,version(u)-1), ['VERSION_CONFLICT']);
    await expectRejected(u, 'UPDATE_PROFILE', { dailyBudget: 510 }, version(u)+10, ['VERSION_CONFLICT']);
    for (const [type,key,value] of [['PURCHASE_ITEM','itemKey','pet_cactus'],
      ['REDEEM_REWARD_TICKET','ticketKey','favorite_drink']]) {
      await expectRejected(u,type,{[key]:value},version(u),['INVALID_PAYLOAD']);
      for (const bad of [null,0,'1',1.5,9007199254740992]) {
        await expectRejected(u,type,{[key]:value,seenCatalogVersion:bad},version(u),['INVALID_PAYLOAD']);
      }
      await expectRejected(u,type,{[key]:value,seenCatalogVersion:999999},version(u),['CATALOG_CHANGED']);
    }
    for (const field of ['userId','ownerId','playerId','profileId']) {
      await expectRejected(u,'UPDATE_PROFILE',{dailyBudget:510,[field]:actors.find(x=>x!==u).id},
        version(u),['INVALID_PAYLOAD']);
    }
    for (const field of ['gold','gems','price','discount','reward','refund','quantity','hp','xp','level']) {
      await expectRejected(u,'PURCHASE_ITEM',{itemKey:'pet_cactus',
        seenCatalogVersion:offer(u,'pet_cactus').seenCatalogVersion,[field]:1},
        version(u),['INVALID_PAYLOAD']);
    }
  }
  pass('expected-and-catalog-negative-contracts');

  for (const [u,other] of [[a,b],[b,a]]) {
    for (const table of PHASE6B2_TABLES) {
      const own = await u.client.from(table).select('user_id').eq('user_id',u.id);
      assert.equal(own.error,null,table+' own read');
      const foreign = await u.client.from(table).select('*').eq('user_id',other.id);
      assert.equal(foreign.error,null,table+' cross read'); assert.deepEqual(foreign.data,[]);
      assert.equal((await u.client.from(table).insert({user_id:other.id})).error?.code,'42501',table+' insert');
      assert.equal((await u.client.from(table).update({user_id:u.id}).eq('user_id',other.id)).error?.code,'42501',table+' update');
      assert.equal((await u.client.from(table).delete().eq('user_id',other.id)).error?.code,'42501',table+' delete');
    }
    await expectRejected(u,'USE_REWARD_TICKET',{ticketInstanceId:other.ticketId},version(u),['TICKET_NOT_FOUND']);
    await expectRejected(u,'REVERSE_REWARD_TICKET',{ticketInstanceId:other.ticketId},version(u),['TICKET_NOT_FOUND']);
    await expectRejected(u,'REDEEM_REWARD_TICKET',{ticketInstanceId:other.ticketId,
      ticketKey:'rest_30',seenCatalogVersion:offer(u,'rest_30').seenCatalogVersion},version(u),['INVALID_PAYLOAD']);
    const foreignItem = other === a ? 'weapon_sword' : 'armor_shield';
    await expectRejected(u,'USE_ITEM',{itemKey:foreignItem},version(u),['ITEM_NOT_OWNED','ITEM_NOT_USABLE']);
    await expectRejected(u,'EQUIP_ITEM',{itemKey:foreignItem},version(u),['ITEM_NOT_OWNED']);
    const foreignSlot = foreignItem === 'weapon_sword' ? 'weapon' : 'armor';
    await expectRejected(u,'UNEQUIP_ITEM',{slot:foreignSlot},version(u),['ITEM_NOT_OWNED']);
    for (const type of ['UPDATE_CUSTOM_HABIT','REMOVE_CUSTOM_HABIT','RESTORE_CUSTOM_HABIT']) {
      const payload = {habitId:other.customHabitId,...(type==='UPDATE_CUSTOM_HABIT'?{title:'cross-account'}:{})};
      await expectRejected(u,type,payload,version(u),['NOT_FOUND']);
    }
    await expectRejected(u,'REVERSE_HABIT_EVENT',{eventId:other.habitEventId},version(u),['HABIT_EVENT_NOT_FOUND']);
  }
  pass('bidirectional-read-write-entity-and-ownership-attacks');

  const anon = createClient(config.url,config.publishableKey,{auth:{persistSession:false,autoRefreshToken:false}});
  for (const table of PHASE6B2_TABLES) {
    const out=await anon.from(table).select('*').in('user_id',[a.id,b.id]);
    assert.ok(out.error || out.data.length===0,table+' anon read');
  }
  for (const client of [anon,a.client,b.client]) {
    for (const [rpc,args] of [
      ['execute_phase3_command',{p_user_id:a.id,p_command:{},p_expected_version:version(a)}],
      ['execute_phase4b_command',{p_user_id:a.id,p_command:{},p_expected_version:version(a),p_plan:{}}],
      ['execute_phase5b_economy_command',{p_user_id:a.id,p_command:{},p_expected_version:version(a)}],
      ['get_phase4b_operation_receipt',{p_user_id:a.id,p_command:{}}]
    ]) {
      const out=await client.rpc(rpc,args);
      assert.equal(out.error?.code,'42501',rpc+' direct call must reach ACL denial');
    }
  }
  pass('anon-and-sensitive-rpc-attacks');
  await phase6b2Gate('after-negative-attacks');
  report('LIVE_RESULT',{ok:true,projectRef:REF,runId,checks,
    users:users.map(u=>({label:u.label,id:u.id})),versions:users.map(u=>({label:u.label,version:version(u)}))});
}
async function main() {
  if (!['--authorized-phase5c3','--authorized-phase6b2'].includes(process.argv[2])) {
    throw new Error('Explicit authorized live-verification mode required');
  }
  report('START', { projectRef: REF, runId });
  if (process.env.PHASE5C3_RESUME_RUN_ID) await prepareTemporaryResume();
  try { await (phase6b2Mode ? verifyPhase6B2()
    : process.argv.includes('--closure-remaining') ? verifyClosureRemaining()
    : process.argv.includes('--remaining') ? verifyRemaining() : verify()); }
  catch (error) {
    report('STOP_ON_FAILURE', { stage, error, checks });
    process.exitCode = 1;
  } finally {
    for (const u of users) {
      u.coordinator?.stop();
      if (!u.id) continue;
      const { error } = await u.client.auth.signOut({ scope: 'global' });
      report('GLOBAL_SIGNOUT', { label: u.label, id: u.id, ok: !error, ...(error ? { error } : {}) });
      if (error) process.exitCode = 1;
      u.password = null;
    }
    report('AUTH_DELETE_REQUIRED', { runId, users: users.filter(u => u.id)
      .map(u => ({ label: u.label, id: u.id, ...(phase6b2Mode ? {} : { email: u.email }) })) });
  }
}
async function prepareTemporaryResume() {
  // The old recovery path exposed a credential hash for a manual DB reset.
  // Fail closed before network/Auth work; fresh authorized test runs still work.
  report('RESUME_DISABLED', { runId });
  throw new Error('Legacy credential-output resume is disabled; use a fresh authorized test run.');
}
main().catch(error => { report('RUNNER_FAILURE', { stage, error }); process.exitCode = 1; });
