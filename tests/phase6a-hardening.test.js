const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const Auth = require('../memberAuth.js');
const Contract = require('../backendContract.js');
const Application = require('../gameApplication.js');
const { createHarness, fixture, app, clone } = require('./helpers/member-economy-ui-harness.cjs');

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
const response = body => ({ ok: body.ok !== false, status: body.ok === false ? 401 : 200, json: async () => clone(body) });
const sessionFor = id => ({ access_token: 'test-only-' + id, user: { id } });

// Production projection/cleanup, coordinator, journal, application and transport.
// Only Auth/HTTP, DOM and storage are isolated; never uses live accounts.
async function harness(t, options = {}) {
  const h = await createHarness({ gameplayProjection: true });
  h.coordinator.stop();
  let session = sessionFor('A'), sessionWait = null, authError = null, signOutCount = 0;
  let guestHydrations = 0;
  const states = { A: fixture(), B: fixture() }, posts = [], reads = [], postQueue = [], readQueue = [];
  states.A.member.adventurerName = 'A'; states.B.member.adventurerName = 'B'; states.B.player.gold = 37;
  const client = { auth: {
    async getSession() {
      if (sessionWait) { const wait = sessionWait; sessionWait = null; wait.entered.resolve(); await wait.release.promise; }
      return { data: { session }, error: authError };
    },
    async signOut() { signOutCount++; return { error: { status: 503, message: 'unavailable' } }; },
    async signInWithPassword() { session = sessionFor('B'); authError = null; return { data: { session }, error: null }; },
    onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; }
  } };
  const start = app.indexOf('async function restoreGuestEntranceAfterLogout');
  vm.runInContext(app.slice(start, app.indexOf('async function initializeMemberAuth', start)), h.context);
  Object.assign(h.context, {
    guestModeController: { exitGuest() { throw new Error('Member failure must not change Guest mode'); } },
    gameApplication: { async initialize() { guestHydrations++; throw new Error('No Guest fallback'); } }
  });
  const coordinator = Auth.createMemberAuthCoordinator({
    supabaseClient: client, projectUrl: 'https://isolated.invalid', publishableKey: 'test-public',
    storage: h.local, contract: Contract, application: Application, ...options,
    onMemberReady: ({ user, state }) => {
      h.context.activeMember = { id: user.id, state }; h.context.applyMemberGameplayProjection(state);
    },
    onSignedOut: details => h.context.restoreGuestEntranceAfterLogout(details),
    fetchImpl: async (_url, request) => {
      if (request.method === 'GET') {
        reads.push(request);
        const next = readQueue.shift();
        return next ? next(request) : response({ ok: true, state: states[session.user.id] });
      }
      const command = JSON.parse(request.body);
      assert.equal(Contract.validateCommandEnvelope(command).ok, true);
      posts.push({ command, headers: request.headers });
      const next = postQueue.shift();
      return next ? next(command) : response({ ok: true, state: states[session.user.id], result: { operationId: command.operationId } });
    }
  });
  h.context.memberAuthCoordinator = coordinator;
  t.after(() => coordinator.stop());
  assert.equal((await coordinator.start()).ok, true);
  h.local.setItem('lifequest_state_backup_before_restore', 'guest-backup');
  h.local.setItem('lifequest_pending_operations:guest', 'guest-pending');
  const guestBefore = h.local.entries().filter(([key]) => !key.includes(':member:'));
  return { ...h, coordinator, client, states, posts, reads, postQueue, readQueue, guestBefore,
    setSession: value => { session = value; }, setAuthError: value => { authError = value; },
    waitSession() { sessionWait = { entered: deferred(), release: deferred() }; return sessionWait; },
    evidence: () => ({ guestHydrations, signOutCount }) };
}

const intents = {
  Profile: c => c.updateProfile({ adventurerName: 'Changed' }),
  Draft: c => c.saveDailyDraft({ date: '2026-08-28', draft: { sleep: 8 } }),
  Rules: c => c.setRuleEnabled({ ruleId: 'rule_1', enabled: false }),
  CustomHabit: c => c.createCustomHabit({ title: 'Test habit', direction: 'good' }),
  MainQuest: c => c.selectMainQuest({ questId: 'sleep' }),
  Daily: c => c.submitDailyEntry({ businessDate: '2026-08-28', input: { sleep: 8, water: 2, exercise: 40, study: 1, expense: 0, impulse: 0, sugaryDrinks: 0 } }),
  Habit: c => c.reportHabitEvent({ habitId: 'exercise_training', businessDate: '2026-08-28' }),
  Economy: c => c.purchaseItem({ itemKey: 'potion_red', seenCatalogVersion: 1 })
};

function assertGuestUnchanged(h) {
  assert.deepEqual(h.local.entries().filter(([key]) => !key.includes(':member:')), h.guestBefore);
  assert.equal(h.evidence().guestHydrations, 0);
}

for (const family of ['Economy', 'Daily', 'Habit']) {
  test(`G1 ${family}: A waiting for Session cannot send with B credentials`, async t => {
    const h = await harness(t), wait = h.waitSession();
    const pending = intents[family](h.coordinator);
    await wait.entered.promise;
    await h.coordinator.logout();
    await h.coordinator.login({ email: 'synthetic@example.invalid', password: 'test-only' });
    const before = h.coordinator.getMemberState();
    wait.release.resolve();
    const result = await pending;
    assert.equal(h.posts.length, 0, 'wrong-account requests must never reach fetch');
    assert.equal(result.cancelled, true);
    assert.deepEqual(h.coordinator.getMemberState(), before);
    assert.equal(h.context.activeMember.id, 'B');
  });
}

test('G2 delayed v21 receipt preserves result but cannot overwrite authoritative v22', async t => {
  const h = await harness(t), entered = deferred(), release = deferred();
  const old = clone(h.states.A); old.meta.repositoryVersion = 21; old.player.gold = 475;
  h.postQueue.push(async command => { entered.resolve(); await release.promise;
    return response({ ok: true, state: old, result: { operationId: command.operationId, receipt: 'original-v21' } }); });
  const pending = intents.Economy(h.coordinator);
  await entered.promise;
  h.states.A.meta.repositoryVersion = 22; h.states.A.player.gold = 450;
  h.states.A.inventory = [{ itemKey: 'potion_red', quantity: 2 }];
  h.states.A.equipment = [{ itemKey: 'weapon_sword', slot: 'weapon' }];
  h.states.A.recentEconomyTransactions = [{ id: 'latest', type: 'purchase_item' }];
  await h.coordinator.reloadMember();
  const newest = h.coordinator.getMemberState();
  release.resolve();
  const result = await pending;
  assert.equal(result.receipt, 'original-v21');
  assert.equal(h.coordinator.getMemberState().meta.repositoryVersion, 22);
  assert.deepEqual(h.coordinator.getMemberState(), newest);
  assert.deepEqual(result.state, newest);
});

for (const family of Object.keys(intents)) {
  test(`G3 ${family}: AUTH_REQUIRED plus signOut 503 uses mandatory shared cleanup`, async t => {
    const h = await harness(t);
    h.postQueue.push(() => response({ ok: false, errorCode: 'AUTH_REQUIRED', retryable: false }));
    const result = await intents[family](h.coordinator);
    assert.equal(result.ok, false);
    assert.equal(h.coordinator.getMemberState(), null);
    assert.equal(h.coordinator.getSession(), null);
    assert.equal(h.context.activeMember, null);
    assert.deepEqual(Object.keys(h.context.state), []);
    assert.equal(h.context.authView, 'login');
    assert.equal(h.context.memberEconomyActionPending, false);
    assert.equal(h.evidence().guestHydrations, 0);
    assert.deepEqual(h.local.entries().filter(([key]) => !key.includes(':member:')), h.guestBefore);
    const before = h.posts.length;
    assert.equal((await intents[family](h.coordinator)).ok, false);
    assert.equal(h.posts.length, before);
  });
}

test('G4 HTTP200 malformed mutation is unknown, retains projection and original request on retry', async t => {
  const h = await harness(t), before = h.coordinator.getMemberState();
  h.postQueue.push(() => ({ ok: true, status: 200, async json() { throw new SyntaxError('test malformed'); } }));
  const failed = await intents.Economy(h.coordinator);
  assert.equal(failed.ok, false, 'bad JSON is never success');
  assert.equal(failed.unknownResult, true);
  assert.equal(failed.retryable, true);
  assert.deepEqual(h.coordinator.getMemberState(), before);
  const original = h.posts[0].command;
  const journal = JSON.parse(h.local.getItem('lifequest_pending_operations:member:A'));
  assert.equal(journal[0].operationId, original.operationId);
  h.postQueue.push(command => response({ ok: true, duplicate: true, state: before, result: { operationId: command.operationId } }));
  assert.equal((await intents.Economy(h.coordinator)).ok, true);
  assert.deepEqual(h.posts[1].command, original);
});

test('G4 HTTP200 malformed reload preserves the last projection and permits safe retry', async t => {
  const h = await harness(t);
  const before = clone(h.coordinator.getMemberState());
  h.readQueue.push(() => ({ ok: true, status: 200, async json() { throw new SyntaxError('test malformed'); } }));
  await assert.rejects(h.coordinator.reloadMember(), error => error.code === 'MALFORMED_RESPONSE');
  assert.deepEqual(h.coordinator.getMemberState(), before);
  assert.deepEqual(h.context.activeMember.state, before);
  assert.equal(h.posts.length, 0);
  assert.equal((await h.coordinator.reloadMember()).ok, true);
});

test('G1 logout while waiting cancels all sends and clears only Member journal', async t => {
  const h = await harness(t), wait = h.waitSession();
  const pending = intents.Habit(h.coordinator);
  await wait.entered.promise; await h.coordinator.logout(); wait.release.resolve();
  assert.equal((await pending).cancelled, true);
  assert.equal(h.posts.length, 0);
  assert.equal(h.local.getItem('lifequest_pending_operations:member:A'), null);
  assertGuestUnchanged(h);
});

test('G1 shared SDK identity change before listener is not used as authority for the old intent', async t => {
  const h = await harness(t);
  h.setSession(sessionFor('B'));
  const result = await intents.Economy(h.coordinator);
  assert.equal(result.cancelled, true);
  assert.equal(h.posts.length, 0);
  assert.equal(h.evidence().signOutCount, 0, 'must not revoke B while cancelling A');
  assert.equal(h.coordinator.getMemberState(), null);
  assertGuestUnchanged(h);
});

test('G1 a token without a matching SDK user identity cannot send the captured Member intent', async t => {
  const h = await harness(t);
  h.setSession({ access_token: 'test-only-unidentified' });
  assert.equal((await intents.Habit(h.coordinator)).cancelled, true);
  assert.equal(h.posts.length, 0); assert.equal(h.context.activeMember, null);
  assertGuestUnchanged(h);
});

for (const shape of ['full', 'partial']) {
  test(`G2 stale ${shape} duplicate receipt cannot replace v23 after v22 partial merge`, async t => {
    const h = await harness(t);
    h.postQueue.push(() => response({ ok: true, state: { meta: { repositoryVersion: 22 }, player: { gold: 444 } } }));
    assert.equal((await intents.Rules(h.coordinator)).ok, true);
    assert.equal(h.coordinator.getMemberState().achievements[0].code, 'boss_slayer');
    const old = shape === 'full' ? fixture() : { player: { gold: 999 } };
    old.meta = { repositoryVersion: 21 };
    h.states.A = h.coordinator.getMemberState(); h.states.A.meta.repositoryVersion = 23;
    await h.coordinator.reloadMember();
    const latest = h.coordinator.getMemberState();
    h.postQueue.push(() => response({ ok: true, duplicate: true, state: old,
      repositoryVersion: 21, result: { receiptVersion: 21, transactionId: 'original' } }));
    const duplicate = await intents.Economy(h.coordinator);
    assert.equal(duplicate.ok, true); assert.equal(duplicate.duplicate, true);
    assert.equal(duplicate.transactionId, 'original'); assert.equal(duplicate.receiptVersion, 21);
    assert.deepEqual(duplicate.state, latest);
    assert.deepEqual(h.coordinator.getMemberState(), latest);
  });
}

test('G2 old reload cannot take over a newer reload, even with a larger claimed version', async t => {
  const h = await harness(t), entered = deferred(), release = deferred();
  const stale = fixture(); stale.meta.repositoryVersion = 99;
  h.readQueue.push(async () => { entered.resolve(); await release.promise; return response({ ok: true, state: stale }); });
  const oldRead = h.coordinator.reloadMember(); await entered.promise;
  h.states.A.meta.repositoryVersion = 22;
  await h.coordinator.reloadMember();
  release.resolve(); assert.equal((await oldRead).cancelled, true);
  assert.equal(h.coordinator.getMemberState().meta.repositoryVersion, 22);
  assert.equal(h.context.activeMember.state.meta.repositoryVersion, 22);
});

test('G2 newer reload failure cannot be rescued by a superseded old read', async t => {
  const h = await harness(t), entered = deferred(), release = deferred();
  const before = clone(h.coordinator.getMemberState());
  h.readQueue.push(async () => { entered.resolve(); await release.promise; return response({ ok: true, state: fixture() }); });
  const oldRead = h.coordinator.reloadMember(); await entered.promise;
  h.readQueue.push(() => ({ ok: false, status: 503, json: async () => ({ ok: false, errorCode: 'NETWORK_ERROR', retryable: true }) }));
  await assert.rejects(h.coordinator.reloadMember());
  release.resolve(); assert.equal((await oldRead).cancelled, true);
  assert.deepEqual(h.coordinator.getMemberState(), before);
  assert.deepEqual(h.context.activeMember.state, before);
  assert.equal(h.posts.length, 0); assertGuestUnchanged(h);
});

test('Bootstrap from A cannot overwrite the next B login', async t => {
  const h = await harness(t), entered = deferred(), release = deferred();
  h.readQueue.push(async () => { entered.resolve(); await release.promise; return response({ ok: true, state: h.states.A }); });
  const pending = h.coordinator.reloadMember(); await entered.promise;
  await h.coordinator.logout(); await h.coordinator.login({});
  const before = h.coordinator.getMemberState();
  release.resolve(); assert.equal((await pending).cancelled, true);
  assert.equal(h.context.activeMember.id, 'B'); assert.deepEqual(h.coordinator.getMemberState(), before);
});

test('G3 temporary Auth 503 with usable session does not logout or submit a command', async t => {
  const h = await harness(t), before = h.coordinator.getMemberState();
  h.setAuthError({ status: 503, name: 'AuthRetryableFetchError' });
  const result = await intents.Profile(h.coordinator);
  assert.equal(result.ok, false); assert.equal(result.errorCode, 'AUTH_UNAVAILABLE');
  assert.equal(result.retryable, true); assert.equal(h.evidence().signOutCount, 0);
  assert.equal(h.posts.length, 0); assert.deepEqual(h.coordinator.getMemberState(), before);
  assertGuestUnchanged(h);
});

test('G3 expired local credential plus refresh 503 cleans all runtime without a fetch', async t => {
  const h = await harness(t);
  h.setSession({ ...sessionFor('A'), expires_at: 1 }); h.setAuthError({ status: 503 });
  const result = await intents.Daily(h.coordinator);
  assert.equal(result.ok, false); assert.equal(h.posts.length, 0);
  assert.equal(h.coordinator.getSession(), null); assert.equal(h.context.activeMember, null);
  assert.equal(h.context.authView, 'login'); assertGuestUnchanged(h);
});

test('G3 explicit Auth 401 cleans locally even if a stale token is returned', async t => {
  const h = await harness(t);
  h.setAuthError({ status: 401, code: 'session_not_found' });
  assert.equal((await intents.Habit(h.coordinator)).ok, false);
  assert.equal(h.posts.length, 0); assert.equal(h.context.activeMember, null);
  assertGuestUnchanged(h);
});

for (const [name, body] of Object.entries({ empty: {}, null: null, array: [], noState: { ok: true },
  noVersion: { ok: true, state: { meta: {} } }, falseVersion: { ok: true, state: { meta: { repositoryVersion: '22' } } } } )) {
  test(`G4 incomplete HTTP200 ${name} cannot succeed or clear state`, async t => {
    const h = await harness(t), before = h.coordinator.getMemberState();
    h.postQueue.push(() => ({ ok: true, status: 200, json: async () => body }));
    const result = await intents.Economy(h.coordinator);
    assert.equal(result.ok, false); assert.equal(result.unknownResult, true);
    assert.deepEqual(h.coordinator.getMemberState(), before);
    assert.ok(h.local.getItem('lifequest_pending_operations:member:A'));
  });
}

test('G4 rendered purchase malformed response shows unknown feedback, unlocks UI and retries the same envelope', async t => {
  const h = await harness(t);
  h.postQueue.push(() => ({ ok: true, status: 200, async json() { throw new SyntaxError('test'); } }));
  h.click('member-item-purchase', 'potion_red'); await h.confirm();
  assert.match(h.modals.at(-1).message, /無法確認操作結果/);
  assert.equal(h.context.memberEconomyActionPending, false);
  assert.equal(h.context.state.character.gold, 500);
  h.postQueue.push(command => response({ ok: true, duplicate: true, state: h.states.A, result: { operationId: command.operationId } }));
  h.click('member-item-purchase', 'potion_red'); await h.confirm();
  assert.deepEqual(h.posts[1].command, h.posts[0].command);
  assert.match(h.modals.at(-1).message, /沒有再次扣除/); assertGuestUnchanged(h);
});

test('G1 a confirmation opened by A cannot submit after B login', async t => {
  const h = await harness(t);
  h.click('member-item-purchase', 'potion_red'); const confirmA = h.modals.at(-1).onConfirm;
  await h.coordinator.logout(); await h.coordinator.login({});
  await confirmA(); assert.equal(h.posts.length, 0); assert.equal(h.context.activeMember.id, 'B');
});

for (const missing of ['player', 'inventory', 'achievements', 'rulePreferences', 'dailyDrafts']) {
  test(`Ready boundary rejects bootstrap missing ${missing} before normalization can invent defaults`, async t => {
    const h = await harness(t, { requireCompleteBootstrap: true });
    const before = clone(h.coordinator.getMemberState());
    const broken = fixture(); delete broken[missing];
    h.readQueue.push(() => response({ ok: true, state: broken }));
    await assert.rejects(h.coordinator.reloadMember(), error => error.code === 'MALFORMED_RESPONSE');
    assert.deepEqual(h.coordinator.getMemberState(), before);
    assert.deepEqual(h.context.activeMember.state, before);
    assert.equal(h.posts.length, 0); assertGuestUnchanged(h);
    assert.equal((await h.coordinator.reloadMember()).ok, true);
  });
}

function installGameplayHandlers(h) {
  const buttons = new Map();
  const button = key => {
    if (!buttons.has(key)) buttons.set(key, { dataset: {}, textContent: 'Ready', disabled: false,
      querySelector: () => null, getAttribute(name) { return this[name]; },
      setAttribute(name, value) { this[name] = String(value); }, removeAttribute(name) { delete this[name]; } });
    return buttons.get(key);
  };
  h.context.document.getElementById = id => id === 'btn-submit-log' ? button('daily') : null;
  h.context.document.querySelectorAll = selector => selector === '[aria-busy="true"]'
    ? [...buttons.values()].filter(item => item['aria-busy'] === 'true') : [];
  Object.assign(h.context, { getDailyRecordPolicy: () => ({ allowed: true }), getTodayDateString: () => '2026-08-28',
    renderCampSettlementFromEntry() {}, getMemberHabitActionButton: (_action, id) => button(id) });
  const section = (from, to) => app.slice(app.indexOf(from), app.indexOf(to, app.indexOf(from)));
  vm.runInContext(section('function setMemberActionBusy(', 'function getMemberHabitActionButton(')
    + section('async function submitMemberDailyEntry(', 'window.submitDailyLog =')
    + section('async function commitMemberHabitReport(', 'window.undoLastHabitEvent =')
    + section('window.toggleRuleEnabled =', '// 刪除規則'), h.context);
  return { button, invoke(family) {
    if (family === 'Daily') return h.context.submitMemberDailyEntry({ businessDate: '2026-08-28', input: { sleep: 8 } });
    if (family === 'Rules') return h.context.window.toggleRuleEnabled('rule_1');
    const task = h.context.state.tasks.find(row => row.isSystem);
    assert.ok(task, 'real projection contains system tasks');
    return h.context.commitMemberHabitReport(task.id);
  } };
}

for (const family of ['Daily', 'Habit', 'Rules']) {
  test(`G1/G3 ${family} UI: late A failure cannot release B loading, navigate or display A result`, async t => {
    const h = await harness(t), ui = installGameplayHandlers(h);
    const a = { entered: deferred(), release: deferred() }, b = { entered: deferred(), release: deferred() };
    h.postQueue.push(async () => { a.entered.resolve(); await a.release.promise; return response({ ok: false, errorCode: 'AUTH_REQUIRED' }); });
    const pendingA = ui.invoke(family); await a.entered.promise;
    await h.coordinator.logout(); await h.coordinator.login({});
    h.postQueue.push(async () => { b.entered.resolve(); await b.release.promise; return response({ ok: true, state: h.states.B }); });
    const pendingB = ui.invoke(family); await b.entered.promise;
    const modalsBefore = h.modals.length;
    a.release.resolve(); await pendingA;
    assert.equal(h.context.activeMember.id, 'B'); assert.equal(h.modals.length, modalsBefore);
    if (family === 'Rules') assert.equal(h.context.ruleToggleLocks.has('rule_1'), true);
    else {
      const key = family === 'Daily' ? 'daily' : h.context.state.tasks.find(row => row.isSystem).id;
      assert.equal(ui.button(key)['aria-busy'], 'true'); assert.equal(ui.button(key).disabled, true);
    }
    b.release.resolve(); await pendingB;
    assert.equal(h.context.ruleToggleLocks.size, 0); assert.equal(h.context.habitActionLocks.size, 0);
    assertGuestUnchanged(h);
  });
  test(`G3 ${family} UI: invalid session clears loading and never shows success`, async t => {
    const h = await harness(t), ui = installGameplayHandlers(h);
    h.postQueue.push(() => response({ ok: false, errorCode: 'SESSION_EXPIRED' }));
    await ui.invoke(family);
    assert.equal(h.coordinator.getMemberState(), null); assert.equal(h.context.activeMember, null);
    assert.equal(h.context.authView, 'login'); assert.equal(h.modals.length, 0);
    assert.equal(h.context.ruleToggleLocks.size, 0); assert.equal(h.context.habitActionLocks.size, 0);
    assert.notEqual(ui.button('daily')['aria-busy'], 'true'); assertGuestUnchanged(h);
  });
}

test('Ready boundary production initialization opts in; failed Cloud read shows retry without Guest hydration', async t => {
  const h = await harness(t, { requireCompleteBootstrap: true });
  h.context.window.LifeQuestSupabase = { getSupabaseClient: () => ({}) };
  const initialFailureCoordinator = {
    async start() { throw Object.assign(new Error('test malformed bootstrap'), { code: 'MALFORMED_RESPONSE' }); },
    getSession() { return sessionFor('A'); }
  };
  h.context.window.LifeQuestMemberAuth = { createMemberAuthCoordinator: options => {
    assert.equal(options.requireCompleteBootstrap, true); return initialFailureCoordinator;
  }, safeMemberReloadMessage: error => {
    assert.equal(error.code, 'MALFORMED_RESPONSE');
    return '會員卷宗暫時無法載入，請稍後再試。';
  } };
  h.context.activeMember = null;
  const result = await h.context.initializeMemberAuth();
  assert.equal(result.ok, false);
  assert.equal(h.context.bootstrapView.error, '會員卷宗暫時無法載入，請稍後再試。');
  assertGuestUnchanged(h);
});

test('G1 response JSON decoding delayed across account change cannot affect B or its journal', async t => {
  const h = await harness(t), entered = deferred(), release = deferred();
  h.postQueue.push(() => ({ ok: true, status: 200, async json() {
    entered.resolve(); await release.promise; return { ok: true, state: h.states.A };
  } }));
  const pending = intents.Economy(h.coordinator); await entered.promise;
  await h.coordinator.logout(); await h.coordinator.login({});
  const before = h.coordinator.getMemberState();
  release.resolve(); assert.equal((await pending).cancelled, true);
  assert.deepEqual(h.coordinator.getMemberState(), before);
  assert.equal(h.local.getItem('lifequest_pending_operations:member:A'), null);
  assertGuestUnchanged(h);
});

test('G3 late remote signOut error cannot clear a newly authenticated B runtime', async t => {
  const h = await harness(t), entered = deferred(), release = deferred();
  h.client.auth.signOut = async () => { entered.resolve(); await release.promise; return { error: { status: 503 } }; };
  const pending = h.coordinator.logout(); await entered.promise;
  await h.coordinator.login({}); const before = h.coordinator.getMemberState();
  release.resolve(); await pending;
  assert.equal(h.context.activeMember.id, 'B'); assert.deepEqual(h.coordinator.getMemberState(), before);
  assertGuestUnchanged(h);
});

test('G3 thrown Auth network error without expiry evidence is unavailable, not logout', async t => {
  const h = await harness(t), before = h.coordinator.getMemberState();
  h.client.auth.getSession = async () => { throw new TypeError('isolated network failure'); };
  const result = await intents.Draft(h.coordinator);
  assert.equal(result.errorCode, 'AUTH_UNAVAILABLE'); assert.equal(result.retryable, true);
  assert.equal(h.posts.length, 0); assert.equal(h.evidence().signOutCount, 0);
  assert.deepEqual(h.coordinator.getMemberState(), before); assertGuestUnchanged(h);
});

test('G4 malformed partial achievement array cannot clear a valid unlock', async t => {
  const h = await harness(t), before = h.coordinator.getMemberState();
  h.postQueue.push(() => response({ ok: true, state: { meta: { repositoryVersion: 21 }, achievements: null } }));
  const result = await intents.Economy(h.coordinator);
  assert.equal(result.ok, false); assert.equal(result.unknownResult, true);
  assert.deepEqual(h.coordinator.getMemberState(), before);
});

test('G4 mismatched operation receipt is unknown and cannot complete the pending intent', async t => {
  const h = await harness(t);
  h.postQueue.push(() => response({ ok: true, state: fixture(), result: { operationId: 'another-operation' } }));
  const result = await intents.Economy(h.coordinator);
  assert.equal(result.ok, false); assert.equal(result.unknownResult, true);
  assert.equal(JSON.parse(h.local.getItem('lifequest_pending_operations:member:A'))[0].operationId, h.posts[0].command.operationId);
});

test('Reload-specific UI guard invalidates only the old read while preserving session-level ownership', async t => {
  const h = await harness(t);
  const sessionGuard = h.coordinator.captureRuntime(), readGuard = h.coordinator.captureRuntime({ includeBootstrap: true });
  await h.coordinator.reloadMember();
  assert.equal(sessionGuard(), true); assert.equal(readGuard(), false);
});

test('Session boundary: late normal-logout Guest hydration cannot replace the new B projection', async t => {
  const h = await harness(t), entered = deferred(), release = deferred();
  h.client.auth.signOut = async () => { h.setSession(null); return { error: null }; };
  h.context.guestModeController.exitGuest = () => {};
  h.context.gameApplication.initialize = async () => {
    entered.resolve(); await release.promise;
    return vm.runInContext('JSON.parse(JSON.stringify(DEFAULT_STATE))', h.context);
  };
  const logout = h.coordinator.logout(); await entered.promise;
  await h.coordinator.login({}); const before = clone(h.context.state);
  release.resolve(); await logout;
  assert.equal(h.context.activeMember.id, 'B');
  assert.deepEqual(clone(h.context.state), before);
  assertGuestUnchanged(h);
});
