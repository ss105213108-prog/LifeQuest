// Explicitly authorized Phase 6C-2 live verification only. Never runs in npm test.
// Temporary credentials and tokens remain process-memory only and are never logged.
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

const REF = 'jwpbwlrdzmfzjlbrktlc';
const runId = crypto.randomBytes(8).toString('hex');
const users = [];
const clients = [];
const activeHolds = new Set();
const checks = {};
let stage = 'authorization';
const report = (event, details = {}) => console.log(JSON.stringify(safeVerificationRecord({ event, ...details })));
const startStage = name => { stage = name; report('STAGE_START', { name }); };
const pass = (name, details = {}) => {
  checks[name] = true;
  report('STAGE_PASS', { name, ...details });
};
const clone = value => JSON.parse(JSON.stringify(value));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function withTimeout(promise, timeoutMs, name) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(name)), timeoutMs);
    })
  ]).finally(() => clearTimeout(timer));
}
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
function storage() {
  const values = new Map();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key)
  };
}

const sandbox = { globalThis: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../supabaseConfig.js'), 'utf8'), sandbox);
const config = sandbox.globalThis.LIFEQUEST_SUPABASE_CONFIG;
assert.equal(new URL(config.url).hostname, REF + '.supabase.co');
const today = Contract.getBusinessDate({ now: new Date().toISOString(), timeZone: 'Asia/Taipei' });
const guestSave = JSON.stringify({ mode: 'guest', sentinel: 'phase6c2-guest-save', gold: 4321 });

function newClient(label, authStorage = storage()) {
  const client = createClient(config.url, config.publishableKey, {
    auth: {
      persistSession: true,
      storage: authStorage,
      storageKey: `phase6c2-${label}-${runId}`,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });
  clients.push(client);
  return { client, authStorage };
}

function wire(actor) {
  actor.requests ||= [];
  actor.pending ||= storage();
  if (actor.pending.getItem('lifequest_state') === null) actor.pending.setItem('lifequest_state', guestSave);
  actor.fetchImpl = async (url, options = {}) => {
    assert.equal(new URL(url).hostname, REF + '.supabase.co');
    const command = options.body ? JSON.parse(options.body) : null;
    if (command) actor.requests.push({ command: clone(command), expectedVersion: options.headers?.['If-Match'] });
    const response = await fetch(url, { ...options, signal: AbortSignal.timeout(45000) });
    if (command && actor.holdType === command.type && response.ok) {
      const hold = actor.hold;
      actor.holdType = null;
      actor.hold = null;
      hold.entered.resolve();
      await hold.release.promise;
    }
    if (command && actor.dropType === command.type && response.ok) {
      actor.dropType = null;
      throw new Error('authorized response-loss simulation after server response');
    }
    return response;
  };
  actor.coordinator = Auth.createMemberAuthCoordinator({
    supabaseClient: actor.client,
    projectUrl: config.url,
    publishableKey: config.publishableKey,
    storage: actor.pending,
    contract: Contract,
    application: Application,
    fetchImpl: actor.fetchImpl,
    requireCompleteBootstrap: true
  });
}

const state = actor => actor.coordinator.getMemberState();
const version = actor => state(actor).meta.repositoryVersion;
const requestsForOperation = (actor, operationId) => actor.requests
  .filter(record => record.command?.operationId === operationId);
async function reload(actor) {
  const context = `${actor.label}:reload`;
  const result = await actor.coordinator.reloadMember();
  assert.equal(result.ok, true, `${context}:${result.errorCode || result.reason || 'failed'}`);
  assert.equal(actor.pending.getItem('lifequest_state'), guestSave);
  return state(actor);
}
async function success(actor, method, payload) {
  const context = `${actor.label}:${method}`;
  const before = version(actor);
  const result = await actor.coordinator[method](payload);
  assert.equal(result.ok, true, `${context}:${result.errorCode || result.reason || 'failed'}`);
  assert.equal(version(actor), before + 1, context + ':version');
  assert.equal(actor.pending.getItem('lifequest_state'), guestSave);
  return result;
}

async function createTemporaryUser(label) {
  const authStorage = storage();
  const built = newClient(label + '-primary', authStorage);
  const user = {
    label,
    email: `lifequest-phase6c2-${label}-${runId}@example.com`,
    password: crypto.randomBytes(32).toString('base64url') + '!Aa9',
    client: built.client,
    authStorage,
    pending: storage(),
    requests: []
  };
  users.push(user);
  const signup = await user.client.auth.signUp({
    email: user.email,
    password: user.password,
    options: { data: { adventurer_name: `P6C2${label.toUpperCase()}${runId.slice(0, 5)}` } }
  });
  if (signup.data?.user?.id) {
    user.id = signup.data.user.id;
    report('TEMP_ACCOUNT', { label, userId: user.id, cleanupRequired: true });
  }
  assert.ok(!signup.error && signup.data?.session && user.id, `temporary signup failed:${label}`);
  wire(user);
  const started = await user.coordinator.start();
  assert.ok(started.ok && started.state);
  await success(user, 'selectMainQuest', { questId: label === 'a' ? 'sleep' : 'exercise' });
  return user;
}

async function independentSession(user) {
  const built = newClient(user.label + '-secondary');
  const login = await built.client.auth.signInWithPassword({ email: user.email, password: user.password });
  assert.ok(!login.error && login.data?.session && login.data.user?.id === user.id);
  const primarySession = (await user.client.auth.getSession()).data.session;
  assert.ok(primarySession && login.data.session.access_token !== primarySession.access_token);
  assert.ok(login.data.session.refresh_token !== primarySession.refresh_token);
  const actor = { label: user.label + '2', id: user.id, client: built.client,
    pending: storage(), requests: [], email: user.email, password: user.password };
  wire(actor);
  const started = await actor.coordinator.start();
  assert.ok(started.ok && started.state);
  return actor;
}

function envelope(type, payload, operationId = `p6c2-${crypto.randomUUID()}`) {
  return Contract.createCommandEnvelope({ type, payload, operationId, businessDate: today });
}
async function raw(actor, command, expectedVersion) {
  const transport = Auth.createSupabaseTransport({
    client: actor.client,
    projectUrl: config.url,
    publishableKey: config.publishableKey
  });
  const prepared = Contract.createApiRequest(command);
  assert.equal(prepared.ok, true);
  prepared.request.headers['If-Match'] = String(expectedVersion);
  return transport(prepared.request);
}
async function rawBootstrap(actor) {
  const transport = Auth.createSupabaseTransport({
    client: actor.client,
    projectUrl: config.url,
    publishableKey: config.publishableKey
  });
  return transport({ method: 'GET', path: '/bootstrap', requireCompleteBootstrap: true });
}

async function synchronize(...actors) {
  for (const actor of actors) await reload(actor);
  const versions = actors.map(version);
  assert.equal(new Set(versions).size, 1, 'sessions did not converge to one repository version');
}

async function concurrent(actorA, methodA, payloadA, actorB, methodB, payloadB) {
  assert.equal(version(actorA), version(actorB));
  const before = version(actorA);
  const results = await Promise.all([
    actorA.coordinator[methodA](payloadA),
    actorB.coordinator[methodB](payloadB)
  ]);
  assert.equal(results.filter(result => result.ok).length, 1);
  assert.equal(results.filter(result => result.errorCode === 'VERSION_CONFLICT').length, 1);
  await synchronize(actorA, actorB);
  assert.equal(version(actorA), before + 1);
  return results;
}

async function earnFunds(actor, sibling, minimum) {
  for (let days = 7; state(actor).player.gold < minimum && days >= 1; days--) {
    const date = new Date(today + 'T00:00:00Z');
    date.setUTCDate(date.getUTCDate() - days);
    await success(actor, 'submitDailyEntry', {
      businessDate: date.toISOString().slice(0, 10),
      input: { sleep: 8, water: 2000, exercise: 40, study: 30, expense: 100,
        impulse: 0, sugaryDrinks: 0 }
    });
    await reload(sibling);
  }
  assert.ok(state(actor).player.gold >= minimum, 'normal gameplay did not earn required temporary funds');
}

async function verifyConcurrentBootstrap(actor) {
  startStage('concurrent-bootstrap');
  let mixed = null;
  let attempts = 0;
  const delays = [0, 2, 5, 10, 15, 25];
  for (let i = 0; i < 24 && !mixed; i++) {
    attempts++;
    await reload(actor);
    const beforeVersion = version(actor);
    const beforeName = state(actor).member.adventurerName;
    const nextName = `P6C2Snap${i}`;
    const readPromise = rawBootstrap(actor);
    await delay(delays[i % delays.length]);
    const mutation = await actor.coordinator.updateProfile({ adventurerName: nextName });
    assert.equal(mutation.ok, true);
    const read = await readPromise;
    assert.equal(read.ok, true);
    const readVersion = read.state.meta.repositoryVersion;
    const readName = read.state.member.adventurerName;
    const consistentBefore = readVersion === beforeVersion && readName === beforeName;
    const consistentAfter = readVersion === beforeVersion + 1 && readName === nextName;
    if (!consistentBefore && !consistentAfter) mixed = {
      attempt: i + 1, beforeVersion, readVersion,
      readNameMatchesBefore: readName === beforeName,
      readNameMatchesAfter: readName === nextName
    };
  }
  report('CONCURRENT_BOOTSTRAP', { attempts, mixedSnapshotFound: Boolean(mixed), ...(mixed || {}) });
  if (mixed) throw new Error('MIXED_SNAPSHOT_FOUND');
  pass('concurrent-bootstrap-no-mixed-snapshot-observed', { attempts });
}

async function verify() {
  startStage('temporary-account-setup');
  const a1 = await createTemporaryUser('a');
  const b1 = await createTemporaryUser('b');
  startStage('independent-sessions');
  const a2 = await independentSession(a1);
  assert.equal(a1.id, a2.id);
  pass('same-account-two-independent-sessions');

  startStage('stale-mutation-version-conflict-and-reload');
  await synchronize(a1, a2);
  const staleStart = version(a1);
  await success(a1, 'updateProfile', { adventurerName: 'P6C2AOne' });
  const stale = await a2.coordinator.updateProfile({ adventurerName: 'P6C2ATwo' });
  assert.equal(stale.errorCode, 'VERSION_CONFLICT');
  assert.equal(stale.currentVersion, staleStart + 1);
  assert.equal((await a2.coordinator.reloadMember()).ok, true);
  assert.equal(state(a2).meta.repositoryVersion, staleStart + 1);
  assert.equal(state(a2).member.adventurerName, 'P6C2AOne');
  pass('true-stale-profile-version-conflict-then-authoritative-reload');

  startStage('concurrent-daily-habit');
  await synchronize(a1, a2);
  await concurrent(a1, 'submitDailyEntry', {
    businessDate: today,
    input: { sleep: 8, water: 2000, exercise: 40, study: 30, expense: 100,
      impulse: 0, sugaryDrinks: 0 }
  }, a2, 'reportHabitEvent', { habitId: 'exercise_training', businessDate: today });
  pass('true-concurrent-daily-habit-one-success-one-conflict');

  startStage('concurrent-purchase-habit');
  const custom = await success(a1, 'createCustomHabit', { title: 'P6C2 concurrent habit', direction: 'good' });
  await reload(a2);
  const customHabitId = custom.habitId || state(a1).customHabits.find(row => row.title === 'P6C2 concurrent habit')?.id;
  assert.ok(customHabitId);
  const potion = state(a1).catalog.find(row => row.itemKey === 'potion_red');
  const potionPrice = Math.floor(potion.basePrice * (1 - Math.min(state(a1).player.baseStats.wealth * 0.01, 0.2)));
  await earnFunds(a1, a2, potionPrice);
  await synchronize(a1, a2);
  await concurrent(a1, 'purchaseItem', {
    itemKey: 'potion_red', seenCatalogVersion: potion.catalogVersion
  }, a2, 'reportHabitEvent', { habitId: customHabitId, businessDate: today });
  assert.ok(state(a1).player.gold >= 0);
  pass('true-concurrent-purchase-habit-one-success-no-partial-state');

  startStage('multi-session-refresh');
  await success(a1, 'updateProfile', { dailyBudget: 654 });
  await reload(a2);
  assert.equal(state(a2).member.dailyBudget, 654);
  assert.equal(version(a2), version(a1));
  pass('multi-session-refresh-loads-latest-authoritative-projection');

  startStage('response-loss-unknown-result-and-duplicate');
  await synchronize(a1, a2);
  a2.dropType = 'UPDATE_PROFILE';
  const uncertain = await a2.coordinator.updateProfile({ adventurerName: 'P6C2Lost' });
  assert.equal(uncertain.ok, false);
  assert.equal(uncertain.errorCode, 'NETWORK_ERROR');
  assert.equal(uncertain.unknownResult, true);
  const lostOperationId = uncertain.operationId;
  const lostRequests = requestsForOperation(a2, lostOperationId);
  assert.equal(lostRequests.length, 1);
  const lostRequest = lostRequests.find(record => record.command?.operationId === lostOperationId);
  assert.ok(lostRequest);
  const lostCommand = clone(lostRequest.command);
  const journal = JSON.parse(a2.pending.getItem(`lifequest_pending_operations:member:${a2.id}`));
  const pendingLostCommand = journal.find(record => record.operationId === lostCommand.operationId);
  assert.equal(pendingLostCommand?.operationId, lostCommand.operationId);
  a2.coordinator.stop();
  wire(a2);
  assert.equal((await a2.coordinator.start()).ok, true);
  const committedVersion = version(a2);
  const retry = await a2.coordinator.updateProfile({ adventurerName: 'P6C2Lost' });
  assert.ok(retry.ok && retry.duplicate);
  assert.equal(retry.operationId, lostCommand.operationId);
  assert.equal(version(a2), committedVersion);
  const serverDuplicate = await raw(a2, lostCommand, lostRequest.expectedVersion);
  assert.ok(serverDuplicate.ok && serverDuplicate.duplicate);
  assert.equal(serverDuplicate.state.meta.repositoryVersion, committedVersion);
  const journalAfterDuplicate = JSON.parse(
    a2.pending.getItem(`lifequest_pending_operations:member:${a2.id}`) || '[]'
  );
  assert.equal(journalAfterDuplicate.some(record => record.operationId === lostCommand.operationId), false);
  const changed = await raw(a2, { ...lostCommand, payload: { adventurerName: 'P6C2Reuse' } }, version(a2));
  assert.equal(changed.errorCode, 'OPERATION_ID_REUSED');
  await reload(a2);
  assert.equal(version(a2), committedVersion);
  assert.equal(state(a2).member.adventurerName, 'P6C2Lost');
  pass('real-response-loss-reload-same-operation-duplicate-and-reuse-rejection');

  startStage('f5-session-restore');
  const restoredSnapshot = clone(state(a2));
  a2.coordinator.stop();
  wire(a2);
  const restored = await a2.coordinator.start();
  assert.ok(restored.ok && restored.session?.user.id === a2.id);
  assert.equal(version(a2), restoredSnapshot.meta.repositoryVersion);
  assert.equal(state(a2).member.adventurerName, restoredSnapshot.member.adventurerName);
  assert.equal(a2.pending.getItem('lifequest_state'), guestSave);
  pass('f5-session-restore-authoritative-bootstrap-no-guest-fallback');

  await verifyConcurrentBootstrap(a2);

  startStage('local-logout');
  await synchronize(a1, a2);
  a1.holdType = 'UPDATE_PROFILE';
  const lateHold = { entered: deferred(), release: deferred() };
  activeHolds.add(lateHold);
  a1.hold = lateHold;
  const lateA = a1.coordinator.updateProfile({ adventurerName: 'P6C2LateA' });
  await withTimeout(lateHold.entered.promise, 60000, 'late-response-hold-not-entered');
  const lateRequests = a1.requests.filter(record =>
    record.command?.type === 'UPDATE_PROFILE'
    && record.command?.payload?.adventurerName === 'P6C2LateA'
  );
  assert.equal(lateRequests.length, 1);
  const lateRequest = lateRequests.find(record =>
    record.command?.type === 'UPDATE_PROFILE'
    && record.command?.payload?.adventurerName === 'P6C2LateA'
  );
  assert.ok(lateRequest);
  const lateCommand = lateRequest.command;
  const localLogout = await a1.coordinator.logout();
  assert.equal(localLogout.ok, true);
  assert.equal(a1.coordinator.getMemberState(), null);
  assert.equal((await a1.client.auth.getSession()).data.session, null);
  const aJournalAfterLogout = JSON.parse(
    a1.pending.getItem(`lifequest_pending_operations:member:${a1.id}`) || '[]'
  );
  assert.equal(aJournalAfterLogout.some(record => record.operationId === lateCommand.operationId), false);
  assert.ok((await a2.client.auth.getSession()).data.session, 'local logout revoked independent A2 session');
  assert.equal((await a2.coordinator.reloadMember()).ok, true);
  pass('local-logout-invalidates-a1-only-a2-remains-valid');

  startStage('account-switch-and-late-response');
  const switched = await a1.coordinator.login({ email: b1.email, password: b1.password });
  assert.ok(switched.ok && switched.session.user.id === b1.id);
  assert.equal(state(a1).member.adventurerName, state(b1).member.adventurerName);
  assert.notEqual(state(a1).member.adventurerName, state(a2).member.adventurerName);
  const bJournalBeforeLateResponse = JSON.parse(
    a1.pending.getItem(`lifequest_pending_operations:member:${b1.id}`) || '[]'
  );
  assert.equal(bJournalBeforeLateResponse.some(record => record.operationId === lateCommand.operationId), false);
  lateHold.release.resolve();
  activeHolds.delete(lateHold);
  const lateResult = await withTimeout(lateA, 60000, 'late-response-not-settled');
  assert.equal(lateResult.cancelled, true);
  assert.equal(a1.coordinator.getSession().user.id, b1.id);
  assert.equal(state(a1).member.adventurerName, state(b1).member.adventurerName);
  assert.equal(a1.pending.getItem('lifequest_state'), guestSave);
  pass('account-switch-late-a-response-cannot-overwrite-b-or-guest');

  startStage('cross-account-rls-smoke');
  for (const [actor, other] of [[a2, b1], [b1, a2]]) {
    for (const table of ['profiles', 'member_game_roots', 'player_states', 'daily_entries',
      'habit_events', 'player_inventory', 'resource_ledger']) {
      const rows = await actor.client.from(table).select('user_id').in('user_id', [actor.id, other.id]);
      assert.ok(!rows.error && rows.data.every(row => row.user_id === actor.id));
      const foreign = await actor.client.from(table).select('user_id').eq('user_id', other.id);
      assert.ok(!foreign.error && foreign.data.length === 0);
    }
  }
  pass('cross-account-rls-select-smoke');

  startStage('guest-member-guest-boundary');
  for (const actor of [a1, a2, b1]) assert.equal(actor.pending.getItem('lifequest_state'), guestSave);
  pass('guest-member-guest-sentinel-preserved-and-never-used-as-member-projection');
  report('LIVE_RESULT', {
    ok: true,
    projectRef: REF,
    checks,
    temporaryUsers: users.map(user => ({ label: user.label, userId: user.id, cleanupRequired: true }))
  });
}

async function cleanupSessions() {
  for (const hold of activeHolds) hold.release.resolve();
  activeHolds.clear();
  for (const client of clients) {
    try { await client.auth.signOut({ scope: 'global' }); } catch (_error) { /* exact-ID cleanup follows */ }
  }
  for (const user of users) {
    user.password = null;
    report('TEMP_SIGNOUT_ATTEMPTED', {
      label: user.label, userId: user.id, remoteBestEffort: true, cleanupRequired: true
    });
  }
}

async function main() {
  assert.equal(process.argv[2], '--authorized-phase6c2', 'PHASE 6C-2 TEMP AUTHORIZATION REQUIRED');
  try {
    await verify();
  } finally {
    await cleanupSessions();
  }
}

main().catch(() => {
  report('STAGE_FAIL', { name: stage, projectRef: REF });
  report('LIVE_FAILURE', {
    stage,
    projectRef: REF,
    cleanupUsers: users.map(user => ({ label: user.label, userId: user.id, cleanupRequired: true }))
  });
  process.exitCode = 1;
});
