const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const BackendContract = require('../backendContract.js');
const domainPromise = import('../supabase/functions/_shared/phase4Domain.mjs');

const player = (overrides = {}) => ({
  totalXp: 0, hp: 50, gold: 0, gems: 0,
  baseStats: { health: 10, energy: 10, wealth: 10, growth: 10 },
  ...overrides
});

const dailyPayload = (overrides = {}) => ({
  sleep: 7, water: 2000, exercise: 30, study: 30,
  expense: 100, impulse: 0, sugaryDrinks: 0, ...overrides
});

test('Phase 4B command contract accepts only narrow player intent payloads', () => {
  const report = BackendContract.createCommandEnvelope({
    type: 'REPORT_HABIT_EVENT', operationId: 'habit-report-0001',
    businessDate: '2026-08-23', payload: { habitId: 'exercise_training' }
  });
  const reverse = BackendContract.createCommandEnvelope({
    type: 'REVERSE_HABIT_EVENT', operationId: 'habit-reverse-0001',
    businessDate: '2026-08-23', payload: { eventId: '11111111-1111-4111-8111-111111111111' }
  });
  const daily = BackendContract.createCommandEnvelope({
    type: 'SUBMIT_DAILY_ENTRY', operationId: 'daily-submit-0001',
    businessDate: '2026-08-23', payload: dailyPayload()
  });
  assert.equal(BackendContract.validateCommandEnvelope(report).ok, true);
  assert.equal(BackendContract.validateCommandEnvelope(reverse).ok, true);
  assert.equal(BackendContract.validateCommandEnvelope(daily).ok, true);
  assert.equal(BackendContract.validateCommandEnvelope({ ...report, payload: { habitId: 'x', xpToAdd: 999 } }).reason, 'invalid_payload');
  assert.equal(BackendContract.validateCommandEnvelope({ ...daily, payload: { ...daily.payload, goldReward: 999 } }).reason, 'invalid_payload');
});

test('good habit grants current local-compatible reward and respects daily reward limits', async () => {
  const { buildHabitEventPlan } = await domainPromise;
  const plan = buildHabitEventPlan({
    habit: { key: 'exercise_training', title: '有氧運動 10 分鐘', direction: 'good', kind: 'system' },
    player: player(), businessDate: '2026-08-23', serverBusinessDate: '2026-08-23',
    sameDayReports: 0, sameDayRewards: 0
  });
  assert.equal(plan.habit.policy.rewardGranted, true);
  assert.equal(plan.resource.deltas.xp, 5);
  assert.equal(plan.resource.deltas.gold, 2);
  const capped = buildHabitEventPlan({
    habit: { key: 'exercise_training', title: '有氧運動 10 分鐘', direction: 'good', kind: 'system' },
    player: player(), businessDate: '2026-08-23', serverBusinessDate: '2026-08-23',
    sameDayReports: 3, sameDayRewards: 3
  });
  assert.equal(capped.habit.policy.rewardGranted, false);
  assert.equal(capped.resource.deltas.xp, 0);
});

test('bad habit applies authoritative damage and the Phase 4 death boundary', async () => {
  const { buildHabitEventPlan } = await domainPromise;
  const plan = buildHabitEventPlan({
    habit: { key: 'fried_food', title: '吃油炸垃圾食物', direction: 'bad', kind: 'system' },
    player: player({ hp: 5, gold: 101 }), activeStatusIds: ['status-1'],
    businessDate: '2026-08-23', serverBusinessDate: '2026-08-23'
  });
  assert.equal(plan.resource.died, true);
  assert.equal(plan.resource.after.hp, 50);
  assert.equal(plan.resource.after.gold, 86);
  assert.deepEqual(plan.resource.clearedStatusIds, ['status-1']);
});

test('habit events are today-only and report caps fail without resource mutation', async () => {
  const { buildHabitEventPlan } = await domainPromise;
  const args = {
    habit: { key: 'hydration', title: '多喝水 500ml', direction: 'good', kind: 'system' },
    player: player(), businessDate: '2026-08-23', serverBusinessDate: '2026-08-23'
  };
  assert.throws(() => buildHabitEventPlan({ ...args, businessDate: '2026-08-22' }), /only on the server/);
  assert.throws(() => buildHabitEventPlan({ ...args, sameDayReports: 12 }), /report limit/);
});

test('custom good habits receive at most one daily reward', async () => {
  const { buildHabitEventPlan } = await domainPromise;
  const habit = { id: 'custom-1', title: '散步', direction: 'good', kind: 'custom' };
  const first = buildHabitEventPlan({ habit, player: player(), businessDate: '2026-08-23', serverBusinessDate: '2026-08-23' });
  const second = buildHabitEventPlan({ habit, player: player(), businessDate: '2026-08-23', serverBusinessDate: '2026-08-23', sameDayReports: 1, sameDayRewards: 1 });
  assert.equal(first.habit.policy.rewardGranted, true);
  assert.equal(second.habit.policy.rewardGranted, false);
});

test('fried food incident and gym rat use stable system keys and the same-day five-report rule', async () => {
  const { buildHabitEventPlan } = await domainPromise;
  const fried = buildHabitEventPlan({
    habit: { key: 'fried_food', title: '任意標題', direction: 'bad', kind: 'system' },
    player: player(), businessDate: '2026-08-23', serverBusinessDate: '2026-08-23',
    recentFriedFoodReports: 2
  });
  assert.equal(fried.boss.bossKey, 'fried-food-beast');
  const beforeTarget = buildHabitEventPlan({
    habit: { key: 'exercise_training', title: '不依賴中文標題', direction: 'good', kind: 'system' },
    player: player(), businessDate: '2026-08-23', serverBusinessDate: '2026-08-23',
    sameDayReports: 3
  });
  assert.deepEqual(beforeTarget.achievementEvents, []);
  const fifthReport = buildHabitEventPlan({
    habit: { key: 'exercise_training', title: '不依賴中文標題', direction: 'good', kind: 'system' },
    player: player(), businessDate: '2026-08-23', serverBusinessDate: '2026-08-23',
    sameDayReports: 4
  });
  assert.deepEqual(fifthReport.achievementEvents, ['gym_rat']);
  const sixthReport = buildHabitEventPlan({
    habit: { key: 'exercise_training', title: '不依賴中文標題', direction: 'good', kind: 'system' },
    player: player(), businessDate: '2026-08-23', serverBusinessDate: '2026-08-23',
    sameDayReports: 5, achievementCodes: ['gym_rat']
  });
  assert.deepEqual(sixthReport.achievementEvents, []);
});

test('gym rat never counts non-exercise habits toward the same-day target', async () => {
  const { buildHabitEventPlan } = await domainPromise;
  const hydration = buildHabitEventPlan({
    habit: { key: 'hydration', title: '多喝水 500ml', direction: 'good', kind: 'system' },
    player: player(), businessDate: '2026-08-23', serverBusinessDate: '2026-08-23',
    sameDayReports: 4
  });
  assert.deepEqual(hydration.achievementEvents, []);
});

test('daily reconciliation cross-checks facts without changing the draft source', async () => {
  const { reconcileDailyInput } = await domainPromise;
  const raw = dailyPayload({ water: 0, exercise: 0, study: 0, impulse: 0 });
  const effective = reconcileDailyInput({ rawInput: raw, habitEvents: [
    { systemKey: 'hydration' }, { systemKey: 'hydration' },
    { systemKey: 'exercise_training' }, { systemKey: 'skill_practice' },
    { systemKey: 'impulse_purchase' }
  ] });
  assert.equal(raw.water, 0);
  assert.deepEqual(effective, { ...raw, water: 1000, exercise: 10, study: 30, impulse: 1 });
});

test('daily settlement calculates rules, server critical and perfect-day gem', async () => {
  const { buildDailySettlementPlan } = await domainPromise;
  const plan = buildDailySettlementPlan({
    rawInput: dailyPayload(), player: player(), profile: { dailyBudget: 500 },
    businessDate: '2026-08-23', serverBusinessDate: '2026-08-23', randomValue: 0.99
  });
  assert.deepEqual(plan.failedRuleIds, []);
  assert.equal(plan.critical, false);
  assert.equal(plan.reward.xp, 75);
  assert.equal(plan.reward.gold, 30);
  assert.equal(plan.reward.gems, 1);
  assert.equal(plan.resource.after.gems, 1);
  const critical = buildDailySettlementPlan({
    rawInput: dailyPayload(), player: player(), profile: { dailyBudget: 500 },
    businessDate: '2026-08-23', serverBusinessDate: '2026-08-23', randomValue: 0
  });
  assert.equal(critical.critical, true);
  assert.equal(critical.reward.xp, 150);
  assert.equal(critical.reward.gold, 60);
});

test('daily failures damage HP and can cross multiple levels safely', async () => {
  const { buildDailySettlementPlan } = await domainPromise;
  const failure = buildDailySettlementPlan({
    rawInput: dailyPayload({ sleep: 0, water: 0, exercise: 0, study: 0, expense: 1000, impulse: 1 }),
    player: player(), profile: { dailyBudget: 500 }, businessDate: '2026-08-23',
    serverBusinessDate: '2026-08-23', randomValue: 0.99
  });
  assert.equal(failure.failedRuleIds.length, 5);
  assert.ok(failure.resource.after.hp < 50);
  const highReward = await domainPromise;
  const leveled = highReward.applyAuthoritativeResourceEffects({ player: player(), effects: { xp: 300 } });
  assert.equal(leveled.after.level, 4);
  assert.equal(leveled.after.hp, 65);
  assert.deepEqual(leveled.after.baseStats, { health: 13, energy: 13, wealth: 13, growth: 13 });
});

test('exercise streak reward is granted once with Gems +5 and vitality only', async () => {
  const { buildDailySettlementPlan } = await domainPromise;
  const history = [
    { ...dailyPayload({ exercise: 30 }), businessDate: '2026-08-21' },
    { ...dailyPayload({ exercise: 30 }), businessDate: '2026-08-22' }
  ];
  const plan = buildDailySettlementPlan({
    rawInput: dailyPayload({ exercise: 30 }), history, player: player(), profile: { dailyBudget: 500 },
    businessDate: '2026-08-23', serverBusinessDate: '2026-08-23', randomValue: 0.99
  });
  assert.deepEqual(plan.achievementEvents, ['exercise_streak_3']);
  assert.equal(plan.reward.gems, 6);
  assert.equal(plan.statuses.some(item => item.key === 'vitality'), true);
  const duplicate = buildDailySettlementPlan({
    rawInput: dailyPayload({ exercise: 30 }), history, player: player(), profile: { dailyBudget: 500 },
    businessDate: '2026-08-23', serverBusinessDate: '2026-08-23', randomValue: 0.99,
    achievementCodes: ['exercise_streak_3']
  });
  assert.deepEqual(duplicate.achievementEvents, []);
  assert.equal(duplicate.reward.gems, 1);
});

test('backfill applies resources but cannot mutate current Boss and expires old status historically', async () => {
  const { buildDailySettlementPlan } = await domainPromise;
  const plan = buildDailySettlementPlan({
    rawInput: dailyPayload(), player: player(), profile: { dailyBudget: 500 },
    businessDate: '2026-08-18', serverBusinessDate: '2026-08-23', randomValue: 0.99,
    history: [{ ...dailyPayload({ sleep: 4 }), businessDate: '2026-08-17' }]
  });
  assert.equal(plan.resource.deltas.xp > 0, true);
  assert.equal(plan.boss, null);
  const mental = plan.statuses.find(item => item.key === 'mental_full');
  assert.equal(mental.state, 'historical_only');
});

test('active Boss progresses at most once per business date and grants reward on defeat', async () => {
  const { buildDailySettlementPlan } = await domainPromise;
  const activeBoss = {
    id: '11111111-1111-4111-8111-111111111111', bossKey: 'sleep-nightmare',
    hp: 20, maxHp: 100, summonedOn: '2026-08-20', lastActionDate: null
  };
  const plan = buildDailySettlementPlan({
    rawInput: dailyPayload({ sleep: 7 }), player: player(), profile: { dailyBudget: 500 },
    businessDate: '2026-08-23', serverBusinessDate: '2026-08-23', randomValue: 0.99, activeBoss
  });
  assert.equal(plan.boss.action, 'progress');
  assert.equal(plan.boss.defeated, true);
  assert.equal(plan.reward.gold, 180);
  assert.equal(plan.reward.gems, 9);
  assert.equal(plan.rewardBreakdown.boss.gems, 3);
  assert.equal(plan.rewardBreakdown.achievement.gems, 5);
  assert.deepEqual(plan.achievementEvents, ['boss_slayer']);
  const duplicateDate = buildDailySettlementPlan({
    rawInput: dailyPayload({ sleep: 7 }), player: player(), profile: { dailyBudget: 500 },
    businessDate: '2026-08-23', serverBusinessDate: '2026-08-23', randomValue: 0.99,
    activeBoss: { ...activeBoss, lastActionDate: '2026-08-23' }
  });
  assert.equal(duplicateDate.boss, null);
});

test('Phase 4B migration exposes only one service-role command with transaction kernel', () => {
  const migration = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations',
    '20260823200000_phase_4b_transactional_gameplay_commands.sql'), 'utf8');
  assert.match(migration, /private\.phase4_reserve_operation/i);
  assert.match(migration, /private\.phase4_complete_operation/i);
  assert.match(migration, /for update/i);
  assert.match(migration, /grant execute on function public\.execute_phase4b_command[\s\S]+to service_role/i);
  assert.match(migration, /revoke all on function public\.execute_phase4b_command[\s\S]+from public, anon, authenticated/i);
  assert.doesNotMatch(migration, /grant execute[\s\S]+execute_phase4b_command[\s\S]+to authenticated/i);
  assert.match(migration, /DAILY_REVISION_BLOCKED/);
  assert.match(migration, /REVERSAL_BLOCKED/);
});

test('Phase 4B routes transactional commands and has no Boss reversal command', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const edge = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'functions', 'lifequest-command', 'index.ts'), 'utf8');
  assert.match(app, /memberAuthCoordinator\.reportHabitEvent/);
  assert.match(app, /memberAuthCoordinator\.submitDailyEntry/);
  assert.match(edge, /REPORT_HABIT_EVENT:\s*'execute_phase4b_command'/);
  assert.match(edge, /SUBMIT_DAILY_ENTRY:\s*'execute_phase4b_command'/);
  assert.match(edge, /rpc\('get_phase4b_operation_receipt'/);
  assert.match(edge, /receiptResult\.duplicate === true/);
  assert.match(edge, /systemKey:\s*event\.system_key/);
  assert.match(edge, /reversedAt:\s*event\.reversed_at/);
  assert.match(edge, /rawInput:\s*payload, habitEvents, history/);
  assert.doesNotMatch(edge, /totalExerciseReports|exerciseReports\.count/);
  assert.match(edge, /achievementProgress:[\s\S]+gym_rat:[\s\S]+gymRatProgressQuery\.count/);
  assert.match(edge, /\.eq\('business_date', getTaipeiBusinessDate\(\)\)[\s\S]+\.eq\('system_key', 'exercise_training'\)/);
  assert.doesNotMatch(edge, /REVERSE_BOSS_ACTION/);
});

test('gym rat repair migration exposes authoritative daily progress and backfills one unlock', () => {
  const migrationPath = path.join(__dirname, '..', 'supabase', 'migrations',
    '20260824152523_fix_gym_rat_daily_achievement.sql');
  assert.equal(fs.existsSync(migrationPath), true, 'missing gym rat achievement repair migration');
  const sql = fs.readFileSync(migrationPath, 'utf8');

  assert.match(sql, /'achievementProgress'[\s\S]+'gym_rat'/);
  assert.match(sql, /system_key\s*=\s*'exercise_training'/i);
  assert.match(sql, /business_date\s*=\s*\(now\(\) at time zone/i);
  assert.match(sql, /row_number\(\) over[\s\S]+partition by h\.user_id, h\.business_date/i);
  assert.match(sql, /where daily_rank = 5/i);
  assert.match(sql, /on conflict \(user_id, achievement_code\) do nothing/i);
  assert.match(sql, /repository_version = repository_version \+ 1/i);
  assert.doesNotMatch(sql, /insert into public\.resource_ledger/i);
});

test('Phase 4B replays completed operation receipts before rebuilding unsafe daily plans', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations',
    '20260823210000_phase_4b_idempotency_preflight.sql'), 'utf8');
  assert.match(sql, /create or replace function private\.phase4b_operation_receipt/);
  assert.match(sql, /v_operation\.request_hash <> v_request_hash/);
  assert.match(sql, /'errorCode', 'OPERATION_ID_REUSED'/);
  assert.match(sql, /'duplicate', true/);
  assert.match(sql, /'state', private\.phase4b_state\(p_user_id\)/);
  assert.match(sql, /revoke all on function public\.get_phase4b_operation_receipt[\s\S]+from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.get_phase4b_operation_receipt[\s\S]+to service_role/i);
  assert.doesNotMatch(sql, /grant execute[\s\S]+get_phase4b_operation_receipt[\s\S]+to authenticated/i);
});

test('daily correction eligibility ignores draft-only version changes but blocks later gameplay commands', () => {
  const migrationPath = path.join(__dirname, '..', 'supabase', 'migrations',
    '20260824120000_phase_4c_daily_correction_dependency_scope.sql');
  assert.equal(fs.existsSync(migrationPath), true,
    'missing correction dependency-scope migration');
  const sql = fs.readFileSync(migrationPath, 'utf8');

  assert.match(sql, /create or replace function private\.phase4b_has_gameplay_dependency/i);
  assert.match(sql, /command_type\s+in\s*\(\s*'REPORT_HABIT_EVENT'\s*,\s*'REVERSE_HABIT_EVENT'\s*,\s*'SUBMIT_DAILY_ENTRY'\s*\)/i);
  assert.match(sql, /status\s*=\s*'completed'/i);
  assert.match(sql, /phase4b_has_gameplay_dependency\(p_user_id,\s*v_previous_revision\.operation_id\)/i);
  assert.doesNotMatch(sql, /command_type\s*=\s*'SAVE_DAILY_DRAFT'/i);
  assert.match(sql, /v_definition\s*:=\s*replace\(v_definition,\s*v_old_guard,\s*v_new_guard\)/i);
  assert.match(sql, /revoke all on function private\.phase4b_has_gameplay_dependency[\s\S]+from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function private\.phase4b_has_gameplay_dependency[\s\S]+to service_role/i);
});

const correctionDependencyPolicy = ({ sourceVersion, laterOperations = [] }) =>
  laterOperations.some(operation =>
    operation.status === 'completed'
    && ['REPORT_HABIT_EVENT', 'REVERSE_HABIT_EVENT', 'SUBMIT_DAILY_ENTRY'].includes(operation.type)
    && operation.repositoryVersion > sourceVersion
  );

test('daily correction eligibility is identical with or without a draft-only operation', () => {
  const directSubmitBlocked = correctionDependencyPolicy({ sourceVersion: 10 });
  const savedDraftThenSubmitBlocked = correctionDependencyPolicy({
    sourceVersion: 10,
    laterOperations: [{
      type: 'SAVE_DAILY_DRAFT', status: 'completed', repositoryVersion: 11
    }]
  });

  assert.equal(directSubmitBlocked, false);
  assert.equal(savedDraftThenSubmitBlocked, directSubmitBlocked);
});

test('a later gameplay dependency blocks correction even when a draft is saved afterwards', () => {
  const gameplayDependency = {
    type: 'REPORT_HABIT_EVENT', status: 'completed', repositoryVersion: 11
  };
  const directSubmitBlocked = correctionDependencyPolicy({
    sourceVersion: 10,
    laterOperations: [gameplayDependency]
  });
  const savedDraftThenSubmitBlocked = correctionDependencyPolicy({
    sourceVersion: 10,
    laterOperations: [
      gameplayDependency,
      { type: 'SAVE_DAILY_DRAFT', status: 'completed', repositoryVersion: 12 }
    ]
  });

  assert.equal(directSubmitBlocked, true);
  assert.equal(savedDraftThenSubmitBlocked, true);
});

test('safe direct and draft-first corrections produce the same next revision input', () => {
  const currentRevision = 1;
  const newInput = dailyPayload({ sleep: 10 });
  const direct = {
    blocked: correctionDependencyPolicy({ sourceVersion: 10 }),
    revision: currentRevision + 1,
    input: newInput
  };
  const draftFirst = {
    blocked: correctionDependencyPolicy({
      sourceVersion: 10,
      laterOperations: [{
        type: 'SAVE_DAILY_DRAFT', status: 'completed', repositoryVersion: 11
      }]
    }),
    revision: currentRevision + 1,
    input: newInput
  };

  assert.deepEqual(draftFirst, direct);
});
