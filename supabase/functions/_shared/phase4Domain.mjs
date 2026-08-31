const assertSafeNonNegativeInteger = (value, label) => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer`);
  }
  return value;
};

const assertPositiveInteger = (value, label) => {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${label} must be a positive safe integer`);
  }
  return value;
};

const parseBusinessDate = (value, label = 'businessDate') => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new TypeError(`${label} must use YYYY-MM-DD`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new RangeError(`${label} is not a valid calendar date`);
  }
  return date;
};

const deepFreeze = value => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
};

export const PHASE4_DEFINITION_VERSIONS = deepFreeze({
  engine: 'phase4-v1',
  rules: 'rules-v1',
  habits: 'habits-v1',
  bosses: 'bosses-v1',
  achievements: 'achievements-v1',
  levelCurve: 'level-v1'
});

export const PHASE4_SYSTEM_HABITS = deepFreeze({
  hydration: { key: 'hydration', title: '多喝水 500ml', direction: 'good' },
  exercise_training: { key: 'exercise_training', title: '有氧運動 10 分鐘', direction: 'good' },
  skill_practice: { key: 'skill_practice', title: '寫程式／練習技能', direction: 'good' },
  fried_food: { key: 'fried_food', title: '吃油炸垃圾食物', direction: 'bad' },
  impulse_purchase: { key: 'impulse_purchase', title: '衝動購物／亂花錢', direction: 'bad' },
  sedentary_screen: { key: 'sedentary_screen', title: '久坐不起滑手機', direction: 'bad' }
});

export const PHASE4_HABIT_POLICIES = deepFreeze({
  hydration: { maxDailyReports: 12, maxDailyRewards: 4 },
  exercise_training: { maxDailyReports: 12, maxDailyRewards: 3 },
  skill_practice: { maxDailyReports: 8, maxDailyRewards: 1 },
  fried_food: { maxDailyReports: 10, maxDailyRewards: 0 },
  impulse_purchase: { maxDailyReports: 10, maxDailyRewards: 0 },
  sedentary_screen: { maxDailyReports: 12, maxDailyRewards: 0 },
  custom_good: { maxDailyReports: 10, maxDailyRewards: 1 },
  custom_bad: { maxDailyReports: 10, maxDailyRewards: 0 }
});

export const PHASE4_RULE_DEFINITIONS = deepFreeze({
  rule_1: {
    kind: 'daily_reward', conditions: [{ metric: 'sleep', operator: '>=', value: 7 }],
    reward: { xp: 20, gold: 5, stats: { energy: 2 } }, statusKey: 'mental_full'
  },
  rule_2: {
    kind: 'daily_reward', conditions: [
      { metric: 'expense', operator: '<=', profileValue: 'dailyBudget' },
      { metric: 'impulse', operator: '==', value: 0 }
    ],
    reward: { xp: 15, gold: 10, stats: { wealth: 2 } }
  },
  rule_water: {
    kind: 'daily_reward', conditions: [{ metric: 'water', operator: '>=', value: 2000 }],
    reward: { xp: 10, gold: 5, stats: { health: 1 } }
  },
  rule_exercise: {
    kind: 'daily_reward', conditions: [{ metric: 'exercise', operator: '>=', value: 30 }],
    reward: { xp: 15, gold: 5, stats: { energy: 1 } }
  },
  rule_5: {
    kind: 'daily_reward', conditions: [{ metric: 'study', operator: '>=', value: 30 }],
    reward: { xp: 15, gold: 5, stats: { growth: 2 } }
  },
  rule_3: {
    kind: 'status', consecutiveDays: 2,
    conditions: [{ metric: 'sleep', operator: '<', value: 6 }],
    statusKey: 'sleep_deprivation'
  },
  rule_boss_sleep: {
    kind: 'boss_incident', consecutiveDays: 3,
    conditions: [{ metric: 'sleep', operator: '<', value: 5 }], bossKey: 'sleep-nightmare'
  },
  rule_boss_lazy: {
    kind: 'boss_incident', consecutiveDays: 3,
    conditions: [{ metric: 'exercise', operator: '<', value: 15 }], bossKey: 'laziness-beast'
  },
  rule_boss_budget: {
    kind: 'boss_incident', periodDays: 7, aggregate: 'sum',
    conditions: [{ metric: 'expense', operator: '>', profileValue: 'weeklyBudget' }],
    bossKey: 'budget-vampire'
  },
  rule_boss_fried_food: {
    kind: 'boss_incident', periodDays: 7, aggregate: 'count',
    habitKey: 'fried_food', operator: '>=', value: 3, bossKey: 'fried-food-beast'
  },
  rule_4: {
    kind: 'boss_incident', periodDays: 7, aggregate: 'sum',
    conditions: [{ metric: 'sugaryDrinks', operator: '>=', value: 5 }], bossKey: 'sugar-monster'
  },
  rule_6: {
    kind: 'achievement', consecutiveDays: 3,
    conditions: [{ metric: 'exercise', operator: '>=', value: 30 }],
    achievementCode: 'exercise_streak_3'
  }
});

export const PHASE4_STATUS_DEFINITIONS = deepFreeze({
  mental_full: {
    key: 'mental_full', title: '精神飽滿', effectType: 'buff',
    modifiers: { energy: 2 }, durationDays: 1, definitionVersion: 'rules-v1'
  },
  sleep_deprivation: {
    key: 'sleep_deprivation', title: '睡眠不足', effectType: 'debuff',
    modifiers: { energy: -3 }, durationDays: 1, definitionVersion: 'rules-v1'
  },
  vitality: {
    key: 'vitality', title: '活力充沛', effectType: 'buff',
    modifiers: {}, durationDays: 2, definitionVersion: 'achievements-v1'
  }
});

export const PHASE4_BOSS_DEFINITIONS = deepFreeze({
  'sleep-nightmare': {
    key: 'sleep-nightmare', name: '睡眠夢魘', maxHp: 100, priority: 100,
    challenge: { source: 'daily_entry', targetDays: 3, conditions: [{ metric: 'sleep', operator: '>=', value: 7 }] },
    reward: { gold: 150, gems: 3 }
  },
  'budget-vampire': {
    key: 'budget-vampire', name: '預算吸血鬼', maxHp: 100, priority: 90,
    challenge: { source: 'daily_entry', targetDays: 3, conditions: [
      { metric: 'expense', operator: '<=', profileValue: 'dailyBudget' },
      { metric: 'impulse', operator: '==', value: 0 }
    ] }, reward: { gold: 150, gems: 3 }
  },
  'fried-food-beast': {
    key: 'fried-food-beast', name: '油炸暴食獸', maxHp: 100, priority: 85,
    challenge: { source: 'habit_event', targetDays: 3, habitKey: 'fried_food', operator: '==', value: 0 },
    reward: { gold: 150, gems: 3 }
  },
  'laziness-beast': {
    key: 'laziness-beast', name: '怠惰巨獸', maxHp: 100, priority: 80,
    challenge: { source: 'daily_entry', targetDays: 3, conditions: [{ metric: 'exercise', operator: '>=', value: 30 }] },
    reward: { gold: 150, gems: 3 }
  },
  'sugar-monster': {
    key: 'sugar-monster', name: '糖分魔獸', maxHp: 100, priority: 75,
    challenge: { source: 'daily_entry', targetDays: 3, conditions: [{ metric: 'sugaryDrinks', operator: '==', value: 0 }] },
    reward: { gold: 150, gems: 3 }
  }
});

export const PHASE4_ACHIEVEMENT_DEFINITIONS = deepFreeze({
  exercise_streak_3: {
    code: 'exercise_streak_3',
    sourceHabitKey: 'exercise_training',
    target: { consecutiveDays: 3 },
    reward: {
      gems: 5,
      status: { key: 'vitality', title: '活力充沛', durationDays: 2 }
    },
    definitionVersion: PHASE4_DEFINITION_VERSIONS.achievements
  },
  gym_rat: {
    code: 'gym_rat',
    sourceHabitKey: 'exercise_training',
    target: { dailyReports: 5 },
    reward: {},
    definitionVersion: PHASE4_DEFINITION_VERSIONS.achievements
  },
  boss_slayer: {
    code: 'boss_slayer',
    target: { bossDefeats: 1 },
    reward: { gems: 5 },
    definitionVersion: PHASE4_DEFINITION_VERSIONS.achievements
  }
});

export const RESOURCE_TYPES = deepFreeze([
  'xp', 'hp', 'gold', 'gems', 'health', 'energy', 'wealth', 'growth'
]);

export const RESOURCE_REASONS = deepFreeze([
  'daily_reward', 'daily_failure', 'habit_reward', 'habit_damage',
  'death_penalty', 'boss_reward', 'achievement_reward', 'reversal'
]);

export function levelThreshold(level) {
  const normalizedLevel = assertPositiveInteger(level, 'level');
  const threshold = 25 * (normalizedLevel - 1) * normalizedLevel;
  if (!Number.isSafeInteger(threshold)) throw new RangeError('level threshold exceeds safe integer range');
  return threshold;
}

export function levelFromTotalXp(totalXp) {
  const xp = assertSafeNonNegativeInteger(totalXp, 'totalXp');
  let low = 1;
  let high = 2;
  while (levelThreshold(high) <= xp) {
    low = high;
    high *= 2;
    if (!Number.isSafeInteger(high) || high > 9_000_000) {
      throw new RangeError('totalXp exceeds level-v1 supported range');
    }
  }
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if (levelThreshold(middle) <= xp) low = middle;
    else high = middle;
  }
  return low;
}

export function maxHpFromTotalXp(totalXp, { baseMaxHp = 50, hpPerLevel = 5 } = {}) {
  assertPositiveInteger(baseMaxHp, 'baseMaxHp');
  assertSafeNonNegativeInteger(hpPerLevel, 'hpPerLevel');
  const maxHp = baseMaxHp + (levelFromTotalXp(totalXp) - 1) * hpPerLevel;
  if (!Number.isSafeInteger(maxHp)) throw new RangeError('derived max HP exceeds safe integer range');
  return maxHp;
}

export function previewXpGrant({ totalXp, xpGain, currentHp, baseStats }) {
  const beforeXp = assertSafeNonNegativeInteger(totalXp, 'totalXp');
  const gain = assertSafeNonNegativeInteger(xpGain, 'xpGain');
  assertSafeNonNegativeInteger(currentHp, 'currentHp');
  const normalizedStats = Object.fromEntries(
    ['health', 'energy', 'wealth', 'growth'].map(key => [
      key,
      assertPositiveInteger(baseStats?.[key], `baseStats.${key}`)
    ])
  );
  const finalXp = beforeXp + gain;
  if (!Number.isSafeInteger(finalXp)) throw new RangeError('final totalXp exceeds safe integer range');
  const previousLevel = levelFromTotalXp(beforeXp);
  const level = levelFromTotalXp(finalXp);
  const levelsGained = level - previousLevel;
  const maxHp = maxHpFromTotalXp(finalXp);
  return {
    totalXp: finalXp,
    previousLevel,
    level,
    levelsGained,
    maxHp,
    hp: levelsGained > 0 ? maxHp : Math.min(currentHp, maxHp),
    baseStats: Object.fromEntries(
      Object.entries(normalizedStats).map(([key, value]) => [key, value + levelsGained])
    )
  };
}

export function previewDeath({ totalXp, hp, gold, activeStatusIds = [] }) {
  assertSafeNonNegativeInteger(totalXp, 'totalXp');
  assertSafeNonNegativeInteger(hp, 'hp');
  assertSafeNonNegativeInteger(gold, 'gold');
  if (!Array.isArray(activeStatusIds) || activeStatusIds.some(id => typeof id !== 'string')) {
    throw new TypeError('activeStatusIds must be an array of strings');
  }
  if (hp > 0) return { died: false, hp, gold, goldLost: 0, clearedStatusIds: [] };
  const goldLost = Math.floor(gold * 0.15);
  return {
    died: true,
    hp: maxHpFromTotalXp(totalXp),
    gold: gold - goldLost,
    goldLost,
    clearedStatusIds: [...activeStatusIds]
  };
}

export function classifyTemporalContext({ businessDate, serverBusinessDate, statusExpiresOn = null }) {
  const requested = parseBusinessDate(businessDate);
  const today = parseBusinessDate(serverBusinessDate, 'serverBusinessDate');
  const daysAgo = Math.round((today.getTime() - requested.getTime()) / 86_400_000);
  if (daysAgo < 0) throw new RangeError('future businessDate is not allowed');
  if (daysAgo > 7) throw new RangeError('businessDate exceeds the seven-day backfill window');
  let statusHistoricalOnly = false;
  if (statusExpiresOn !== null) {
    statusHistoricalOnly = parseBusinessDate(statusExpiresOn, 'statusExpiresOn') <= today;
  }
  return {
    daysAgo,
    isToday: daysAgo === 0,
    isBackfill: daysAgo > 0,
    allowHabitEvent: daysAgo === 0,
    allowCurrentBossMutation: daysAgo === 0,
    statusHistoricalOnly
  };
}

export function createHabitSnapshot({ title, direction, systemKey = null, customHabitId = null, policy }) {
  if (typeof title !== 'string' || title.trim().length < 1 || title.trim().length > 80) {
    throw new RangeError('habit title must contain 1-80 characters');
  }
  if (!['good', 'bad'].includes(direction)) throw new RangeError('habit direction must be good or bad');
  const isSystem = typeof systemKey === 'string' && systemKey.length > 0 && customHabitId === null;
  const isCustom = typeof customHabitId === 'string' && customHabitId.length > 0 && systemKey === null;
  if (!isSystem && !isCustom) throw new TypeError('habit must have exactly one stable identity');
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) throw new TypeError('policy must be an object');
  return deepFreeze({
    title: title.trim(), direction, systemKey, customHabitId,
    policy: structuredClone(policy),
    definitionVersion: PHASE4_DEFINITION_VERSIONS.habits
  });
}

export function createDefinitionStamp() {
  return { ...PHASE4_DEFINITION_VERSIONS };
}

const addBusinessDays = (value, amount) => {
  const date = parseBusinessDate(value);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
};

const compare = (actual, operator, expected) => {
  if (operator === '>=') return actual >= expected;
  if (operator === '<=') return actual <= expected;
  if (operator === '>') return actual > expected;
  if (operator === '<') return actual < expected;
  if (operator === '==') return actual === expected;
  throw new RangeError(`unsupported operator ${operator}`);
};

const normalizePlayer = player => ({
  totalXp: assertSafeNonNegativeInteger(Number(player?.totalXp), 'player.totalXp'),
  hp: assertSafeNonNegativeInteger(Number(player?.hp), 'player.hp'),
  gold: assertSafeNonNegativeInteger(Number(player?.gold), 'player.gold'),
  gems: assertSafeNonNegativeInteger(Number(player?.gems), 'player.gems'),
  baseStats: Object.fromEntries(['health', 'energy', 'wealth', 'growth'].map(key => [
    key,
    assertPositiveInteger(Number(player?.baseStats?.[key]), `player.baseStats.${key}`)
  ]))
});

export function applyAuthoritativeResourceEffects({ player, effects = {}, activeStatusIds = [] }) {
  const before = normalizePlayer(player);
  const xpGain = Math.max(0, Math.trunc(Number(effects.xp) || 0));
  const xp = previewXpGrant({
    totalXp: before.totalXp,
    xpGain,
    currentHp: before.hp,
    baseStats: before.baseStats
  });
  const directStats = effects.stats && typeof effects.stats === 'object' ? effects.stats : {};
  const stats = Object.fromEntries(Object.entries(xp.baseStats).map(([key, value]) => [
    key,
    Math.max(1, value + Math.trunc(Number(directStats[key]) || 0))
  ]));
  const gold = before.gold + Math.trunc(Number(effects.gold) || 0);
  const gems = before.gems + Math.trunc(Number(effects.gems) || 0);
  if (gold < 0 || gems < 0) throw new RangeError('resource effect would create a negative balance');
  let hp = Math.min(xp.hp, xp.maxHp);
  hp = Math.max(0, Math.min(xp.maxHp, hp + Math.trunc(Number(effects.hp) || 0)));
  const death = previewDeath({ totalXp: xp.totalXp, hp, gold, activeStatusIds });
  const after = {
    totalXp: xp.totalXp,
    hp: death.hp,
    gold: death.gold,
    gems,
    baseStats: stats,
    level: xp.level,
    maxHp: xp.maxHp
  };
  return {
    before,
    after,
    levelsGained: xp.levelsGained,
    died: death.died,
    goldLost: death.goldLost,
    clearedStatusIds: death.clearedStatusIds,
    deltas: {
      xp: after.totalXp - before.totalXp,
      hp: after.hp - before.hp,
      gold: after.gold - before.gold,
      gems: after.gems - before.gems,
      health: after.baseStats.health - before.baseStats.health,
      energy: after.baseStats.energy - before.baseStats.energy,
      wealth: after.baseStats.wealth - before.baseStats.wealth,
      growth: after.baseStats.growth - before.baseStats.growth
    }
  };
}

export function buildHabitEventPlan({
  habit,
  player,
  businessDate,
  serverBusinessDate,
  sameDayReports = 0,
  sameDayRewards = 0,
  activeStatusIds = [],
  recentFriedFoodReports = 0,
  hasActiveBoss = false,
  incidentAlreadyExists = false,
  achievementCodes = []
}) {
  const temporal = classifyTemporalContext({ businessDate, serverBusinessDate });
  if (!temporal.allowHabitEvent) throw new RangeError('habit events are allowed only on the server business date');
  const isCustom = habit?.kind === 'custom';
  const direction = habit?.direction;
  if (!['good', 'bad'].includes(direction)) throw new RangeError('habit direction is invalid');
  const policyKey = isCustom ? `custom_${direction}` : habit.key;
  const policy = PHASE4_HABIT_POLICIES[policyKey];
  if (!policy) throw new RangeError('habit policy is not defined');
  if (sameDayReports >= policy.maxDailyReports) throw new RangeError('daily habit report limit reached');
  const rewardGranted = direction === 'good' && sameDayRewards < policy.maxDailyRewards;
  const normalized = normalizePlayer(player);
  const effects = rewardGranted
    ? { xp: 3 + Math.floor(normalized.baseStats.growth / 4), gold: 2 }
    : direction === 'bad' ? { hp: -5 } : {};
  const resource = applyAuthoritativeResourceEffects({ player: normalized, effects, activeStatusIds });
  const summonFriedFoodBoss = habit?.key === 'fried_food'
    && recentFriedFoodReports + 1 >= 3
    && !hasActiveBoss
    && !incidentAlreadyExists;
  const achievementEvents = habit?.key === 'exercise_training'
    && sameDayReports + 1 >= PHASE4_ACHIEVEMENT_DEFINITIONS.gym_rat.target.dailyReports
    && !achievementCodes.includes('gym_rat') ? ['gym_rat'] : [];
  return {
    kind: 'habit_event',
    businessDate,
    habit: {
      kind: isCustom ? 'custom' : 'system',
      systemKey: isCustom ? null : habit.key,
      customHabitId: isCustom ? habit.id : null,
      title: String(habit.title || ''),
      direction,
      policy: { ...policy, rewardGranted, effects }
    },
    resource,
    boss: summonFriedFoodBoss ? { action: 'summon', bossKey: 'fried-food-beast' } : null,
    achievementEvents,
    definitions: createDefinitionStamp()
  };
}

const ruleMatches = ({ rule, entry, profile }) => rule.conditions.every(condition => {
  const expected = condition.profileValue === 'dailyBudget'
    ? Number(profile.dailyBudget)
    : Number(condition.value);
  return compare(Number(entry[condition.metric]), condition.operator, expected);
});

export function reconcileDailyInput({ rawInput, habitEvents = [] }) {
  const input = {
    sleep: Number(rawInput.sleep),
    water: Math.trunc(Number(rawInput.water)),
    exercise: Math.trunc(Number(rawInput.exercise)),
    study: Math.trunc(Number(rawInput.study)),
    expense: Math.trunc(Number(rawInput.expense)),
    impulse: Math.trunc(Number(rawInput.impulse)),
    sugaryDrinks: Math.trunc(Number(rawInput.sugaryDrinks))
  };
  const counts = habitEvents.filter(event => !event.reversedAt).reduce((summary, event) => {
    summary[event.systemKey] = (summary[event.systemKey] || 0) + 1;
    return summary;
  }, {});
  input.water = Math.max(input.water, (counts.hydration || 0) * 500);
  input.exercise = Math.max(input.exercise, (counts.exercise_training || 0) * 10);
  input.study = Math.max(input.study, (counts.skill_practice || 0) * 30);
  input.impulse = Math.max(input.impulse, counts.impulse_purchase || 0);
  return input;
}

export function buildDailySettlementPlan({
  rawInput,
  habitEvents = [],
  history = [],
  player,
  profile,
  rulePreferences = {},
  businessDate,
  serverBusinessDate,
  randomValue,
  activeStatusIds = [],
  activeBoss = null,
  achievementCodes = [],
  incidentKeys = []
}) {
  const temporal = classifyTemporalContext({ businessDate, serverBusinessDate });
  if (!Number.isFinite(randomValue) || randomValue < 0 || randomValue >= 1) {
    throw new RangeError('randomValue must be in [0, 1)');
  }
  const effectiveInput = reconcileDailyInput({ rawInput, habitEvents });
  const enabled = id => rulePreferences[id] !== false;
  const dailyRuleIds = ['rule_1', 'rule_2', 'rule_water', 'rule_exercise', 'rule_5'].filter(enabled);
  const completedRuleIds = dailyRuleIds.filter(id => ruleMatches({
    rule: PHASE4_RULE_DEFINITIONS[id], entry: effectiveInput, profile
  }));
  const failedRuleIds = dailyRuleIds.filter(id => !completedRuleIds.includes(id));
  const baseReward = completedRuleIds.reduce((reward, id) => {
    const current = PHASE4_RULE_DEFINITIONS[id].reward;
    reward.xp += current.xp || 0;
    reward.gold += current.gold || 0;
    Object.entries(current.stats || {}).forEach(([key, value]) => {
      reward.stats[key] = (reward.stats[key] || 0) + value;
    });
    return reward;
  }, { xp: 0, gold: 0, gems: 0, stats: {} });
  const normalized = normalizePlayer(player);
  const critical = randomValue * 100 < normalized.baseStats.energy * 1.5;
  if (critical) {
    baseReward.xp *= 2;
    baseReward.gold *= 2;
  }
  if (completedRuleIds.length === dailyRuleIds.length && dailyRuleIds.length > 0) baseReward.gems += 1;
  const rewardBreakdown = {
    daily: { xp: baseReward.xp, gold: baseReward.gold, gems: baseReward.gems, stats: { ...baseReward.stats } },
    boss: { gold: 0, gems: 0 },
    achievement: { gems: 0 }
  };
  const damage = failedRuleIds.length
    ? Math.max(2, failedRuleIds.length * 6 - Math.floor(normalized.baseStats.health / 4))
    : 0;
  baseReward.hp = -damage;

  const dates = [...history, { ...effectiveInput, businessDate }]
    .sort((a, b) => String(a.businessDate).localeCompare(String(b.businessDate)));
  const lastConsecutive = (count, predicate) => {
    const tail = dates.slice(-count);
    if (tail.length !== count || !tail.every(predicate)) return false;
    return tail.every((entry, index) => index === 0
      || addBusinessDays(tail[index - 1].businessDate, 1) === entry.businessDate);
  };
  const statuses = [];
  if (completedRuleIds.includes('rule_1')) statuses.push('mental_full');
  if (enabled('rule_3') && lastConsecutive(2, entry => Number(entry.sleep) < 6)) statuses.push('sleep_deprivation');
  const achievementEvents = [];
  if (enabled('rule_6')
    && !achievementCodes.includes('exercise_streak_3')
    && lastConsecutive(3, entry => Number(entry.exercise) >= 30)) {
    achievementEvents.push('exercise_streak_3');
    baseReward.gems += 5;
    rewardBreakdown.achievement.gems += 5;
    statuses.push('vitality');
  }

  let bossPlan = null;
  if (temporal.allowCurrentBossMutation && activeBoss && activeBoss.lastActionDate !== businessDate) {
    const definition = PHASE4_BOSS_DEFINITIONS[activeBoss.bossKey];
    if (definition && businessDate >= activeBoss.summonedOn) {
      const challenge = definition.challenge;
      const matched = challenge.source === 'habit_event'
        ? (habitEvents.filter(event => !event.reversedAt && event.systemKey === challenge.habitKey).length === Number(challenge.value || 0))
        : challenge.conditions.every(condition => {
            const expected = condition.profileValue === 'dailyBudget'
              ? Number(profile.dailyBudget)
              : Number(condition.value);
            return compare(Number(effectiveInput[condition.metric]), condition.operator, expected);
          });
      const damage = matched ? Math.ceil(Number(activeBoss.maxHp) / Number(challenge.targetDays || 1)) : 0;
      const defeated = damage >= Number(activeBoss.hp);
      bossPlan = {
        action: 'progress', encounterId: activeBoss.id, matched, damage,
        defeated, bossKey: activeBoss.bossKey
      };
      if (defeated) {
        baseReward.gold += Number(definition.reward.gold) || 0;
        baseReward.gems += Number(definition.reward.gems) || 0;
        rewardBreakdown.boss.gold += Number(definition.reward.gold) || 0;
        rewardBreakdown.boss.gems += Number(definition.reward.gems) || 0;
        if (!achievementCodes.includes('boss_slayer')) {
          achievementEvents.push('boss_slayer');
          const achievementReward = PHASE4_ACHIEVEMENT_DEFINITIONS.boss_slayer.reward;
          baseReward.gems += Number(achievementReward.gems) || 0;
          rewardBreakdown.achievement.gems += Number(achievementReward.gems) || 0;
        }
      }
    }
  }

  const bossCandidates = [];
  if (temporal.allowCurrentBossMutation && !activeBoss) {
    if (enabled('rule_boss_sleep') && lastConsecutive(3, entry => Number(entry.sleep) < 5)) bossCandidates.push('sleep-nightmare');
    if (enabled('rule_boss_lazy') && lastConsecutive(3, entry => Number(entry.exercise) < 15)) bossCandidates.push('laziness-beast');
    const recent = dates.slice(-7);
    const weeklyBudget = Number(profile.dailyBudget) * 7;
    if (enabled('rule_boss_budget') && recent.length === 7
      && recent.reduce((sum, entry) => sum + Number(entry.expense), 0) > weeklyBudget) bossCandidates.push('budget-vampire');
    if (enabled('rule_4') && recent.length === 7
      && recent.reduce((sum, entry) => sum + Number(entry.sugaryDrinks), 0) >= 5) bossCandidates.push('sugar-monster');
  }
  const bossKey = bossCandidates
    .filter(key => !incidentKeys.includes(`${key}:${businessDate}`))
    .sort((a, b) => PHASE4_BOSS_DEFINITIONS[b].priority - PHASE4_BOSS_DEFINITIONS[a].priority)[0] || null;
  if (!bossPlan && bossKey) bossPlan = { action: 'summon', bossKey };

  const statusPlans = [...new Set(statuses)].map(key => {
    const definition = PHASE4_STATUS_DEFINITIONS[key];
    const expiresOn = addBusinessDays(businessDate, definition.durationDays);
    const historicalOnly = temporal.isBackfill && expiresOn <= serverBusinessDate;
    return {
      ...definition,
      appliedOn: businessDate,
      expiresOn,
      state: historicalOnly ? 'historical_only' : 'active'
    };
  });
  const resource = applyAuthoritativeResourceEffects({
    player: normalized,
    effects: baseReward,
    activeStatusIds
  });
  return {
    kind: 'daily_settlement',
    businessDate,
    temporal,
    rawInput: { ...rawInput },
    effectiveInput,
    completedRuleIds,
    failedRuleIds,
    critical,
    reward: baseReward,
    rewardBreakdown,
    resource,
    statuses: statusPlans,
    boss: bossPlan,
    achievementEvents,
    definitions: createDefinitionStamp()
  };
}
