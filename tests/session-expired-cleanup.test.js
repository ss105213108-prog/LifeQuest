const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { createClient } = require('@supabase/supabase-js');
const Auth = require('../memberAuth.js');
const Contract = require('../backendContract.js');
const Application = require('../gameApplication.js');
const { createHarness, fixture, storage, app, clone } = require('./helpers/member-economy-ui-harness.cjs');

// Production UI, coordinator, repository and SDK; only HTTP, clock, DOM and
// storage are isolated. No test in this file contacts a real Supabase account.
async function expiredSdkHarness(t) {
  const h = await createHarness({ gameplayProjection: true });
  h.coordinator.stop();
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const authStorage = storage(), authKey = 'isolated-cleanup-auth';
  const session = { access_token: 'test-only-token', refresh_token: 'test-only-refresh',
    expires_at: Math.floor(now / 1000) + 3600,
    user: { id: '11111111-1111-4111-8111-111111111111' } };
  authStorage.setItem(authKey, JSON.stringify(session));
  let authRequests = 0, memberPosts = 0, guestHydrations = 0;
  const client = createClient('https://isolated.supabase.co', 'test-public', {
    auth: { storage: authStorage, storageKey: authKey, persistSession: true,
      autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async () => {
      authRequests++;
      now += 31000; // Exhaust the SDK retry window without a real sleep.
      return new Response(JSON.stringify({ message: 'Auth service unavailable' }), { status: 503 });
    } }
  });
  const start = app.indexOf('async function restoreGuestEntranceAfterLogout');
  const end = app.indexOf('async function initializeMemberAuth', start);
  assert.ok(start >= 0 && end > start);
  vm.runInContext(app.slice(start, end), h.context);
  Object.assign(h.context, {
    guestModeController: { exitGuest() { throw new Error('Do not change Guest mode'); } },
    gameApplication: { async initialize() { guestHydrations++; throw new Error('No Guest fallback'); } },
    editingHabitId: 'member-only-edit', pendingModalAction: () => {},
    habitActionLocks: new Set(), ruleToggleLocks: new Set()
  });
  const coordinator = Auth.createMemberAuthCoordinator({
    supabaseClient: client, projectUrl: 'https://isolated.supabase.co', publishableKey: 'test-public',
    storage: h.local, contract: Contract, application: Application,
    onMemberReady: ({ state }) => h.context.applyMemberGameplayProjection(state),
    onSignedOut: details => h.context.restoreGuestEntranceAfterLogout(details),
    fetchImpl: async (_url, options) => {
      if (options.method !== 'GET') memberPosts++;
      return { ok: true, status: 200, json: async () => ({ ok: true, state: fixture() }) };
    }
  });
  t.after(() => { coordinator.stop(); client.auth.stopAutoRefresh(); });
  h.context.memberAuthCoordinator = coordinator;
  assert.equal((await coordinator.start()).ok, true);
  h.local.setItem('lifequest_state_backup_before_restore', 'guest-backup');
  h.local.setItem('lifequest_pending_operations:guest', 'guest-pending');
  const guestBefore = h.local.entries().filter(([key]) => !key.includes(':member:'));
  const pendingKey = 'lifequest_pending_operations:member:' + session.user.id;
  h.local.setItem(pendingKey, JSON.stringify([{ status: 'pending', intentKey: 'older-intent', operationId: 'older-operation', command: {} }]));
  session.expires_at = Math.floor(now / 1000) - 60;
  authStorage.setItem(authKey, JSON.stringify(session));
  return { ...h, coordinator, client, pendingKey, guestBefore,
    evidence: () => ({ authRequests, memberPosts, guestHydrations }) };
}

test('expired Session plus real SDK refresh/signOut 503 clears Member runtime and UI without Guest fallback or a transaction', async t => {
  const h = await expiredSdkHarness(t);
  assert.ok(h.coordinator.getMemberState().player);
  assert.ok(h.context.activeMember);
  h.click('member-item-purchase', 'potion_red');
  await h.confirm();
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(h.evidence().authRequests > 0);
  assert.equal(h.evidence().memberPosts, 0);
  assert.equal(h.coordinator.getMemberState(), null, 'mandatory coordinator cleanup');
  assert.equal(h.coordinator.getSession(), null);
  assert.equal(h.context.activeMember, null);
  assert.deepEqual(Object.keys(h.context.state), [], 'no Member or Guest projection at Login');
  assert.equal(h.context.editingHabitId, null);
  assert.equal(h.context.pendingModalAction, null);
  assert.equal(h.navigation.getItem('currentMemberView'), null);
  assert.equal(h.elements.listShopRewards.markup(), '');
  assert.equal(h.elements.achievementsGrid.markup(), '');
  assert.equal(h.context.memberEconomyActionPending, false);
  assert.equal(h.context.authView, 'login');
  assert.equal(h.elements.authOverlay.classList.contains('active'), true);
  assert.equal(h.evidence().guestHydrations, 0);
  assert.equal(h.local.getItem(h.pendingKey), null);
  assert.deepEqual(h.local.entries().filter(([key]) => !key.includes(':member:')), h.guestBefore);
});

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

async function memberHarness(t, { signOut = '503', readFailure = false } = {}) {
  const h = await createHarness({ gameplayProjection: true });
  h.coordinator.stop();
  const sessionFor = id => ({ access_token: 'test-only-' + id, user: { id } });
  let session = sessionFor('A'), listener, guestHydrations = 0, postCount = 0;
  let pendingRead = null, pendingPost = null, postFailure = null;
  const a = fixture(), b = fixture();
  Object.assign(a, { inventory: [{ itemKey: 'weapon_sword', quantity: 1 }],
    equipment: [{ itemKey: 'weapon_sword', slot: 'weapon' }],
    rewardTickets: [{ id: 'A-ticket', status: 'unused' }],
    recentEconomyTransactions: [{ id: 'A-history', type: 'purchase_item', createdAt: '2026-08-28T00:00:00Z' }] });
  a.member.adventurerName = 'Member A';
  b.member.adventurerName = 'Member B';
  b.player.gold = 37;
  b.achievements = [];
  b.achievementProgress = {};
  const client = { auth: {
    async getSession() { return readFailure
      ? { data: { session: null }, error: { status: 503, message: 'service unavailable' } }
      : { data: { session }, error: null }; },
    async signOut() {
      if (signOut === 'throw') throw new Error('network unavailable');
      if (signOut === '503') return { error: { status: 503, message: 'service unavailable' } };
      session = null;
      listener?.('SIGNED_OUT', null);
      return { error: null };
    },
    async signInWithPassword() { session = sessionFor('B'); return { data: { session }, error: null }; },
    onAuthStateChange(fn) { listener = fn; return { data: { subscription: { unsubscribe() { listener = null; } } } }; }
  } };
  const start = app.indexOf('async function restoreGuestEntranceAfterLogout');
  vm.runInContext(app.slice(start, app.indexOf('async function initializeMemberAuth', start)), h.context);
  Object.assign(h.context, {
    guestModeController: { exitGuest() {} },
    gameApplication: { async initialize() {
      guestHydrations++;
      return vm.runInContext('JSON.parse(JSON.stringify(DEFAULT_STATE))', h.context);
    } }
  });
  const coordinator = Auth.createMemberAuthCoordinator({
    supabaseClient: client, projectUrl: 'https://isolated.invalid', publishableKey: 'test-public',
    storage: h.local, contract: Contract, application: Application,
    onMemberReady: ({ user, state }) => {
      h.context.activeMember = { id: user.id, state };
      h.context.applyMemberGameplayProjection(state);
    },
    onSignedOut: details => h.context.restoreGuestEntranceAfterLogout(details),
    fetchImpl: async (_url, options) => {
      const captured = clone(session.user.id === 'A' ? a : b);
      if (options.method === 'GET') {
        if (pendingRead) await pendingRead.promise;
      } else {
        postCount++;
        if (pendingPost) await pendingPost.promise;
        if (postFailure) return { ok: false, status: 401,
          json: async () => ({ ok: false, errorCode: postFailure, retryable: false }) };
      }
      return { ok: true, status: 200, json: async () => ({ ok: true, state: captured }) };
    }
  });
  h.context.memberAuthCoordinator = coordinator;
  t.after(() => coordinator.stop());
  // Load A before injecting an expired-session failure.
  const initialFailure = readFailure;
  readFailure = false;
  await coordinator.start();
  readFailure = initialFailure;
  return { ...h, coordinator, client, b,
    evidence: () => ({ guestHydrations, postCount }),
    emit: (event, value) => listener?.(event, value),
    allowRead: () => { readFailure = false; },
    holdRead: value => { pendingRead = value; },
    holdPost: value => { pendingPost = value; },
    rejectPost: code => { postFailure = code; } };
}

test('signOut 503 guarantees local coordinator and UI cleanup and reports remote failure honestly', async t => {
  const h = await memberHarness(t);
  const guest = h.local.getItem('lifequest_state');
  const result = await h.coordinator.logout();
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, 'LOGOUT_FAILED');
  assert.equal(h.coordinator.getMemberState(), null);
  assert.equal(h.coordinator.getSession(), null);
  assert.equal(h.context.activeMember, null);
  assert.deepEqual(Object.keys(h.context.state), []);
  assert.equal(h.context.authView, 'login');
  assert.equal(h.evidence().guestHydrations, 0);
  assert.equal(h.local.getItem('lifequest_state'), guest);
});

test('a thrown remote signOut network error still clears local Member references', async t => {
  const h = await memberHarness(t, { signOut: 'throw' });
  assert.equal((await h.coordinator.logout()).ok, false);
  assert.equal(h.coordinator.getMemberState(), null);
  assert.equal(h.context.activeMember, null);
  assert.deepEqual(Object.keys(h.context.state), []);
});

test('A expiry and 503 followed by B login bootstraps B without A economy or achievements', async t => {
  const h = await memberHarness(t, { readFailure: true });
  const guest = h.local.getItem('lifequest_state');
  h.click('member-item-purchase', 'potion_red');
  await h.confirm();
  assert.equal(h.coordinator.getMemberState(), null);
  assert.equal(h.context.activeMember, null);
  assert.deepEqual(Object.keys(h.context.state), []);
  assert.equal(h.evidence().postCount, 0);
  h.allowRead();
  const next = await h.coordinator.login({ email: 'b@example.com', password: 'test-only-password' });
  assert.equal(next.ok, true);
  assert.equal(h.context.activeMember.id, 'B');
  const restored = h.coordinator.getMemberState();
  for (const key of ['inventory', 'equipment', 'rewardTickets', 'achievements', 'recentEconomyTransactions']) {
    assert.deepEqual(restored[key], [], key + ' must not inherit A');
  }
  assert.equal(restored.player.gold, 37);
  assert.equal(h.context.state.memberEconomy.resources.gold, 37);
  assert.equal(h.evidence().guestHydrations, 0);
  assert.equal(h.local.getItem('lifequest_state'), guest);
});

test('late A bootstrap cannot repopulate a cleared Member runtime after signOut failure', async t => {
  const h = await memberHarness(t);
  const gate = deferred();
  h.holdRead(gate);
  const loading = h.coordinator.reloadMember();
  await new Promise(resolve => setImmediate(resolve));
  await h.coordinator.logout({ reason: 'session-expired' });
  assert.equal(h.coordinator.getMemberState(), null);
  gate.resolve();
  await loading;
  assert.equal(h.coordinator.getMemberState(), null, 'late Cloud response must stay invalidated');
  assert.equal(h.context.activeMember, null);
});

test('normal signOut success still clears Member state and preserves the existing Guest entrance flow', async t => {
  const h = await memberHarness(t, { signOut: 'success' });
  const guest = h.local.getItem('lifequest_state');
  assert.equal((await h.coordinator.logout()).ok, true);
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(h.coordinator.getMemberState(), null);
  assert.equal(h.coordinator.getSession(), null);
  assert.equal(h.context.activeMember, null);
  assert.equal(h.context.state.memberEconomy, undefined);
  assert.equal(h.context.authView, 'home');
  assert.equal(h.evidence().guestHydrations, 1, 'SIGNED_OUT and logout finally must not notify twice');
  assert.equal(h.local.getItem('lifequest_state'), guest);
});

test('late A Cloud bootstrap cannot replace B after expiry cleanup and a new login', async t => {
  const h = await memberHarness(t);
  const gate = deferred();
  h.holdRead(gate);
  const loadingA = h.coordinator.reloadMember();
  await new Promise(resolve => setImmediate(resolve));
  await h.coordinator.logout({ reason: 'session-expired' });
  h.holdRead(null);
  await h.coordinator.login({ email: 'b@example.com', password: 'test-only' });
  gate.resolve();
  await loadingA;
  assert.equal(h.coordinator.getMemberState().member.adventurerName, 'Member B');
  assert.equal(h.context.activeMember.id, 'B');
  assert.equal(h.context.state.memberEconomy.resources.gold, 37);
});

test('late A economy response after invalidation cannot restore A or log out the new B session', async t => {
  const h = await memberHarness(t);
  const gate = deferred();
  h.holdPost(gate);
  h.click('member-item-purchase', 'potion_red');
  const pendingA = h.confirm();
  await new Promise(resolve => setImmediate(resolve));
  await h.coordinator.logout({ reason: 'session-expired' });
  await h.coordinator.login({ email: 'b@example.com', password: 'test-only' });
  gate.resolve();
  await pendingA;
  assert.equal(h.coordinator.getMemberState()?.member.adventurerName, 'Member B');
  assert.equal(h.context.activeMember?.id, 'B');
  assert.equal(h.context.state.memberEconomy.resources.gold, 37);
  assert.equal(h.evidence().guestHydrations, 0);
});

test('a cancelled A response cannot unlock the new B transaction while it is pending', async t => {
  const h = await memberHarness(t);
  const aGate = deferred(), bGate = deferred();
  h.holdPost(aGate);
  h.click('member-item-purchase', 'potion_red');
  const pendingA = h.confirm();
  await new Promise(resolve => setImmediate(resolve));
  await h.coordinator.logout({ reason: 'session-expired' });
  await h.coordinator.login({ email: 'b@example.com', password: 'test-only' });
  h.holdPost(bGate);
  h.click('member-item-purchase', 'potion_red');
  const pendingB = h.confirm();
  await new Promise(resolve => setImmediate(resolve));
  aGate.resolve();
  await pendingA;
  assert.equal(h.context.memberEconomyActionPending, true);
  assert.equal(h.context.activeMember.id, 'B');
  bGate.resolve();
  await pendingB;
  assert.equal(h.context.memberEconomyActionPending, false);
  assert.equal(h.context.state.memberEconomy.resources.gold, 37);
});

test('a cached Auth session event after failed signOut cannot resurrect A', async t => {
  const h = await memberHarness(t);
  await h.coordinator.logout({ reason: 'session-expired' });
  h.emit('TOKEN_REFRESHED', { access_token: 'test-only-A', user: { id: 'A' } });
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(h.coordinator.getMemberState(), null);
  assert.equal(h.context.activeMember, null);
  assert.deepEqual(Object.keys(h.context.state), []);
  assert.equal(h.evidence().guestHydrations, 0);
});

test('both Auth error responses clear Member UI without Guest hydration even when remote signOut succeeds', async t => {
  for (const code of ['AUTH_REQUIRED', 'SESSION_EXPIRED']) {
    const h = await memberHarness(t, { signOut: 'success' });
    const guest = h.local.getItem('lifequest_state');
    h.rejectPost(code);
    h.click('member-item-purchase', 'potion_red');
    await h.confirm();
    await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(h.coordinator.getMemberState(), null);
    assert.equal(h.context.activeMember, null);
    assert.deepEqual(Object.keys(h.context.state), []);
    assert.equal(h.context.memberEconomyActionPending, false);
    assert.equal(h.context.authView, 'login');
    assert.equal(h.evidence().guestHydrations, 0);
    assert.equal(h.local.getItem('lifequest_state'), guest);
  }
});

test('new Member commands are rejected while best-effort remote signOut is pending', async t => {
  const h = await memberHarness(t);
  const gate = deferred();
  h.client.auth.signOut = () => gate.promise;
  const logout = h.coordinator.logout({ reason: 'session-expired' });
  const purchase = await h.coordinator.purchaseItem({ itemKey: 'potion_red', seenCatalogVersion: 1 });
  assert.equal(purchase.ok, false);
  assert.equal(purchase.errorCode, 'AUTH_REQUIRED');
  assert.equal(h.evidence().postCount, 0);
  gate.resolve({ error: { status: 503 } });
  await logout;
  assert.equal(h.coordinator.getMemberState(), null);
  assert.equal(h.context.activeMember, null);
});
