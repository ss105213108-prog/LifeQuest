const test = require('node:test');
const assert = require('node:assert/strict');
const MemberAuth = require('../memberAuth.js');

function achievements() {
  return [
    {
      code: 'boss_slayer', unlockedAt: '2026-08-26T09:00:00Z', rewardState: 'granted',
      definitionVersion: 'achievements-v1',
      rewardSnapshot: { gems: 5 }, targetSnapshot: { bossDefeated: true }
    },
    {
      code: 'exercise_streak_3', unlockedAt: '2026-08-25T09:00:00Z', rewardState: 'granted',
      definitionVersion: 'achievements-v1',
      rewardSnapshot: { gems: 5, status: 'vitality' }, targetSnapshot: { days: 3 }
    }
  ];
}

test('slim authoritative achievement rows preserve snapshots by code, not array position', () => {
  const current = {
    achievements: achievements(), achievementProgress: { boss_slayer: 1, exercise_streak_3: 3 },
    player: { gems: 10 }
  };
  const incoming = {
    achievements: achievements().reverse().map(({ rewardSnapshot, targetSnapshot, ...row }) => row),
    player: { gold: 42 }
  };
  const merged = MemberAuth.mergeMemberCloudState(current, incoming);
  for (const expected of current.achievements) {
    const actual = merged.achievements.find(row => row.code === expected.code);
    assert.deepEqual(actual.rewardSnapshot, expected.rewardSnapshot);
    assert.deepEqual(actual.targetSnapshot, expected.targetSnapshot);
    assert.equal(actual.rewardState, 'granted');
    assert.equal(actual.unlockedAt, expected.unlockedAt);
  }
  assert.deepEqual(merged.achievementProgress, current.achievementProgress);
  assert.equal(merged.player.gems, 10);
  assert.equal(Object.hasOwn(incoming.achievements[0], 'rewardSnapshot'), false, 'input is not mutated');
});

test('normalization preserves missing snapshot fields through repeated passes', () => {
  const partial = MemberAuth.normalizeMemberCloudState({ achievements: [{ achievement_code: 'boss_slayer' }] });
  const twice = MemberAuth.normalizeMemberCloudState(partial);
  assert.equal(Object.hasOwn(twice.achievements[0], 'rewardSnapshot'), false);
  assert.equal(Object.hasOwn(twice.achievements[0], 'targetSnapshot'), false);
  const merged = MemberAuth.mergeMemberCloudState({ achievements: achievements() }, { achievements: twice.achievements });
  assert.deepEqual(merged.achievements[0], { ...achievements()[0], achievement_code: 'boss_slayer' });
});

test('explicit new, empty and null snapshots override cached data in either naming convention', () => {
  for (const [rewardField, targetField] of [['rewardSnapshot', 'targetSnapshot'], ['reward_snapshot', 'target_snapshot']]) {
    for (const [reward, target] of [[{ gems: 7 }, { count: 2 }], [{}, {}], [null, null]]) {
      const merged = MemberAuth.mergeMemberCloudState({ achievements: achievements() }, {
        achievements: [{ achievement_code: 'boss_slayer', [rewardField]: reward, [targetField]: target }]
      });
      assert.deepEqual(merged.achievements[0].rewardSnapshot, reward);
      assert.deepEqual(merged.achievements[0].targetSnapshot, target);
      assert.equal(merged.achievements[0].rewardState, 'granted');
      assert.equal(merged.achievements[0].unlockedAt, achievements()[0].unlockedAt);
    }
  }
});

test('authoritative achievement membership may remove rows; new codes never inherit another snapshot', () => {
  const current = { achievements: achievements() };
  assert.deepEqual(MemberAuth.mergeMemberCloudState(current, { achievements: [] }).achievements, []);
  const merged = MemberAuth.mergeMemberCloudState(current, { achievements: [{ code: 'gym_rat', rewardState: 'granted' }] });
  assert.deepEqual(merged.achievements, [{ code: 'gym_rat', rewardState: 'granted' }]);
  const reloaded = MemberAuth.normalizeMemberCloudState({ achievements: [{ code: 'gym_rat' }] });
  assert.equal(reloaded.achievements.length, 1, 'full bootstrap never consults cached achievements');
});

test('snapshot merge is repeatable without mutating resources or other gameplay slices', () => {
  const current = MemberAuth.normalizeMemberCloudState({
    achievements: achievements(), achievementProgress: { boss_slayer: 1, exercise_streak_3: 3 },
    player: { gems: 10, gold: 500 }, activeBoss: { id: 'existing-boss', hp: 70 },
    rulePreferences: { rule_1: false }, dailyDrafts: { '2026-08-27': { sleep: 8 } },
    resourceLedger: [{ id: 'original-achievement-reward', gems: 5 }]
  });
  const before = JSON.stringify(current);
  const partial = { achievements: current.achievements.map(row => ({ code: row.code })) };
  let state = current;
  for (let i = 0; i < 5; i++) state = MemberAuth.mergeMemberCloudState(state, partial);
  assert.deepEqual(state, current, 'replaying the read projection never awards resources or creates receipts');
  assert.equal(JSON.stringify(current), before);
});

test('rendered purchase through remote transport preserves achievement snapshots immediately, on retry and reload', async () => {
  const { createHarness, fixture, clone } = require('./helpers/member-economy-ui-harness.cjs');
  const full = fixture();
  full.achievements = achievements();
  full.achievementProgress = { boss_slayer: 1, exercise_streak_3: 3 };
  full.resourceLedger = [{ id: 'boss-achievement-reward', source: 'achievement_reward', gems: 5 }];
  const h = await createHarness({ server: { state: full }, gameplayProjection: true });
  const guestBefore = h.local.getItem('lifequest_state');
  const ledgerBefore = clone(full.resourceLedger);
  const before = clone(h.coordinator.getMemberState().achievements);
  function assertAchievementState(harness) {
    assert.deepEqual(harness.coordinator.getMemberState().achievements, before);
    assert.deepEqual(clone(harness.context.activeMember.state.achievements), before);
    assert.equal(harness.context.state.character.gems, 20);
    const boss = harness.context.state.achievements.find(row => row.id === 'boss_slayer');
    assert.equal(boss.unlocked, true);
    assert.equal(boss.progress, 1);
    assert.equal(boss.target, 1);
    const medal = harness.elements.achievementsGrid.children.find(row => row.dataset.medal === 'boss_slayer');
    assert.match(medal.className, /unlocked/);
    assert.match(medal.innerHTML, /公會正式授勳/);
    assert.match(medal.innerHTML, /aria-valuenow="1"/);
    assert.equal(harness.context.state.achievements.find(row => row.id === 'exercise_streak_3').unlocked, true);
  }
  assertAchievementState(h);
  function slimResponse(duplicate = false) {
    const partial = clone(h.server.state);
    partial.achievements = partial.achievements.map(({ rewardSnapshot, targetSnapshot, ...row }) => row);
    delete partial.achievementProgress;
    delete partial.resourceLedger;
    return { ok: true, duplicate, state: partial, repositoryVersion: 21 };
  }
  h.queue.push(command => {
    assert.equal(command.type, 'PURCHASE_ITEM');
    assert.deepEqual(command.payload, { itemKey: 'potion_red', seenCatalogVersion: 1 });
    h.server.state.player.gold = 478;
    h.server.state.inventory = [{ itemKey: 'potion_red', itemType: 'potion', quantity: 1 }];
    h.server.state.meta.repositoryVersion = 21;
    h.server.state.recentEconomyTransactions = [{ id: 'purchase-receipt', type: 'purchase_item', currencyDelta: -22 }];
    return slimResponse();
  });
  const reads = h.getCount();
  h.click('member-item-purchase', 'potion_red');
  await h.confirm();
  assert.equal(h.getCount(), reads, 'snapshot is preserved without a compensating full Cloud reload');
  assert.equal(h.requests.length, 1);
  assert.equal(h.context.state.memberEconomy.resources.gold, 478);
  assert.equal(h.context.state.memberEconomy.inventoryByKey.potion_red.quantity, 1);
  assert.equal(h.context.memberEconomyActionPending, false);
  assertAchievementState(h);

  // A later uncertain request may replay a committed receipt with another slim
  // projection. The client must never derive/re-award Gems from its snapshots.
  h.queue.push(() => { throw new Error('test network timeout'); });
  h.click('member-item-purchase', 'potion_red');
  await h.confirm();
  h.queue.push(command => {
    assert.equal(command.operationId, h.requests[1].command.operationId);
    return slimResponse(true);
  });
  h.click('member-item-purchase', 'potion_red');
  await h.confirm();
  assert.equal(h.requests.length, 3);
  assertAchievementState(h);
  assert.equal(h.server.state.meta.repositoryVersion, 21);
  assert.equal(h.server.state.achievements.length, 2);
  assert.equal(h.server.state.recentEconomyTransactions.length, 1);
  assert.deepEqual(h.server.state.resourceLedger, ledgerBefore);
  assert.deepEqual(h.coordinator.getMemberState().resourceLedger, ledgerBefore);

  const reload = await createHarness({ server: h.server, local: h.local, gameplayProjection: true });
  assert.equal(reload.getCount(), 1, 'fresh session bootstrap loads the full Cloud response');
  assertAchievementState(reload);
  await reload.coordinator.logout();
  const restored = await reload.coordinator.login({ email: 'fixture@example.invalid', password: 'fixture-only' });
  assert.equal(restored.ok, true);
  assertAchievementState(reload);
  assert.equal(h.local.getItem('lifequest_state'), guestBefore);
});
