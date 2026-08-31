const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const BackendContract = require('../backendContract.js');
const Application = require('../gameApplication.js');
const MemberAuth = require('../memberAuth.js');

const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

function createStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
    value(key) { return values.get(key); }
  };
}

function createAuthClient(session) {
  return {
    auth: {
      async getSession() { return { data: { session }, error: null }; },
      onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
      async signOut() { session = null; return { error: null }; }
    }
  };
}

function cloudState(version = 20) {
  return {
    meta: { repositoryVersion: version, operations: [] },
    member: {
      adventurerName: '經濟測試員', onboardingCompleted: true,
      mainQuestId: 'sleep', dailyBudget: 500, timeZone: 'Asia/Taipei'
    },
    player: {
      totalXp: 200, hp: 50, maxHp: 65, gold: 500, gems: 20,
      baseStats: { health: 10, energy: 10, wealth: 10, growth: 10 }
    },
    dailyDrafts: {}, customHabits: [], rulePreferences: {}, dailyEntries: [], habitEvents: [],
    statusEffects: [], activeBoss: null, achievements: [], catalog: [], inventory: [], equipment: [],
    rewardTickets: [], recentEconomyTransactions: []
  };
}

function createCoordinatorHarness({ failFirstPurchase = false } = {}) {
  const session = { access_token: 'member-token', user: { id: 'phase5c2-member' } };
  const storage = createStorage();
  const posted = [];
  let state = cloudState();
  let purchaseAttempts = 0;
  const coordinator = MemberAuth.createMemberAuthCoordinator({
    supabaseClient: createAuthClient(session),
    projectUrl: 'https://jwpbwlrdzmfzjlbrktlc.supabase.co',
    publishableKey: 'sb_publishable_example',
    storage,
    contract: BackendContract,
    application: Application,
    fetchImpl: async (_url, options) => {
      if (options.method === 'GET') {
        return { ok: true, status: 200, async json() { return { ok: true, state }; } };
      }
      const command = JSON.parse(options.body);
      posted.push(command);
      if (failFirstPurchase && command.type === 'PURCHASE_ITEM' && purchaseAttempts++ === 0) {
        return {
          ok: false,
          status: 503,
          async json() { return { ok: false, errorCode: 'NETWORK_ERROR', retryable: true }; }
        };
      }
      state = cloudState(state.meta.repositoryVersion + 1);
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            ok: true,
            state,
            result: { repositoryVersion: state.meta.repositoryVersion },
            repositoryVersion: state.meta.repositoryVersion
          };
        }
      };
    }
  });
  return { coordinator, posted, storage };
}

test('Member economy coordinator submits all seven server-authoritative command intents', async () => {
  const { coordinator, posted } = createCoordinatorHarness();
  const ticketId = '123e4567-e89b-42d3-a456-426614174099';
  await coordinator.start();
  await coordinator.purchaseItem({ itemKey: 'potion_red', seenCatalogVersion: 2 });
  await coordinator.useItem({ itemKey: 'potion_red' });
  await coordinator.equipItem({ itemKey: 'weapon_sword' });
  await coordinator.unequipItem({ slot: 'weapon' });
  await coordinator.redeemRewardTicket({ ticketKey: 'rest_30', seenCatalogVersion: 3 });
  await coordinator.useRewardTicket({ ticketInstanceId: ticketId });
  await coordinator.reverseRewardTicket({ ticketInstanceId: ticketId });

  assert.deepEqual(posted.map(command => command.type), [
    'PURCHASE_ITEM', 'USE_ITEM', 'EQUIP_ITEM', 'UNEQUIP_ITEM',
    'REDEEM_REWARD_TICKET', 'USE_REWARD_TICKET', 'REVERSE_REWARD_TICKET'
  ]);
  assert.deepEqual(posted.map(command => command.payload), [
    { itemKey: 'potion_red', seenCatalogVersion: 2 },
    { itemKey: 'potion_red' },
    { itemKey: 'weapon_sword' },
    { slot: 'weapon' },
    { ticketKey: 'rest_30', seenCatalogVersion: 3 },
    { ticketInstanceId: ticketId },
    { ticketInstanceId: ticketId }
  ]);
  const forbidden = [
    'userId', 'price', 'basePrice', 'estimatedPrice', 'discount', 'currency',
    'gold', 'gems', 'hp', 'quantity', 'modifier'
  ];
  posted.forEach(command => forbidden.forEach(key => assert.equal(key in command.payload, false)));
});

test('Retry of the same pending economy intent reuses its original operationId', async () => {
  const { coordinator, posted, storage } = createCoordinatorHarness({ failFirstPurchase: true });
  await coordinator.start();
  const first = await coordinator.purchaseItem({ itemKey: 'potion_red', seenCatalogVersion: 2 });
  const second = await coordinator.purchaseItem({ itemKey: 'potion_red', seenCatalogVersion: 2 });

  assert.equal(first.ok, false);
  assert.equal(second.ok, true);
  assert.equal(posted.length, 2);
  assert.equal(posted[0].operationId, posted[1].operationId);
  assert.equal(storage.value('lifequest_pending_operations:member:phase5c2-member'), '[]');
});

test('Purchase, potion and reward ticket mutations require confirmation while equipment is direct', () => {
  const purchase = app.slice(app.lastIndexOf('window.requestMemberItemPurchase'), app.lastIndexOf('window.requestMemberItemUse'));
  const useItem = app.slice(app.lastIndexOf('window.requestMemberItemUse'), app.lastIndexOf('window.requestMemberItemEquip'));
  const equip = app.slice(app.lastIndexOf('window.requestMemberItemEquip'), app.lastIndexOf('window.requestMemberItemUnequip'));
  const unequip = app.slice(app.lastIndexOf('window.requestMemberItemUnequip'), app.lastIndexOf('window.requestMemberTicketRedemption'));
  const redeem = app.slice(app.lastIndexOf('window.requestMemberTicketRedemption'), app.lastIndexOf('window.requestMemberTicketUse'));
  const useTicket = app.slice(app.lastIndexOf('window.requestMemberTicketUse'), app.lastIndexOf('window.requestMemberTicketReverse'));
  const reverseTicket = app.slice(app.lastIndexOf('window.requestMemberTicketReverse'), app.indexOf('async function submitMemberDailyEntry'));

  [purchase, useItem, redeem, useTicket, reverseTicket].forEach(source => {
    assert.match(source, /showModal\(/);
    assert.match(source, /onConfirm:/);
  });
  [equip, unequip].forEach(source => {
    assert.doesNotMatch(source, /showModal\(/);
    assert.match(source, /runMemberEconomyAction\(/);
  });
});

test('Economy action lock ignores concurrent clicks and always clears in finally', () => {
  const runner = app.slice(
    app.indexOf('async function runMemberEconomyAction'),
    app.lastIndexOf('window.requestMemberItemPurchase')
  );
  assert.match(runner, /memberEconomyActionPending\) return/);
  assert.match(runner, /memberEconomyActionPending = true/);
  assert.match(runner, /finally \{\s*if \(!cancelled\) \{\s*memberEconomyActionPending = false/);
  assert.match(app, /const isDisabled = disabled \|\| memberEconomyActionPending/);
});

test('Economy conflicts reload Cloud truth and never auto-resend a transaction', () => {
  const failure = app.slice(
    app.indexOf('async function handleMemberEconomyFailure'),
    app.indexOf('async function runMemberEconomyAction')
  );
  const genericFailure = app.slice(
    app.indexOf('async function handleMemberCommandFailure'),
    app.indexOf('async function handleMemberEconomyFailure')
  );
  assert.match(failure, /CATALOG_CHANGED/);
  assert.match(failure, /reloadMember\(\)/);
  assert.doesNotMatch(failure, /purchaseItem|redeemRewardTicket|execute\(\)/);
  assert.match(genericFailure, /VERSION_CONFLICT/);
  assert.match(genericFailure, /reloadMember\(\)/);
  assert.match(genericFailure, /手動重試/);
});

test('Economy auth failures return to login without treating Guest data as Member truth', () => {
  const failure = app.slice(
    app.indexOf('async function handleMemberEconomyFailure'),
    app.indexOf('async function runMemberEconomyAction')
  );
  assert.match(failure, /AUTH_REQUIRED/);
  assert.match(failure, /SESSION_EXPIRED/);
  assert.match(failure, /memberAuthCoordinator\?\.logout\(\{ reason: 'session-expired' \}\)/);
  assert.match(failure, /setAuthEntranceView\('login'\)/);
  assert.doesNotMatch(failure, /loadState|lifequest_state|LocalStorageRepository/);
});

test('Economy UI maps the actual Phase 5B resource and inventory error codes safely', () => {
  const failure = app.slice(
    app.indexOf('async function handleMemberCommandFailure'),
    app.indexOf('async function handleMemberEconomyFailure')
  );
  [
    'INSUFFICIENT_RESOURCE', 'INVENTORY_LIMIT_REACHED', 'ITEM_NOT_AVAILABLE',
    'ITEM_NOT_OWNED', 'HP_ALREADY_FULL', 'ITEM_NOT_EQUIPPABLE',
    'INVALID_EQUIPMENT_SLOT', 'TICKET_ALREADY_USED', 'CATALOG_CHANGED'
  ].forEach(errorCode => assert.match(failure, new RegExp(`${errorCode}:`)));
  assert.doesNotMatch(failure, /SQLSTATE|stack trace|rpc_phase5/);
});

test('Partial economy response preserves base stats and unrelated Member gameplay slices', () => {
  const current = cloudState(20);
  current.achievements = [{ code: 'boss_slayer', unlocked: true }];
  current.player.baseStats = { health: 12, energy: 13, wealth: 14, growth: 15 };
  const merged = MemberAuth.mergeMemberCloudState(current, {
    meta: { repositoryVersion: 21 },
    player: { gold: 420 },
    inventory: [{ item_key: 'potion_red', item_type: 'potion', quantity: 1 }]
  });
  assert.deepEqual(merged.player.baseStats, { health: 12, energy: 13, wealth: 14, growth: 15 });
  assert.equal(merged.player.gold, 420);
  assert.equal(merged.achievements[0].code, 'boss_slayer');
  assert.equal(merged.inventory[0].quantity, 1);
});

test('Used or reversed reward tickets render no Member command action', () => {
  const renderer = app.slice(
    app.indexOf('function renderMemberShopRewards()'),
    app.indexOf('function renderShopRewards()')
  );
  assert.match(renderer, /ticket\.status === 'unused'/);
  assert.match(renderer, /memberEconomyButton\('member-ticket-use'/);
  assert.match(renderer, /memberEconomyButton\('member-ticket-reverse'/);
  assert.match(renderer, /不可再操作/);
});

test('Member economy success applies only the authoritative server projection', () => {
  const runner = app.slice(
    app.indexOf('async function runMemberEconomyAction'),
    app.lastIndexOf('window.requestMemberItemPurchase')
  );
  assert.match(runner, /result\.state \|\| memberAuthCoordinator\.getMemberState\(\)/);
  assert.match(runner, /applyMemberGameplayProjection\(authoritativeState\)/);
  assert.doesNotMatch(runner, /state\.(?:gold|gems|hp|inventory|equipment)\s*=/);
});

test('Phase 5C-3 opens supply only and Guest economy handlers are unchanged', () => {
  assert.match(app, /const MEMBER_PHASE5_TABS = new Set\(\['privacy-settings'\]\)/);
  assert.match(app, /MEMBER_RESTORABLE_VIEWS[^;]*supply/);
  assert.match(app, /window\.requestEquipmentTrade = function/);
  assert.match(app, /window\.requestRewardTicket = function/);
});
