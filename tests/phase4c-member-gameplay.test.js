const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const BackendContract = require('../backendContract.js');
const Application = require('../gameApplication.js');
const MemberAuth = require('../memberAuth.js');
const DailyFormSubmission = require('../dailyFormSubmission.js');

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
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

function cloudState(version = 8, overrides = {}) {
  return {
    meta: { repositoryVersion: version, operations: [] },
    member: {
      adventurerName: '雲端冒險者', onboardingCompleted: true,
      mainQuestId: 'sleep', dailyBudget: 500, timeZone: 'Asia/Taipei'
    },
    dailyDrafts: {}, customHabits: [], rulePreferences: {},
    player: {
      totalXp: 160, level: 3, hp: 55, maxHp: 60, gold: 120, gems: 7,
      baseStats: { health: 12, energy: 13, wealth: 11, growth: 14 },
      levelCurveVersion: 'level-v1'
    },
    dailyEntries: [], habitEvents: [], statusEffects: [], activeBoss: null, achievements: [],
    ...overrides
  };
}

test('Phase 4C member coordinator submits only gameplay intent and requested business date', async () => {
  const session = { access_token: 'member-token', user: { id: 'phase4c-member' } };
  const posted = [];
  let state = cloudState();
  const coordinator = MemberAuth.createMemberAuthCoordinator({
    supabaseClient: createAuthClient(session),
    projectUrl: 'https://jwpbwlrdzmfzjlbrktlc.supabase.co',
    publishableKey: 'sb_publishable_example',
    storage: createStorage(), contract: BackendContract, application: Application,
    fetchImpl: async (_url, options) => {
      if (options.method === 'GET') {
        return { ok: true, status: 200, async json() { return { ok: true, state }; } };
      }
      const command = JSON.parse(options.body);
      posted.push(command);
      state = cloudState(state.meta.repositoryVersion + 1, {
        habitEvents: command.type === 'REPORT_HABIT_EVENT'
          ? [{ id: '123e4567-e89b-42d3-a456-426614174001', businessDate: command.context.businessDate,
            kind: 'system', systemKey: command.payload.habitId, direction: 'good', title: '飲水',
            policy: { rewardGranted: true, xp: 10, gold: 5 }, occurredAt: '2026-08-23T04:00:00Z', reversedAt: null }]
          : state.habitEvents
      });
      return { ok: true, status: 200, async json() { return { ok: true, state, result: {} }; } };
    }
  });

  await coordinator.start();
  await coordinator.reportHabitEvent({ habitId: 'hydration', businessDate: '2026-08-23' });
  await coordinator.reverseHabitEvent({
    eventId: '123e4567-e89b-42d3-a456-426614174001', businessDate: '2026-08-23'
  });
  await coordinator.submitDailyEntry({
    businessDate: '2026-08-20',
    input: { sleep: 7.5, water: 2000, exercise: 30, study: 20, expense: 100, impulse: 0, sugaryDrinks: 0 }
  });

  assert.deepEqual(posted.map(item => item.type), [
    'REPORT_HABIT_EVENT', 'REVERSE_HABIT_EVENT', 'SUBMIT_DAILY_ENTRY'
  ]);
  assert.equal(posted[0].context.businessDate, '2026-08-23');
  assert.deepEqual(posted[0].payload, { habitId: 'hydration' });
  assert.deepEqual(posted[1].payload, { eventId: '123e4567-e89b-42d3-a456-426614174001' });
  assert.equal(posted[2].context.businessDate, '2026-08-20');
  assert.deepEqual(Object.keys(posted[2].payload).sort(), [
    'exercise', 'expense', 'impulse', 'sleep', 'study', 'sugaryDrinks', 'water'
  ]);
  assert.equal(posted.some(item => 'userId' in item.payload || 'xp' in item.payload || 'gold' in item.payload), false);
});

test('Phase 4C normalizes the authoritative read model without inventing resources', () => {
  const normalized = MemberAuth.normalizeMemberCloudState(cloudState(9, {
    statusEffects: [{ id: 's1', key: 'focused', type: 'buff', title: '專注', modifiers: { growth: 2 },
      appliedOn: '2026-08-22', expiresOn: '2026-08-24', state: 'active' }],
    dailyEntries: [{ id: 'd1', businessDate: '2026-08-22', currentRevision: 2,
      effectiveInput: { sleep: 8 }, settlement: { resource: { xp: 20, gold: 5, hp: 0 } } }],
    habitEvents: [{ id: 'h1', businessDate: '2026-08-23', kind: 'system', systemKey: 'hydration',
      direction: 'good', title: '飲水', policy: { rewardGranted: true }, occurredAt: '2026-08-23T01:00:00Z' }],
    activeBoss: { id: 'b1', bossKey: 'sleep_nightmare', name: '睡眠夢魘', hp: 80, maxHp: 100,
      state: 'active', summonedOn: '2026-08-23' },
    achievements: [{ achievement_code: 'gym_rat', unlocked_at: '2026-08-23T01:00:00Z', reward_state: 'granted' }],
    achievement_progress: { gym_rat: 5 }
  }));

  assert.equal(normalized.player.totalXp, 160);
  assert.equal(normalized.player.gold, 120);
  assert.equal(normalized.dailyEntries[0].businessDate, '2026-08-22');
  assert.equal(normalized.habitEvents[0].systemKey, 'hydration');
  assert.equal(normalized.statusEffects[0].expiresOn, '2026-08-24');
  assert.equal(normalized.activeBoss.bossKey, 'sleep_nightmare');
  assert.equal(normalized.achievements[0].code, 'gym_rat');
  assert.equal(normalized.achievementProgress.gym_rat, 5);
});

test('locked member achievements project authoritative Cloud progress instead of a local zero', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const projectionStart = app.indexOf('const unlocked = new Map');
  const projectionEnd = app.indexOf('projection.logs =', projectionStart);
  const projection = app.slice(projectionStart, projectionEnd);

  assert.match(projection, /memberState\.achievementProgress/);
  assert.match(projection, /Math\.min\(item\.target/);
});

test('member reload normalizes snake_case status identity fields for Buff rendering', async () => {
  const session = { access_token: 'member-token', user: { id: 'phase4c-status-reload-member' } };
  let serverState = cloudState(9, {
    statusEffects: [{
      id: 'status-reload-1', key: 'mental_full', type: 'buff', title: '精神飽滿',
      modifiers: { energy: 2 }, appliedOn: '2026-08-24', expiresOn: '2026-08-25', state: 'active'
    }]
  });
  const coordinator = MemberAuth.createMemberAuthCoordinator({
    supabaseClient: createAuthClient(session),
    projectUrl: 'https://jwpbwlrdzmfzjlbrktlc.supabase.co',
    publishableKey: 'sb_publishable_example',
    storage: createStorage(), contract: BackendContract, application: Application,
    fetchImpl: async () => ({
      ok: true, status: 200, async json() { return { ok: true, state: serverState }; }
    })
  });

  await coordinator.start();
  assert.equal(coordinator.getMemberState().statusEffects[0].type, 'buff');

  serverState = cloudState(10, {
    statusEffects: [{
      id: 'status-reload-1',
      effect_key: 'mental_full',
      effect_type: 'buff',
      title_snapshot: '精神飽滿',
      modifier_snapshot: { energy: 2 },
      applied_on: '2026-08-24',
      expires_on: '2026-08-25',
      state: 'active'
    }]
  });
  await coordinator.reloadMember();
  const restored = coordinator.getMemberState().statusEffects[0];

  assert.equal(restored.key, 'mental_full');
  assert.equal(restored.type, 'buff');
  assert.equal(restored.title, '精神飽滿');
  assert.deepEqual(restored.modifiers, { energy: 2 });
  assert.equal(restored.expiresOn, '2026-08-25');
});

test('member status projection supplies the remainingDays field rendered by Buff and Debuff badges', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const projectionStart = app.indexOf('const activeStatuses =');
  const projectionEnd = app.indexOf('projection.statusHistory =', projectionStart);
  const projection = app.slice(projectionStart, projectionEnd);
  const rendererStart = app.indexOf('function renderStatusEffects()');
  const rendererEnd = app.indexOf('function renderRecoveryTasks()', rendererStart);
  const renderer = app.slice(rendererStart, rendererEnd);

  assert.notEqual(projectionStart, -1);
  assert.notEqual(projectionEnd, -1);
  assert.equal((projection.match(/remainingDays\s*:/g) || []).length, 2);
  assert.equal((projection.match(/\bduration\s*:/g) || []).length, 0);
  assert.match(renderer, /buff\.remainingDays/);
  assert.match(renderer, /debuff\.remainingDays/);
});

test('latest Cloud habit event controls both the undo label and reversal event id', async () => {
  const eventA = {
    id: '123e4567-e89b-42d3-a456-42661417400a', businessDate: '2026-08-24',
    kind: 'system', systemKey: 'hydration', direction: 'good', title: '多喝水 500ml',
    policy: { rewardGranted: true }, occurredAt: '2026-08-24T01:00:00Z', reversedAt: null
  };
  const eventB = {
    id: '123e4567-e89b-42d3-a456-42661417400b', businessDate: '2026-08-24',
    kind: 'system', systemKey: 'screen_break', direction: 'good', title: '使用 3C 後休息 10 分鐘',
    policy: { rewardGranted: true }, occurredAt: '2026-08-24T02:00:00Z', reversedAt: null
  };
  const session = { access_token: 'member-token', user: { id: 'phase4c-habit-undo-member' } };
  const posted = [];
  let state = cloudState(20, { habitEvents: [eventA] });
  const coordinator = MemberAuth.createMemberAuthCoordinator({
    supabaseClient: createAuthClient(session), projectUrl: 'https://jwpbwlrdzmfzjlbrktlc.supabase.co',
    publishableKey: 'sb_publishable_example', storage: createStorage(),
    contract: BackendContract, application: Application,
    fetchImpl: async (_url, options) => {
      if (options.method === 'GET') {
        return { ok: true, status: 200, async json() { return { ok: true, state }; } };
      }
      const command = JSON.parse(options.body);
      posted.push(command);
      state = cloudState(command.type === 'REVERSE_HABIT_EVENT' ? 22 : 21, {
        habitEvents: command.type === 'REVERSE_HABIT_EVENT'
          ? [{ ...eventB, reversedAt: '2026-08-24T03:00:00Z' }, eventA]
          : [eventB, eventA]
      });
      return { ok: true, status: 200, async json() {
        return { ok: true, state, result: { eventId: command.payload.eventId || eventB.id } };
      } };
    }
  });

  await coordinator.start();
  await coordinator.reportHabitEvent({ habitId: 'screen_break', businessDate: '2026-08-24' });
  const latest = MemberAuth.selectLatestHabitEvent(coordinator.getMemberState().habitEvents);
  assert.equal(latest.title, eventB.title);
  await coordinator.reloadMember();
  assert.equal(
    MemberAuth.selectLatestHabitEvent(coordinator.getMemberState().habitEvents).id,
    eventB.id,
    'authoritative reload must keep Event B as the latest reversal target'
  );
  await coordinator.reverseHabitEvent({ eventId: latest.id, businessDate: '2026-08-24' });
  assert.equal(posted[0].type, 'REPORT_HABIT_EVENT');
  assert.equal(posted[1].type, 'REVERSE_HABIT_EVENT');
  assert.equal(posted[1].payload.eventId, eventB.id);
  assert.equal(
    MemberAuth.selectLatestHabitEvent(coordinator.getMemberState().habitEvents).id,
    eventA.id,
    'a reversed Event B must no longer be the undo target'
  );

  const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const selectorUses = app.match(/selectLatestHabitEvent\(state\.habitEvents\)/g) || [];
  assert.ok(selectorUses.length >= 2, 'undo label and undo command must share the same selector');
});

test('a blocked latest habit event remains the reversal target instead of falling back to an older event', async () => {
  const eventA = {
    id: '123e4567-e89b-42d3-a456-42661417401a', businessDate: '2026-08-24',
    direction: 'good', title: '多喝水 500ml', occurredAt: '2026-08-24T01:00:00Z', reversedAt: null
  };
  const eventB = {
    id: '123e4567-e89b-42d3-a456-42661417401b', businessDate: '2026-08-24',
    direction: 'good', title: '使用 3C 後休息 10 分鐘', occurredAt: '2026-08-24T02:00:00Z', reversedAt: null
  };
  const session = { access_token: 'member-token', user: { id: 'phase4c-blocked-undo-member' } };
  const posted = [];
  const state = cloudState(24, { habitEvents: [eventB, eventA] });
  const coordinator = MemberAuth.createMemberAuthCoordinator({
    supabaseClient: createAuthClient(session), projectUrl: 'https://jwpbwlrdzmfzjlbrktlc.supabase.co',
    publishableKey: 'sb_publishable_example', storage: createStorage(),
    contract: BackendContract, application: Application,
    fetchImpl: async (_url, options) => {
      if (options.method === 'GET') {
        return { ok: true, status: 200, async json() { return { ok: true, state }; } };
      }
      const command = JSON.parse(options.body);
      posted.push(command);
      return { ok: false, status: 409, async json() {
        return { ok: false, errorCode: 'REVERSAL_BLOCKED', retryable: false, state };
      } };
    }
  });

  await coordinator.start();
  const latest = MemberAuth.selectLatestHabitEvent(coordinator.getMemberState().habitEvents);
  assert.equal(latest.id, eventB.id);
  const result = await coordinator.reverseHabitEvent({ eventId: latest.id, businessDate: '2026-08-24' });
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, 'REVERSAL_BLOCKED');
  assert.equal(posted[0].payload.eventId, eventB.id);
  assert.equal(MemberAuth.selectLatestHabitEvent(coordinator.getMemberState().habitEvents).id, eventB.id);
});

test('Phase 4C gameplay never overwrites the guest save', async () => {
  const guestSave = JSON.stringify({ character: { gold: 77 }, tasks: [{ id: 'guest-only' }] });
  const storage = createStorage({ lifequest_state: guestSave });
  const session = { access_token: 'member-token', user: { id: 'phase4c-member' } };
  let state = cloudState();
  const coordinator = MemberAuth.createMemberAuthCoordinator({
    supabaseClient: createAuthClient(session), projectUrl: 'https://jwpbwlrdzmfzjlbrktlc.supabase.co',
    publishableKey: 'sb_publishable_example', storage, contract: BackendContract, application: Application,
    fetchImpl: async (_url, options) => {
      if (options.method === 'GET') return { ok: true, status: 200, async json() { return { ok: true, state }; } };
      state = cloudState(9);
      return { ok: true, status: 200, async json() { return { ok: true, state, result: {} }; } };
    }
  });
  await coordinator.start();
  await coordinator.reportHabitEvent({ habitId: 'hydration', businessDate: '2026-08-23' });
  assert.equal(storage.value('lifequest_state'), guestSave);
});

test('Phase 4C network retry reuses the same durable operation id', async () => {
  const session = { access_token: 'member-token', user: { id: 'phase4c-retry-member' } };
  const posted = [];
  let postCount = 0;
  const coordinator = MemberAuth.createMemberAuthCoordinator({
    supabaseClient: createAuthClient(session), projectUrl: 'https://jwpbwlrdzmfzjlbrktlc.supabase.co',
    publishableKey: 'sb_publishable_example', storage: createStorage(),
    contract: BackendContract, application: Application,
    fetchImpl: async (_url, options) => {
      if (options.method === 'GET') {
        return { ok: true, status: 200, async json() { return { ok: true, state: cloudState(8) }; } };
      }
      postCount += 1;
      posted.push(JSON.parse(options.body));
      if (postCount === 1) {
        return { ok: false, status: 503, async json() {
          return { ok: false, errorCode: 'INTERNAL_ERROR', retryable: true, state: cloudState(8) };
        } };
      }
      return { ok: true, status: 200, async json() {
        return { ok: true, state: cloudState(9), result: { eventId: 'evt-1' } };
      } };
    }
  });

  await coordinator.start();
  const first = await coordinator.reportHabitEvent({ habitId: 'hydration', businessDate: '2026-08-23' });
  const second = await coordinator.reportHabitEvent({ habitId: 'hydration', businessDate: '2026-08-23' });
  assert.equal(first.ok, false);
  assert.equal(first.retryable, true);
  assert.equal(second.ok, true);
  assert.equal(posted[0].operationId, posted[1].operationId);
});

test('Phase 4C version conflict adopts authoritative state before an explicit reload', async () => {
  const session = { access_token: 'member-token', user: { id: 'phase4c-version-member' } };
  let getVersion = 8;
  const coordinator = MemberAuth.createMemberAuthCoordinator({
    supabaseClient: createAuthClient(session), projectUrl: 'https://jwpbwlrdzmfzjlbrktlc.supabase.co',
    publishableKey: 'sb_publishable_example', storage: createStorage(),
    contract: BackendContract, application: Application,
    fetchImpl: async (_url, options) => {
      if (options.method === 'GET') {
        return { ok: true, status: 200, async json() { return { ok: true, state: cloudState(getVersion) }; } };
      }
      getVersion = 12;
      return { ok: false, status: 409, async json() {
        return {
          ok: false, errorCode: 'VERSION_CONFLICT', retryable: false,
          currentVersion: 12, state: cloudState(12)
        };
      } };
    }
  });

  await coordinator.start();
  const conflict = await coordinator.reportHabitEvent({ habitId: 'hydration', businessDate: '2026-08-23' });
  assert.equal(conflict.ok, false);
  assert.equal(conflict.errorCode, 'VERSION_CONFLICT');
  assert.equal(conflict.state.meta.repositoryVersion, 12);
  const refreshed = await coordinator.reloadMember();
  assert.equal(refreshed.ok, true);
  assert.equal(refreshed.state.meta.repositoryVersion, 12);
});

test('member rule OFF to ON keeps the complete gameplay state and restores the Cloud preference', async () => {
  const session = { access_token: 'member-token', user: { id: 'phase4c-rule-member' } };
  const posted = [];
  const readyStates = [];
  let persistedPreference = false;
  let version = 8;
  const fullState = () => cloudState(version, {
    rulePreferences: { rule_1: persistedPreference }
  });
  const fetchImpl = async (_url, options) => {
      if (options.method === 'GET') {
        return { ok: true, status: 200, async json() { return { ok: true, state: fullState() }; } };
      }
      const command = JSON.parse(options.body);
      posted.push(command);
      persistedPreference = command.payload.enabled;
      version += 1;
      const phase3State = {
        meta: { repositoryVersion: version, operations: [] },
        member: fullState().member,
        dailyDrafts: {}, customHabits: [],
        rulePreferences: { rule_1: persistedPreference }
      };
      return { ok: true, status: 200, async json() {
        return { ok: true, state: phase3State, result: { ruleId: 'rule_1', enabled: persistedPreference } };
      } };
    };
  const createCoordinator = () => MemberAuth.createMemberAuthCoordinator({
    supabaseClient: createAuthClient(session), projectUrl: 'https://jwpbwlrdzmfzjlbrktlc.supabase.co',
    publishableKey: 'sb_publishable_example', storage: createStorage(),
    contract: BackendContract, application: Application,
    onMemberReady: ({ state }) => readyStates.push(state),
    fetchImpl
  });
  const coordinator = createCoordinator();

  await coordinator.start();
  const enabled = await coordinator.setRuleEnabled({ ruleId: 'rule_1', enabled: true });
  const restored = await coordinator.reloadMember();
  coordinator.stop();
  const reloggedCoordinator = createCoordinator();
  const relogged = await reloggedCoordinator.start();
  const disabled = await reloggedCoordinator.setRuleEnabled({ ruleId: 'rule_1', enabled: false });

  assert.equal(posted.length, 2);
  assert.deepEqual(posted.map(item => item.type), ['SET_RULE_ENABLED', 'SET_RULE_ENABLED']);
  assert.deepEqual(posted[0].payload, { ruleId: 'rule_1', enabled: true });
  assert.deepEqual(posted[1].payload, { ruleId: 'rule_1', enabled: false });
  assert.equal(enabled.state.rulePreferences.rule_1, true);
  assert.ok(enabled.state.player, 'successful Rule Preference commands must not discard the gameplay projection');
  assert.ok(readyStates[1].player, 'success must keep the member in the gameplay workspace');
  assert.equal(restored.state.rulePreferences.rule_1, true);
  assert.ok(restored.state.player);
  assert.equal(relogged.state.rulePreferences.rule_1, true);
  assert.ok(relogged.state.player);
  assert.equal(disabled.state.rulePreferences.rule_1, false);
  assert.ok(disabled.state.player);
  reloggedCoordinator.stop();
});

test('failed member rule toggle keeps the authoritative value and does not announce a ready state', async () => {
  const session = { access_token: 'member-token', user: { id: 'phase4c-rule-error-member' } };
  const readyStates = [];
  const state = cloudState(8, { rulePreferences: { rule_1: false } });
  const coordinator = MemberAuth.createMemberAuthCoordinator({
    supabaseClient: createAuthClient(session), projectUrl: 'https://jwpbwlrdzmfzjlbrktlc.supabase.co',
    publishableKey: 'sb_publishable_example', storage: createStorage(),
    contract: BackendContract, application: Application,
    onMemberReady: ({ state: readyState }) => readyStates.push(readyState),
    fetchImpl: async (_url, options) => {
      if (options.method === 'GET') {
        return { ok: true, status: 200, async json() { return { ok: true, state }; } };
      }
      return { ok: false, status: 500, async json() {
        return { ok: false, errorCode: 'INTERNAL_ERROR', retryable: true, state };
      } };
    }
  });

  await coordinator.start();
  const failed = await coordinator.setRuleEnabled({ ruleId: 'rule_1', enabled: true });

  assert.equal(failed.ok, false);
  assert.equal(failed.state.rulePreferences.rule_1, false);
  assert.ok(failed.state.player);
  assert.equal(readyStates.length, 1, 'failed commands must not render a false member-ready success');
});

test('rule toggle UI locks only while pending, always releases, and never navigates away', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const start = app.indexOf('window.toggleRuleEnabled = async function');
  const end = app.indexOf('// 刪除規則', start);
  const toggleHandler = app.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.match(app, /const togglePending = ruleToggleLocks\.has\(rule\.id\)/);
  assert.match(app, /togglePending \? 'disabled aria-busy="true"' : ''/);
  assert.match(toggleHandler, /ruleToggleLocks\.add\(id\)[\s\S]*finally[\s\S]*ruleToggleLocks\.delete\(id\)/);
  assert.match(toggleHandler, /activeMember[\s\S]*memberAuthCoordinator\.setRuleEnabled[\s\S]*executeGameCommand/);
  assert.doesNotMatch(toggleHandler, /showMemberBootstrap|returnToMemberBootstrap|switchToTab/);
});

test('valid restored member session enters gameplay without a manual dossier retry', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const bootStart = app.indexOf("document.addEventListener('DOMContentLoaded'");
  const bootEnd = app.indexOf('function applyPendingMainQuest', bootStart);
  const boot = app.slice(bootStart, bootEnd);

  assert.ok(bootStart >= 0 && bootEnd > bootStart);
  assert.match(
    app,
    /function restoreMemberGameplayWorkspace\(authResult\)[\s\S]{0,450}onboardingCompleted[\s\S]{0,250}memberState\?\.player[\s\S]{0,300}readStoredMemberView\(\)[\s\S]{0,150}enterMemberGameplayWorkspace\(restoredView\)/
  );
  assert.match(
    boot,
    /if \(authResult\?\.session\) \{[\s\S]{0,180}restoreMemberGameplayWorkspace\(authResult\);[\s\S]{0,80}return;/
  );
  assert.match(boot, /applyPendingMainQuest\(\);[\s\S]{0,120}checkOnboarding\(\);/);
  assert.doesNotMatch(boot, /authMemberRetry\.(click|dispatchEvent)/);
});

test('member reload restores only a legal saved gameplay view after authoritative bootstrap', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const restoreStart = app.indexOf('function restoreMemberGameplayWorkspace');
  const restoreEnd = app.indexOf('function returnToMemberBootstrap', restoreStart);
  const restore = app.slice(restoreStart, restoreEnd);

  assert.ok(restoreStart >= 0 && restoreEnd > restoreStart);
  assert.match(app, /const MEMBER_VIEW_STORAGE_KEY = 'currentMemberView'/);
  assert.match(
    app,
    /const MEMBER_RESTORABLE_VIEWS = new Set\(\['dashboard', 'rules', 'training', 'boss-battle', 'insights', 'analytics', 'supply'\]\)/
  );
  assert.match(app, /function readStoredMemberView\(\)[\s\S]{0,450}sessionStorage\.getItem\(MEMBER_VIEW_STORAGE_KEY\)[\s\S]{0,250}MEMBER_RESTORABLE_VIEWS\.has/);
  assert.match(restore, /memberState\?\.player[\s\S]{0,300}readStoredMemberView\(\)[\s\S]{0,150}enterMemberGameplayWorkspace\(restoredView\)/);
  assert.doesNotMatch(restore, /enterMemberGameplayWorkspace\('draft'\)/);
});

test('member view persistence covers navigation, fallback and logout without touching guest saves', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const switchStart = app.indexOf('window.switchToTab = function');
  const switchEnd = app.indexOf('// ==========================================', switchStart);
  const switchHandler = app.slice(switchStart, switchEnd);
  const logoutStart = app.indexOf('async function restoreGuestEntranceAfterLogout');
  const logoutEnd = app.indexOf('async function initializeMemberAuth', logoutStart);
  const logoutHandler = app.slice(logoutStart, logoutEnd);

  assert.ok(switchStart >= 0 && switchEnd > switchStart);
  assert.ok(logoutStart >= 0 && logoutEnd > logoutStart);
  assert.match(app, /function normalizeMemberView\(view\)[\s\S]{0,220}MEMBER_RESTORABLE_VIEWS\.has\(view\)[\s\S]{0,120}'dashboard'/);
  assert.match(switchHandler, /activeMember[\s\S]{0,180}member-gameplay-mode[\s\S]{0,180}saveCurrentMemberView\(tabName\)/);
  const clearViewAt = logoutHandler.indexOf('clearCurrentMemberView()');
  const hydrateAt = logoutHandler.indexOf('const guestState = await gameApplication.initialize()');
  const identityCheckAt = logoutHandler.indexOf('if (memberAuthCoordinator?.getSession?.()?.user) return;');
  const applyAt = logoutHandler.indexOf('state = guestState;');
  assert.ok(clearViewAt >= 0 && hydrateAt > clearViewAt && identityCheckAt > hydrateAt && applyAt > identityCheckAt,
    'clear Member view, hydrate Guest, recheck identity, then apply only if no new Member exists');
  assert.match(app, /sessionStorage\.setItem\(MEMBER_VIEW_STORAGE_KEY/);
  assert.match(app, /sessionStorage\.removeItem\(MEMBER_VIEW_STORAGE_KEY\)/);
  assert.doesNotMatch(app, /localStorage\.(?:setItem|removeItem)\(MEMBER_VIEW_STORAGE_KEY/);
});

test('Member UI routes gameplay before local settlement and retains restricted view gating', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'style.css'), 'utf8');
  assert.match(app, /memberAuthCoordinator\.reportHabitEvent/);
  assert.match(app, /memberAuthCoordinator\.reverseHabitEvent/);
  assert.match(app, /memberAuthCoordinator\.submitDailyEntry/);
  assert.match(app, /handleMemberCommandFailure/);
  assert.match(app, /VERSION_CONFLICT[\s\S]{0,500}reloadMember/);
  assert.match(app, /MEMBER_PHASE5_TABS/);
  assert.match(app, /const MEMBER_GAMEPLAY_ENABLED = true/);
  assert.match(css, /member-gameplay-mode/);
  assert.doesNotMatch(css, /member-gameplay-mode[\s\S]{0,250}#btn-submit-log/);
});

test('member daily submit captures the current unsaved form snapshot before dispatch', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const memberStart = app.indexOf('async function submitMemberDailyEntry');
  const memberEnd = app.indexOf('window.submitDailyLog = async function', memberStart);
  const submitStart = memberEnd;
  const submitEnd = app.indexOf('const habitAudit = HabitEngine.auditDaily', submitStart);
  const memberSubmit = app.slice(memberStart, memberEnd);
  const submitHandler = app.slice(submitStart, submitEnd);

  assert.ok(memberStart >= 0 && memberEnd > memberStart && submitEnd > submitStart);
  assert.match(app, /function readDailyLogFormInput\(form[\s\S]{0,200}DailyFormSubmission\.read\(form\)/);
  assert.match(
    submitHandler,
    /const currentFormInput = submittedInput \|\| readDailyLogFormInput\(\);[\s\S]{0,220}activeMember[\s\S]{0,220}submitMemberDailyEntry\(\{[\s\S]{0,160}input: currentFormInput/
  );
  assert.match(memberSubmit, /\{\s*businessDate,\s*input\s*\}[\s\S]{0,800}submitDailyEntry\(\{[\s\S]{0,120}input/);
  assert.doesNotMatch(memberSubmit, /readDailyLogFormDraft|dailyDrafts/);
  assert.match(memberSubmit, /applyMemberGameplayProjection[\s\S]*setCampStage\('settlement'\)[\s\S]*finally[\s\S]*setMemberActionBusy\(button, false\)/);
  assert.doesNotMatch(memberSubmit, /showMemberBootstrap|returnToMemberBootstrap|switchToTab/);
});

test('member daily command prefers current form input over an older saved Cloud draft', async () => {
  const session = { access_token: 'member-token', user: { id: 'phase4c-current-form-member' } };
  const posted = [];
  const state = cloudState(12, {
    dailyDrafts: {
      '2026-08-24': {
        date: '2026-08-24', sleep: 6, water: 2000, exercise: 35,
        study: 0, expense: 120, impulse: 0, sugaryDrinks: 0
      }
    }
  });
  const coordinator = MemberAuth.createMemberAuthCoordinator({
    supabaseClient: createAuthClient(session), projectUrl: 'https://jwpbwlrdzmfzjlbrktlc.supabase.co',
    publishableKey: 'sb_publishable_example', storage: createStorage(),
    contract: BackendContract, application: Application,
    fetchImpl: async (_url, options) => {
      if (options.method === 'GET') {
        return { ok: true, status: 200, async json() { return { ok: true, state }; } };
      }
      posted.push(JSON.parse(options.body));
      return { ok: true, status: 200, async json() {
        return { ok: true, state: cloudState(13), result: { revision: 2 } };
      } };
    }
  });

  await coordinator.start();
  await coordinator.submitDailyEntry({
    businessDate: '2026-08-24',
    input: { sleep: 8, water: 2000, exercise: 40, study: 0, expense: 120, impulse: 0, sugaryDrinks: 0 }
  });

  assert.equal(posted.length, 1);
  assert.equal(posted[0].type, 'SUBMIT_DAILY_ENTRY');
  assert.equal(posted[0].payload.sleep, 8);
  assert.equal(posted[0].payload.exercise, 40);
  assert.notEqual(posted[0].payload.sleep, state.dailyDrafts['2026-08-24'].sleep);
});

test('daily save remains draft-only while correction consumes command raw input as a new revision', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const edge = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'functions', 'lifequest-command', 'index.ts'), 'utf8');
  const transaction = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20260823200000_phase_4b_transactional_gameplay_commands.sql'), 'utf8');
  const index = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const saveStart = app.indexOf("elements.btnSaveDraft?.addEventListener('click'");
  const saveEnd = app.indexOf('// 系統公文', saveStart);
  const saveHandler = app.slice(saveStart, saveEnd);

  assert.ok(saveStart >= 0 && saveEnd > saveStart);
  assert.match(saveHandler, /saveDailyDraft\(\{ date, draft \}\)/);
  assert.doesNotMatch(saveHandler, /submitDailyEntry|submitDailyLog|Settlement/);
  assert.match(edge, /buildDailySettlementPlan\(\{[\s\S]{0,120}rawInput: payload/);
  assert.match(transaction, /v_entry\.current_revision := v_entry\.current_revision \+ 1/);
  assert.match(transaction, /insert into public\.daily_entry_revisions/);
  assert.match(index, /app\.js\?v=60/);
});

test('rendered member daily form submits its unsaved DOM values through the real remote command path', async () => {
  const index = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const fieldNames = ['sleep', 'water', 'exercise', 'study', 'expense', 'impulse', 'sugaryDrinks'];
  const idByName = {
    sleep: 'log-sleep', water: 'log-water', exercise: 'log-exercise', study: 'log-study',
    expense: 'log-expense', impulse: 'log-impulse', sugaryDrinks: 'log-sugary-drinks'
  };
  const elements = new Map(fieldNames.map(name => {
    const id = idByName[name];
    assert.match(index, new RegExp(`<input[^>]+id=["']${id}["'][^>]+name=["']${name}["']`));
    return [name, { id, name, value: name === 'sleep' ? '6' : name === 'exercise' ? '35' : '0' }];
  }));
  const listeners = new Map();
  const form = {
    id: 'daily-log-form',
    elements: { namedItem(name) { return elements.get(name) || null; } },
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type, listener) { if (listeners.get(type) === listener) listeners.delete(type); },
    async dispatchSubmit() {
      const event = { currentTarget: form, target: form, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
      await listeners.get('submit')(event);
      return event;
    }
  };

  const session = { access_token: 'member-token', user: { id: 'phase4c-ui-form-member' } };
  const posted = [];
  let state = cloudState(18, {
    dailyDrafts: {
      '2026-08-24': { date: '2026-08-24', sleep: 6, water: 0, exercise: 35, study: 0, expense: 0, impulse: 0, sugaryDrinks: 0 }
    },
    dailyEntries: [{
      id: 'entry-1', businessDate: '2026-08-24', currentRevision: 1,
      effectiveInput: { sleep: 6, water: 0, exercise: 35, study: 0, expense: 0, impulse: 0, sugaryDrinks: 0 }
    }]
  });
  const coordinator = MemberAuth.createMemberAuthCoordinator({
    supabaseClient: createAuthClient(session), projectUrl: 'https://jwpbwlrdzmfzjlbrktlc.supabase.co',
    publishableKey: 'sb_publishable_example', storage: createStorage(),
    contract: BackendContract, application: Application,
    fetchImpl: async (_url, options) => {
      if (options.method === 'GET') {
        return { ok: true, status: 200, async json() { return { ok: true, state }; } };
      }
      const command = JSON.parse(options.body);
      posted.push(command);
      state = cloudState(19, {
        dailyEntries: [{ id: 'entry-1', businessDate: '2026-08-24', currentRevision: 2,
          effectiveInput: command.payload }]
      });
      return { ok: true, status: 200, async json() {
        return { ok: true, state, result: { revision: 2 }, repositoryVersion: 19 };
      } };
    }
  });
  await coordinator.start();

  let capturedCurrentFormInput = null;
  DailyFormSubmission.bind(form, async ({ input }) => {
    capturedCurrentFormInput = input;
    await coordinator.submitDailyEntry({ businessDate: '2026-08-24', input });
  });
  elements.get('sleep').value = '8';
  elements.get('exercise').value = '40';
  const submitEvent = await form.dispatchSubmit();

  assert.equal(submitEvent.defaultPrevented, true);
  assert.equal(elements.get('sleep').value, '8');
  assert.equal(elements.get('exercise').value, '40');
  assert.equal(capturedCurrentFormInput.sleep, '8');
  assert.equal(capturedCurrentFormInput.exercise, '40');
  assert.equal(posted.length, 1);
  assert.equal(posted[0].type, 'SUBMIT_DAILY_ENTRY');
  assert.equal(posted[0].payload.sleep, 8);
  assert.equal(posted[0].payload.exercise, 40);
  assert.notEqual(posted[0].payload.sleep, 6);
});
