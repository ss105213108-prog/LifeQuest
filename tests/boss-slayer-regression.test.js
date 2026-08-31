const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const MemberAuth = require('../memberAuth.js');
const domainPromise = import('../supabase/functions/_shared/phase4Domain.mjs');

const player = () => ({
  totalXp: 0,
  hp: 50,
  gold: 0,
  gems: 0,
  baseStats: { health: 10, energy: 10, wealth: 10, growth: 10 }
});

const dailyPayload = () => ({
  sleep: 8,
  water: 2000,
  exercise: 30,
  study: 0,
  expense: 100,
  impulse: 0,
  sugaryDrinks: 0
});

const defeatedBossPlan = async (overrides = {}) => {
  const { buildDailySettlementPlan } = await domainPromise;
  return buildDailySettlementPlan({
    rawInput: dailyPayload(),
    player: player(),
    profile: { dailyBudget: 500 },
    businessDate: '2026-08-26',
    serverBusinessDate: '2026-08-26',
    randomValue: 0.99,
    activeBoss: {
      id: '11111111-1111-4111-8111-111111111111',
      bossKey: 'sleep-nightmare',
      hp: 1,
      maxHp: 100,
      summonedOn: '2026-08-20',
      lastActionDate: null
    },
    achievementCodes: [],
    ...overrides
  });
};

test('Boss defeat emits boss_slayer unlock and achievement reward', async () => {
  const plan = await defeatedBossPlan();

  assert.equal(plan.boss.defeated, true);
  assert.deepEqual(plan.achievementEvents, ['boss_slayer']);
  assert.equal(plan.rewardBreakdown.boss.gems, 3);
  assert.equal(plan.rewardBreakdown.achievement.gems, 5);
});

test('boss_slayer uses the stable server definition and Gems +5 reward', async () => {
  const { PHASE4_ACHIEVEMENT_DEFINITIONS } = await domainPromise;
  assert.deepEqual(PHASE4_ACHIEVEMENT_DEFINITIONS.boss_slayer, {
    code: 'boss_slayer',
    target: { bossDefeats: 1 },
    reward: { gems: 5 },
    definitionVersion: 'achievements-v1'
  });
});

test('an already unlocked boss_slayer is not rewarded again', async () => {
  const plan = await defeatedBossPlan({ achievementCodes: ['boss_slayer'] });
  assert.equal(plan.boss.defeated, true);
  assert.deepEqual(plan.achievementEvents, []);
  assert.equal(plan.rewardBreakdown.boss.gems, 3);
  assert.equal(plan.rewardBreakdown.achievement.gems, 0);
});

test('same-date Boss retry cannot emit another defeat or achievement reward', async () => {
  const plan = await defeatedBossPlan({
    activeBoss: {
      id: '11111111-1111-4111-8111-111111111111',
      bossKey: 'sleep-nightmare',
      hp: 1,
      maxHp: 100,
      summonedOn: '2026-08-20',
      lastActionDate: '2026-08-26'
    }
  });
  assert.equal(plan.boss, null);
  assert.deepEqual(plan.achievementEvents, []);
  assert.equal(plan.rewardBreakdown.boss.gems, 0);
  assert.equal(plan.rewardBreakdown.achievement.gems, 0);
});

test('Boss and exercise achievements remain distinct in one settlement', async () => {
  const history = [
    { ...dailyPayload(), businessDate: '2026-08-24' },
    { ...dailyPayload(), businessDate: '2026-08-25' }
  ];
  const plan = await defeatedBossPlan({ history });
  assert.deepEqual(plan.achievementEvents, ['exercise_streak_3', 'boss_slayer']);
  assert.equal(plan.rewardBreakdown.achievement.gems, 10);
});

test('member normalization preserves authoritative boss_slayer unlocks', () => {
  const state = MemberAuth.normalizeMemberCloudState({
    achievements: [{
      achievement_code: 'boss_slayer',
      unlocked_at: '2026-08-26T07:40:49.417875Z',
      reward_state: 'granted',
      definition_version: 'achievements-v1',
      reward_snapshot: { gems: 5 }
    }]
  });
  assert.equal(state.achievements.length, 1);
  assert.equal(state.achievements[0].code, 'boss_slayer');
  assert.equal(state.achievements[0].rewardState, 'granted');
  assert.deepEqual(state.achievements[0].rewardSnapshot, { gems: 5 });
});

test('partial Economy projection does not replace achievements', () => {
  const current = MemberAuth.normalizeMemberCloudState({
    meta: { repositoryVersion: 10 },
    achievements: [{ code: 'boss_slayer', unlockedAt: '2026-08-26T07:40:49Z' }]
  });
  const merged = MemberAuth.mergeMemberCloudState(current, {
    meta: { repositoryVersion: 11 },
    inventory: [{ itemKey: 'red-potion', quantity: 1 }]
  });
  assert.equal(merged.meta.repositoryVersion, 11);
  assert.equal(merged.achievements.length, 1);
  assert.equal(merged.achievements[0].code, 'boss_slayer');
});

test('repair migration backfills only a missing boss_slayer reward', () => {
  const migration = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations',
    '20260826100000_fix_boss_slayer_achievement.sql'), 'utf8');
  assert.match(migration, /b\.state\s*=\s*'defeated'/i);
  assert.match(migration, /not exists[\s\S]+achievement_code\s*=\s*'boss_slayer'/i);
  assert.match(migration, /not exists[\s\S]+source_id\s*=\s*'boss_slayer'/i);
  assert.match(migration, /on conflict \(user_id, achievement_code\) do nothing/i);
  assert.match(migration, /reason[\s\S]+'achievement_reward'[\s\S]+'boss_slayer'/i);
  assert.match(migration, /repository_version\s*=\s*repository_version\s*\+\s*1/i);
  assert.doesNotMatch(migration, /insert into public\.boss_(encounters|actions)/i);
});

test('transaction kernel records separate exactly-once achievement ledgers', () => {
  const migration = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations',
    '20260826100000_fix_boss_slayer_achievement.sql'), 'utf8');
  assert.match(migration, /v_achievement in \('exercise_streak_3', 'boss_slayer'\)/);
  assert.match(migration, /'achievement', v_achievement, v_operation_id/);
  assert.match(migration, /when v_achievement = 'boss_slayer'[\s\S]+jsonb_build_object\('gems', 5\)/);
  assert.match(migration, /revoke all on function private\.execute_phase4b_command[\s\S]+from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function private\.execute_phase4b_command[\s\S]+to service_role/i);
});

test('Achievement UI maps an authoritative unlock to full target progress', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  assert.match(app, /unlocked\s*=\s*new Map\(\(memberState\.achievements \|\| \[\]\)/);
  assert.match(app, /unlocked:\s*true,\s*progress:\s*item\.target/);
  assert.match(app, /id:\s*'boss_slayer'[\s\S]+target:\s*1/);
});

test('Phase 5C-3 retains the restricted settings gate alongside boss achievement projection', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  assert.match(app, /if \(activeMember && MEMBER_PHASE5_TABS\.has\(tabName\)\)/);
  assert.match(app, /公會設施尚未對會員開放/);
  assert.match(app, /MEMBER_PHASE5_TABS = new Set\(\['privacy-settings'\]\)/);
});
