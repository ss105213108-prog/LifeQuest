const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const domainPromise = import('../supabase/functions/_shared/phase4Domain.mjs');

test('level-v1 exact thresholds derive level without storing a second authority', async () => {
  const domain = await domainPromise;
  assert.equal(domain.levelThreshold(1), 0);
  assert.equal(domain.levelThreshold(2), 50);
  assert.equal(domain.levelThreshold(3), 150);
  assert.equal(domain.levelThreshold(4), 300);
  assert.equal(domain.levelFromTotalXp(0), 1);
  assert.equal(domain.levelFromTotalXp(49), 1);
  assert.equal(domain.levelFromTotalXp(50), 2);
  assert.equal(domain.levelFromTotalXp(149), 2);
  assert.equal(domain.levelFromTotalXp(150), 3);
});

test('level-v1 supports one and multiple level gains with final max HP restoration', async () => {
  const { previewXpGrant } = await domainPromise;
  const baseStats = { health: 10, energy: 10, wealth: 10, growth: 10 };
  const oneLevel = previewXpGrant({ totalXp: 40, xpGain: 10, currentHp: 20, baseStats });
  assert.deepEqual(oneLevel, {
    totalXp: 50, previousLevel: 1, level: 2, levelsGained: 1,
    maxHp: 55, hp: 55,
    baseStats: { health: 11, energy: 11, wealth: 11, growth: 11 }
  });
  const multiple = previewXpGrant({ totalXp: 0, xpGain: 300, currentHp: 1, baseStats });
  assert.equal(multiple.level, 4);
  assert.equal(multiple.levelsGained, 3);
  assert.equal(multiple.maxHp, 65);
  assert.equal(multiple.hp, 65);
  assert.deepEqual(multiple.baseStats, { health: 13, energy: 13, wealth: 13, growth: 13 });
});

test('level-v1 handles large safe XP and rejects invalid values', async () => {
  const { levelFromTotalXp, maxHpFromTotalXp } = await domainPromise;
  assert.ok(levelFromTotalXp(1_000_000_000) > 1);
  assert.ok(maxHpFromTotalXp(1_000_000_000) > 50);
  assert.throws(() => levelFromTotalXp(-1), /non-negative/);
  assert.throws(() => levelFromTotalXp(1.5), /safe integer/);
});

test('death boundary applies only Phase 4 effects and leaves inventory out', async () => {
  const { previewDeath } = await domainPromise;
  assert.deepEqual(previewDeath({ totalXp: 150, hp: 0, gold: 101, activeStatusIds: ['buff-1'] }), {
    died: true, hp: 60, gold: 86, goldLost: 15, clearedStatusIds: ['buff-1']
  });
  assert.deepEqual(previewDeath({ totalXp: 0, hp: 25, gold: 80 }), {
    died: false, hp: 25, gold: 80, goldLost: 0, clearedStatusIds: []
  });
});

test('temporal policy keeps habit reports today-only and suppresses current boss on backfill', async () => {
  const { classifyTemporalContext } = await domainPromise;
  assert.deepEqual(classifyTemporalContext({
    businessDate: '2026-08-23', serverBusinessDate: '2026-08-23', statusExpiresOn: '2026-08-24'
  }), {
    daysAgo: 0, isToday: true, isBackfill: false,
    allowHabitEvent: true, allowCurrentBossMutation: true, statusHistoricalOnly: false
  });
  const backfill = classifyTemporalContext({
    businessDate: '2026-08-18', serverBusinessDate: '2026-08-23', statusExpiresOn: '2026-08-20'
  });
  assert.equal(backfill.allowHabitEvent, false);
  assert.equal(backfill.allowCurrentBossMutation, false);
  assert.equal(backfill.statusHistoricalOnly, true);
  assert.throws(() => classifyTemporalContext({ businessDate: '2026-08-24', serverBusinessDate: '2026-08-23' }), /future/);
  assert.throws(() => classifyTemporalContext({ businessDate: '2026-08-15', serverBusinessDate: '2026-08-23' }), /seven-day/);
});

test('rule_6 and gym_rat definitions use only confirmed rewards and stable habit keys', async () => {
  const { PHASE4_ACHIEVEMENT_DEFINITIONS: definitions } = await domainPromise;
  assert.deepEqual(definitions.exercise_streak_3.reward, {
    gems: 5,
    status: { key: 'vitality', title: '活力充沛', durationDays: 2 }
  });
  assert.equal(definitions.exercise_streak_3.sourceHabitKey, 'exercise_training');
  assert.equal(definitions.gym_rat.sourceHabitKey, 'exercise_training');
  assert.deepEqual(definitions.gym_rat.target, { dailyReports: 5 });
  assert.equal('xp' in definitions.exercise_streak_3.reward, false);
  assert.equal('gold' in definitions.exercise_streak_3.reward, false);
  assert.equal('health' in definitions.exercise_streak_3.reward, false);
});

test('server definition foundation pins all current rules, bosses and status policies', async () => {
  const domain = await domainPromise;
  assert.deepEqual(Object.keys(domain.PHASE4_RULE_DEFINITIONS).sort(), [
    'rule_1', 'rule_2', 'rule_3', 'rule_4', 'rule_5', 'rule_6',
    'rule_boss_budget', 'rule_boss_fried_food', 'rule_boss_lazy', 'rule_boss_sleep',
    'rule_exercise', 'rule_water'
  ]);
  assert.equal(Object.keys(domain.PHASE4_BOSS_DEFINITIONS).length, 5);
  assert.equal(domain.PHASE4_STATUS_DEFINITIONS.vitality.modifiers.health, undefined);
  assert.equal(domain.PHASE4_RULE_DEFINITIONS.rule_2.conditions[0].profileValue, 'dailyBudget');
});

test('habit snapshot preserves a narrow historical contract', async () => {
  const { createHabitSnapshot } = await domainPromise;
  const snapshot = createHabitSnapshot({
    title: '有氧運動 10 分鐘', direction: 'good', systemKey: 'exercise_training',
    policy: { reward: { xp: 10 } }
  });
  assert.equal(snapshot.systemKey, 'exercise_training');
  assert.equal(snapshot.customHabitId, null);
  assert.equal(snapshot.definitionVersion, 'habits-v1');
  assert.deepEqual(Object.keys(snapshot).sort(), [
    'customHabitId', 'definitionVersion', 'direction', 'policy', 'systemKey', 'title'
  ]);
  assert.throws(() => createHabitSnapshot({
    title: '錯誤', direction: 'good', systemKey: 'x', customHabitId: 'y', policy: {}
  }), /exactly one/);
});

test('Phase 4A migration defines foundations but exposes no gameplay command', () => {
  const migrationDir = path.join(__dirname, '..', 'supabase', 'migrations');
  const foundation = fs.readFileSync(path.join(migrationDir, '20260823180000_phase_4a_authoritative_domain_foundation.sql'), 'utf8');
  const hardening = fs.readFileSync(path.join(migrationDir, '20260823181000_phase_4a_grants_hardening.sql'), 'utf8');
  const bootstrap = fs.readFileSync(path.join(migrationDir, '20260823182000_phase_4a_player_state_bootstrap.sql'), 'utf8');
  const fkIndexes = fs.readFileSync(path.join(migrationDir, '20260823183000_phase_4a_foreign_key_indexes.sql'), 'utf8');
  const guards = fs.readFileSync(path.join(migrationDir, '20260823184000_phase_4a_state_transition_guards.sql'), 'utf8');
  const requiredTables = [
    'player_states', 'daily_entries', 'daily_entry_revisions', 'habit_events',
    'resource_ledger', 'status_effects', 'player_achievements', 'boss_encounters', 'boss_actions'
  ];
  requiredTables.forEach(table => assert.match(foundation, new RegExp(`create table public\\.${table}\\b`, 'i')));
  assert.match(foundation, /unique \(user_id, business_date\)/i);
  assert.match(foundation, /where state = 'active'/i);
  assert.match(foundation, /grant select on[\s\S]+to authenticated/i);
  assert.match(foundation, /revoke all on function private\.phase4_reserve_operation/i);
  assert.doesNotMatch(foundation, /create or replace function public\.(report_habit_event|submit_daily_entry|reverse_habit_event)/i);
  assert.match(hardening, /revoke select, insert, update, delete, truncate, references, trigger[\s\S]+from anon/i);
  assert.match(bootstrap, /after insert on public\.member_game_roots/i);
  assert.match(bootstrap, /insert into public\.player_states\(user_id\)/i);
  [
    'boss_actions\\(encounter_id, user_id\\)',
    'daily_entry_revisions\\(daily_entry_id, user_id\\)',
    'habit_events\\(custom_habit_id, user_id\\)',
    'resource_ledger\\(reverses_ledger_id, user_id\\)'
  ].forEach(pattern => assert.match(fkIndexes, new RegExp(pattern, 'i')));
  assert.match(guards, /ACHIEVEMENT_REWARD_ALREADY_RECORDED/);
  assert.match(guards, /BOSS_REWARD_ALREADY_RECORDED/);
  assert.match(guards, /HABIT_EVENT_ALREADY_REVERSED/);
  assert.match(guards, /resource_ledger_immutable/);
  assert.match(guards, /boss_actions_immutable/);
});
