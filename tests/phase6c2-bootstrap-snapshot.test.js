const test = require('node:test');
const assert = require('node:assert/strict');
const { createEdgeHarness } = require('./helpers/edge-handler-harness.cjs');

function profile(name) {
  return {
    adventurer_name: name,
    onboarding_status: 'completed',
    onboarding_completed: true,
    main_quest_code: 'sleep',
    daily_budget: 500,
    timezone: 'Asia/Taipei',
    created_at: '2026-08-29T00:00:00Z',
    updated_at: '2026-08-29T00:00:00Z'
  };
}

function player() {
  return {
    total_xp: 0, hp: 50, gold: 0, gems: 0,
    base_health: 5, base_energy: 5, base_wealth: 5, base_growth: 5,
    level_curve_version: 'level-v1', updated_at: '2026-08-29T00:00:00Z'
  };
}

test('bootstrap discards a mixed read and returns the next complete stable projection', async () => {
  let repositoryVersion = 11;
  let adventurerName = 'Before';
  let profileReads = 0;
  let rootReads = 0;
  const h = await createEdgeHarness({
    rpcResult: {},
    readResolver(table) {
      if (table === 'member_game_roots') {
        rootReads++;
        return { data: { repository_version: repositoryVersion }, error: null };
      }
      if (table === 'profiles') {
        profileReads++;
        const data = profile(adventurerName);
        if (profileReads === 1) {
          repositoryVersion = 12;
          adventurerName = 'After';
        }
        return { data, error: null };
      }
      if (table === 'player_states') return { data: player(), error: null };
      if (table === 'boss_encounters') return { data: null, error: null };
      return { data: [], error: null, count: 0 };
    }
  });

  const response = await h.request(null, { method: 'GET' });

  assert.equal(response.status, 200);
  assert.equal(response.body.repositoryVersion, 12);
  assert.equal(response.body.state.meta.repositoryVersion, 12);
  assert.equal(response.body.state.member.adventurerName, 'After');
  assert.equal(profileReads, 2, 'the complete projection must be re-read after the fence changes');
  assert.equal(rootReads, 4, 'each attempt must read both start and end repository versions');
  for (const table of ['daily_drafts', 'custom_habits', 'rule_preferences', 'player_states',
    'status_effects', 'daily_entries', 'boss_encounters', 'player_achievements',
    'item_catalog']) {
    assert.equal(h.reads.filter(read => read === table).length, 2, `${table} must be re-read in full`);
  }
  assert.equal(h.reads.filter(read => read === 'habit_events').length, 4,
    'both Habit Event projection reads must be repeated on the second attempt');
  assert.equal(h.calls.filter(call => call.name === 'get_phase5b_economy_state').length, 2,
    'the Economy projection must be re-read in full');
});

test('bootstrap exhausts three unstable attempts without returning a mixed projection', async () => {
  let repositoryVersion = 20;
  let profileReads = 0;
  let rootReads = 0;
  const h = await createEdgeHarness({
    rpcResult: {},
    readResolver(table) {
      if (table === 'member_game_roots') {
        rootReads++;
        return { data: { repository_version: repositoryVersion }, error: null };
      }
      if (table === 'profiles') {
        profileReads++;
        const data = profile(`Attempt-${profileReads}-before`);
        repositoryVersion++;
        return { data, error: null };
      }
      if (table === 'player_states') return { data: player(), error: null };
      if (table === 'boss_encounters') return { data: null, error: null };
      return { data: [], error: null, count: 0 };
    }
  });

  const response = await h.request(null, { method: 'GET' });

  assert.equal(response.status, 409);
  assert.equal(response.body.errorCode, 'VERSION_CONFLICT');
  assert.equal(response.body.retryable, true);
  assert.equal(response.body.currentVersion, 23);
  assert.equal(Object.prototype.hasOwnProperty.call(response.body, 'state'), false);
  assert.equal(profileReads, 3);
  assert.equal(rootReads, 6);
});
