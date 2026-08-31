const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const BackendContract = require('../backendContract.js');
const Application = require('../gameApplication.js');
const MemberAuth = require('../memberAuth.js');

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

function cloudState(version = 2, overrides = {}) {
  return {
    meta: { repositoryVersion: version, operations: [] },
    member: {
      adventurerName: 'Phase三冒險者',
      onboardingStatus: 'main_quest_selected',
      onboardingCompleted: true,
      mainQuestId: 'sleep',
      dailyBudget: 500,
      timeZone: 'Asia/Taipei'
    },
    dailyDrafts: {},
    customHabits: [],
    rulePreferences: {},
    ...overrides
  };
}

function command(type, payload) {
  return BackendContract.createCommandEnvelope({
    type,
    operationId: `phase3-${type.toLowerCase()}-0001`,
    occurredAt: '2026-08-23T03:00:00.000Z',
    businessDate: '2026-08-23',
    payload
  });
}

test('Phase 3 contract accepts the six non-resource member intents', () => {
  const habitId = '123e4567-e89b-42d3-a456-426614174000';
  const draft = { sleep: 7.5, water: 2000, exercise: 30, study: 20, expense: 100, impulse: 0, sugaryDrinks: 0 };
  const commands = [
    command('SAVE_DAILY_DRAFT', { date: '2026-08-23', draft }),
    command('CREATE_CUSTOM_HABIT', { title: '閱讀三十分鐘', direction: 'good' }),
    command('UPDATE_CUSTOM_HABIT', { habitId, title: '閱讀二十分鐘' }),
    command('REMOVE_CUSTOM_HABIT', { habitId }),
    command('RESTORE_CUSTOM_HABIT', { habitId }),
    command('SET_RULE_ENABLED', { ruleId: 'rule_1', enabled: false })
  ];

  commands.forEach(item => assert.equal(BackendContract.validateCommandEnvelope(item).ok, true));
});

test('Phase 3 contract rejects resource forgery and system definition changes', () => {
  const draft = command('SAVE_DAILY_DRAFT', {
    date: '2026-08-23',
    draft: { sleep: 7, water: 2000, exercise: 30, study: 0, expense: 100, impulse: 0, sugaryDrinks: 0 },
    gold: 999
  });
  const habit = command('CREATE_CUSTOM_HABIT', { title: '閱讀', direction: 'good', exp: 999 });
  const rule = command('SET_RULE_ENABLED', { ruleId: 'forged-rule', enabled: false });

  assert.equal(BackendContract.validateCommandEnvelope(draft).reason, 'invalid_payload');
  assert.equal(BackendContract.validateCommandEnvelope(habit).reason, 'invalid_payload');
  assert.equal(BackendContract.validateCommandEnvelope(rule).reason, 'invalid_payload');
});

test('Phase 3 daily draft validates fields and safe ranges', () => {
  const base = { sleep: 7, water: 2000, exercise: 30, study: 0, expense: 100, impulse: 0, sugaryDrinks: 0 };
  assert.equal(BackendContract.validateCommandEnvelope(command('SAVE_DAILY_DRAFT', {
    date: '2026-08-23', draft: { ...base, hp: 50 }
  })).reason, 'invalid_payload');
  assert.equal(BackendContract.validateCommandEnvelope(command('SAVE_DAILY_DRAFT', {
    date: '2026-08-23', draft: { ...base, sleep: 25 }
  })).reason, 'invalid_payload');
  assert.equal(BackendContract.validateCommandEnvelope(command('SAVE_DAILY_DRAFT', {
    date: '2026-02-30', draft: base
  })).reason, 'invalid_payload');
  assert.equal(BackendContract.validateCommandEnvelope(command('SAVE_DAILY_DRAFT', {
    date: '2026-08-23', draft: { ...base, water: 1.5 }
  })).reason, 'invalid_payload');
});

test('member methods submit only Phase 3 intent and adopt authoritative projection', async () => {
  const session = { access_token: 'member-token', user: { id: 'member-phase3' } };
  const posted = [];
  let state = cloudState();
  let habit = null;
  const coordinator = MemberAuth.createMemberAuthCoordinator({
    supabaseClient: createAuthClient(session),
    projectUrl: 'https://jwpbwlrdzmfzjlbrktlc.supabase.co',
    publishableKey: 'sb_publishable_example',
    storage: createStorage(),
    contract: BackendContract,
    application: Application,
    fetchImpl: async (_url, options) => {
      if (options.method === 'GET') {
        return { ok: true, status: 200, async json() { return { ok: true, state }; } };
      }
      const submitted = JSON.parse(options.body);
      posted.push(submitted);
      const version = state.meta.repositoryVersion + 1;
      if (submitted.type === 'SAVE_DAILY_DRAFT') {
        state = cloudState(version, { dailyDrafts: { [submitted.payload.date]: { date: submitted.payload.date, ...submitted.payload.draft } } });
      } else if (submitted.type === 'CREATE_CUSTOM_HABIT') {
        habit = { id: '123e4567-e89b-42d3-a456-426614174000', ...submitted.payload, deletedAt: null };
        state = cloudState(version, { customHabits: [habit] });
      } else if (submitted.type === 'UPDATE_CUSTOM_HABIT') {
        habit = { ...habit, title: submitted.payload.title ?? habit.title, direction: submitted.payload.direction ?? habit.direction };
        state = cloudState(version, { customHabits: [habit] });
      } else if (submitted.type === 'REMOVE_CUSTOM_HABIT') {
        habit = { ...habit, deletedAt: '2026-08-23T03:05:00.000Z' };
        state = cloudState(version, { customHabits: [habit] });
      } else if (submitted.type === 'RESTORE_CUSTOM_HABIT') {
        habit = { ...habit, deletedAt: null };
        state = cloudState(version, { customHabits: [habit] });
      } else if (submitted.type === 'SET_RULE_ENABLED') {
        state = cloudState(version, { rulePreferences: { [submitted.payload.ruleId]: submitted.payload.enabled } });
      }
      return { ok: true, status: 200, async json() { return { ok: true, state, result: {} }; } };
    }
  });

  await coordinator.start();
  await coordinator.saveDailyDraft({
    date: '2026-08-23',
    draft: { sleep: '', water: 1800, exercise: 20, study: 30, expense: '', impulse: 0, sugaryDrinks: 1 }
  });
  await coordinator.createCustomHabit({ title: '閱讀', direction: 'good' });
  await coordinator.updateCustomHabit({ habitId: habit.id, title: '閱讀三十分鐘', direction: 'good' });
  await coordinator.removeCustomHabit({ habitId: habit.id });
  await coordinator.restoreCustomHabit({ habitId: habit.id });
  const result = await coordinator.setRuleEnabled({ ruleId: 'rule_1', enabled: false });

  assert.deepEqual(posted.map(item => item.type), [
    'SAVE_DAILY_DRAFT', 'CREATE_CUSTOM_HABIT', 'UPDATE_CUSTOM_HABIT',
    'REMOVE_CUSTOM_HABIT', 'RESTORE_CUSTOM_HABIT', 'SET_RULE_ENABLED'
  ]);
  assert.equal(posted[0].payload.draft.sleep, null);
  assert.equal(posted[0].payload.draft.expense, null);
  assert.equal(posted.some(item => 'userId' in item || 'gold' in item.payload || 'exp' in item.payload), false);
  assert.equal(result.state.rulePreferences.rule_1, false);
  assert.equal(result.state.meta.repositoryVersion, 8);
});

test('member Phase 3 commands never overwrite the guest save', async () => {
  const guestSave = JSON.stringify({ dailyDrafts: { guest: true }, tasks: [{ id: 'guest-habit' }] });
  const storage = createStorage({ lifequest_state: guestSave });
  const session = { access_token: 'member-token', user: { id: 'member-phase3' } };
  let state = cloudState();
  const coordinator = MemberAuth.createMemberAuthCoordinator({
    supabaseClient: createAuthClient(session),
    projectUrl: 'https://jwpbwlrdzmfzjlbrktlc.supabase.co',
    publishableKey: 'sb_publishable_example',
    storage,
    contract: BackendContract,
    application: Application,
    fetchImpl: async (_url, options) => {
      if (options.method === 'GET') return { ok: true, status: 200, async json() { return { ok: true, state }; } };
      state = cloudState(3, { rulePreferences: { rule_2: false } });
      return { ok: true, status: 200, async json() { return { ok: true, state }; } };
    }
  });

  await coordinator.start();
  await coordinator.setRuleEnabled({ ruleId: 'rule_2', enabled: false });
  assert.equal(storage.value('lifequest_state'), guestSave);
});

test('Phase 3 migration creates only non-resource definitions with RLS', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20260823120000_phase_3_member_definitions.sql'), 'utf8');
  assert.match(sql, /create table public\.daily_drafts/i);
  assert.match(sql, /primary key \(user_id, entry_date\)/i);
  assert.match(sql, /create table public\.custom_habits/i);
  assert.match(sql, /deleted_at timestamptz/i);
  assert.match(sql, /create table public\.rule_preferences/i);
  assert.match(sql, /primary key \(user_id, rule_id\)/i);
  assert.match(sql, /enable row level security/gi);
  assert.match(sql, /auth\.uid\(\)\) = user_id/gi);
  assert.match(sql, /revoke insert, update, delete[\s\S]*authenticated/gi);
  assert.doesNotMatch(sql, /create table .*daily_entries|create table .*habit_events|\bresource_ledger\b/i);
});

test('Phase 3 server transaction uses existing receipts and repository version', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20260823120000_phase_3_member_definitions.sql'), 'utf8');
  assert.match(sql, /insert into private\.command_operations/i);
  assert.match(sql, /on conflict \(user_id, operation_id\) do nothing/i);
  assert.match(sql, /OPERATION_ID_REUSED/);
  assert.match(sql, /OPERATION_IN_PROGRESS/);
  assert.match(sql, /repository_version = repository_version \+ 1/i);
  assert.match(sql, /v_existing\.result \|\| jsonb_build_object\('duplicate', true\)/i);
  assert.match(sql, /BACKFILL_NOT_ALLOWED/);
  assert.match(sql, /INVALID_BUSINESS_DATE/);
});

test('SAVE_DAILY_DRAFT changes only draft persistence, command receipt and repository version', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20260823120000_phase_3_member_definitions.sql'), 'utf8');
  const validationStart = sql.indexOf("if v_command_type = 'SAVE_DAILY_DRAFT' then");
  const start = sql.indexOf("if v_command_type = 'SAVE_DAILY_DRAFT' then", validationStart + 1);
  const end = sql.indexOf("elsif v_command_type = 'CREATE_CUSTOM_HABIT' then", start);
  const branch = sql.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.match(branch, /insert into public\.daily_drafts/i);
  assert.match(branch, /on conflict \(user_id, entry_date\) do update/i);
  assert.doesNotMatch(branch, /player_states|resource_ledger|habit_events|boss_encounters|boss_actions|player_achievements|status_effects|daily_entries|daily_entry_revisions/i);
  assert.match(sql, /update public\.member_game_roots[\s\S]+repository_version = repository_version \+ 1/i);
  assert.match(sql, /update private\.command_operations[\s\S]+status = 'completed'/i);
});

test('custom habit SQL uses server ids, soft deletion and an active limit', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20260823120000_phase_3_member_definitions.sql'), 'utf8');
  assert.match(sql, /id uuid primary key default gen_random_uuid\(\)/i);
  assert.match(sql, /set deleted_at = now\(\)/i);
  assert.match(sql, /set deleted_at = null/i);
  assert.match(sql, /v_active_count >= 50/i);
  assert.doesNotMatch(sql, /delete from public\.custom_habits/i);
});

test('Edge Function extends authoritative read and routes all six Phase 3 commands', () => {
  const edge = fs.readFileSync(path.join(__dirname, '../supabase/functions/lifequest-command/index.ts'), 'utf8');
  ['daily_drafts', 'custom_habits', 'rule_preferences'].forEach(table => assert.match(edge, new RegExp(`from\\('${table}'\\)`)));
  assert.ok(
    (edge.match(/\.eq\('user_id', userData\.user\.id\)/g) || []).length >= 5,
    'all authoritative member reads must be scoped to the verified Auth user'
  );
  assert.doesNotMatch(edge, /Promise\.all\(\[\s*commandWriter[\s\S]*from\('rule_preferences'\)/);
  [
    'SAVE_DAILY_DRAFT', 'CREATE_CUSTOM_HABIT', 'UPDATE_CUSTOM_HABIT',
    'REMOVE_CUSTOM_HABIT', 'RESTORE_CUSTOM_HABIT', 'SET_RULE_ENABLED'
  ].forEach(type => assert.match(edge, new RegExp(`${type}: 'execute_phase3_command'`)));
  assert.match(edge, /p_user_id:\s*userData\.user\.id/);
  assert.doesNotMatch(edge, /payload\.userId|command\.userId/);
});

test('Phase 3 schema contains no game-resource columns or settlement command', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20260823120000_phase_3_member_definitions.sql'), 'utf8');
  assert.doesNotMatch(sql, /^\s*(exp|level|gold|gems|hp|boss|achievement|reward_amount)\s+[a-z]/gim);
  assert.doesNotMatch(sql, /'(?:REPORT_HABIT_EVENT|SUBMIT_DAILY_ENTRY|SETTLE_DAILY_ENTRY)'/i);
});

test('member Phase 3 UI still routes definition changes through Cloud commands', () => {
  const app = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
  assert.match(app, /memberAuthCoordinator\?\.saveDailyDraft/);
  assert.match(app, /memberAuthCoordinator\.createCustomHabit/);
  assert.match(app, /memberAuthCoordinator\.updateCustomHabit/);
  assert.match(app, /memberAuthCoordinator\.removeCustomHabit/);
  assert.match(app, /memberAuthCoordinator\.restoreCustomHabit/);
  assert.match(app, /memberAuthCoordinator\.setRuleEnabled/);
  assert.match(app, /會員的系統委託只能閱讀/);
});
