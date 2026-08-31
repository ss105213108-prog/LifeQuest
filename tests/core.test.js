const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CURRENT_SCHEMA_VERSION,
  StateStore,
  DailyDataEngine,
  DailyRecordPolicy,
  BusinessDatePolicy,
  MainQuestEngine,
  AdvisorEngine,
  RuleEngine,
  Insights,
  SettlementEngine,
  SettlementRevisionEngine,
  AchievementEngine,
  HabitEngine,
  EquipmentEngine,
  SupplyEngine,
  DailyGemEngine,
  RewardTicketEngine,
  ProfessionEngine,
  BossEngine,
  StatusEffectEngine,
  AchievementRewardEngine,
  DeathEngine,
  RulePolicy,
  SaveArchiveEngine
} = require('../lifequestCore.js');

test('AdvisorEngine uses only the latest seven calendar days and reports the exact evidence period', () => {
  const history = [
    { date: '2026-08-06', sleep: 3, water: 0, exercise: 0, expense: 900, impulse: 1, completedCount: 0, totalRuleCount: 4 },
    { date: '2026-08-07', sleep: 4, water: 0, exercise: 0, expense: 900, impulse: 1, completedCount: 0, totalRuleCount: 4 },
    { date: '2026-08-08', sleep: 5, water: 0, exercise: 0, expense: 900, impulse: 1, completedCount: 0, totalRuleCount: 4 },
    ...Array.from({ length: 7 }, (_, index) => ({
      date: `2026-08-${String(index + 10).padStart(2, '0')}`,
      sleep: 8,
      water: 2000,
      exercise: 30,
      expense: 300,
      impulse: 0,
      completedCount: 4,
      totalRuleCount: 4,
      budgetLimitAtSettlement: 500
    }))
  ];

  const result = AdvisorEngine.analyze({
    history,
    today: '2026-08-16',
    goal: 'sleep',
    dailyBudget: 500,
    rules: [{ id: 'sleep-rule', type: 'daily', metric: 'sleep', operator: '>=', targetValue: 7 }]
  });

  assert.equal(result.periodStart, '2026-08-10');
  assert.equal(result.periodEnd, '2026-08-16');
  assert.equal(result.sampleDays, 7);
  assert.equal(result.reliability, 'reliable');
  assert.equal(result.evidence.averageSleep, 8);
  assert.match(result.advice, /8/);
  assert.doesNotMatch(result.advice, /7\.5|利息|程式練習/);
});

test('BossEngine rejects records before summon date and only advances on or after the boundary', () => {
  const summoned = BossEngine.summon({
    boss: { active: false },
    definitions: [{ id: 'sleep-nightmare', maxHp: 90, challenge: { source: 'dailyLog', target: 3, conditions: [{ metric: 'sleep', operator: '>=', targetValue: 7 }] } }],
    candidates: [{ ruleId: 'boss-sleep', bossId: 'sleep-nightmare' }],
    today: '2026-08-15',
    processedIncidentKeys: []
  });
  const beforeSummon = BossEngine.advanceChallenge({
    boss: summoned.boss,
    character: { equipped: {} },
    entry: { date: '2026-08-14', sleep: 8 }
  });
  const onSummonDate = BossEngine.advanceChallenge({
    boss: summoned.boss,
    character: { equipped: {} },
    entry: { date: '2026-08-15', sleep: 8 }
  });

  assert.equal(summoned.boss.summonedOn, '2026-08-15');
  assert.equal(beforeSummon.reason, 'before_summon');
  assert.equal(beforeSummon.boss.hp, 90);
  assert.equal(onSummonDate.advanced, true);
  assert.equal(onSummonDate.boss.challenge.progress, 1);
});

test('StatusEffectEngine records an expired backfill effect without changing the current character', () => {
  const result = StatusEffectEngine.apply({
    character: { attributes: { energy: 10 } },
    buffs: [],
    debuffs: [],
    today: '2026-08-10',
    asOfDate: '2026-08-16',
    effect: {
      id: 'fatigue',
      sourceRuleId: 'fatigue-rule',
      type: 'debuff',
      title: '睡眠不足',
      duration: 2,
      attributes: { energy: -3 }
    }
  });

  assert.equal(result.applied, false);
  assert.equal(result.historicalOnly, true);
  assert.equal(result.character.attributes.energy, 10);
  assert.deepEqual(result.debuffs, []);
  assert.deepEqual(result.statusEvents.map(event => [event.event, event.date]), [
    ['applied', '2026-08-10'],
    ['expired', '2026-08-12']
  ]);
});

test('SupplyEngine reverses an equipment purchase once and keeps an append-only correction trail', () => {
  const items = [{ id: 'weapon_sword', type: 'weapon', title: '木劍', cost: 60, attr: { energy: 2 } }];
  const purchased = SupplyEngine.acquire({
    character: { gold: 100, attributes: { energy: 10 }, equipped: { weapon: null, armor: null, pet: null } },
    inventory: [],
    transactions: [],
    items,
    itemId: 'weapon_sword',
    transactionId: 'purchase-1',
    purchasedAt: '2026-08-16T08:00:00.000Z'
  });
  const reversed = SupplyEngine.reversePurchase({
    character: purchased.character,
    inventory: purchased.inventory,
    transactions: purchased.transactions,
    items,
    transactionId: 'purchase-1',
    correctionId: 'correction-purchase-1',
    correctedAt: '2026-08-16T08:05:00.000Z'
  });
  const repeated = SupplyEngine.reversePurchase({
    character: reversed.character,
    inventory: reversed.inventory,
    transactions: reversed.transactions,
    items,
    transactionId: 'purchase-1',
    correctionId: 'correction-purchase-1'
  });

  assert.equal(reversed.ok, true);
  assert.equal(reversed.character.gold, 100);
  assert.equal(reversed.character.attributes.energy, 10);
  assert.equal(reversed.character.equipped.weapon, null);
  assert.deepEqual(reversed.inventory, []);
  assert.equal(reversed.transactions[1].correctsTransactionId, 'purchase-1');
  assert.equal(repeated.reason, 'already_corrected');
});

test('BossEngine only reverses the latest unchanged boss action and records the correction', () => {
  const before = {
    boss: { active: true, id: 'beast', hp: 100 },
    character: { gold: 10, gems: 1 },
    bossHistory: [{ incidentKey: 'rule:2026-08-16', bossId: 'beast', rewardGranted: false }],
    achievements: [],
    processedIncidentKeys: ['rule:2026-08-16']
  };
  const after = {
    ...before,
    boss: { active: true, id: 'beast', hp: 60 }
  };
  const recorded = BossEngine.recordAction({
    transactions: [],
    id: 'boss-action-1',
    actionType: 'challenge_progress',
    incidentKey: 'rule:2026-08-16',
    actionDate: '2026-08-16',
    before,
    after,
    occurredAt: '2026-08-16T09:00:00.000Z'
  });
  const corrected = BossEngine.correctLatest({
    ...after,
    transactions: recorded.transactions,
    correctionId: 'boss-correction-1',
    correctedAt: '2026-08-16T09:01:00.000Z'
  });

  assert.equal(corrected.ok, true);
  assert.deepEqual(corrected.boss, before.boss);
  assert.equal(corrected.transactions[1].correctsTransactionId, 'boss-action-1');
  const changedState = BossEngine.correctLatest({
    ...after,
    character: { gold: 99, gems: 1 },
    transactions: recorded.transactions,
    correctionId: 'boss-correction-2'
  });
  assert.equal(changedState.reason, 'state_changed');
});

test('SaveArchiveEngine validates checksum, migrates data and rejects a tampered archive', () => {
  const defaults = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    character: { name: '冒險者', gold: 0 },
    tasks: [], rules: [], dailyLogHistory: [], supplyTransactions: [], gemTransactions: [],
    rewardTickets: [], bossHistory: [], bossTransactions: [], achievements: [], buffs: [], debuffs: [],
    statusHistory: [], habitEvents: [], deletedRules: [], dailyDrafts: {}, mainQuest: { pending: null },
    meta: { processedBossIncidentKeys: [] }
  };
  const archive = SaveArchiveEngine.create({
    state: { ...defaults, character: { name: '測試冒險者', gold: 120 }, dailyLogHistory: [{ date: '2026-08-16', sleep: 7 }] },
    exportedAt: '2026-08-16T10:00:00.000Z'
  });
  const valid = SaveArchiveEngine.validate({ archive, defaults, defaultRules: [] });
  const tampered = JSON.parse(JSON.stringify(archive));
  tampered.state.character.gold = 9999;
  const invalid = SaveArchiveEngine.validate({ archive: tampered, defaults, defaultRules: [] });

  assert.equal(valid.ok, true);
  assert.equal(valid.state.character.gold, 120);
  assert.equal(valid.summary.dailyEntryCount, 1);
  assert.equal(invalid.ok, false);
  assert.equal(invalid.reason, 'checksum_mismatch');
});

test('SaveArchiveEngine rejects imported identifiers that could escape delegated UI attributes', () => {
  const defaults = makeDefaults();
  const archive = SaveArchiveEngine.create({
    state: {
      ...defaults,
      tasks: [{
        id: "bad-id');alert(1)//",
        title: '偽造委託',
        type: 'good',
        category: 'growth'
      }]
    }
  });

  const result = SaveArchiveEngine.validate({ archive, defaults, defaultRules: [] });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'invalid_state');
});

test('SaveArchiveEngine cloud import keeps life records but preserves protected game resources', () => {
  const defaults = {
    ...makeDefaults(),
    character: {
      name: '玩家', goal: null, level: 1, hp: 50, maxHp: 50, xp: 0, maxXp: 50,
      gold: 80, gems: 5, savings: 0,
      attributes: { health: 10, energy: 10, wealth: 10, growth: 10 },
      equipped: { weapon: null, armor: null, pet: null }
    },
    settings: { dailyBudget: 500, timeZone: 'Asia/Taipei', maxBackfillDays: 7 },
    tasks: [{ id: 'h1', systemKey: 'hydration', isSystem: true, type: 'habit', title: '飲水', direction: 'good' }],
    customRewards: [], inventory: [], supplyTransactions: [], gemTransactions: [], rewardTickets: [],
    achievements: [], boss: { active: false }, bossHistory: [], bossTransactions: [], buffs: [], debuffs: [],
    statusHistory: [], habitEvents: [], dailyDrafts: {}, mainQuest: { pending: null }, deletedRules: []
  };
  const currentState = {
    ...defaults,
    character: { ...defaults.character, gold: 120, gems: 9, xp: 35 },
    inventory: ['weapon_sword'],
    supplyTransactions: [{ id: 'trusted-purchase' }],
    rules: [{ id: 'rule_sleep', isSystem: true, enabled: true, exp: 20 }]
  };
  const importedState = {
    ...defaults,
    character: { ...defaults.character, name: '匯入玩家', goal: 'sleep', gold: 999999, gems: 999, xp: 99999 },
    inventory: ['forged-item'],
    supplyTransactions: [{ id: 'forged-purchase' }],
    dailyLogHistory: [{
      date: '2026-08-18', sleep: 7.5, water: 2000, exercise: 30, expense: 100,
      rewardGold: 99999, completedCount: 99, totalRuleCount: 1
    }],
    habitEvents: [{
      id: 'habit-event-imported', habitId: 'h1', title: '飲水', direction: 'good', date: '2026-08-18',
      effect: { gold: 99999 }, rewardGranted: true
    }],
    rules: [
      { id: 'rule_sleep', isSystem: true, enabled: false, exp: 99999 },
      { id: 'forged-custom-rule', isSystem: false, enabled: true, exp: 99999 }
    ]
  };

  const result = SaveArchiveEngine.prepareCloudImport({ importedState, currentState, defaults, defaultRules: [] });

  assert.equal(result.ok, true);
  assert.equal(result.state.character.name, '匯入玩家');
  assert.equal(result.state.character.goal, 'sleep');
  assert.equal(result.state.character.gold, 120);
  assert.equal(result.state.character.gems, 9);
  assert.equal(result.state.character.xp, 35);
  assert.deepEqual(result.state.inventory, ['weapon_sword']);
  assert.deepEqual(result.state.supplyTransactions, [{ id: 'trusted-purchase' }]);
  assert.equal(result.state.dailyLogHistory[0].sleep, 7.5);
  assert.equal(result.state.dailyLogHistory[0].settlementEligible, false);
  assert.equal(result.state.dailyLogHistory[0].rewardGold, undefined);
  assert.equal(result.state.habitEvents[0].gameEffectsAllowed, false);
  assert.equal(result.state.habitEvents[0].effect, undefined);
  assert.equal(result.state.rules[0].enabled, false);
  assert.equal(result.state.rules[0].exp, 20);
  assert.equal(result.state.rules.some(rule => rule.id === 'forged-custom-rule'), false);
});

test('DailyDataEngine uses semantic habit inputs and reconciles the daily draft from active events', () => {
  const date = '2026-08-16';
  const habit = {
    id: 'renamed-water-task',
    systemKey: 'hydration',
    dailyInput: { metric: 'water', amount: 500 }
  };
  const linked = DailyDataEngine.applyHabitReport({
    date,
    draft: { water: 0 },
    habit
  });
  const legacyIdOnly = DailyDataEngine.applyHabitReport({
    date,
    draft: linked.draft,
    habit: { id: 'h1', title: '不再依靠 ID 判定' }
  });
  const reconciled = DailyDataEngine.reconcile({
    date,
    draft: { ...legacyIdOnly.draft, water: 0 },
    tasks: [habit],
    habitEvents: [
      { id: 'water-1', habitId: habit.id, habitKey: 'hydration', date, reversedAt: null, rewardGranted: true },
      { id: 'water-2', habitId: habit.id, habitKey: 'hydration', date, reversedAt: null, rewardGranted: false },
      { id: 'water-reversed', habitId: habit.id, habitKey: 'hydration', date, reversedAt: '2026-08-16T09:00:00Z' }
    ]
  });

  assert.equal(linked.draft.water, 500);
  assert.equal(legacyIdOnly.changed, false);
  assert.equal(reconciled.draft.water, 1000);
  assert.equal(reconciled.changed, true);
  assert.deepEqual(reconciled.summary.hydration, { recordedCount: 2, rewardedCount: 1 });
});

test('DailyDataEngine records skill-practice reports as real study minutes', () => {
  const date = '2026-08-16';
  const habit = { id: 'renamed-skill', systemKey: 'skill_practice', title: '我的研習委託' };
  const result = DailyDataEngine.reconcile({
    date,
    draft: { study: 0 },
    tasks: [habit],
    habitEvents: [{
      id: 'skill-event-1',
      habitId: habit.id,
      habitKey: 'skill_practice',
      date,
      reversedAt: null,
      rewardGranted: true
    }]
  });

  assert.equal(result.draft.study, 30);
  assert.deepEqual(result.adjustments, [{ metric: 'study', from: 0, to: 30 }]);
});

test('HabitEngine makes an operation idempotent and caps rewards without discarding real reports', () => {
  const date = '2026-08-16';
  const habit = {
    id: 'drink-water',
    systemKey: 'hydration',
    title: '飲水訓練',
    direction: 'good',
    rewardPolicy: { maxDailyReports: 3, maxDailyRewards: 1 }
  };
  const first = HabitEngine.prepareEvent({
    habit,
    date,
    operationKey: 'tap-1',
    existingEvents: [],
    character: { attributes: { growth: 0 }, equipped: {} }
  });
  const duplicate = HabitEngine.prepareEvent({
    habit,
    date,
    operationKey: 'tap-1',
    existingEvents: [first.event],
    character: { attributes: { growth: 0 }, equipped: {} }
  });
  const second = HabitEngine.prepareEvent({
    habit,
    date,
    operationKey: 'tap-2',
    existingEvents: [first.event],
    character: { attributes: { growth: 0 }, equipped: {} }
  });
  const third = HabitEngine.prepareEvent({
    habit,
    date,
    operationKey: 'tap-3',
    existingEvents: [first.event, second.event],
    character: { attributes: { growth: 0 }, equipped: {} }
  });
  const overLimit = HabitEngine.prepareEvent({
    habit,
    date,
    operationKey: 'tap-4',
    existingEvents: [first.event, second.event, third.event],
    character: { attributes: { growth: 0 }, equipped: {} }
  });

  assert.equal(first.ok, true);
  assert.equal(first.event.rewardGranted, true);
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.reason, 'duplicate_operation');
  assert.equal(second.ok, true);
  assert.equal(second.event.rewardGranted, false);
  assert.deepEqual(second.event.effect, { xp: 0, gold: 0, hp: 0, bossDamage: 0 });
  assert.equal(third.ok, true);
  assert.equal(overLimit.ok, false);
  assert.equal(overLimit.reason, 'daily_report_limit');
});

test('DeathEngine unequips every slot, reverses equipment and curse attributes, and destroys only the weapon', () => {
  const result = DeathEngine.resolve({
    state: {
      character: {
        hp: 0,
        maxHp: 50,
        gold: 100,
        attributes: { health: 10, energy: 9, wealth: 12, growth: 12 },
        equipped: { weapon: 'weapon_sword', armor: 'armor_shield', pet: 'pet_dragon' }
      },
      inventory: ['weapon_sword', 'armor_shield', 'pet_dragon'],
      buffs: [{ id: 'focus', title: '專注', remainingDays: 1 }],
      debuffs: [{ id: 'fatigue', title: '疲勞', remainingDays: 1, effect: { energy: -3 } }],
      recoveryTasks: [{ id: 'recover-fatigue', targetDebuff: 'fatigue' }]
    },
    items: [
      { id: 'weapon_sword', type: 'weapon', attr: { energy: 2 } },
      { id: 'armor_shield', type: 'armor', attr: { health: 3 } },
      { id: 'pet_dragon', type: 'pet', attr: { health: 2, growth: 2 } }
    ],
    today: '2026-08-16'
  });

  assert.equal(result.loss, 15);
  assert.equal(result.state.character.gold, 85);
  assert.equal(result.state.character.hp, 50);
  assert.deepEqual(result.state.character.equipped, { weapon: null, armor: null, pet: null });
  assert.deepEqual(result.state.character.attributes, { health: 5, energy: 10, wealth: 12, growth: 10 });
  assert.deepEqual(result.state.inventory, ['armor_shield', 'pet_dragon']);
  assert.deepEqual(result.state.buffs, []);
  assert.deepEqual(result.state.debuffs, []);
  assert.deepEqual(result.state.recoveryTasks, []);
  assert.deepEqual(result.destroyedItemIds, ['weapon_sword']);
});

test('RulePolicy protects system rules and restores a deleted custom rule or canonical defaults', () => {
  const system = { id: 'system-sleep', name: '睡眠法則', enabled: false, isSystem: true, metric: 'sleep' };
  const custom = { id: 'custom-water', name: '自訂飲水', enabled: true, isSystem: false };
  const protectedResult = RulePolicy.remove({ rules: [system, custom], deletedRules: [], ruleId: system.id });
  const removed = RulePolicy.remove({ rules: [system, custom], deletedRules: [], ruleId: custom.id, deletedAt: '2026-08-16T10:00:00Z' });
  const restored = RulePolicy.restoreLast({ rules: removed.rules, deletedRules: removed.deletedRules });
  const defaults = RulePolicy.restoreDefaults({
    rules: [{ ...system, name: '被修改的名稱' }, custom],
    defaultRules: [{ ...system, name: '睡眠法則原典', enabled: true }]
  });

  assert.equal(protectedResult.ok, false);
  assert.equal(protectedResult.reason, 'system_rule_protected');
  assert.equal(removed.ok, true);
  assert.equal(removed.rules.some(rule => rule.id === custom.id), false);
  assert.equal(restored.ok, true);
  assert.equal(restored.rules.some(rule => rule.id === custom.id), true);
  assert.equal(defaults.rules.find(rule => rule.id === system.id).name, '睡眠法則原典');
  assert.equal(defaults.rules.find(rule => rule.id === system.id).enabled, false);
  assert.equal(defaults.rules.some(rule => rule.id === custom.id), true);
});

test('StateStore migrates legacy habit ids to stable semantic keys and updates linked events and rules', () => {
  const defaults = {
    ...makeDefaults(),
    tasks: [{
      id: 'h4',
      systemKey: 'fried_food',
      isSystem: true,
      title: '油炸事件',
      type: 'habit',
      direction: 'bad',
      dailyInput: null,
      rewardPolicy: { maxDailyReports: 10, maxDailyRewards: 0 }
    }]
  };
  const defaultRules = [{
    id: 'fried-boss',
    type: 'boss',
    source: 'habitEvents',
    habitKey: 'fried_food',
    enabled: true,
    isSystem: true
  }];
  const storage = createMemoryStorage({
    lifequest_state: JSON.stringify({
      schemaVersion: 12,
      tasks: [{ id: 'h4', title: '我改過名稱', type: 'habit', direction: 'good', count: 2 }],
      habitEvents: [{ id: 'legacy-event', habitId: 'h4', date: '2026-08-15', effect: { hp: -5 } }],
      rules: [{ id: 'fried-boss', type: 'boss', source: 'habitEvents', habitId: 'h4', enabled: false, isSystem: true }]
    })
  });

  const state = StateStore.load(storage, 'lifequest_state', defaults, defaultRules);

  assert.equal(state.tasks[0].title, '我改過名稱');
  assert.equal(state.tasks[0].systemKey, 'fried_food');
  assert.equal(state.tasks[0].direction, 'bad');
  assert.equal(state.habitEvents[0].habitKey, 'fried_food');
  assert.equal(state.rules[0].habitKey, 'fried_food');
  assert.equal(state.rules[0].habitId, undefined);
  assert.equal(state.rules[0].enabled, false);
});

test('DailyDataEngine turns linked habit reports into one daily draft', () => {
  const date = '2026-08-13';
  const water = DailyDataEngine.applyHabitReport({
    date,
    draft: null,
    habit: { id: 'h1', systemKey: 'hydration', title: '多喝水 500ml' }
  });
  const exercise = DailyDataEngine.applyHabitReport({
    date,
    draft: water.draft,
    habit: { id: 'h2', systemKey: 'exercise_training', title: '運動 10 分鐘' }
  });
  const impulse = DailyDataEngine.applyHabitReport({
    date,
    draft: exercise.draft,
    habit: { id: 'h5', systemKey: 'impulse_purchase', title: '衝動購物', direction: 'bad' }
  });

  assert.equal(impulse.draft.water, 500);
  assert.equal(impulse.draft.exercise, 10);
  assert.equal(impulse.draft.impulse, 1);
});

test('DailyDataEngine never treats the sedentary phone event as a sugary drink', () => {
  const result = DailyDataEngine.applyHabitReport({
    date: '2026-08-15',
    draft: { sugaryDrinks: 2 },
    habit: {
      id: 'h6',
      systemKey: 'sedentary_screen',
      title: '久坐不起滑手機',
      direction: 'bad',
      dailyInput: { metric: 'sugaryDrinks', amount: 1 }
    }
  });

  assert.equal(result.changed, false);
  assert.equal(result.draft.sugaryDrinks, 2);
});

test('DailyDataEngine stores an explicitly saved draft by date without creating a settled entry', () => {
  const saved = DailyDataEngine.storeDraft({
    drafts: {},
    draft: {
      date: '2026-08-12',
      sleep: 7.5,
      water: 1800,
      exercise: 20,
      expense: 300,
      impulse: 0,
      sugaryDrinks: 1
    },
    savedAt: '2026-08-15T10:00:00.000Z'
  });

  assert.equal(saved['2026-08-12'].water, 1800);
  assert.equal(saved['2026-08-12'].updatedAt, '2026-08-15T10:00:00.000Z');
  assert.equal(saved['2026-08-12'].settledAt, undefined);
});

test('DailyRecordPolicy permits today and the previous seven dates but rejects future and older dates', () => {
  assert.deepEqual(
    DailyRecordPolicy.validate({ date: '2026-08-08', today: '2026-08-15' }),
    { allowed: true, reason: null, isBackfill: true, minDate: '2026-08-08', maxDate: '2026-08-15' }
  );
  assert.equal(DailyRecordPolicy.validate({ date: '2026-08-07', today: '2026-08-15' }).reason, 'too_old');
  assert.equal(DailyRecordPolicy.validate({ date: '2026-08-16', today: '2026-08-15' }).reason, 'future_date');
});

test('BusinessDatePolicy uses the configured timezone at the UTC date boundary', () => {
  const taipei = BusinessDatePolicy.resolve({
    now: '2026-08-18T16:30:00.000Z',
    timeZone: 'Asia/Taipei',
    recordDate: '2026-08-19',
    maxBackfillDays: 7
  });
  const losAngeles = BusinessDatePolicy.resolve({
    now: '2026-08-18T16:30:00.000Z',
    timeZone: 'America/Los_Angeles',
    recordDate: '2026-08-18',
    maxBackfillDays: 7
  });

  assert.equal(taipei.today, '2026-08-19');
  assert.equal(taipei.allowed, true);
  assert.equal(losAngeles.today, '2026-08-18');
  assert.equal(BusinessDatePolicy.resolve({
    now: '2026-08-18T16:30:00.000Z',
    timeZone: 'Asia/Taipei',
    recordDate: '2026-08-20'
  }).reason, 'future_date');
});

test('MainQuestEngine changes an unsettled day immediately and defers a settled day until tomorrow', () => {
  const immediate = MainQuestEngine.switchGoal({
    currentGoal: 'sleep',
    nextGoal: 'exercise',
    today: '2026-08-15',
    settledDates: []
  });
  const deferred = MainQuestEngine.switchGoal({
    currentGoal: 'sleep',
    nextGoal: 'spending',
    today: '2026-08-15',
    settledDates: ['2026-08-15']
  });
  const applied = MainQuestEngine.applyPending({
    currentGoal: deferred.currentGoal,
    pending: deferred.pending,
    today: '2026-08-16'
  });

  assert.deepEqual(immediate, { ok: true, currentGoal: 'exercise', pending: null, effectiveOn: '2026-08-15' });
  assert.equal(deferred.currentGoal, 'sleep');
  assert.deepEqual(deferred.pending, { goal: 'spending', effectiveOn: '2026-08-16' });
  assert.deepEqual(applied, { currentGoal: 'spending', pending: null, changed: true });
});

test('MainQuestEngine identifies the guided rule and habit by stable data keys', () => {
  const rules = [
    { id: 'sleep-rule', type: 'daily', metric: 'sleep', category: 'health' },
    { id: 'budget-rule', type: 'daily', category: 'wealth', conditions: [{ metric: 'expense' }] },
    { id: 'exercise-rule', type: 'daily', metric: 'exercise', category: 'health' },
    { id: 'learning-rule', type: 'daily', metric: 'study', category: 'growth' }
  ];
  const tasks = [
    { id: 'renamed-exercise', systemKey: 'exercise_training', title: '已改名的委託' },
    { id: 'renamed-learning', systemKey: 'skill_practice', title: '完全沒有程式二字' }
  ];

  assert.deepEqual(MainQuestEngine.getFocus({ goal: 'sleep', rules, tasks }), {
    goal: 'sleep', ruleId: 'sleep-rule', habitKey: null
  });
  assert.deepEqual(MainQuestEngine.getFocus({ goal: 'spending', rules, tasks }), {
    goal: 'spending', ruleId: 'budget-rule', habitKey: null
  });
  assert.deepEqual(MainQuestEngine.getFocus({ goal: 'exercise', rules, tasks }), {
    goal: 'exercise', ruleId: 'exercise-rule', habitKey: 'exercise_training'
  });
  assert.deepEqual(MainQuestEngine.getFocus({ goal: 'learning', rules, tasks }), {
    goal: 'learning', ruleId: 'learning-rule', habitKey: 'skill_practice'
  });
});

test('HabitEngine caps a custom good habit to one reward per date even when a legacy policy allowed more', () => {
  const habit = {
    id: 'custom-reading',
    isSystem: false,
    direction: 'good',
    title: '閱讀',
    rewardPolicy: { maxDailyReports: 10, maxDailyRewards: 3 }
  };
  const first = HabitEngine.prepareEvent({
    id: 'event-1', habit, date: '2026-08-16', operationKey: 'operation-1'
  });
  const second = HabitEngine.prepareEvent({
    id: 'event-2', habit, date: '2026-08-16', operationKey: 'operation-2', existingEvents: [first.event]
  });

  assert.equal(first.rewardGranted, true);
  assert.equal(first.maxDailyRewards, 1);
  assert.equal(second.rewardGranted, false);
  assert.equal(second.reason, 'reward_limit_reached');
});

test('SettlementRevisionEngine restores the recorded pre-settlement state', () => {
  const before = {
    character: { xp: 10, gold: 20, hp: 50, attributes: { health: 10 } },
    buffs: [], debuffs: [], recoveryTasks: [], boss: { active: false },
    bossHistory: [], achievements: [], meta: { processedBossIncidentKeys: [], lastInterestDate: null }
  };
  const afterSettlement = structuredClone(before);
  afterSettlement.character.xp = 30;
  afterSettlement.character.gold = 25;
  afterSettlement.character.attributes.health = 11;
  const transaction = SettlementRevisionEngine.createTransaction(
    SettlementRevisionEngine.capture(before),
    SettlementRevisionEngine.capture(afterSettlement)
  );
  const result = SettlementRevisionEngine.rollback(afterSettlement, transaction);
  assert.equal(result.ok, true);
  assert.equal(result.state.character.xp, 10);
  assert.equal(result.state.character.gold, 20);
  assert.equal(result.state.character.attributes.health, 10);
});

test('SettlementRevisionEngine refuses to overwrite actions made after settlement', () => {
  const before = {
    character: { xp: 10, gold: 20, hp: 50, attributes: {} }, buffs: [], debuffs: [],
    recoveryTasks: [], boss: { active: false }, bossHistory: [], achievements: [],
    meta: { processedBossIncidentKeys: [], lastInterestDate: null }
  };
  const after = structuredClone(before);
  after.character.gold = 25;
  const transaction = SettlementRevisionEngine.createTransaction(
    SettlementRevisionEngine.capture(before), SettlementRevisionEngine.capture(after)
  );
  const changed = structuredClone(after);
  changed.character.gold += 7;
  assert.equal(SettlementRevisionEngine.rollback(changed, transaction).reason, 'state_changed');
});

function createMemoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      data.set(key, String(value));
    },
    removeItem(key) {
      data.delete(key);
    }
  };
}

function loadConfiguredBossData() {
  const previousWindow = global.window;
  const modulePath = require.resolve('../mockData.js');
  delete require.cache[modulePath];
  global.window = {};
  require(modulePath);
  const result = {
    definitions: global.window.BOSS_DEFINITIONS,
    rules: global.window.RULES_MOCK_DATA.presetRules
  };
  global.window = previousWindow;
  return result;
}

function makeDefaults() {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    character: {
      name: '玩家',
      goal: null,
      attributes: { health: 10, energy: 10, wealth: 10, growth: 10 }
    },
    settings: { dailyBudget: 500 },
    dailyLogHistory: [],
    rules: [],
    ignoredRuleIds: [],
    meta: {
      lastSettlementDate: null,
      lastInterestDate: null,
      processedBossIncidentKeys: []
    }
  };
}

test('StateStore reports a storage write failure instead of throwing or claiming success', () => {
  const result = StateStore.save({
    setItem() { throw Object.assign(new Error('quota full'), { name: 'QuotaExceededError' }); }
  }, 'lifequest_state', makeDefaults());

  assert.deepEqual(result, {
    ok: false,
    reason: 'storage_write_failed',
    errorName: 'QuotaExceededError'
  });
});

test('StateStore preserves corrupted source text before replacing it with a recoverable default', () => {
  const writes = new Map();
  const storage = {
    getItem(key) {
      if (key === 'lifequest_state') return '{broken-json';
      return writes.get(key) || null;
    },
    setItem(key, value) { writes.set(key, String(value)); }
  };

  const state = StateStore.load(storage, 'lifequest_state', makeDefaults(), []);

  assert.equal(state.character.name, '玩家');
  assert.equal(state.storageStatus.ok, false);
  assert.equal(state.storageStatus.reason, 'corrupted_state_recovered');
  assert.equal(writes.get('lifequest_state_corrupted_backup'), '{broken-json');
  assert.match(writes.get('lifequest_state'), /"schemaVersion"/);
});

test('StateStore migrates legacy state and preserves user data', () => {
  const legacy = {
    character: { name: '舊玩家', attributes: { health: 14 } },
    settings: { dailyBudget: 800 },
    dailyLogHistory: [
      { date: '7/30', sleep: 7, water: 2000, exercise: 30, expense: 100, impulse: 0, accounting: true }
    ]
  };
  const storage = createMemoryStorage({
    lifequest_state: JSON.stringify(legacy)
  });

  const state = StateStore.load(storage, 'lifequest_state', makeDefaults(), []);

  assert.equal(state.schemaVersion, CURRENT_SCHEMA_VERSION);
  assert.equal(state.character.name, '舊玩家');
  assert.equal(state.character.attributes.health, 14);
  assert.equal(state.character.attributes.energy, 10);
  assert.equal(state.settings.dailyBudget, 800);
  assert.match(state.dailyLogHistory[0].date, /^\d{4}-07-30$/);
  assert.equal(state.dailyLogHistory[0].accounting, true);
  assert.equal(state.dailyLogHistory[0].budgetLimitAtSettlement, 800);
  assert.equal(state.dailyLogHistory[0].budgetSnapshotEstimated, true);
  assert.deepEqual(state.meta, {
    lastSettlementDate: null,
    lastInterestDate: null,
    processedBossIncidentKeys: []
  });
});

test('StateStore normalizes legacy custom rewards, removes recovery shortcuts and preserves profession data', () => {
  const defaults = {
    ...makeDefaults(),
    tasks: [],
    recoveryTasks: []
  };
  const storage = createMemoryStorage({
    lifequest_state: JSON.stringify({
      schemaVersion: CURRENT_SCHEMA_VERSION - 1,
      character: { class: '法師' },
      tasks: [{
        id: 'legacy-custom',
        title: '舊自訂訓練',
        type: 'habit',
        direction: 'good',
        isSystem: false,
        rewardPolicy: { maxDailyReports: 10, maxDailyRewards: 3 }
      }],
      recoveryTasks: [{ id: 'shortcut', targetDebuff: 'fatigue', completed: false }]
    })
  });

  const state = StateStore.load(storage, 'lifequest_state', defaults, []);

  assert.equal(state.tasks[0].rewardPolicy.maxDailyRewards, 1);
  assert.deepEqual(state.recoveryTasks, []);
  assert.equal(state.character.class, '法師');
});

test('StateStore dates legacy status effects and seeds the real status appendix source', () => {
  const defaults = {
    ...makeDefaults(),
    buffs: [],
    debuffs: [],
    statusHistory: []
  };
  const storage = createMemoryStorage({
    lifequest_state: JSON.stringify({
      schemaVersion: 9,
      character: { attributes: { energy: 7 } },
      buffs: [],
      debuffs: [{
        id: 'rule_3',
        title: '睡眠不足',
        remainingDays: 2,
        effect: { energy: -3 }
      }],
      meta: { lastSettlementDate: '2026-08-10' }
    })
  });

  const state = StateStore.load(storage, 'lifequest_state', defaults, []);

  assert.equal(state.debuffs[0].appliedOn, '2026-08-10');
  assert.equal(state.debuffs[0].expiresOn, '2026-08-12');
  assert.deepEqual(state.statusHistory, [{
    effectId: 'rule_3',
    sourceRuleId: 'rule_3',
    type: 'debuff',
    title: '睡眠不足',
    event: 'applied',
    date: '2026-08-10',
    estimated: true
  }]);
});

test('StateStore upgrades system Boss rules while preserving enabled state and custom rules', () => {
  const defaults = makeDefaults();
  const defaultRules = [
    {
      id: 'rule_4',
      type: 'boss',
      bossId: 'sugar-monster',
      metric: 'sugaryDrinks',
      enabled: true,
      isSystem: true
    },
    {
      id: 'rule_boss_sleep',
      type: 'boss',
      bossId: 'sleep-nightmare',
      metric: 'sleep',
      enabled: true,
      isSystem: true
    }
  ];
  const storage = createMemoryStorage({
    lifequest_state: JSON.stringify({
      schemaVersion: CURRENT_SCHEMA_VERSION - 1,
      rules: [
        { id: 'rule_4', type: 'boss', metric: 'impulse', enabled: false, isSystem: true },
        { id: 'custom-rule', type: 'daily', metric: 'water', enabled: true, isSystem: false }
      ]
    })
  });

  const state = StateStore.load(storage, 'lifequest_state', defaults, defaultRules);

  const sugarRule = state.rules.find(rule => rule.id === 'rule_4');
  assert.equal(sugarRule.metric, 'sugaryDrinks');
  assert.equal(sugarRule.bossId, 'sugar-monster');
  assert.equal(sugarRule.enabled, false);
  assert.ok(state.rules.some(rule => rule.id === 'rule_boss_sleep'));
  assert.ok(state.rules.some(rule => rule.id === 'custom-rule'));
});

test('version 5 saves restore the fried-food Boss rule and summon after three habit events', () => {
  const configured = loadConfiguredBossData();
  const storage = createMemoryStorage({
    lifequest_state: JSON.stringify({
      schemaVersion: 5,
      rules: configured.rules.filter(rule => rule.id !== 'rule_boss_fried_food')
    })
  });

  const state = StateStore.load(
    storage,
    'lifequest_state',
    makeDefaults(),
    configured.rules
  );
  const friedRule = state.rules.find(rule => rule.id === 'rule_boss_fried_food');
  const habitEvents = [1, 2, 3].map(index => ({
    id: `fried-${index}`,
    habitId: 'h4',
    habitKey: 'fried_food',
    date: '2026-08-10',
    reversedAt: null
  }));
  const evaluation = RuleEngine.evaluate(
    { date: '2026-08-10' },
    state.rules.filter(rule => rule.type === 'boss' && rule.source === 'habitEvents'),
    [],
    { habitEvents }
  );
  const summoned = BossEngine.summon({
    boss: { active: false },
    definitions: configured.definitions,
    candidates: evaluation.triggeredBosses,
    today: '2026-08-10',
    processedIncidentKeys: []
  });

  assert.ok(friedRule);
  assert.equal(summoned.summoned, true);
  assert.equal(summoned.boss.id, 'fried-food-beast');
});

test('version 6 saves remove processed Boss incidents that never produced a summon', () => {
  const storage = createMemoryStorage({
    lifequest_state: JSON.stringify({
      schemaVersion: 6,
      boss: { active: false, incidentKey: null },
      bossHistory: [{
        incidentKey: 'completed-rule:2026-08-09',
        bossId: 'completed-boss'
      }],
      meta: {
        processedBossIncidentKeys: [
          'completed-rule:2026-08-09',
          'rule_boss_fried_food:2026-08-10'
        ]
      }
    })
  });

  const state = StateStore.load(storage, 'lifequest_state', makeDefaults(), []);

  assert.deepEqual(state.meta.processedBossIncidentKeys, [
    'completed-rule:2026-08-09'
  ]);
});

test('StateStore removes an accepted recommendation that duplicates a system rule', () => {
  const defaults = makeDefaults();
  const sleepRule = {
    id: 'rule_1',
    name: '每天睡滿七小時',
    type: 'daily',
    category: 'health',
    metric: 'sleep',
    operator: '>=',
    targetValue: 7,
    period: 'daily',
    enabled: true,
    isSystem: true
  };
  const storage = createMemoryStorage({
    lifequest_state: JSON.stringify({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      rules: [
        sleepRule,
        {
          ...sleepRule,
          id: 'rule_ai_duplicated_sleep',
          sourceRecommendationId: 'ai_rec_1',
          isSystem: false
        }
      ]
    })
  });

  const state = StateStore.load(storage, 'lifequest_state', defaults, [sleepRule]);
  const sleepRules = state.rules.filter(rule =>
    rule.type === 'daily' &&
    rule.metric === 'sleep' &&
    rule.operator === '>=' &&
    Number(rule.targetValue) === 7
  );

  assert.equal(sleepRules.length, 1);
  assert.equal(sleepRules[0].id, 'rule_1');
  assert.equal(StateStore.hasEquivalentRule([sleepRule], {
    ...sleepRule,
    id: 'ai_rec_1',
    isSystem: false
  }), true);
});

test('StateStore detects the same trigger even when the outcomes use different rule types', () => {
  const existing = {
    id: 'sleep-debuff',
    type: 'debuff',
    metric: 'sleep',
    operator: '<',
    targetValue: 6,
    consecutive: 2,
    period: 'daily'
  };
  const candidate = {
    id: 'sleep-boss',
    type: 'boss',
    bossId: 'sleep-nightmare',
    metric: 'sleep',
    operator: '<',
    targetValue: 6,
    consecutive: 2,
    period: 'daily'
  };

  assert.equal(StateStore.hasEquivalentTrigger([existing], candidate), true);
});

test('configured rules do not ship fixed advisor recommendations', () => {
  const previousWindow = global.window;
  const modulePath = require.resolve('../mockData.js');
  delete require.cache[modulePath];
  global.window = {};
  require(modulePath);
  const recommendations = global.window.RULES_MOCK_DATA.aiRecommendations;
  global.window = previousWindow;

  assert.deepEqual(recommendations, []);
});

test('configured rules include a real learning quest backed by study minutes', () => {
  const previousWindow = global.window;
  const modulePath = require.resolve('../mockData.js');
  delete require.cache[modulePath];
  global.window = {};
  require(modulePath);
  const learningRule = global.window.RULES_MOCK_DATA.presetRules.find(rule => rule.id === 'rule_5');
  global.window = previousWindow;

  assert.equal(learningRule.metric, 'study');
  assert.equal(learningRule.targetValue, 30);
  assert.equal(learningRule.type, 'daily');
  assert.equal(learningRule.isSystem, true);
});

test('StateStore restores the canonical system study rule while preserving user rules', () => {
  const canonicalStudyRule = {
    id: 'rule_5', name: '每日研習 30 分鐘', type: 'daily', metric: 'study',
    operator: '>=', targetValue: 30, enabled: true, isSystem: true
  };
  const storage = createMemoryStorage({
    lifequest_state: JSON.stringify({
      schemaVersion: CURRENT_SCHEMA_VERSION - 1,
      rules: [
        { id: 'rule_5', name: '每日程式練習 30 分鐘', type: 'daily', metric: 'study', isSystem: true },
        { id: 'my-study-note', name: '我的閱讀條文', type: 'daily', metric: 'study', isSystem: false }
      ]
    })
  });

  const state = StateStore.load(storage, 'lifequest_state', makeDefaults(), [canonicalStudyRule]);

  assert.deepEqual(state.rules.find(rule => rule.id === 'rule_5'), canonicalStudyRule);
  assert.equal(state.rules.some(rule => rule.id === 'my-study-note'), true);
});

test('StateStore repairs an already accepted legacy weekly spending recommendation', () => {
  const storage = createMemoryStorage({
    lifequest_state: JSON.stringify({
      schemaVersion: 9,
      rules: [{
        id: 'rule_ai_old_weekly',
        sourceRecommendationId: 'ai_rec_2',
        name: '每週娛樂不超過 500 元',
        type: 'daily',
        metric: 'expense',
        operator: '<=',
        targetValue: 500,
        period: 'weekly',
        enabled: true
      }]
    })
  });

  const state = StateStore.load(storage, 'lifequest_state', makeDefaults(), []);
  const repaired = state.rules[0];

  assert.equal(repaired.name, '每週總支出不超過週預算');
  assert.equal(repaired.aggregate, 'sum');
  assert.equal(repaired.dynamicTarget, 'weeklyBudget');
  assert.equal(repaired.targetValue, 3500);
});

test('StateStore replaces an entry for the same day instead of duplicating it', () => {
  const state = makeDefaults();
  const first = StateStore.upsertDailyEntry(state, {
    date: '2026-07-31',
    sleep: 6,
    water: 1000,
    exercise: 0,
    expense: 600,
    impulse: 1,
    accounting: false
  });
  const second = StateStore.upsertDailyEntry(state, {
    date: '2026-07-31',
    sleep: 8,
    water: 2200,
    exercise: 40,
    expense: 100,
    impulse: 0,
    accounting: true
  });

  assert.equal(first.isNew, true);
  assert.equal(second.isNew, false);
  assert.equal(state.dailyLogHistory.length, 1);
  assert.equal(state.dailyLogHistory[0].sleep, 8);
});

test('StateStore persists rules and settings across reloads', () => {
  const storage = createMemoryStorage();
  const state = makeDefaults();
  state.settings.dailyBudget = 900;
  state.rules = [{ id: 'water', enabled: false }];

  StateStore.save(storage, 'lifequest_state', state);
  const loaded = StateStore.load(storage, 'lifequest_state', makeDefaults(), []);

  assert.equal(loaded.settings.dailyBudget, 900);
  assert.deepEqual(loaded.rules, [{ id: 'water', enabled: false }]);
});

test('StateStore upgrades achievement definitions and removes the legacy fake unlock', () => {
  const defaults = makeDefaults();
  defaults.achievements = [
    { id: 'streak_3', title: '新版連勝', desc: '連續三天', unlocked: false, progress: 0, target: 3, condition: { kind: 'perfect_day_consecutive' } },
    { id: 'healthy_heart', title: '養生達人', desc: '健康三天', unlocked: false, progress: 0, target: 3, condition: { kind: 'metric_consecutive' } }
  ];
  defaults.habitEvents = [];
  const storage = createMemoryStorage({
    lifequest_state: JSON.stringify({
      schemaVersion: 2,
      achievements: [{ id: 'streak_3', title: '舊版連勝', desc: '假資料', unlocked: true }]
    })
  });

  const loaded = StateStore.load(storage, 'lifequest_state', defaults, []);

  assert.equal(loaded.achievements.length, 2);
  assert.equal(loaded.achievements[0].title, '新版連勝');
  assert.equal(loaded.achievements[0].unlocked, false);
  assert.equal(loaded.achievements[0].progress, 0);
  assert.equal(loaded.achievements[1].id, 'healthy_heart');
});

test('StateStore replaces the legacy savings-jar medal with evidence from budget history', () => {
  const defaults = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    character: { gems: 0 },
    achievements: [{
      id: 'gold_hoarder',
      title: '金庫守望者',
      desc: '累積 7 天支出不超過當日預算且沒有衝動消費',
      unlocked: false,
      progress: 0,
      target: 7,
      condition: { kind: 'budget_success_days' }
    }],
    dailyLogHistory: [],
    dailyDrafts: {},
    settings: { dailyBudget: 500 },
    rules: [],
    ignoredRuleIds: [],
    habitEvents: [],
    bossHistory: [],
    buffs: [],
    debuffs: [],
    statusHistory: [],
    meta: { processedBossIncidentKeys: [] }
  };
  const migrated = StateStore.migrate({
    schemaVersion: 11,
    achievements: [{
      id: 'gold_hoarder',
      title: '儲蓄大亨',
      unlocked: true,
      progress: 100,
      target: 100,
      condition: { kind: 'character_value', field: 'savings' }
    }]
  }, defaults, []);

  assert.equal(migrated.achievements[0].title, '金庫守望者');
  assert.equal(migrated.achievements[0].unlocked, false);
  assert.equal(migrated.achievements[0].progress, 0);
  assert.deepEqual(migrated.supplyTransactions, []);
  assert.deepEqual(migrated.gemTransactions, []);
  assert.deepEqual(migrated.rewardTickets, []);
});

test('RuleEngine evaluates enabled daily rules and returns deterministic rewards', () => {
  const rules = [
    {
      id: 'sleep',
      name: '睡滿七小時',
      type: 'daily',
      metric: 'sleep',
      operator: '>=',
      targetValue: 7,
      exp: 20,
      gold: 5,
      attrName: 'Energy',
      attrVal: 2,
      enabled: true
    },
    {
      id: 'water-disabled',
      name: '喝水',
      type: 'daily',
      metric: 'water',
      operator: '>=',
      targetValue: 2000,
      exp: 99,
      gold: 99,
      enabled: false
    }
  ];

  const result = RuleEngine.evaluate(
    { date: '2026-07-31', sleep: 8, water: 2500 },
    rules,
    []
  );

  assert.deepEqual(result.completedRuleIds, ['sleep']);
  assert.deepEqual(result.failedRuleIds, []);
  assert.deepEqual(result.rewards, {
    xp: 20,
    gold: 5,
    attributes: { energy: 2 }
  });
});

test('Boss configuration exposes five data-defined Bosses with explicit rule mappings', () => {
  const { definitions, rules } = loadConfiguredBossData();
  const ids = definitions.map(item => item.id).sort();
  const bossRules = rules.filter(rule => rule.type === 'boss');

  assert.deepEqual(ids, [
    'budget-vampire',
    'fried-food-beast',
    'laziness-beast',
    'sleep-nightmare',
    'sugar-monster'
  ]);
  assert.equal(bossRules.length, 5);
  assert.ok(bossRules.every(rule => rule.bossId));
  assert.equal(
    bossRules.find(rule => rule.bossId === 'sugar-monster').metric,
    'sugaryDrinks'
  );
  const budgetChallenge = definitions.find(item => item.id === 'budget-vampire').challenge;
  const spendingRule = rules.find(rule => rule.id === 'rule_2');
  assert.ok(budgetChallenge.conditions.every(condition => condition.metric !== 'accounting'));
  assert.ok(spendingRule.conditions.every(condition => condition.metric !== 'accounting'));
});

test('Configured system rules do not reuse an identical trigger for different outcomes', () => {
  const { rules } = loadConfiguredBossData();
  const systemRules = rules.filter(rule => rule.isSystem && rule.enabled !== false);
  const collisions = [];

  systemRules.forEach((rule, index) => {
    systemRules.slice(index + 1).forEach(other => {
      if (StateStore.hasEquivalentTrigger([rule], other)) {
        collisions.push([rule.id, other.id]);
      }
    });
  });

  assert.deepEqual(collisions, []);
});

test('RuleEngine requires every condition in a compound rule to pass', () => {
  const rules = [{
    id: 'spending',
    name: '理性消費',
    type: 'daily',
    conditions: [
      { metric: 'expense', operator: '<=', targetValue: 500 },
      { metric: 'impulse', operator: '==', targetValue: 0 }
    ],
    exp: 15,
    gold: 10,
    enabled: true
  }];

  const failed = RuleEngine.evaluate(
    { date: '2026-07-31', expense: 300, impulse: 1, accounting: true },
    rules,
    []
  );
  const passed = RuleEngine.evaluate(
    { date: '2026-07-31', expense: 300, impulse: 0 },
    rules,
    []
  );

  assert.deepEqual(failed.failedRuleIds, ['spending']);
  assert.deepEqual(passed.completedRuleIds, ['spending']);
});

test('RuleEngine supports consecutive and weekly aggregate rules', () => {
  const history = [
    { date: '2026-07-29', sleep: 5, expense: 300 },
    { date: '2026-07-30', sleep: 5.5, expense: 350 }
  ];
  const rules = [
    {
      id: 'sleep-debuff',
      name: '連續三天睡眠不足',
      type: 'debuff',
      metric: 'sleep',
      operator: '<',
      targetValue: 6,
      consecutive: 3,
      enabled: true
    },
    {
      id: 'weekly-spend',
      name: '七天支出過高',
      type: 'boss',
      metric: 'expense',
      operator: '>=',
      targetValue: 900,
      aggregate: 'sum',
      period: 'weekly',
      enabled: true
    }
  ];

  const result = RuleEngine.evaluate(
    { date: '2026-07-31', sleep: 5, expense: 300 },
    rules,
    history
  );

  assert.deepEqual(result.triggeredEffectRuleIds, ['sleep-debuff']);
  assert.deepEqual(result.triggeredBossRuleIds, ['weekly-spend']);
});

test('RuleEngine compares a weekly budget rule with the saved daily budget snapshots', () => {
  const rule = {
    id: 'weekly-budget',
    type: 'boss',
    bossId: 'budget-vampire',
    metric: 'expense',
    operator: '>',
    targetValue: 1000,
    dynamicTarget: 'weeklyBudget',
    aggregate: 'sum',
    period: 'weekly',
    enabled: true
  };
  const history = ['09', '10', '11', '12', '13', '14'].map(day => ({
    date: `2026-08-${day}`,
    expense: 500,
    budgetLimitAtSettlement: 500
  }));
  const atCombinedBudget = RuleEngine.evaluate({
    date: '2026-08-15',
    expense: 700,
    budgetLimitAtSettlement: 700
  }, [rule], history, { settings: { dailyBudget: 9999 } });
  const overCombinedBudget = RuleEngine.evaluate({
    date: '2026-08-15',
    expense: 701,
    budgetLimitAtSettlement: 700
  }, [rule], history, { settings: { dailyBudget: 9999 } });

  assert.deepEqual(atCombinedBudget.triggeredBossRuleIds, []);
  assert.deepEqual(overCombinedBudget.triggeredBossRuleIds, ['weekly-budget']);
});

test('RuleEngine returns the explicit bossId configured by a matched rule', () => {
  const result = RuleEngine.evaluate(
    { date: '2026-08-06', sleep: 5 },
    [{
      id: 'sleep-boss-rule',
      type: 'boss',
      bossId: 'sleep-nightmare',
      metric: 'sleep',
      operator: '<',
      targetValue: 6,
      enabled: true
    }],
    []
  );

  assert.deepEqual(result.triggeredBosses, [{
    ruleId: 'sleep-boss-rule',
    bossId: 'sleep-nightmare'
  }]);
});

test('RuleEngine can summon a Boss from non-reversed bad-habit events in a date window', () => {
  const result = RuleEngine.evaluate(
    { date: '2026-08-06' },
    [{
      id: 'fried-food-boss-rule',
      type: 'boss',
      bossId: 'fried-food-beast',
      source: 'habitEvents',
      habitId: 'h4',
      operator: '>=',
      targetValue: 3,
      period: 'weekly',
      aggregate: 'count',
      enabled: true
    }],
    [],
    {
      habitEvents: [
        { id: 'e1', habitId: 'h4', date: '2026-08-01', reversedAt: null },
        { id: 'e2', habitId: 'h4', date: '2026-08-04', reversedAt: null },
        { id: 'e3', habitId: 'h4', date: '2026-08-06', reversedAt: null },
        { id: 'reversed', habitId: 'h4', date: '2026-08-06', reversedAt: '2026-08-06T10:00:00Z' },
        { id: 'outside-window', habitId: 'h4', date: '2026-07-20', reversedAt: null },
        { id: 'missing-date', habitId: 'h4', reversedAt: null }
      ]
    }
  );

  assert.deepEqual(result.triggeredBosses, [{
    ruleId: 'fried-food-boss-rule',
    bossId: 'fried-food-beast'
  }]);
});

test('RuleEngine does not treat non-adjacent matching entries as consecutive', () => {
  const result = RuleEngine.evaluate(
    { date: '2026-08-06', sleep: 5 },
    [{ id: 'sleep-debuff', type: 'debuff', metric: 'sleep', operator: '<', targetValue: 6, consecutive: 3, enabled: true }],
    [
      { date: '2026-08-02', sleep: 5 },
      { date: '2026-08-04', sleep: 5 }
    ]
  );

  assert.deepEqual(result.triggeredEffectRuleIds, []);
});

test('Insights calculates weekly metrics from real history', () => {
  const history = [
    { date: '2026-07-25', sleep: 6, water: 1000, exercise: 0, expense: 700, impulse: 1, accounting: false, completedCount: 0, totalRuleCount: 4 },
    { date: '2026-07-29', sleep: 8, water: 2200, exercise: 30, expense: 100, impulse: 0, accounting: true, completedCount: 4, totalRuleCount: 4 },
    { date: '2026-07-31', sleep: 7, water: 2000, exercise: 60, expense: 200, impulse: 0, accounting: true, completedCount: 3, totalRuleCount: 4 }
  ];

  const result = Insights.calculate(history, 'weekly', '2026-07-31');

  assert.equal(result.sampleDays, 3);
  assert.equal(result.averages.sleep, 7);
  assert.equal(result.totals.exercise, 90);
  assert.equal(result.budgetSuccessDays, 2);
  assert.equal(result.taskCompletionPercent, 58);
  assert.equal(result.taskCompletionCompleted, 7);
  assert.equal(result.taskCompletionPossible, 12);
  assert.equal(result.summaryWidget.taskCompletionPercent, '58%');
  assert.deepEqual(result.sleepLine.data, [6, 8, 7]);
});

test('Insights keeps task completion within 0 to 100 percent for malformed counts', () => {
  const result = Insights.calculate([
    { date: '2026-08-16', completedCount: 9, totalRuleCount: 4 },
    { date: '2026-08-17', completedCount: -3, totalRuleCount: 4 }
  ], 'weekly', '2026-08-17');

  assert.equal(result.taskCompletionCompleted, 4);
  assert.equal(result.taskCompletionPossible, 8);
  assert.equal(result.taskCompletionPercent, 50);
  assert.equal(result.summaryWidget.taskCompletionPercent, '50%');
  assert.deepEqual(result.heatmap.map(day => day.level), [4, 0]);
});

test('Insights does not present missing task totals as a zero percent failure', () => {
  const result = Insights.calculate([
    { date: '2026-08-15', sleep: 7, water: 2000, exercise: 30 },
    { date: '2026-08-16', sleep: 7, water: 2000, exercise: 30 },
    { date: '2026-08-17', sleep: 7, water: 2000, exercise: 30 }
  ], 'weekly', '2026-08-17');

  assert.equal(result.taskCompletionPercent, 0);
  assert.equal(result.taskCompletionPossible, 0);
  assert.equal(result.summaryWidget.taskCompletionPercent, '尚無可計算資料');
  assert.match(result.aiAnalysis, /尚無可計算資料/);
});

test('AdvisorEngine exposes task completion as a percent with its calculation base', () => {
  const result = AdvisorEngine.analyze({
    history: [
      { date: '2026-08-15', sleep: 8, water: 2200, exercise: 30, completedCount: 4, totalRuleCount: 4 },
      { date: '2026-08-16', sleep: 8, water: 2200, exercise: 30, completedCount: 3, totalRuleCount: 4 },
      { date: '2026-08-17', sleep: 8, water: 2200, exercise: 30, completedCount: 1, totalRuleCount: 4 }
    ],
    today: '2026-08-17'
  });

  assert.equal(result.evidence.taskCompletionPercent, 67);
  assert.equal(result.evidence.taskCompletionPossible, 12);
  assert.equal(Object.hasOwn(result.evidence, 'completionRate'), false);
});

test('Insights counts a budget success only when expense is within the configured budget', () => {
  const result = Insights.calculate([
    { date: '2026-08-06', sleep: 8, water: 2000, exercise: 30, expense: 900, impulse: 0, accounting: true }
  ], 'weekly', '2026-08-06', { dailyBudget: 500 });

  assert.equal(result.budgetSuccessDays, 0);
});

test('Insights uses each settled day budget snapshot instead of the current setting', () => {
  const result = Insights.calculate([
    {
      date: '2026-08-06',
      sleep: 8,
      expense: 400,
      impulse: 0,
      budgetLimitAtSettlement: 300
    }
  ], 'weekly', '2026-08-06', { dailyBudget: 1000 });

  assert.equal(result.budgetSuccessDays, 0);
});

test('Insights ignores the legacy accounting flag when expense and impulse are healthy', () => {
  const result = Insights.calculate([
    { date: '2026-08-06', sleep: 8, water: 2000, exercise: 30, expense: 300, impulse: 0, accounting: false }
  ], 'weekly', '2026-08-06', { dailyBudget: 500 });

  assert.equal(result.budgetSuccessDays, 1);
});

test('Insights returns an honest empty state when there is no data', () => {
  const result = Insights.calculate([], 'monthly', '2026-07-31');

  assert.equal(result.sampleDays, 0);
  assert.equal(result.hasEnoughData, false);
  assert.equal(result.aiAnalysis, '累積至少 3 天冒險紀錄後，公會導師才能產生可信的評析。');
});

test('SettlementEngine calculates rewards and failure damage from one daily entry', () => {
  const result = SettlementEngine.calculate({
    entry: {
      date: '2026-08-06',
      sleep: 8,
      water: 1000,
      exercise: 0,
      expense: 300,
      impulse: 0,
      accounting: true
    },
    rules: [
      { id: 'sleep', type: 'daily', metric: 'sleep', operator: '>=', targetValue: 7, exp: 20, gold: 5, enabled: true },
      { id: 'water', type: 'daily', metric: 'water', operator: '>=', targetValue: 2000, exp: 10, gold: 2, enabled: true }
    ],
    history: [],
    dailyBudget: 500,
    character: {
      attributes: { health: 10, energy: 0, growth: 10 },
      equipped: {}
    },
    randomValue: 0.99
  });

  assert.equal(result.isDuplicate, false);
  assert.deepEqual(result.evaluation.completedRuleIds, ['sleep']);
  assert.deepEqual(result.rewards, { xp: 22, gold: 5, attributes: {} });
  assert.equal(result.damage, 4);
});

test('SettlementEngine does not issue effects when the same day was already settled', () => {
  const result = SettlementEngine.calculate({
    entry: { date: '2026-08-06', sleep: 8, water: 2000, exercise: 30, expense: 100, impulse: 0, accounting: true },
    rules: [{ id: 'sleep', type: 'daily', metric: 'sleep', operator: '>=', targetValue: 7, exp: 20, gold: 5, enabled: true }],
    history: [],
    dailyBudget: 500,
    previousEntry: { date: '2026-08-06', expGained: 22, goldGained: 5 },
    lastSettlementDate: '2026-08-06',
    character: { attributes: { health: 10, energy: 0, growth: 10 }, equipped: {} },
    randomValue: 0.99
  });

  assert.equal(result.isDuplicate, true);
  assert.deepEqual(result.rewards, { xp: 0, gold: 0, attributes: {} });
  assert.equal(result.damage, 0);
});

test('SettlementEngine exposes a newly matched Boss rule on a same-day correction exactly once', () => {
  const baseInput = {
    entry: {
      date: '2026-08-06',
      sleep: 8,
      water: 2000,
      exercise: 30,
      expense: 100,
      impulse: 5,
      accounting: true
    },
    rules: [{
      id: 'sugar-boss',
      type: 'boss',
      metric: 'impulse',
      operator: '>=',
      targetValue: 5,
      aggregate: 'sum',
      period: 'weekly',
      enabled: true
    }],
    history: [],
    dailyBudget: 500,
    lastSettlementDate: '2026-08-06',
    character: { attributes: { health: 10, energy: 0, growth: 10 }, equipped: {} },
    randomValue: 0.99
  };

  const firstMatch = SettlementEngine.calculate({
    ...baseInput,
    previousEntry: {
      date: '2026-08-06',
      impulse: 0,
      triggeredBossRuleIds: []
    }
  });
  const repeatedMatch = SettlementEngine.calculate({
    ...baseInput,
    previousEntry: {
      date: '2026-08-06',
      impulse: 5,
      triggeredBossRuleIds: ['sugar-boss']
    }
  });

  assert.equal(firstMatch.isDuplicate, true);
  assert.deepEqual(firstMatch.rewards, { xp: 0, gold: 0, attributes: {} });
  assert.equal(firstMatch.damage, 0);
  assert.deepEqual(firstMatch.newTriggeredBossRuleIds, ['sugar-boss']);
  assert.deepEqual(repeatedMatch.newTriggeredBossRuleIds, []);
});

test('AchievementEngine unlocks a metric streak only for consecutive calendar dates', () => {
  const definition = {
    id: 'healthy_heart',
    title: '養生達人',
    unlocked: false,
    progress: 0,
    target: 3,
    condition: {
      kind: 'metric_consecutive',
      conditions: [
        { metric: 'sleep', operator: '>=', targetValue: 7 },
        { metric: 'water', operator: '>=', targetValue: 2000 }
      ]
    }
  };

  const withGap = AchievementEngine.evaluate({
    achievements: [definition],
    history: [
      { date: '2026-08-02', sleep: 8, water: 2200 },
      { date: '2026-08-04', sleep: 8, water: 2200 },
      { date: '2026-08-05', sleep: 8, water: 2200 }
    ],
    today: '2026-08-05'
  });
  const consecutive = AchievementEngine.evaluate({
    achievements: [definition],
    history: [
      { date: '2026-08-03', sleep: 8, water: 2200 },
      { date: '2026-08-04', sleep: 8, water: 2200 },
      { date: '2026-08-05', sleep: 8, water: 2200 }
    ],
    today: '2026-08-05'
  });

  assert.equal(withGap.achievements[0].progress, 2);
  assert.equal(withGap.achievements[0].unlocked, false);
  assert.deepEqual(withGap.newlyUnlockedIds, []);
  assert.equal(consecutive.achievements[0].unlocked, true);
  assert.equal(consecutive.achievements[0].unlockedAt, '2026-08-05');
  assert.deepEqual(consecutive.newlyUnlockedIds, ['healthy_heart']);
});

test('AchievementEngine does not unlock or reward an achievement twice', () => {
  const result = AchievementEngine.evaluate({
    achievements: [{
      id: 'gold_hoarder',
      unlocked: true,
      progress: 100,
      target: 100,
      condition: { kind: 'character_value', field: 'savings' }
    }],
    character: { savings: 150 },
    today: '2026-08-06'
  });

  assert.equal(result.achievements[0].unlocked, true);
  assert.deepEqual(result.newlyUnlockedIds, []);
});

test('HabitEngine calculates auditable good and bad habit effects', () => {
  const good = HabitEngine.createEvent({
    id: 'event-good',
    habit: { id: 'h2', title: '有氧運動', direction: 'good', count: 2, dailyCounts: { '2026-08-06': 1 } },
    date: '2026-08-06',
    character: { attributes: { growth: 10 }, equipped: { pet: 'pet_cactus' } },
    boss: { active: true },
    createdAt: '2026-08-06T10:00:00.000Z'
  });
  const bad = HabitEngine.createEvent({
    id: 'event-bad',
    habit: { id: 'h4', title: '垃圾食物', direction: 'bad', count: 0, dailyCounts: {} },
    date: '2026-08-06',
    character: { attributes: { growth: 10 }, equipped: { armor: 'armor_shield' } },
    boss: { active: false },
    createdAt: '2026-08-06T10:01:00.000Z'
  });

  assert.deepEqual(good.effect, { xp: 5, gold: 3, hp: 0, bossDamage: 0 });
  assert.equal(good.beforeCount, 2);
  assert.equal(good.beforeDailyCount, 1);
  assert.deepEqual(bad.effect, { xp: 0, gold: 0, hp: -3, bossDamage: 0 });
});

test('HabitEngine cannot damage an active Boss by repeatedly reporting a generic good habit', () => {
  const event = HabitEngine.createEvent({
    id: 'repeat-water',
    habit: {
      id: 'h1',
      title: '多喝水 500ml',
      direction: 'good',
      count: 20,
      dailyCounts: { '2026-08-15': 20 }
    },
    date: '2026-08-15',
    character: { attributes: { growth: 10 }, equipped: {} },
    boss: { active: true, id: 'sleep-nightmare', hp: 100 }
  });

  assert.equal(event.effect.bossDamage, 0);
});

test('HabitEngine undoes only the latest unchanged event and marks it reversed', () => {
  const beforeState = {
    character: { xp: 40, gold: 80, hp: 50 },
    boss: { active: true, hp: 10 },
    bossHistory: [],
    meta: { processedBossIncidentKeys: [] },
    achievements: [{ id: 'gym_rat', unlocked: false }],
    tasks: [{ id: 'h2', count: 1, dailyCounts: { '2026-08-06': 1 } }],
    habitEvents: []
  };
  const beforeSnapshot = HabitEngine.captureSnapshot(beforeState);
  const afterState = JSON.parse(JSON.stringify(beforeState));
  afterState.character.xp = 45;
  afterState.character.gold = 82;
  afterState.boss.hp = 6;
  afterState.bossHistory.push({
    incidentKey: 'fried-rule:2026-08-06',
    bossId: 'fried-food-beast'
  });
  afterState.meta.processedBossIncidentKeys.push('fried-rule:2026-08-06');
  afterState.tasks[0].count = 2;
  afterState.tasks[0].dailyCounts['2026-08-06'] = 2;
  const event = {
    id: 'event-1',
    habitId: 'h2',
    title: '有氧運動',
    date: '2026-08-06',
    beforeCount: 1,
    beforeDailyCount: 1,
    beforeSnapshot,
    afterSnapshot: HabitEngine.captureSnapshot(afterState),
    reversedAt: null
  };
  afterState.habitEvents.push(event);

  const result = HabitEngine.undo({
    state: afterState,
    eventId: 'event-1',
    reversedAt: '2026-08-06T10:05:00.000Z'
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.state.character, beforeState.character);
  assert.equal(result.state.tasks[0].count, 1);
  assert.equal(result.state.tasks[0].dailyCounts['2026-08-06'], 1);
  assert.deepEqual(result.state.bossHistory, []);
  assert.deepEqual(result.state.meta.processedBossIncidentKeys, []);
  assert.equal(result.state.habitEvents[0].reversedAt, '2026-08-06T10:05:00.000Z');
  assert.equal(HabitEngine.undo({ state: result.state, eventId: 'event-1' }).reason, 'already_reversed');
});

test('EquipmentEngine replaces slot bonuses and re-equipping does not stack attributes', () => {
  const items = [
    { id: 'wood_sword', type: 'weapon', attr: { energy: 2 } },
    { id: 'focus_staff', type: 'weapon', attr: { energy: 1, growth: 3 } }
  ];
  const character = {
    attributes: { health: 10, energy: 10, wealth: 10, growth: 10 },
    equipped: { weapon: null, armor: null, pet: null }
  };

  const first = EquipmentEngine.equip({ character, items, itemId: 'wood_sword' });
  const repeated = EquipmentEngine.equip({ character: first.character, items, itemId: 'wood_sword' });
  const replaced = EquipmentEngine.equip({ character: repeated.character, items, itemId: 'focus_staff' });

  assert.equal(first.character.attributes.energy, 12);
  assert.equal(repeated.changed, false);
  assert.equal(repeated.character.attributes.energy, 12);
  assert.deepEqual(replaced.character.attributes, {
    health: 10,
    energy: 11,
    wealth: 10,
    growth: 13
  });
  assert.equal(replaced.character.equipped.weapon, 'focus_staff');
  assert.equal(replaced.previousItemId, 'wood_sword');
});

test('SupplyEngine buys unique equipment once and later re-equips it without charging again', () => {
  const items = [
    { id: 'wood_sword', type: 'weapon', title: '木劍', cost: 60, attr: { energy: 2 } },
    { id: 'focus_staff', type: 'weapon', title: '專注法杖', cost: 80, attr: { growth: 3 } }
  ];
  const initial = {
    character: { gold: 200, attributes: { energy: 10, growth: 10 }, equipped: {} },
    inventory: [],
    transactions: []
  };

  const boughtSword = SupplyEngine.acquire({
    ...initial,
    items,
    itemId: 'wood_sword',
    transactionId: 'trade-1',
    purchasedAt: '2026-08-15T08:00:00.000Z'
  });
  const boughtStaff = SupplyEngine.acquire({
    character: boughtSword.character,
    inventory: boughtSword.inventory,
    transactions: boughtSword.transactions,
    items,
    itemId: 'focus_staff',
    transactionId: 'trade-2',
    purchasedAt: '2026-08-15T08:01:00.000Z'
  });
  const reequippedSword = SupplyEngine.acquire({
    character: boughtStaff.character,
    inventory: boughtStaff.inventory,
    transactions: boughtStaff.transactions,
    items,
    itemId: 'wood_sword',
    transactionId: 'trade-3',
    purchasedAt: '2026-08-15T08:02:00.000Z'
  });

  assert.equal(boughtSword.character.gold, 140);
  assert.deepEqual(boughtStaff.inventory, ['wood_sword', 'focus_staff']);
  assert.equal(reequippedSword.character.gold, 60);
  assert.equal(reequippedSword.character.equipped.weapon, 'wood_sword');
  assert.deepEqual(reequippedSword.character.attributes, { energy: 12, growth: 10 });
  assert.equal(reequippedSword.transactions.length, 2);
  assert.equal(reequippedSword.reason, 'equipped_owned');
});

test('SupplyEngine rejects insufficient funds and duplicate transaction ids without changing resources', () => {
  const item = { id: 'iron_shield', type: 'armor', title: '鐵盾', cost: 80, attr: { health: 3 } };
  const first = SupplyEngine.acquire({
    character: { gold: 100, attributes: { health: 10 }, equipped: {} },
    inventory: [],
    transactions: [],
    items: [item],
    itemId: item.id,
    transactionId: 'trade-same',
    purchasedAt: '2026-08-15T09:00:00.000Z'
  });
  const duplicate = SupplyEngine.acquire({
    character: first.character,
    inventory: first.inventory,
    transactions: first.transactions,
    items: [item],
    itemId: item.id,
    transactionId: 'trade-same',
    purchasedAt: '2026-08-15T09:00:01.000Z'
  });
  const insufficient = SupplyEngine.acquire({
    character: { gold: 10, attributes: { health: 10 }, equipped: {} },
    inventory: [],
    transactions: [],
    items: [item],
    itemId: item.id,
    transactionId: 'trade-low'
  });

  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.reason, 'duplicate_transaction');
  assert.equal(duplicate.character.gold, 20);
  assert.equal(insufficient.ok, false);
  assert.equal(insufficient.reason, 'insufficient_gold');
  assert.equal(insufficient.character.gold, 10);
  assert.deepEqual(insufficient.inventory, []);
});

test('DailyGemEngine grants one gem only once when every daily rule is completed', () => {
  const first = DailyGemEngine.grantPerfectDay({
    character: { gems: 2 },
    transactions: [],
    date: '2026-08-15',
    completedCount: 4,
    totalRuleCount: 4,
    transactionId: 'perfect-2026-08-15'
  });
  const repeated = DailyGemEngine.grantPerfectDay({
    character: first.character,
    transactions: first.transactions,
    date: '2026-08-15',
    completedCount: 4,
    totalRuleCount: 4,
    transactionId: 'perfect-2026-08-15-repeat'
  });
  const incomplete = DailyGemEngine.grantPerfectDay({
    character: repeated.character,
    transactions: repeated.transactions,
    date: '2026-08-16',
    completedCount: 3,
    totalRuleCount: 4,
    transactionId: 'perfect-2026-08-16'
  });

  assert.equal(first.granted, 1);
  assert.equal(first.character.gems, 3);
  assert.equal(repeated.granted, 0);
  assert.equal(repeated.reason, 'already_granted');
  assert.equal(incomplete.granted, 0);
  assert.equal(incomplete.reason, 'not_perfect');
});

test('RewardTicketEngine records redemption, use, and refunds only an unused ticket', () => {
  const catalog = [{ id: 'rest_30', title: '短暫休憩券', cost: 3, description: '休息30分鐘' }];
  const redeemed = RewardTicketEngine.redeem({
    character: { gems: 5 },
    tickets: [],
    transactions: [],
    catalog,
    ticketId: 'rest_30',
    transactionId: 'gem-trade-1',
    redeemedAt: '2026-08-15T10:00:00.000Z'
  });
  const duplicated = RewardTicketEngine.redeem({
    character: redeemed.character,
    tickets: redeemed.tickets,
    transactions: redeemed.transactions,
    catalog,
    ticketId: 'rest_30',
    transactionId: 'gem-trade-1',
    redeemedAt: '2026-08-15T10:00:01.000Z'
  });
  const refunded = RewardTicketEngine.reverse({
    character: redeemed.character,
    tickets: redeemed.tickets,
    transactions: redeemed.transactions,
    ownedTicketId: redeemed.ticket.id,
    reversedAt: '2026-08-15T10:05:00.000Z'
  });
  const used = RewardTicketEngine.use({
    tickets: redeemed.tickets,
    ownedTicketId: redeemed.ticket.id,
    usedAt: '2026-08-15T10:10:00.000Z'
  });
  const usedRefund = RewardTicketEngine.reverse({
    character: redeemed.character,
    tickets: used.tickets,
    transactions: redeemed.transactions,
    ownedTicketId: redeemed.ticket.id,
    reversedAt: '2026-08-15T10:11:00.000Z'
  });

  assert.equal(redeemed.character.gems, 2);
  assert.deepEqual(
    redeemed.ticket,
    {
      id: 'reward-ticket-gem-trade-1',
      catalogId: 'rest_30',
      nameSnapshot: '短暫休憩券',
      descriptionSnapshot: '休息30分鐘',
      costSnapshot: 3,
      status: 'unused',
      redeemedAt: '2026-08-15T10:00:00.000Z',
      usedAt: null,
      reversedAt: null,
      transactionId: 'gem-trade-1'
    }
  );
  assert.equal(duplicated.reason, 'duplicate_transaction');
  assert.equal(refunded.character.gems, 5);
  assert.equal(refunded.ticket.status, 'reversed');
  assert.equal(used.ticket.status, 'used');
  assert.equal(usedRefund.reason, 'already_used');
});

test('RewardTicketEngine blocks redemption when gems are insufficient', () => {
  const result = RewardTicketEngine.redeem({
    character: { gems: 2 },
    tickets: [],
    transactions: [],
    catalog: [{ id: 'drink', title: '喜愛飲品券', cost: 5 }],
    ticketId: 'drink',
    transactionId: 'gem-low'
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'insufficient_gems');
  assert.equal(result.character.gems, 2);
  assert.deepEqual(result.tickets, []);
});

test('ProfessionEngine changes identity without changing character attributes', () => {
  const character = { class: '戰士', attributes: { health: 12, energy: 9 } };
  const result = ProfessionEngine.setIdentity({ character, profession: '法師' });
  const invalid = ProfessionEngine.setIdentity({ character: result.character, profession: '龍騎士' });
  assert.equal(result.character.class, '法師');
  assert.deepEqual(result.character.attributes, { health: 12, energy: 9 });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.reason, 'invalid_profession');
});

test('AchievementEngine calculates the savings medal from real budget-success days', () => {
  const result = AchievementEngine.evaluate({
    achievements: [{
      id: 'gold_hoarder',
      title: '金庫守望者',
      target: 3,
      unlocked: false,
      condition: { kind: 'budget_success_days' }
    }],
    history: [
      { date: '2026-08-13', expense: 450, impulse: 0, budgetLimitAtSettlement: 500 },
      { date: '2026-08-14', expense: 650, impulse: 0, budgetLimitAtSettlement: 500 },
      { date: '2026-08-15', expense: 300, impulse: 0, budgetLimitAtSettlement: 400 },
      { date: '2026-08-16', expense: 200, impulse: 1, budgetLimitAtSettlement: 400 },
      { date: '2026-08-17', expense: 400, impulse: 0, budgetLimitAtSettlement: 400 }
    ],
    today: '2026-08-17'
  });

  assert.equal(result.achievements[0].progress, 3);
  assert.equal(result.achievements[0].unlocked, true);
});

test('BossEngine applies damage, grants defeat rewards once, and ignores an inactive boss', () => {
  const character = { gold: 20, gems: 1 };
  const boss = { active: true, hp: 30, maxHp: 100, challenge: { progress: 1 } };

  const hit = BossEngine.damage({ boss, character, amount: 12 });
  const defeated = BossEngine.damage({ boss: hit.boss, character: hit.character, amount: 20 });
  const repeated = BossEngine.damage({ boss: defeated.boss, character: defeated.character, amount: 20 });

  assert.equal(hit.boss.hp, 18);
  assert.equal(hit.defeated, false);
  assert.deepEqual(hit.rewards, { gold: 0, gems: 0 });
  assert.equal(defeated.boss.hp, 0);
  assert.equal(defeated.boss.active, false);
  assert.equal(defeated.boss.challenge, null);
  assert.deepEqual(defeated.character, { gold: 170, gems: 4 });
  assert.deepEqual(defeated.rewards, { gold: 150, gems: 3 });
  assert.equal(repeated.applied, false);
  assert.deepEqual(repeated.character, { gold: 170, gems: 4 });
});

test('BossEngine summons a Boss entirely from its data definition', () => {
  const result = BossEngine.summon({
    boss: { active: false },
    definitions: [{
      id: 'sleep-nightmare',
      name: '睡眠夢魘 😴',
      icon: '😴',
      description: '連續睡眠不足形成的夢魘。',
      maxHp: 90,
      priority: 100,
      challenge: {
        title: '連續 3 天睡滿 7 小時',
        source: 'dailyLog',
        conditions: [{ metric: 'sleep', operator: '>=', targetValue: 7 }],
        target: 3
      }
    }],
    candidates: [{ ruleId: 'sleep-boss-rule', bossId: 'sleep-nightmare' }],
    today: '2026-08-06',
    processedIncidentKeys: []
  });

  assert.equal(result.summoned, true);
  assert.equal(result.boss.id, 'sleep-nightmare');
  assert.equal(result.boss.name, '睡眠夢魘 😴');
  assert.equal(result.boss.hp, 90);
  assert.equal(result.boss.icon, '😴');
  assert.equal(result.boss.challenge.progress, 0);
  assert.equal(result.boss.challenge.lastProgressDate, null);
  assert.deepEqual(result.processedIncidentKeys, ['sleep-boss-rule:2026-08-06']);
});

test('BossEngine advances a recovery challenge at most once per calendar date', () => {
  const boss = {
    id: 'sleep-nightmare',
    active: true,
    hp: 100,
    maxHp: 100,
    rewards: { gold: 150, gems: 3 },
    challenge: {
      source: 'dailyLog',
      conditions: [{ metric: 'sleep', operator: '>=', targetValue: 7 }],
      target: 3,
      progress: 0,
      lastProgressDate: null
    }
  };
  const character = { gold: 0, gems: 0, equipped: {} };

  const first = BossEngine.advanceChallenge({
    boss,
    character,
    entry: { date: '2026-08-06', sleep: 7.5 }
  });
  const repeated = BossEngine.advanceChallenge({
    boss: first.boss,
    character: first.character,
    entry: { date: '2026-08-06', sleep: 8 }
  });

  assert.equal(first.advanced, true);
  assert.equal(first.boss.challenge.progress, 1);
  assert.equal(first.boss.challenge.lastProgressDate, '2026-08-06');
  assert.equal(first.boss.hp, 66);
  assert.equal(repeated.advanced, false);
  assert.equal(repeated.reason, 'duplicate_date');
  assert.equal(repeated.boss.hp, 66);
});

test('BossEngine chooses the highest-priority Boss and consumes every simultaneous incident', () => {
  const definitions = [
    { id: 'low', name: '低優先 Boss', priority: 10, challenge: { target: 2 } },
    { id: 'high', name: '高優先 Boss', priority: 100, challenge: { target: 2 } }
  ];
  const candidates = [
    { ruleId: 'low-rule', bossId: 'low' },
    { ruleId: 'high-rule', bossId: 'high' }
  ];
  const first = BossEngine.summon({
    boss: { active: false },
    definitions,
    candidates,
    today: '2026-08-06',
    processedIncidentKeys: []
  });
  const repeated = BossEngine.summon({
    boss: { active: false },
    definitions,
    candidates,
    today: '2026-08-06',
    processedIncidentKeys: first.processedIncidentKeys
  });

  assert.equal(first.boss.id, 'high');
  assert.deepEqual(first.processedIncidentKeys.sort(), [
    'high-rule:2026-08-06',
    'low-rule:2026-08-06'
  ]);
  assert.equal(repeated.summoned, false);
});

test('BossEngine does not consume an incident when another Boss prevents the summon', () => {
  const result = BossEngine.summon({
    boss: { id: 'sleep-nightmare', active: true },
    definitions: [{ id: 'fried-food-beast', priority: 85, challenge: { target: 3 } }],
    candidates: [{ ruleId: 'rule_boss_fried_food', bossId: 'fried-food-beast' }],
    today: '2026-08-10',
    processedIncidentKeys: []
  });

  assert.equal(result.summoned, false);
  assert.deepEqual(result.processedIncidentKeys, []);
});

test('BossEngine does not count a missing or non-consecutive date toward challenge progress', () => {
  const boss = {
    active: true,
    hp: 100,
    maxHp: 100,
    challenge: {
      source: 'dailyLog',
      conditions: [{ metric: 'exercise', operator: '>=', targetValue: 30 }],
      target: 3,
      progress: 1,
      lastProgressDate: '2026-08-01'
    }
  };
  const character = { gold: 0, gems: 0, equipped: {} };
  const missing = BossEngine.advanceChallenge({
    boss,
    character,
    entry: { exercise: 30 }
  });
  const afterGap = BossEngine.advanceChallenge({
    boss,
    character,
    entry: { date: '2026-08-03', exercise: 30 }
  });

  assert.equal(missing.reason, 'missing_date');
  assert.equal(missing.boss.challenge.progress, 1);
  assert.equal(afterGap.advanced, true);
  assert.equal(afterGap.reset, true);
  assert.equal(afterGap.boss.challenge.progress, 1);
});

test('BossEngine grants challenge defeat rewards only once', () => {
  const boss = {
    active: true,
    hp: 100,
    maxHp: 100,
    rewards: { gold: 40, gems: 2 },
    challenge: {
      source: 'dailyLog',
      conditions: [{ metric: 'sugaryDrinks', operator: '==', targetValue: 0 }],
      target: 1,
      progress: 0,
      lastProgressDate: null
    }
  };
  const first = BossEngine.advanceChallenge({
    boss,
    character: { gold: 10, gems: 1, equipped: {} },
    entry: { date: '2026-08-06', sugaryDrinks: 0 }
  });
  const repeated = BossEngine.advanceChallenge({
    boss: first.boss,
    character: first.character,
    entry: { date: '2026-08-07', sugaryDrinks: 0 }
  });

  assert.equal(first.defeated, true);
  assert.deepEqual(first.character, { gold: 50, gems: 3, equipped: {} });
  assert.deepEqual(first.rewards, { gold: 40, gems: 2 });
  assert.equal(repeated.reason, 'inactive');
  assert.deepEqual(repeated.rewards, { gold: 0, gems: 0 });
  assert.deepEqual(repeated.character, first.character);
});

test('BossEngine evaluates a no-fried-food recovery day from habit events', () => {
  const boss = {
    active: true,
    hp: 100,
    maxHp: 100,
    challenge: {
      source: 'habitEvents',
      habitId: 'h4',
      operator: '==',
      targetValue: 0,
      target: 3,
      progress: 0,
      lastProgressDate: null
    }
  };
  const success = BossEngine.advanceChallenge({
    boss,
    character: { equipped: {} },
    entry: { date: '2026-08-06' },
    habitEvents: []
  });
  const failed = BossEngine.advanceChallenge({
    boss,
    character: { equipped: {} },
    entry: { date: '2026-08-06' },
    habitEvents: [{ id: 'fried', habitId: 'h4', date: '2026-08-06', reversedAt: null }]
  });

  assert.equal(success.advanced, true);
  assert.equal(success.boss.challenge.progress, 1);
  assert.equal(failed.reason, 'condition_failed');
  assert.equal(failed.boss.challenge.progress, 0);
});

test('StatusEffectEngine applies a debuff once without stacking duplicate penalties', () => {
  const input = {
    character: { attributes: { energy: 10 } },
    buffs: [],
    debuffs: [],
    effect: {
      id: 'sleep_deprived',
      type: 'debuff',
      title: '睡眠不足',
      duration: 2,
      attributes: { energy: -3 }
    }
  };

  const applied = StatusEffectEngine.apply(input);
  const repeated = StatusEffectEngine.apply({
    character: applied.character,
    buffs: applied.buffs,
    debuffs: applied.debuffs,
    effect: input.effect
  });

  assert.equal(applied.applied, true);
  assert.equal(applied.character.attributes.energy, 7);
  assert.deepEqual(applied.debuffs, [{
    id: 'sleep_deprived',
    title: '睡眠不足',
    remainingDays: 2,
    effect: { energy: -3 }
  }]);
  assert.equal(repeated.applied, false);
  assert.equal(repeated.character.attributes.energy, 7);
  assert.equal(repeated.debuffs.length, 1);
});

test('StatusEffectEngine counts down buffs and restores debuff attributes on expiry', () => {
  const firstDay = StatusEffectEngine.tick({
    character: { attributes: { energy: 7 } },
    buffs: [{ id: 'focused', title: '專注', remainingDays: 2 }],
    debuffs: [{ id: 'sleep_deprived', title: '睡眠不足', remainingDays: 2, effect: { energy: -3 } }]
  });
  const secondDay = StatusEffectEngine.tick({
    character: firstDay.character,
    buffs: firstDay.buffs,
    debuffs: firstDay.debuffs
  });

  assert.equal(firstDay.buffs[0].remainingDays, 1);
  assert.equal(firstDay.debuffs[0].remainingDays, 1);
  assert.equal(firstDay.character.attributes.energy, 7);
  assert.deepEqual(firstDay.expiredBuffIds, []);
  assert.deepEqual(firstDay.expiredDebuffIds, []);
  assert.deepEqual(secondDay.buffs, []);
  assert.deepEqual(secondDay.debuffs, []);
  assert.equal(secondDay.character.attributes.energy, 10);
  assert.deepEqual(secondDay.expiredBuffIds, ['focused']);
  assert.deepEqual(secondDay.expiredDebuffIds, ['sleep_deprived']);
});

test('StatusEffectEngine expires effects by calendar date even when days were not settled', () => {
  const applied = StatusEffectEngine.apply({
    character: { attributes: { energy: 10 } },
    buffs: [],
    debuffs: [],
    today: '2026-08-10',
    effect: {
      id: 'sleep_deprived',
      sourceRuleId: 'rule_3',
      type: 'debuff',
      title: '睡眠不足',
      duration: 2,
      attributes: { energy: -3 }
    }
  });
  const synchronized = StatusEffectEngine.tick({
    character: applied.character,
    buffs: applied.buffs,
    debuffs: applied.debuffs,
    today: '2026-08-15'
  });

  assert.equal(applied.debuffs[0].appliedOn, '2026-08-10');
  assert.equal(applied.debuffs[0].expiresOn, '2026-08-12');
  assert.deepEqual(applied.statusEvent, {
    effectId: 'sleep_deprived',
    sourceRuleId: 'rule_3',
    type: 'debuff',
    title: '睡眠不足',
    event: 'applied',
    date: '2026-08-10'
  });
  assert.deepEqual(synchronized.debuffs, []);
  assert.equal(synchronized.character.attributes.energy, 10);
  assert.deepEqual(synchronized.expiredDebuffIds, ['sleep_deprived']);
});

test('Insights builds the status appendix from recorded status events', () => {
  const result = Insights.calculate(
    [{ date: '2026-08-15', sleep: 7, expense: 0, impulse: 0 }],
    'weekly',
    '2026-08-15',
    {
      dailyBudget: 500,
      statusHistory: [
        { effectId: 'focus', type: 'buff', title: '精神飽滿', event: 'applied', date: '2026-08-13' },
        { effectId: 'focus', type: 'buff', title: '精神飽滿', event: 'applied', date: '2026-08-15' },
        { effectId: 'fatigue', type: 'debuff', title: '睡眠不足', event: 'applied', date: '2026-08-14' },
        { effectId: 'old', type: 'buff', title: '過期樣本', event: 'applied', date: '2026-07-01' }
      ]
    }
  );

  assert.deepEqual(result.topBuffs, [
    { id: 'focus', name: '精神飽滿', count: 2 },
    { id: 'old', name: '過期樣本', count: 1 }
  ]);
  assert.deepEqual(result.topDebuffs, [{ id: 'fatigue', name: '睡眠不足', count: 1 }]);
});

test('AchievementRewardEngine grants gems for a new unlock exactly once', () => {
  const achievements = [{
    id: 'boss_slayer',
    title: '巨獸獵人',
    unlocked: false,
    progress: 0,
    target: 1,
    condition: { kind: 'context_flag', flag: 'bossDefeated' }
  }];

  const first = AchievementRewardEngine.evaluateAndGrant({
    achievements,
    character: { gems: 2 },
    flags: { bossDefeated: true },
    today: '2026-08-06'
  });
  const repeated = AchievementRewardEngine.evaluateAndGrant({
    achievements: first.achievements,
    character: first.character,
    flags: { bossDefeated: true },
    today: '2026-08-06'
  });

  assert.deepEqual(first.newlyUnlockedIds, ['boss_slayer']);
  assert.equal(first.gemsGranted, 5);
  assert.equal(first.character.gems, 7);
  assert.deepEqual(repeated.newlyUnlockedIds, []);
  assert.equal(repeated.gemsGranted, 0);
  assert.equal(repeated.character.gems, 7);
});
