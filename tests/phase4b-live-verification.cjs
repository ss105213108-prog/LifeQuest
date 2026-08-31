const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createClient } = require('@supabase/supabase-js');
const { safeFailure, safeVerificationRecord } = require('./helpers/safe-verification-output.cjs');
const { createTemporaryAccountCleanup } = require('./helpers/temporary-account-cleanup.cjs');

const PREFIX = 'LIFEQUEST_PHASE4B_RESULT=';
const temporaryCleanup = createTemporaryAccountCleanup(record =>
  process.stdout.write(`${PREFIX}${JSON.stringify(safeVerificationRecord(record))}\n`));
const PROJECT_REF = 'jwpbwlrdzmfzjlbrktlc';
const EMAIL_PREFIX = 'lifequest-phase4b-';
const TABLES = ['player_states', 'daily_entries', 'daily_entry_revisions', 'habit_events',
  'resource_ledger', 'status_effects', 'player_achievements', 'boss_encounters', 'boss_actions'];

const assert = (value, message) => { if (!value) throw new Error(message); };
const record = (checks, key, value = true) => { checks[key] = value; };

function config() {
  const source = fs.readFileSync(path.resolve(__dirname, '..', 'supabaseConfig.js'), 'utf8');
  const sandbox = { globalThis: {} };
  vm.runInNewContext(source, sandbox, { filename: 'supabaseConfig.js' });
  const value = sandbox.globalThis.LIFEQUEST_SUPABASE_CONFIG;
  if (!value || !String(value.url).includes(PROJECT_REF)) throw new Error('Wrong Supabase project');
  return value;
}

function storage() {
  const values = new Map();
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key)
  };
}

function client(value, runId, label) {
  return createClient(value.url, value.publishableKey, {
    auth: { persistSession: true, autoRefreshToken: false, detectSessionInUrl: false,
      storage: storage(), storageKey: `phase4b-${label}-${runId}` }
  });
}

function password() {
  return crypto.randomBytes(24).toString('base64url') + '!Aa9';
}

function spec(value, runId, label) {
  return {
    label, runId, email: `${EMAIL_PREFIX}${label}-${runId}@example.com`,
    password: password(), client: client(value, runId, label)
  };
}

function today() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function dateOffset(days) {
  const date = new Date(`${today()}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function envelope(type, operationId, payload, businessDate = today()) {
  return { contractVersion: 1, type, operationId, occurredAt: new Date().toISOString(),
    context: { businessDate, timeZone: 'Asia/Taipei' }, intentKey: `${type}:${operationId}`, payload };
}

async function session(user) {
  const { data, error } = await user.client.auth.getSession();
  if (error || !data?.session?.access_token) throw new Error(`Missing session ${user.label}`);
  return data.session;
}

async function request(value, user, { command = null, expectedVersion = null } = {}) {
  const current = await session(user);
  const headers = { apikey: value.publishableKey, Authorization: `Bearer ${current.access_token}`,
    'Content-Type': 'application/json' };
  if (command) headers['Idempotency-Key'] = command.operationId;
  if (expectedVersion !== null) headers['If-Match'] = String(expectedVersion);
  const response = await fetch(`${value.url}/functions/v1/lifequest-command`, {
    method: command ? 'POST' : 'GET', headers, body: command ? JSON.stringify(command) : undefined
  });
  let body = {};
  try { body = await response.json(); } catch (_) { /* retain empty body */ }
  return { ok: response.ok, status: response.status, body };
}

async function send(value, user, type, payload, expectedVersion, suffix, businessDate = today()) {
  const operationId = `phase4b-${user.label}-${suffix}-${user.runId}`;
  const command = envelope(type, operationId, payload, businessDate);
  return { command, response: await request(value, user, { command, expectedVersion }) };
}

async function login(user) {
  const { data, error } = await user.client.auth.signInWithPassword({ email: user.email, password: user.password });
  if (error || !data?.session) throw new Error(`Login failed ${user.label}: ${error?.message || 'no session'}`);
  user.userId = data.user.id;
  const loaded = await request(config(), user);
  assert(loaded.ok, `Cloud load failed ${user.label}`);
  user.version = loaded.body.repositoryVersion;
  return loaded.body;
}

function validDaily(overrides = {}) {
  return { sleep: 7.5, water: 2000, exercise: 30, study: 30,
    expense: 100, impulse: 0, sugaryDrinks: 0, ...overrides };
}

async function setup(value, runId, checks) {
  const users = ['a', 'b'].map(label => spec(value, runId, label));
  for (const user of users) {
    const adventurerName = `P4B${user.label.toUpperCase()}${runId.slice(-6)}`;
    const { data, error } = await user.client.auth.signUp({ email: user.email, password: user.password,
      options: { data: { adventurer_name: adventurerName } } });
    temporaryCleanup.track(user, data?.user);
    assert(!error && data?.user?.id && data?.session, `Signup failed ${user.label}: ${error?.message || 'no session'}`);
    user.userId = data.user.id;
    let out = await send(value, user, 'INITIALIZE_MEMBER_PROFILE',
      { adventurerName }, 0, 'init');
    assert(out.response.ok && out.response.body.repositoryVersion === 1,
      `Initialize failed ${user.label}: ${out.response.status}/${out.response.body.errorCode || JSON.stringify(out.response.body)}`);
    user.version = 1;
    out = await send(value, user, 'SELECT_MAIN_QUEST', { questId: user.label === 'a' ? 'sleep' : 'exercise' }, 1, 'quest');
    assert(out.response.ok && out.response.body.repositoryVersion === 2, `Quest failed ${user.label}`);
    user.version = 2;
    out = await send(value, user, 'CREATE_CUSTOM_HABIT', { title: `驗收訓練-${user.label}`, direction: 'good' }, 2, 'custom');
    assert(out.response.ok && out.response.body.repositoryVersion === 3, `Custom habit failed ${user.label}`);
    user.version = 3;
    user.customHabitId = out.response.body.state?.customHabits
      ?.find(item => item.title === `驗收訓練-${user.label}`)?.id;
    assert(user.customHabitId, `Custom habit id missing ${user.label}`);
  }
  record(checks, 'temporaryUsersCreated');
  record(checks, 'phase123BootstrapPreserved');
  return users.map(({ label, userId, customHabitId, email }) => ({ label, userId, customHabitId, email }));
}

async function basic(value, runId, checks) {
  const users = ['a', 'b'].map(label => spec(value, runId, label));
  const [a, b] = users;
  const loadedA = await login(a); const loadedB = await login(b);
  a.customHabitId = loadedA.state.customHabits.find(item => item.title === '驗收訓練-a')?.id;
  b.customHabitId = loadedB.state.customHabits.find(item => item.title === '驗收訓練-b')?.id;

  for (const table of TABLES) {
    const ownA = await a.client.from(table).select('*');
    const ownB = await b.client.from(table).select('*');
    assert(!ownA.error && !ownB.error, `Own SELECT failed ${table}`);
    assert(ownA.data.every(row => row.user_id === a.userId), `A read leaked ${table}`);
    assert(ownB.data.every(row => row.user_id === b.userId), `B read leaked ${table}`);
    const directInsert = await a.client.from(table).insert({ user_id: a.userId });
    const directUpdate = await a.client.from(table).update({ user_id: a.userId }).eq('user_id', a.userId);
    const directDelete = await a.client.from(table).delete().eq('user_id', a.userId);
    assert(directInsert.error && directUpdate.error && directDelete.error, `Browser DML not denied ${table}`);
  }
  record(checks, 'rlsNineTables'); record(checks, 'browserDmlDeniedNineTables');
  const rpc = await a.client.rpc('execute_phase4b_command', {
    p_user_id: a.userId, p_command: {}, p_expected_version: a.version, p_plan: {}
  });
  assert(rpc.error, 'Sensitive Phase4B RPC callable from browser');
  record(checks, 'sensitiveRpcDenied');

  let out = await send(value, a, 'REPORT_HABIT_EVENT', { habitId: 'hydration' }, a.version, 'good');
  assert(out.response.ok && out.response.body.result?.rewardGranted === true, 'Good habit failed');
  const goodEvent = out.response.body.result.eventId;
  const goodVersion = out.response.body.repositoryVersion;
  assert(out.response.body.state.player.totalXp > loadedA.state.player.totalXp, 'Good habit did not grant XP');
  a.version = goodVersion;
  const duplicate = await request(value, a, { command: out.command, expectedVersion: goodVersion - 1 });
  assert(duplicate.ok && duplicate.body.duplicate === true && duplicate.body.repositoryVersion === goodVersion,
    'Duplicate habit operation replayed');
  const latest = await request(value, a);
  assert(latest.body.repositoryVersion === a.version, 'Duplicate did not return current authoritative version');
  const reused = { ...out.command, payload: { habitId: 'exercise_training' } };
  const reusedResponse = await request(value, a, { command: reused, expectedVersion: goodVersion - 1 });
  assert(reusedResponse.status === 409 && reusedResponse.body.errorCode === 'OPERATION_ID_REUSED', 'Operation reuse not rejected');
  const stale = await send(value, a, 'REPORT_HABIT_EVENT', { habitId: 'exercise_training' }, 1, 'stale');
  assert(stale.response.status === 409 && stale.response.body.errorCode === 'VERSION_CONFLICT', 'Stale version not rejected');
  record(checks, 'idempotencyOperationReuseVersionConflict');

  out = await send(value, a, 'REVERSE_HABIT_EVENT', { eventId: goodEvent }, a.version, 'reverse-good');
  assert(out.response.ok && out.response.body.result?.reversed === true, 'Safe reversal failed');
  a.version = out.response.body.repositoryVersion;
  const doubleReverse = await send(value, a, 'REVERSE_HABIT_EVENT', { eventId: goodEvent }, a.version, 'reverse-again');
  assert(doubleReverse.response.status === 409 && doubleReverse.response.body.errorCode === 'REVERSAL_BLOCKED', 'Double reversal not blocked');
  record(checks, 'safeAndDoubleReversal');

  out = await send(value, a, 'REPORT_HABIT_EVENT', { habitId: a.customHabitId }, a.version, 'custom-one');
  assert(out.response.ok && out.response.body.result.rewardGranted === true, 'Custom habit first reward failed');
  a.version = out.response.body.repositoryVersion;
  out = await send(value, a, 'REPORT_HABIT_EVENT', { habitId: a.customHabitId }, a.version, 'custom-two');
  assert(out.response.ok && out.response.body.result.rewardGranted === false, 'Custom habit reward cap failed');
  a.version = out.response.body.repositoryVersion;
  record(checks, 'customHabitRewardCap');

  let dependentEvent;
  for (let index = 1; index <= 3; index += 1) {
    out = await send(value, a, 'REPORT_HABIT_EVENT', { habitId: 'fried_food' }, a.version, `bad-${index}`);
    assert(out.response.ok, `Bad habit ${index} failed`);
    dependentEvent ||= out.response.body.result.eventId;
    a.version = out.response.body.repositoryVersion;
  }
  assert(out.response.body.state.activeBoss?.bossKey === 'fried-food-beast', 'Boss did not summon exactly at incident threshold');
  const unsafe = await send(value, a, 'REVERSE_HABIT_EVENT', { eventId: dependentEvent }, a.version, 'unsafe-reverse');
  assert(unsafe.response.status === 409 && unsafe.response.body.errorCode === 'REVERSAL_BLOCKED', 'Unsafe reversal not blocked');
  record(checks, 'badHabitDamageBossOnceUnsafeReverse');

  const forged = envelope('REPORT_HABIT_EVENT', `phase4b-a-forged-${runId}`, { habitId: 'hydration', userId: b.userId });
  const forgedResponse = await request(value, a, { command: forged, expectedVersion: a.version });
  assert(forgedResponse.status === 400 && forgedResponse.body.errorCode === 'INVALID_PAYLOAD', 'Forged userId accepted');
  const cross = await send(value, b, 'REVERSE_HABIT_EVENT', { eventId: dependentEvent }, b.version, 'cross-user');
  assert(cross.response.status === 404 && cross.response.body.errorCode === 'HABIT_EVENT_NOT_FOUND', 'Cross-user event exposed');
  record(checks, 'forgedAndCrossUserRejected');

  for (let index = 1; index <= 12; index += 1) {
    out = await send(value, a, 'REPORT_HABIT_EVENT', { habitId: 'hydration' }, a.version, `cap-${index}`);
    assert(out.response.ok, `Habit report before cap failed ${index}`);
    a.version = out.response.body.repositoryVersion;
  }
  const overCap = await send(value, a, 'REPORT_HABIT_EVENT', { habitId: 'hydration' }, a.version, 'cap-13');
  assert(overCap.response.status === 409 && overCap.response.body.errorCode === 'DAILY_LIMIT_REACHED', 'Daily report cap not enforced');
  record(checks, 'systemHabitDailyCap');

  const unsafeDaily = validDaily({ sleep: 6, water: 0, exercise: 0, study: 0, expense: 600, impulse: 1, sugaryDrinks: 2 });
  out = await send(value, b, 'SUBMIT_DAILY_ENTRY', unsafeDaily, b.version, 'daily-old', dateOffset(-7));
  assert(out.response.ok, 'Backfill day -7 failed');
  b.version = out.response.body.repositoryVersion;
  const entryId = out.response.body.result.entryId;
  out = await send(value, b, 'SUBMIT_DAILY_ENTRY', { ...unsafeDaily, sleep: 6.5 }, b.version, 'daily-correct', dateOffset(-7));
  assert(out.response.ok && out.response.body.result.entryId === entryId && out.response.body.result.revision === 2,
    'Safe daily correction did not preserve identity');
  b.version = out.response.body.repositoryVersion;
  const tooOld = await send(value, b, 'SUBMIT_DAILY_ENTRY', validDaily(), b.version, 'too-old', dateOffset(-8));
  const future = await send(value, b, 'SUBMIT_DAILY_ENTRY', validDaily(), b.version, 'future', dateOffset(1));
  assert(tooOld.response.status === 400 && tooOld.response.body.errorCode === 'BACKFILL_NOT_ALLOWED', 'Too-old backfill accepted');
  assert(future.response.status === 400 && future.response.body.errorCode === 'INVALID_BUSINESS_DATE', 'Future entry accepted');
  record(checks, 'dailyCorrectionBackfillFuture');

  out = await send(value, b, 'SET_RULE_ENABLED', { ruleId: 'rule_5', enabled: false }, b.version, 'disable-rule5');
  assert(out.response.ok, 'Rule preference setup failed'); b.version = out.response.body.repositoryVersion;
  for (const [offset, suffix] of [[-2, 'streak-one'], [-1, 'streak-two']]) {
    out = await send(value, b, 'SUBMIT_DAILY_ENTRY', validDaily({ expense: 900 }), b.version, suffix, dateOffset(offset));
    assert(out.response.ok && out.response.body.result.completedRuleIds.includes('rule_5') === false,
      `Rule preference ignored ${suffix}`);
    b.version = out.response.body.repositoryVersion;
  }
  record(checks, 'rulePreferenceAffectsFutureOnly');
  return { users: users.map(({ label, userId }) => ({ label, userId })),
    fixture: { aVersion: a.version, bVersion: b.version, dependentEvent } };
}

async function fixtures(value, runId, checks) {
  const users = ['a', 'b'].map(label => spec(value, runId, label));
  const [a, b] = users;
  const loadedA = await login(a); const loadedB = await login(b);
  const deathAlreadyApplied = loadedA.state.player.gold === 86
    && loadedA.state.statusEffects.some(item => item.effect_key === 'fixture-active' && item.state === 'cleared');
  let out;
  let deathState = loadedA.state;
  if (!deathAlreadyApplied) {
    out = await send(value, a, 'REPORT_HABIT_EVENT', { habitId: 'sedentary_screen' }, a.version, 'death');
    assert(out.response.ok, `Death command failed: ${out.response.status}/${JSON.stringify(out.response.body)}`);
    deathState = out.response.body.state;
    a.version = out.response.body.repositoryVersion;
  }
  assert(deathState.player.hp === deathState.player.maxHp, 'Death HP reset failed');
  assert(deathState.player.gold === 86, 'Death gold penalty should floor 15 percent');
  assert(deathState.statusEffects.some(item => (item.key || item.effect_key) === 'fixture-active' && item.state === 'cleared'),
    'Death did not clear active status');
  record(checks, 'deathHpGoldStatusLedger');

  const replay = await send(value, a, 'SUBMIT_DAILY_ENTRY', validDaily(), a.version, 'preflight-replay');
  assert(replay.response.ok, 'Unsafe-plan replay fixture failed');
  a.version = replay.response.body.repositoryVersion;
  const replayDuplicate = await request(value, a, { command: replay.command, expectedVersion: a.version - 1 });
  assert(replayDuplicate.ok && replayDuplicate.body.duplicate === true
    && replayDuplicate.body.repositoryVersion === a.version, 'Completed unsafe-plan operation did not replay safely');
  record(checks, 'duplicatePreflightBeforeUnsafeRecalculation');

  let state = loadedB.state;
  const bossAchievementAlreadyApplied = state.achievements
    .some(item => (item.code || item.achievement_code) === 'exercise_streak_3');
  if (!bossAchievementAlreadyApplied) {
    out = await send(value, b, 'SUBMIT_DAILY_ENTRY', validDaily({ expense: 900 }), b.version, 'boss-achievement');
    assert(out.response.ok, 'Boss/Achievement daily failed');
    state = out.response.body.state;
    b.version = out.response.body.repositoryVersion;
  }
  const entry = state.dailyEntries.find(item => (item.businessDate || item.business_date) === today());
  const settlement = entry?.settlement || entry?.settlement_snapshot;
  assert(settlement?.effectiveInput?.exercise === 30, 'Daily effective input missing');
  assert(settlement.completedRuleIds.includes('rule_5') === false, 'Disabled rule affected settlement');
  assert(settlement.achievementEvents.includes('exercise_streak_3'), 'Achievement not unlocked');
  assert(settlement.rewardBreakdown.achievement.gems === 5
    && settlement.rewardBreakdown.achievement.xp === undefined
    && settlement.rewardBreakdown.achievement.gold === undefined,
    'Achievement emitted rewards outside actual rule_6 contract');
  assert(state.achievements.filter(item => (item.code || item.achievement_code) === 'exercise_streak_3').length === 1,
    'Achievement not unique');
  assert(state.activeBoss === null, 'Defeated Boss remained active');
  const blocked = await send(value, b, 'SUBMIT_DAILY_ENTRY', validDaily({ exercise: 35 }), b.version, 'blocked-correction');
  assert(blocked.response.status === 409 && blocked.response.body.errorCode === 'DAILY_REVISION_BLOCKED',
    'Unsafe daily correction not blocked');
  const backfill = await send(value, b, 'SUBMIT_DAILY_ENTRY', validDaily({ sleep: 4, exercise: 0 }), b.version, 'backfill-no-boss', dateOffset(-3));
  assert(backfill.response.ok && backfill.response.body.state.activeBoss === null, 'Backfill polluted current Boss state');
  b.version = backfill.response.body.repositoryVersion;
  record(checks, 'bossDefeatRewardOnceAchievementOnce');
  record(checks, 'blockedCorrectionAndBackfillTemporalBoundary');
  return { versions: { a: a.version, b: b.version } };
}

async function concurrency(value, runId, checks) {
  const nonce = crypto.randomBytes(3).toString('hex');
  const a1 = spec(value, runId, 'a'); const a2 = spec(value, runId, 'a');
  const b1 = spec(value, runId, 'b'); const b2 = spec(value, runId, 'b');
  await Promise.all([login(a1), login(a2), login(b1), login(b2)]);
  const aVersion = a1.version;
  const aCommands = [1, 2].map(index => envelope('REPORT_HABIT_EVENT',
    `phase4b-a-concurrent-habit-${index}-${nonce}-${runId}`, { habitId: 'exercise_training' }));
  const aResults = await Promise.all(aCommands.map(command => request(value, a1, { command, expectedVersion: aVersion })));
  assert(aResults.filter(item => item.ok).length === 1
    && aResults.filter(item => item.body.errorCode === 'VERSION_CONFLICT').length === 1,
    'Concurrent habit commands did not serialize');
  const afterA = await request(value, a1);
  assert(afterA.body.repositoryVersion === aVersion + 1, 'Concurrent habit advanced version more than once');

  const bVersion = b1.version;
  const target = dateOffset(-6);
  const bCommands = [1, 2].map(index => envelope('SUBMIT_DAILY_ENTRY',
    `phase4b-b-concurrent-daily-${index}-${nonce}-${runId}`, validDaily({ study: 5 * index }), target));
  const bResults = await Promise.all(bCommands.map(command => request(value, b1, { command, expectedVersion: bVersion })));
  assert(bResults.filter(item => item.ok).length === 1
    && bResults.filter(item => item.body.errorCode === 'VERSION_CONFLICT').length === 1,
    'Concurrent daily commands did not serialize');
  const afterB = await request(value, b1);
  assert(afterB.body.repositoryVersion === bVersion + 1, 'Concurrent daily advanced version more than once');
  const targetEntries = afterB.body.state.dailyEntries
    .filter(item => (item.businessDate || item.business_date) === target);
  assert(targetEntries.length === 1
    && (targetEntries[0].currentRevision || targetEntries[0].current_revision) === 1,
    'Concurrent daily created duplicate/revision');
  record(checks, 'habitConcurrency'); record(checks, 'dailyConcurrency');
  return { versions: { a: afterA.body.repositoryVersion, b: afterB.body.repositoryVersion } };
}

async function receiptSecurity(value, runId, checks) {
  const a = spec(value, runId, 'a');
  await login(a);
  const command = envelope('REPORT_HABIT_EVENT', `phase4b-a-security-probe-${runId}`, { habitId: 'hydration' });
  const direct = await a.client.rpc('get_phase4b_operation_receipt', {
    p_user_id: a.userId,
    p_command: command
  });
  assert(direct.error, 'Browser can call service-only operation receipt preflight');
  record(checks, 'operationReceiptRpcDenied');
  const anonymous = client(value, runId, 'anonymous');
  for (const table of TABLES) {
    const read = await anonymous.from(table).select('*');
    assert(read.error || read.data.length === 0, `Anonymous read exposed ${table}`);
  }
  record(checks, 'anonymousCannotReadNineTables');
  await a.client.auth.signOut();
  return { userId: a.userId };
}

async function latestStateReplay(value, runId, checks) {
  const a = spec(value, runId, 'a');
  await login(a);
  const beforeVersion = a.version;
  const first = await send(value, a, 'REPORT_HABIT_EVENT', { habitId: 'exercise_training' },
    beforeVersion, 'delayed-duplicate-source');
  assert(first.response.ok, 'Delayed duplicate source operation failed');
  const operationVersion = first.response.body.repositoryVersion;
  const originalEventId = first.response.body.result?.eventId;
  a.version = operationVersion;
  const later = await send(value, a, 'REPORT_HABIT_EVENT', { habitId: 'exercise_training' },
    a.version, 'delayed-duplicate-newer-state');
  assert(later.response.ok, 'Newer operation before delayed duplicate failed');
  a.version = later.response.body.repositoryVersion;
  const replay = await request(value, a, { command: first.command, expectedVersion: beforeVersion });
  assert(replay.ok && replay.body.duplicate === true, 'Delayed operation was not replayed as duplicate');
  assert(replay.body.result?.eventId === originalEventId, 'Duplicate did not retain immutable original result');
  assert(replay.body.operationRepositoryVersion === operationVersion,
    'Duplicate did not retain original operation repository version');
  assert(replay.body.repositoryVersion === a.version,
    'Duplicate did not return current authoritative repository version');
  assert(replay.body.state?.player?.totalXp === later.response.body.state?.player?.totalXp,
    'Duplicate returned stale authoritative state');
  record(checks, 'duplicateReturnsOriginalResultAndLatestState');
  await a.client.auth.signOut();
  return { operationVersion, currentVersion: a.version };
}

async function idempotencyMatrix(value, runId, checks) {
  const a = spec(value, runId, 'a');
  await login(a);
  let out = await send(value, a, 'REPORT_HABIT_EVENT', { habitId: 'exercise_training' },
    a.version, 'reverse-duplicate-source');
  assert(out.response.ok, 'Reverse duplicate source event failed');
  const eventId = out.response.body.result?.eventId;
  a.version = out.response.body.repositoryVersion;
  const reversal = await send(value, a, 'REVERSE_HABIT_EVENT', { eventId },
    a.version, 'reverse-duplicate');
  assert(reversal.response.ok, 'Reverse duplicate first operation failed');
  const reversalVersion = reversal.response.body.repositoryVersion;
  a.version = reversalVersion;
  const reversalReplay = await request(value, a, {
    command: reversal.command, expectedVersion: reversalVersion - 1
  });
  assert(reversalReplay.ok && reversalReplay.body.duplicate === true
    && reversalReplay.body.repositoryVersion === reversalVersion,
  'REVERSE_HABIT_EVENT duplicate was executed twice');
  record(checks, 'reverseHabitIdempotency');

  const daily = await send(value, a, 'SUBMIT_DAILY_ENTRY', validDaily({ study: 45 }),
    a.version, 'daily-duplicate', dateOffset(-4));
  assert(daily.response.ok, 'Daily duplicate first operation failed');
  const dailyVersion = daily.response.body.repositoryVersion;
  a.version = dailyVersion;
  const dailyReplay = await request(value, a, { command: daily.command, expectedVersion: dailyVersion - 1 });
  assert(dailyReplay.ok && dailyReplay.body.duplicate === true
    && dailyReplay.body.repositoryVersion === dailyVersion,
  'SUBMIT_DAILY_ENTRY duplicate was executed twice');
  record(checks, 'dailyEntryIdempotency');
  await a.client.auth.signOut();
  return { reversalVersion, dailyVersion };
}

async function signout(value, runId, checks) {
  const users = ['a', 'b'].map(label => spec(value, runId, label));
  for (const user of users) {
    await login(user);
    const { error } = await user.client.auth.signOut({ scope: 'global' });
    assert(!error, `Global sign out failed ${user.label}: ${error?.message || 'unknown'}`);
  }
  record(checks, 'temporaryUsersGloballySignedOut');
  return { users: users.map(({ label, userId }) => ({ label, userId })) };
}

async function main() {
  const mode = process.argv[2]; const runId = process.argv[3];
  if (!/^[a-z0-9-]{8,40}$/.test(runId || '')) {
    throw new Error('Usage: node phase4b-live-verification.cjs setup <run-id>');
  }
  // Credentials are execution-local. Historical multi-process verification and
  // signout modes cannot recover them; cleanup uses the emitted exact Auth IDs.
  if (mode !== 'setup') throw new Error('Legacy cross-process resume disabled');
  const value = config(); const checks = {}; let details;
  try {
    details = await setup(value, runId, checks);
  } finally {
    await temporaryCleanup.finish();
  }
  process.stdout.write(`${PREFIX}${JSON.stringify(safeVerificationRecord({ ok: true, mode, projectRef: PROJECT_REF,
    runId, checks, details, signedOut: true, cleanupRequired: true }))}\n`);
}

main().catch(error => {
  process.stdout.write(`${PREFIX}${JSON.stringify({ ok: false, projectRef: PROJECT_REF,
    failure: safeFailure(error) })}\n`);
  process.exitCode = 1;
});
