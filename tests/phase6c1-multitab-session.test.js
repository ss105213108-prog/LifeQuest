const test = require('node:test');
const assert = require('node:assert/strict');
const Auth = require('../memberAuth.js');
const Contract = require('../backendContract.js');
const Application = require('../gameApplication.js');
const { fixture, storage, clone } = require('./helpers/member-economy-ui-harness.cjs');

function response(body, status = body.ok === false ? 409 : 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => clone(body) };
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function createAuthBus(userId = 'member-shared') {
  let session = { access_token: 'test-shared-token', user: { id: userId } };
  const listeners = new Set();
  const signOutCalls = [];
  return {
    client(label) {
      return { auth: {
        getSession: async () => ({ data: { session }, error: null }),
        signOut: async options => {
          signOutCalls.push({ label, options });
          session = null;
          for (const listener of listeners) listener('SIGNED_OUT', null);
          return { error: null };
        },
        onAuthStateChange(callback) {
          listeners.add(callback);
          return { data: { subscription: { unsubscribe: () => listeners.delete(callback) } } };
        }
      } };
    },
    signOutCalls,
    getSession: () => session
  };
}

function createSharedServer(initialState = fixture()) {
  let state = clone(initialState);
  const receipts = new Map();
  const posts = [];
  let mutationCount = 0;
  let heldType = null;
  let held = null;
  let loseNextResponse = false;
  const requestFingerprint = command => JSON.stringify({
    type: command.type,
    context: command.context,
    payload: command.payload
  });
  const success = (command, duplicate = false, snapshot = state) => ({
    ok: true,
    duplicate,
    repositoryVersion: snapshot.meta.repositoryVersion,
    state: clone(snapshot),
    result: { operationId: command.operationId, duplicate }
  });
  function apply(command) {
    if (command.type === 'UPDATE_PROFILE') {
      state.member = { ...state.member, ...command.payload };
    } else if (command.type === 'PURCHASE_ITEM') {
      state.player.gold -= 10;
      const current = state.inventory.find(row => row.itemKey === command.payload.itemKey);
      if (current) current.quantity++;
      else state.inventory.push({ itemKey: command.payload.itemKey, quantity: 1 });
    } else if (command.type === 'REPORT_HABIT_EVENT') {
      state.habitEvents.unshift({
        id: `habit-event-${mutationCount + 1}`,
        systemKey: command.payload.habitId,
        businessDate: command.context.businessDate,
        occurredAt: command.occurredAt,
        reversedAt: null
      });
    }
    state.meta.repositoryVersion++;
    mutationCount++;
  }
  return {
    posts,
    get state() { return clone(state); },
    get mutationCount() { return mutationCount; },
    holdNext(type) {
      heldType = type;
      held = { entered: deferred(), release: deferred() };
      return held;
    },
    loseNext() { loseNextResponse = true; },
    async fetch(_url, options) {
      if (options.method === 'GET') return response({ ok: true, state: clone(state) });
      const command = JSON.parse(options.body);
      const expectedVersion = Number(options.headers['If-Match']);
      posts.push({ command: clone(command), expectedVersion });
      const fingerprint = requestFingerprint(command);
      const receipt = receipts.get(command.operationId);
      if (receipt) {
        if (receipt.fingerprint !== fingerprint) {
          return response({ ok: false, errorCode: 'OPERATION_ID_REUSED', retryable: false }, 409);
        }
        return response(success(command, true));
      }
      if (expectedVersion !== state.meta.repositoryVersion) {
        return response({
          ok: false,
          errorCode: 'VERSION_CONFLICT',
          retryable: false,
          currentVersion: state.meta.repositoryVersion,
          state: clone(state)
        }, 409);
      }
      apply(command);
      receipts.set(command.operationId, { fingerprint });
      const committed = clone(state);
      if (heldType === command.type && held) {
        const wait = held;
        heldType = null;
        held = null;
        wait.entered.resolve();
        await wait.release.promise;
      }
      if (loseNextResponse) {
        loseNextResponse = false;
        throw new TypeError('simulated connection reset after commit');
      }
      return response(success(command, false, committed));
    }
  };
}

async function createDualTabHarness(t, { sharedStorage = storage(), server = createSharedServer() } = {}) {
  const authBus = createAuthBus();
  const ready = { A: [], B: [] };
  function coordinator(label) {
    return Auth.createMemberAuthCoordinator({
      supabaseClient: authBus.client(label),
      projectUrl: 'https://isolated.invalid',
      publishableKey: 'test-public',
      storage: sharedStorage,
      contract: Contract,
      application: Application,
      onMemberReady: ({ state }) => ready[label].push(clone(state)),
      fetchImpl: server.fetch
    });
  }
  const A = coordinator('A');
  const B = coordinator('B');
  t.after(() => { A.stop(); B.stop(); });
  assert.equal((await A.start()).ok, true);
  assert.equal((await B.start()).ok, true);
  return { A, B, authBus, server, storage: sharedStorage, ready };
}

function staleReadView(base, key) {
  let staleValue = null;
  let armed = false;
  return {
    arm() { staleValue = base.getItem(key); armed = true; },
    getItem(candidate) {
      if (armed && candidate === key) { armed = false; return staleValue; }
      return base.getItem(candidate);
    },
    setItem: (candidate, value) => base.setItem(candidate, value),
    removeItem: candidate => base.removeItem(candidate),
    entries: () => base.entries()
  };
}

test('normal Member logout uses local Supabase scope and still clears only Member runtime', async t => {
  const local = storage();
  const guestSave = JSON.stringify({ character: { gold: 321 }, mode: 'guest' });
  local.setItem('lifequest_state', guestSave);
  const memberJournalKey = 'lifequest_pending_operations:member:member-a';
  local.setItem(memberJournalKey, JSON.stringify([{ operationId: 'pending-member-a' }]));
  local.setItem('lifequest_pending_operations:guest', JSON.stringify([{ operationId: 'pending-guest' }]));
  const session = { access_token: 'test-member-a-token', user: { id: 'member-a' } };
  const signOutCalls = [];
  const signedOut = [];
  const client = { auth: {
    getSession: async () => ({ data: { session }, error: null }),
    signOut: async options => { signOutCalls.push(options); return { error: null }; },
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } })
  } };
  const coordinator = Auth.createMemberAuthCoordinator({
    supabaseClient: client,
    projectUrl: 'https://isolated.invalid',
    publishableKey: 'test-public',
    storage: local,
    contract: Contract,
    application: Application,
    onSignedOut: details => signedOut.push(details),
    fetchImpl: async (_url, options) => {
      assert.equal(options.method, 'GET');
      return response({ ok: true, state: fixture() });
    }
  });
  t.after(() => coordinator.stop());

  assert.equal((await coordinator.start()).ok, true);
  assert.equal(coordinator.getSession().user.id, 'member-a');
  const result = await coordinator.logout();

  assert.equal(result.ok, true);
  assert.deepEqual(signOutCalls, [{ scope: 'local' }]);
  assert.equal(coordinator.getSession(), null);
  assert.equal(coordinator.getMemberState(), null);
  assert.equal(local.getItem(memberJournalKey), null);
  assert.equal(local.getItem('lifequest_pending_operations:guest'), JSON.stringify([{ operationId: 'pending-guest' }]));
  assert.equal(local.getItem('lifequest_state'), guestSave);
  assert.deepEqual(signedOut, [{ reason: 'logout', remoteFailed: false }]);
});

test('two tabs: stale Profile mutation conflicts and adopts the authoritative newer projection', async t => {
  const h = await createDualTabHarness(t);
  const startVersion = h.A.getMemberState().meta.repositoryVersion;

  const first = await h.A.updateProfile({ adventurerName: 'TabA' });
  const stale = await h.B.updateProfile({ adventurerName: 'TabB' });

  assert.equal(first.ok, true);
  assert.equal(stale.ok, false);
  assert.equal(stale.errorCode, 'VERSION_CONFLICT');
  assert.equal(h.server.mutationCount, 1);
  assert.equal(h.server.state.meta.repositoryVersion, startVersion + 1);
  assert.equal(h.server.state.member.adventurerName, 'TabA');
  assert.equal(h.B.getMemberState().meta.repositoryVersion, startVersion + 1);
  assert.equal(h.B.getMemberState().member.adventurerName, 'TabA');
});

test('two tabs: concurrent Purchase and Habit permit one authoritative mutation only', async t => {
  const h = await createDualTabHarness(t);
  const startVersion = h.A.getMemberState().meta.repositoryVersion;
  const [purchase, habit] = await Promise.all([
    h.A.purchaseItem({ itemKey: 'potion_red', seenCatalogVersion: 1 }),
    h.B.reportHabitEvent({ habitId: 'exercise_training', businessDate: '2026-08-29' })
  ]);

  assert.equal([purchase, habit].filter(result => result.ok).length, 1);
  assert.equal([purchase, habit].filter(result => result.errorCode === 'VERSION_CONFLICT').length, 1);
  assert.equal(h.server.mutationCount, 1);
  assert.equal(h.server.state.meta.repositoryVersion, startVersion + 1);
  assert.ok(h.server.state.player.gold >= 0);
  assert.ok(h.server.state.inventory.length + h.server.state.habitEvents.length === 1);
});

test('two tabs: a late lower-version response cannot downgrade a newer projection', async t => {
  const h = await createDualTabHarness(t);
  const held = h.server.holdNext('UPDATE_PROFILE');
  const delayed = h.A.updateProfile({ adventurerName: 'DelayedA' });
  await held.entered.promise;

  assert.equal((await h.B.reloadMember()).ok, true);
  assert.equal((await h.B.updateProfile({ adventurerName: 'NewerB' })).ok, true);
  assert.equal((await h.A.reloadMember()).ok, true);
  const newestVersion = h.A.getMemberState().meta.repositoryVersion;
  held.release.resolve();
  assert.equal((await delayed).ok, true);

  assert.equal(h.server.state.member.adventurerName, 'NewerB');
  assert.equal(h.A.getMemberState().member.adventurerName, 'NewerB');
  assert.equal(h.A.getMemberState().meta.repositoryVersion, newestVersion);
});

test('two tabs: shared journal reuses one operationId for the same pending intent', async t => {
  const h = await createDualTabHarness(t);
  const [first, duplicate] = await Promise.all([
    h.A.updateProfile({ adventurerName: 'SharedIntent' }),
    h.B.updateProfile({ adventurerName: 'SharedIntent' })
  ]);

  assert.equal(first.ok, true);
  assert.equal(duplicate.ok, true);
  assert.equal(h.server.posts.length, 2);
  assert.equal(h.server.posts[0].command.operationId, h.server.posts[1].command.operationId);
  assert.equal(h.server.mutationCount, 1);
  assert.equal(h.server.state.member.adventurerName, 'SharedIntent');
  assert.deepEqual(JSON.parse(h.storage.getItem('lifequest_pending_operations:member:member-shared')), []);
});

test('forced shared-journal stale-read race cannot duplicate the server mutation', async t => {
  const base = storage();
  const journalKey = 'lifequest_pending_operations:member:member-shared';
  const viewA = staleReadView(base, journalKey);
  const viewB = staleReadView(base, journalKey);
  const authBus = createAuthBus();
  const server = createSharedServer();
  const coordinator = (label, local) => Auth.createMemberAuthCoordinator({
    supabaseClient: authBus.client(label), projectUrl: 'https://isolated.invalid',
    publishableKey: 'test-public', storage: local, contract: Contract,
    application: Application, fetchImpl: server.fetch
  });
  const A = coordinator('A-race', viewA);
  const B = coordinator('B-race', viewB);
  t.after(() => { A.stop(); B.stop(); });
  assert.equal((await A.start()).ok, true);
  assert.equal((await B.start()).ok, true);
  viewA.arm();
  viewB.arm();

  const [first, stale] = await Promise.all([
    A.updateProfile({ adventurerName: 'RaceA' }),
    B.updateProfile({ adventurerName: 'RaceB' })
  ]);

  assert.notEqual(server.posts[0].command.operationId, server.posts[1].command.operationId,
    'the forced stale reads reproduce the non-atomic localStorage reservation race');
  assert.equal([first, stale].filter(result => result.ok).length, 1);
  assert.equal([first, stale].filter(result => result.errorCode === 'VERSION_CONFLICT').length, 1);
  assert.equal(server.mutationCount, 1, 'server version locking remains the integrity boundary');
  assert.equal(server.state.member.adventurerName, 'RaceA');
  assert.deepEqual(JSON.parse(base.getItem(journalKey)), []);
});

test('forced journal race preserves an unknown committed operation for same-id reload retry', async t => {
  const base = storage();
  const journalKey = 'lifequest_pending_operations:member:member-shared';
  const viewA = staleReadView(base, journalKey);
  const viewB = staleReadView(base, journalKey);
  const authBus = createAuthBus();
  const server = createSharedServer();
  const coordinator = (label, local) => Auth.createMemberAuthCoordinator({
    supabaseClient: authBus.client(label), projectUrl: 'https://isolated.invalid',
    publishableKey: 'test-public', storage: local, contract: Contract,
    application: Application, fetchImpl: server.fetch
  });
  const A = coordinator('A-unknown-race', viewA);
  const B = coordinator('B-unknown-race', viewB);
  t.after(() => { A.stop(); B.stop(); });
  assert.equal((await A.start()).ok, true);
  assert.equal((await B.start()).ok, true);
  viewA.arm();
  viewB.arm();
  server.loseNext();

  const [unknown, stale] = await Promise.all([
    A.purchaseItem({ itemKey: 'potion_red', seenCatalogVersion: 1 }),
    B.updateProfile({ adventurerName: 'RaceB' })
  ]);
  const committedOperationId = server.posts[0].command.operationId;
  assert.equal(unknown.unknownResult, true);
  assert.equal(stale.errorCode, 'VERSION_CONFLICT');
  assert.equal(server.mutationCount, 1);
  assert.equal(JSON.parse(base.getItem(journalKey))[0]?.operationId, committedOperationId,
    'the unknown committed request must survive the other tab journal write');

  A.stop();
  const restored = coordinator('A-unknown-reloaded', base);
  t.after(() => restored.stop());
  assert.equal((await restored.start()).ok, true);
  const retried = await restored.purchaseItem({ itemKey: 'potion_red', seenCatalogVersion: 1 });
  assert.equal(retried.ok, true);
  assert.equal(retried.duplicate, true);
  assert.equal(server.posts.at(-1).command.operationId, committedOperationId);
  assert.equal(server.mutationCount, 1);
});

test('reload after an unknown result retries the same operationId without a second mutation', async t => {
  const h = await createDualTabHarness(t);
  h.server.loseNext();
  const uncertain = await h.A.updateProfile({ adventurerName: 'Reloaded' });
  assert.equal(uncertain.ok, false);
  assert.equal(uncertain.reason, 'NETWORK_ERROR');
  assert.equal(uncertain.unknownResult, true);
  const original = h.server.posts[0].command;
  assert.equal(h.server.mutationCount, 1);

  h.A.stop();
  const restored = Auth.createMemberAuthCoordinator({
    supabaseClient: h.authBus.client('A-reloaded'),
    projectUrl: 'https://isolated.invalid',
    publishableKey: 'test-public',
    storage: h.storage,
    contract: Contract,
    application: Application,
    fetchImpl: h.server.fetch
  });
  t.after(() => restored.stop());
  assert.equal((await restored.start()).ok, true);
  const retried = await restored.updateProfile({ adventurerName: 'Reloaded' });

  assert.equal(retried.ok, true);
  assert.equal(retried.duplicate, true);
  assert.equal(h.server.posts[1].command.operationId, original.operationId);
  assert.equal(h.server.mutationCount, 1);
  assert.equal(restored.getMemberState().member.adventurerName, 'Reloaded');
  assert.deepEqual(JSON.parse(h.storage.getItem('lifequest_pending_operations:member:member-shared')), []);
});

test('local logout invalidates the sibling tab runtime without touching Guest persistence', async t => {
  const local = storage();
  const guestSave = JSON.stringify({ character: { gold: 777 }, mode: 'guest' });
  const guestJournal = JSON.stringify([{ operationId: 'guest-pending' }]);
  local.setItem('lifequest_state', guestSave);
  local.setItem('lifequest_pending_operations:guest', guestJournal);
  const h = await createDualTabHarness(t, { sharedStorage: local });
  const postsBefore = h.server.posts.length;

  assert.equal((await h.A.logout()).ok, true);
  await new Promise(resolve => setTimeout(resolve, 10));

  assert.deepEqual(h.authBus.signOutCalls, [{ label: 'A', options: { scope: 'local' } }]);
  assert.equal(h.A.getSession(), null);
  assert.equal(h.B.getSession(), null);
  assert.equal(h.A.getMemberState(), null);
  assert.equal(h.B.getMemberState(), null);
  assert.equal((await h.B.updateProfile({ adventurerName: 'MustNotSend' })).errorCode, 'AUTH_REQUIRED');
  assert.equal(h.server.posts.length, postsBefore);
  assert.equal(local.getItem('lifequest_state'), guestSave);
  assert.equal(local.getItem('lifequest_pending_operations:guest'), guestJournal);
});
