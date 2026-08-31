(function(root, factory) {
  const core = factory();
  if (typeof module === 'object' && module.exports) module.exports = core;
  if (root) root.LifeQuestCore = core;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  const CURRENT_SCHEMA_VERSION = 17;
  const DEFAULT_TIME_ZONE = 'Asia/Taipei';

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function stableStringify(value) {
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    if (isPlainObject(value)) {
      return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
  }

  function checksum(value) {
    const input = stableStringify(value);
    let hash = 0x811c9dc5;
    for (let index = 0; index < input.length; index += 1) {
      hash ^= input.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
  }

  function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function mergeDefaults(defaults, source) {
    if (!isPlainObject(defaults)) {
      return source === undefined ? clone(defaults) : clone(source);
    }
    const result = {};
    const sourceObject = isPlainObject(source) ? source : {};
    for (const key of Object.keys(defaults)) {
      result[key] = mergeDefaults(defaults[key], sourceObject[key]);
    }
    for (const key of Object.keys(sourceObject)) {
      if (!(key in result)) result[key] = clone(sourceObject[key]);
    }
    return result;
  }

  function isRealIsoDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
    const parsed = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }

  function toIsoDate(value, year = new Date().getUTCFullYear()) {
    if (typeof value !== 'string') return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return isRealIsoDate(value) ? value : null;
    const match = value.match(/^(\d{1,2})\/(\d{1,2})$/);
    if (!match) return null;
    const normalized = `${year}-${String(match[1]).padStart(2, '0')}-${String(match[2]).padStart(2, '0')}`;
    return isRealIsoDate(normalized) ? normalized : null;
  }

  function addIsoDays(date, amount) {
    const normalized = toIsoDate(date);
    if (!normalized) return null;
    const value = new Date(`${normalized}T00:00:00Z`);
    value.setUTCDate(value.getUTCDate() + Number(amount || 0));
    return value.toISOString().slice(0, 10);
  }

  function daysUntil(fromDate, toDate) {
    const from = Date.parse(`${fromDate}T00:00:00Z`);
    const to = Date.parse(`${toDate}T00:00:00Z`);
    if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
    return Math.ceil((to - from) / (24 * 60 * 60 * 1000));
  }

  function isValidTimeZone(value) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: String(value || '') }).format(new Date(0));
      return true;
    } catch (_error) {
      return false;
    }
  }

  function businessDateFor(now, timeZone = DEFAULT_TIME_ZONE) {
    const selectedTimeZone = isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIME_ZONE;
    const parsed = now instanceof Date ? now : new Date(now);
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: selectedTimeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(parsed);
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  }

  const BusinessDatePolicy = {
    resolve({ now = new Date(), timeZone = DEFAULT_TIME_ZONE, recordDate = null, maxBackfillDays = 7 } = {}) {
      const selectedTimeZone = isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIME_ZONE;
      const today = businessDateFor(now, selectedTimeZone);
      const selectedRecordDate = toIsoDate(recordDate) || today;
      const minDate = addIsoDays(today, -Math.max(0, Number(maxBackfillDays) || 0));
      let reason = null;
      if (selectedRecordDate > today) reason = 'future_date';
      else if (selectedRecordDate < minDate) reason = 'too_old';
      return {
        allowed: !reason,
        reason,
        timeZone: selectedTimeZone,
        today,
        recordDate: selectedRecordDate,
        isBackfill: selectedRecordDate < today,
        minDate,
        maxDate: today
      };
    },

    today({ now = new Date(), timeZone = DEFAULT_TIME_ZONE } = {}) {
      return businessDateFor(now, timeZone);
    },

    isValidTimeZone
  };

  function normalizeEntry(entry) {
    const date = toIsoDate(entry && entry.date);
    if (!date) return null;
    return {
      ...clone(entry),
      id: entry.id || `daily-${date}`,
      date
    };
  }

  function normalizeSavedStatus(effect, anchorDate) {
    const normalized = clone(effect || {});
    const duration = Math.max(1, Number(normalized.remainingDays) || 1);
    const appliedOn = toIsoDate(normalized.appliedOn) || toIsoDate(anchorDate);
    normalized.remainingDays = duration;
    if (appliedOn) {
      normalized.appliedOn = appliedOn;
      normalized.expiresOn = toIsoDate(normalized.expiresOn) || addIsoDays(appliedOn, duration);
    }
    return normalized;
  }

  function normalizeRuleTarget(value) {
    if (value === null || value === undefined) return null;
    if (value === true || value === false) return value;
    if (value !== '' && Number.isFinite(Number(value))) return Number(value);
    return String(value);
  }

  function normalizedRuleConditions(rule) {
    if (!isPlainObject(rule)) return [];
    return Array.isArray(rule.conditions) && rule.conditions.length > 0
      ? rule.conditions
        .filter(isPlainObject)
        .map(condition => ({
          metric: condition.metric || '',
          operator: condition.operator || '',
          targetValue: normalizeRuleTarget(condition.targetValue),
          setting: condition.setting || ''
        }))
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
      : rule.metric && rule.operator
        ? [{
            metric: rule.metric,
            operator: rule.operator,
            targetValue: normalizeRuleTarget(rule.targetValue),
            setting: rule.setting || ''
          }]
        : [];
  }

  function ruleTriggerIdentity(rule) {
    if (!isPlainObject(rule)) return null;
    const conditions = normalizedRuleConditions(rule);
    if (conditions.length === 0) return rule.id ? `id:${rule.id}` : null;
    return JSON.stringify({
      source: rule.source || 'dailyLog',
      period: rule.period || 'daily',
      aggregate: rule.aggregate || '',
      consecutive: Number(rule.consecutive) || 0,
      habitKey: rule.habitKey || '',
      habitId: rule.habitId || '',
      dynamicTarget: rule.dynamicTarget || '',
      conditions
    });
  }

  function ruleIdentity(rule) {
    const trigger = ruleTriggerIdentity(rule);
    if (!trigger || trigger.startsWith('id:')) return trigger;
    return JSON.stringify({
      type: rule.type || '',
      category: rule.category || '',
      bossId: rule.bossId || '',
      achievementId: rule.achievementId || '',
      trigger
    });
  }

  function dedupeRules(rules) {
    const result = [];
    const identityIndexes = new Map();
    (Array.isArray(rules) ? rules : []).forEach(rule => {
      const copy = clone(rule);
      const identity = ruleIdentity(copy);
      if (!identityIndexes.has(identity)) {
        identityIndexes.set(identity, result.length);
        result.push(copy);
        return;
      }
      const existingIndex = identityIndexes.get(identity);
      const existing = result[existingIndex];
      if (copy.isSystem && !existing.isSystem) result[existingIndex] = copy;
    });
    const systemTriggers = new Set(
      result.filter(rule => rule.isSystem)
        .map(ruleTriggerIdentity)
        .filter(identity => identity && !identity.startsWith('id:'))
    );
    return result.filter(rule => {
      if (rule.isSystem) return true;
      const identity = ruleTriggerIdentity(rule);
      return !identity || identity.startsWith('id:') || !systemTriggers.has(identity);
    });
  }

  function migrateState(rawState, defaults, defaultRules) {
    const raw = isPlainObject(rawState) ? rawState : {};
    const rawSchemaVersion = Number(raw.schemaVersion) || 0;
    const migrated = mergeDefaults(defaults, raw);
    migrated.schemaVersion = CURRENT_SCHEMA_VERSION;
    migrated.dailyLogHistory = (Array.isArray(raw.dailyLogHistory) ? raw.dailyLogHistory : [])
      .map(normalizeEntry)
      .filter(Boolean);
    const migrationBudget = Math.max(1, Number(migrated.settings?.dailyBudget) || 500);
    migrated.dailyLogHistory = migrated.dailyLogHistory.map(entry => {
      if (Number(entry.budgetLimitAtSettlement) > 0) return entry;
      return {
        ...entry,
        budgetLimitAtSettlement: migrationBudget,
        budgetSnapshotEstimated: true
      };
    });
    const defaultTasks = Array.isArray(defaults.tasks) ? defaults.tasks : [];
    const savedTasks = Array.isArray(raw.tasks) ? raw.tasks : [];
    migrated.tasks = savedTasks.map(savedTask => {
      const canonical = savedTask?.systemKey
        ? defaultTasks.find(task => task.systemKey === savedTask.systemKey)
        : defaultTasks.find(task => task.isSystem && task.id === savedTask?.id);
      if (!canonical) {
        const savedPolicy = isPlainObject(savedTask?.rewardPolicy)
          ? clone(savedTask.rewardPolicy)
          : {};
        const customRewardLimit = savedTask?.direction === 'bad' ? 0 : 1;
        return {
          ...clone(savedTask),
          isSystem: false,
          systemKey: savedTask?.systemKey || null,
          rewardPolicy: {
            ...savedPolicy,
            maxDailyReports: Math.max(1, Number(savedPolicy.maxDailyReports) || 10),
            maxDailyRewards: customRewardLimit
          }
        };
      }
      return {
        ...clone(savedTask),
        title: canonical.systemKey === 'skill_practice' && /^寫程式 \/ 練習技能(?: 💻)?$/.test(String(savedTask.title || ''))
          ? canonical.title
          : savedTask.title,
        systemKey: canonical.systemKey,
        isSystem: true,
        direction: canonical.direction,
        stat: canonical.stat,
        dailyInput: clone(canonical.dailyInput || null),
        rewardPolicy: clone(canonical.rewardPolicy || null)
      };
    });
    defaultTasks.filter(task => task.isSystem && task.systemKey).forEach(canonical => {
      if (!migrated.tasks.some(task => task.systemKey === canonical.systemKey)) {
        migrated.tasks.push(clone(canonical));
      }
    });
    const savedRules = Array.isArray(raw.rules) ? clone(raw.rules) : null;
    if (savedRules && rawSchemaVersion < CURRENT_SCHEMA_VERSION) {
      const canonicalRules = Array.isArray(defaultRules) ? defaultRules : [];
      migrated.rules = savedRules.map(savedRule => {
        const canonical = canonicalRules.find(rule => rule.id === savedRule.id);
        if (!canonical?.isSystem) return savedRule;
        const upgraded = {
          ...clone(savedRule),
          ...clone(canonical),
          enabled: savedRule.enabled !== false
        };
        if (canonical.habitKey) delete upgraded.habitId;
        return upgraded;
      });
      canonicalRules.forEach(canonical => {
        if (!migrated.rules.some(rule => rule.id === canonical.id)) {
          migrated.rules.push(clone(canonical));
        }
      });
    } else {
      migrated.rules = savedRules || clone(defaultRules || []);
    }
    if (rawSchemaVersion < 11) {
      migrated.rules = migrated.rules.map(rule => {
        if (rule.sourceRecommendationId !== 'ai_rec_2') return rule;
        return {
          ...rule,
          name: '每週總支出不超過週預算',
          conditionText: '7天總支出 <= 每日預算 × 7',
          metric: 'expense',
          operator: '<=',
          targetValue: 3500,
          dynamicTarget: 'weeklyBudget',
          period: 'weekly',
          aggregate: 'sum'
        };
      });
    }
    migrated.rules = dedupeRules(migrated.rules);
    migrated.ignoredRuleIds = Array.isArray(raw.ignoredRuleIds) ? clone(raw.ignoredRuleIds) : [];
    migrated.habitEvents = (Array.isArray(raw.habitEvents) ? raw.habitEvents : [])
      .filter(event => event && event.id && event.habitId)
      .map(event => {
        const task = migrated.tasks.find(item => item.id === event.habitId);
        return {
          ...clone(event),
          habitKey: event.habitKey || task?.systemKey || event.habitId,
          operationKey: event.operationKey || event.id,
          rewardGranted: event.rewardGranted !== undefined
            ? Boolean(event.rewardGranted)
            : Number(event.effect?.xp || 0) > 0 || Number(event.effect?.gold || 0) > 0
        };
      });
    migrated.deletedRules = (Array.isArray(raw.deletedRules) ? raw.deletedRules : [])
      .filter(record => record?.rule?.id && !record.rule.isSystem)
      .map(clone);
    migrated.dailyDrafts = isPlainObject(raw.dailyDrafts) ? clone(raw.dailyDrafts) : {};
    migrated.supplyTransactions = (Array.isArray(raw.supplyTransactions) ? raw.supplyTransactions : [])
      .filter(item => item && item.id)
      .map(clone);
    migrated.gemTransactions = (Array.isArray(raw.gemTransactions) ? raw.gemTransactions : [])
      .filter(item => item && item.id)
      .map(clone);
    migrated.rewardTickets = (Array.isArray(raw.rewardTickets) ? raw.rewardTickets : [])
      .filter(item => item && item.id && item.catalogId)
      .map(clone);
    migrated.mainQuest = mergeDefaults({ pending: null }, raw.mainQuest);
    migrated.bossHistory = (Array.isArray(raw.bossHistory) ? raw.bossHistory : [])
      .filter(item => item && item.incidentKey && item.bossId)
      .map(clone);
    if (migrated.boss?.active) {
      migrated.boss.summonedOn = toIsoDate(migrated.boss.summonedOn || migrated.boss.summonedAt) || null;
    }
    migrated.bossTransactions = (Array.isArray(raw.bossTransactions) ? raw.bossTransactions : [])
      .filter(item => item && item.id)
      .map(clone);
    const defaultAchievements = Array.isArray(defaults.achievements) ? defaults.achievements : [];
    const savedAchievements = Array.isArray(raw.achievements) ? raw.achievements : [];
    migrated.achievements = defaultAchievements.map(definition => {
      const saved = savedAchievements.find(item => item && item.id === definition.id);
      const achievement = mergeDefaults(definition, saved);
      ['title', 'desc', 'target', 'condition'].forEach(key => {
        if (definition[key] !== undefined) achievement[key] = clone(definition[key]);
      });
      if (achievement.id === 'streak_3' && achievement.unlocked && !achievement.unlockedAt) {
        achievement.unlocked = false;
        achievement.progress = 0;
      }
      if (
        rawSchemaVersion < 12 &&
        achievement.id === 'gold_hoarder' &&
        saved?.condition?.kind !== 'budget_success_days'
      ) {
        achievement.unlocked = false;
        achievement.unlockedAt = null;
        achievement.progress = 0;
      }
      return achievement;
    });
    savedAchievements.forEach(saved => {
      if (saved && !migrated.achievements.some(item => item.id === saved.id)) {
        migrated.achievements.push(clone(saved));
      }
    });
    migrated.meta = mergeDefaults(
      {
        lastSettlementDate: null,
        lastInterestDate: null,
        processedBossIncidentKeys: []
      },
      raw.meta
    );
    if (!Array.isArray(migrated.meta.processedBossIncidentKeys)) {
      migrated.meta.processedBossIncidentKeys = [];
    }
    migrated.statusHistory = (Array.isArray(raw.statusHistory) ? raw.statusHistory : [])
      .filter(item => item && item.effectId && item.type && toIsoDate(item.date))
      .map(item => ({ ...clone(item), date: toIsoDate(item.date) }));
    const statusAnchorDate = toIsoDate(raw.meta?.lastSettlementDate) || (
      migrated.dailyLogHistory.length
        ? migrated.dailyLogHistory[migrated.dailyLogHistory.length - 1].date
        : null
    );
    migrated.buffs = (Array.isArray(raw.buffs) ? raw.buffs : [])
      .filter(item => item && item.id)
      .map(item => normalizeSavedStatus(item, statusAnchorDate));
    migrated.debuffs = (Array.isArray(raw.debuffs) ? raw.debuffs : [])
      .filter(item => item && item.id)
      .map(item => normalizeSavedStatus(item, statusAnchorDate));
    // Recovery shortcuts used to remove debuffs immediately and could desynchronise
    // the recorded status duration from the character attributes. Schema 15 keeps
    // debuffs date-driven and discards those obsolete actionable records.
    migrated.recoveryTasks = [];
    if (rawSchemaVersion < 11) {
      [
        ...migrated.buffs.map(item => ({ item, type: 'buff' })),
        ...migrated.debuffs.map(item => ({ item, type: 'debuff' }))
      ].forEach(({ item, type }) => {
        if (!item.appliedOn) return;
        const alreadyRecorded = migrated.statusHistory.some(event =>
          event.effectId === item.id && event.type === type && event.date === item.appliedOn
        );
        if (alreadyRecorded) return;
        migrated.statusHistory.push({
          effectId: item.id,
          sourceRuleId: item.id,
          type,
          title: String(item.title || item.id),
          event: 'applied',
          date: item.appliedOn,
          estimated: true
        });
      });
    }
    if (rawSchemaVersion < 7) {
      const confirmedIncidentKeys = new Set(
        migrated.bossHistory.map(item => item.incidentKey)
      );
      if (migrated.boss?.active && migrated.boss.incidentKey) {
        confirmedIncidentKeys.add(migrated.boss.incidentKey);
      }
      migrated.meta.processedBossIncidentKeys = migrated.meta.processedBossIncidentKeys
        .filter(key => confirmedIncidentKeys.has(key));
    }
    return migrated;
  }

  const StateStore = {
    load(storage, key, defaults, defaultRules) {
      let value = null;
      try {
        value = storage.getItem(key);
      } catch (error) {
        const state = migrateState(null, defaults, defaultRules);
        Object.defineProperty(state, 'storageStatus', {
          value: {
            ok: false,
            reason: 'storage_read_failed',
            errorName: error?.name || 'Error'
          },
          configurable: true,
          writable: true,
          enumerable: false
        });
        return state;
      }

      let parsed = null;
      if (value) {
        try {
          parsed = JSON.parse(value);
        } catch (error) {
          const recoveryKey = `${key}_corrupted_backup`;
          const backupResult = this.writeRaw(storage, recoveryKey, value);
          const state = migrateState(null, defaults, defaultRules);

          if (!backupResult.ok) {
            Object.defineProperty(state, 'storageStatus', {
              value: {
                ok: false,
                reason: 'corrupted_state_unrecoverable',
                errorName: error?.name || 'SyntaxError'
              },
              configurable: true,
              writable: true,
              enumerable: false
            });
            return state;
          }

          const saveResult = this.save(storage, key, state);
          Object.defineProperty(state, 'storageStatus', {
            value: {
              ok: false,
              reason: saveResult.ok
                ? 'corrupted_state_recovered'
                : 'corrupted_state_recovery_write_failed',
              errorName: saveResult.errorName || error?.name || 'SyntaxError',
              recoveryKey
            },
            configurable: true,
            writable: true,
            enumerable: false
          });
          return state;
        }
      }

      const state = migrateState(parsed, defaults, defaultRules);
      const saveResult = this.save(storage, key, state);
      Object.defineProperty(state, 'storageStatus', {
        value: saveResult,
        configurable: true,
        writable: true,
        enumerable: false
      });
      return state;
    },

    save(storage, key, state) {
      return this.writeRaw(storage, key, JSON.stringify(state));
    },

    writeRaw(storage, key, value) {
      try {
        storage.setItem(key, String(value));
        return { ok: true, reason: null, errorName: null };
      } catch (error) {
        return {
          ok: false,
          reason: 'storage_write_failed',
          errorName: error?.name || 'Error'
        };
      }
    },

    upsertDailyEntry(state, entry) {
      const normalized = normalizeEntry(entry);
      if (!normalized) throw new Error('Daily entry requires a valid date');
      const existingIndex = state.dailyLogHistory.findIndex(item => item.date === normalized.date);
      if (existingIndex >= 0) {
        state.dailyLogHistory[existingIndex] = {
          ...state.dailyLogHistory[existingIndex],
          ...normalized
        };
        return { isNew: false, entry: state.dailyLogHistory[existingIndex] };
      }
      state.dailyLogHistory.push(normalized);
      state.dailyLogHistory.sort((a, b) => a.date.localeCompare(b.date));
      return { isNew: true, entry: normalized };
    },

    hasEquivalentRule(rules, candidate) {
      const candidateIdentity = ruleIdentity(candidate);
      if (!candidateIdentity) return false;
      return (Array.isArray(rules) ? rules : [])
        .some(rule => ruleIdentity(rule) === candidateIdentity);
    },

    hasEquivalentTrigger(rules, candidate) {
      const candidateIdentity = ruleTriggerIdentity(candidate);
      if (!candidateIdentity || candidateIdentity.startsWith('id:')) return false;
      return (Array.isArray(rules) ? rules : [])
        .some(rule => ruleTriggerIdentity(rule) === candidateIdentity);
    },

    migrate: migrateState
  };

  const DAILY_INPUT_METRICS = new Set(['water', 'exercise', 'study', 'impulse', 'sugaryDrinks']);
  const SYSTEM_HABIT_DAILY_INPUTS = {
    hydration: { metric: 'water', amount: 500 },
    exercise_training: { metric: 'exercise', amount: 10 },
    skill_practice: { metric: 'study', amount: 30 },
    impulse_purchase: { metric: 'impulse', amount: 1 }
  };

  const DailyDataEngine = {
    getHabitInput(habit = {}) {
      if (habit.systemKey) {
        return clone(SYSTEM_HABIT_DAILY_INPUTS[habit.systemKey] || null);
      }
      if (
        DAILY_INPUT_METRICS.has(habit.dailyInput?.metric) &&
        Number(habit.dailyInput.amount) > 0
      ) {
        return clone(habit.dailyInput);
      }
      return null;
    },

    createDraft({ date, entry = null, draft = null } = {}) {
      const normalizedDate = toIsoDate(date);
      if (!normalizedDate) throw new Error('Daily draft requires a valid date');
      const source = isPlainObject(draft) ? draft : (isPlainObject(entry) ? entry : {});
      return {
        date: normalizedDate,
        sleep: source.sleep ?? '',
        water: Math.max(0, Number(source.water) || 0),
        exercise: Math.max(0, Number(source.exercise) || 0),
        study: Math.max(0, Number(source.study) || 0),
        expense: source.expense ?? '',
        impulse: Math.max(0, Number(source.impulse) || 0),
        sugaryDrinks: Math.max(0, Number(source.sugaryDrinks) || 0),
        updatedAt: source.updatedAt || null
      };
    },

    applyHabitReport({ draft, habit, date, direction = 1 } = {}) {
      const next = this.createDraft({ date, draft });
      const input = this.getHabitInput(habit);
      if (!input) return { draft: next, changed: false, input: null };
      const current = Math.max(0, Number(next[input.metric]) || 0);
      next[input.metric] = Math.max(0, current + Number(input.amount) * Number(direction || 0));
      next.updatedAt = new Date().toISOString();
      return { draft: next, changed: true, input };
    },

    storeDraft({ drafts = {}, draft, savedAt = new Date().toISOString() } = {}) {
      const normalized = this.createDraft({ date: draft?.date, draft });
      normalized.updatedAt = savedAt;
      return {
        ...(isPlainObject(drafts) ? clone(drafts) : {}),
        [normalized.date]: normalized
      };
    },

    reconcile({ draft, tasks = [], habitEvents = [], date } = {}) {
      const next = this.createDraft({ date, draft });
      const normalizedDate = next.date;
      const taskByIdentity = new Map();
      (Array.isArray(tasks) ? tasks : []).forEach(task => {
        if (!task?.id) return;
        taskByIdentity.set(task.id, task);
        if (task.systemKey) taskByIdentity.set(task.systemKey, task);
      });
      const contributions = {};
      const summary = {};
      const activeEvents = (Array.isArray(habitEvents) ? habitEvents : [])
        .filter(event => event && !event.reversedAt && toIsoDate(event.date) === normalizedDate);

      activeEvents.forEach(event => {
        const identity = event.habitKey || event.habitId;
        const task = taskByIdentity.get(identity) || taskByIdentity.get(event.habitId);
        const input = event.dailyInput?.metric
          ? event.dailyInput
          : this.getHabitInput(task || {});
        if (input && DAILY_INPUT_METRICS.has(input.metric) && Number(input.amount) > 0) {
          contributions[input.metric] = (contributions[input.metric] || 0) + Number(input.amount);
        }
        const key = String(identity || 'custom');
        summary[key] = summary[key] || { recordedCount: 0, rewardedCount: 0 };
        summary[key].recordedCount += 1;
        if (event.rewardGranted) summary[key].rewardedCount += 1;
      });

      const adjustments = [];
      Object.entries(contributions).forEach(([metric, minimum]) => {
        const current = Math.max(0, Number(next[metric]) || 0);
        if (current >= minimum) return;
        next[metric] = minimum;
        adjustments.push({ metric, from: current, to: minimum });
      });
      next.habitDataVerifiedAt = new Date().toISOString();
      return {
        draft: next,
        changed: adjustments.length > 0,
        adjustments,
        summary,
        activeEventCount: activeEvents.length
      };
    }
  };

  const DailyRecordPolicy = {
    validate({ date, today, maxBackfillDays = 7 } = {}) {
      const normalizedDate = toIsoDate(date);
      const normalizedToday = toIsoDate(today);
      if (!normalizedDate || !normalizedToday) {
        return { allowed: false, reason: 'invalid_date', isBackfill: false, minDate: null, maxDate: normalizedToday };
      }
      const minDate = addIsoDays(normalizedToday, -Math.max(0, Number(maxBackfillDays) || 0));
      if (normalizedDate > normalizedToday) {
        return { allowed: false, reason: 'future_date', isBackfill: false, minDate, maxDate: normalizedToday };
      }
      if (normalizedDate < minDate) {
        return { allowed: false, reason: 'too_old', isBackfill: true, minDate, maxDate: normalizedToday };
      }
      return {
        allowed: true,
        reason: null,
        isBackfill: normalizedDate < normalizedToday,
        minDate,
        maxDate: normalizedToday
      };
    }
  };

  const MAIN_QUEST_GOALS = new Set(['sleep', 'spending', 'exercise', 'learning']);
  const MainQuestEngine = {
    getFocus({ goal, rules = [], tasks = [] } = {}) {
      const activeRules = (Array.isArray(rules) ? rules : [])
        .filter(rule => rule && rule.type === 'daily' && rule.enabled !== false);
      const containsMetric = (rule, metric) =>
        rule.metric === metric ||
        (Array.isArray(rule.conditions) && rule.conditions.some(condition => condition?.metric === metric));
      const rule = goal === 'sleep'
        ? activeRules.find(item => containsMetric(item, 'sleep'))
        : goal === 'spending'
          ? activeRules.find(item => containsMetric(item, 'expense') || item.category === 'wealth')
          : goal === 'exercise'
            ? activeRules.find(item => containsMetric(item, 'exercise'))
            : goal === 'learning'
              ? activeRules.find(item => containsMetric(item, 'study') || item.category === 'growth')
              : null;
      const desiredHabitKey = goal === 'exercise'
        ? 'exercise_training'
        : goal === 'learning' ? 'skill_practice' : null;
      const habit = desiredHabitKey
        ? (Array.isArray(tasks) ? tasks : []).find(task => task?.systemKey === desiredHabitKey)
        : null;
      return {
        goal: MAIN_QUEST_GOALS.has(goal) ? goal : null,
        ruleId: rule?.id || null,
        habitKey: habit?.systemKey || null
      };
    },

    switchGoal({ currentGoal, nextGoal, today, settledDates = [] } = {}) {
      const normalizedToday = toIsoDate(today);
      if (!MAIN_QUEST_GOALS.has(nextGoal) || !normalizedToday) {
        return { ok: false, reason: 'invalid_goal', currentGoal, pending: null, effectiveOn: null };
      }
      if (nextGoal === currentGoal) {
        return { ok: false, reason: 'unchanged', currentGoal, pending: null, effectiveOn: normalizedToday };
      }
      if ((Array.isArray(settledDates) ? settledDates : []).includes(normalizedToday)) {
        const effectiveOn = addIsoDays(normalizedToday, 1);
        return {
          ok: true,
          currentGoal,
          pending: { goal: nextGoal, effectiveOn },
          effectiveOn
        };
      }
      return { ok: true, currentGoal: nextGoal, pending: null, effectiveOn: normalizedToday };
    },

    applyPending({ currentGoal, pending, today } = {}) {
      const normalizedToday = toIsoDate(today);
      if (!pending?.goal || !MAIN_QUEST_GOALS.has(pending.goal) || !toIsoDate(pending.effectiveOn)) {
        return { currentGoal, pending: null, changed: false };
      }
      if (!normalizedToday || normalizedToday < pending.effectiveOn) {
        return { currentGoal, pending: clone(pending), changed: false };
      }
      return { currentGoal: pending.goal, pending: null, changed: pending.goal !== currentGoal };
    }
  };

  const SETTLEMENT_SNAPSHOT_KEYS = [
    'character', 'buffs', 'debuffs', 'statusHistory', 'recoveryTasks', 'boss', 'bossHistory',
    'bossTransactions', 'achievements', 'gemTransactions', 'rewardTickets'
  ];

  const SettlementRevisionEngine = {
    capture(state = {}) {
      const snapshot = {};
      SETTLEMENT_SNAPSHOT_KEYS.forEach(key => { snapshot[key] = clone(state[key] ?? null); });
      snapshot.processedBossIncidentKeys = clone(state.meta?.processedBossIncidentKeys || []);
      snapshot.lastInterestDate = state.meta?.lastInterestDate || null;
      return snapshot;
    },

    createTransaction(before, after, settledAt = new Date().toISOString()) {
      return { version: 1, settledAt, before: clone(before), after: clone(after) };
    },

    rollback(state = {}, transaction = null) {
      if (!transaction?.before || !transaction?.after) {
        return { ok: false, reason: 'missing_transaction', state: clone(state) };
      }
      const currentSnapshot = this.capture(state);
      if (JSON.stringify(currentSnapshot) !== JSON.stringify(transaction.after)) {
        return { ok: false, reason: 'state_changed', state: clone(state) };
      }
      const next = clone(state);
      SETTLEMENT_SNAPSHOT_KEYS.forEach(key => {
        next[key] = clone(transaction.before[key]);
      });
      next.meta = next.meta || {};
      next.meta.processedBossIncidentKeys = clone(transaction.before.processedBossIncidentKeys || []);
      next.meta.lastInterestDate = transaction.before.lastInterestDate || null;
      return { ok: true, reason: null, state: next };
    }
  };

  function compare(actual, operator, expected) {
    switch (operator) {
      case '>': return actual > expected;
      case '>=': return actual >= expected;
      case '<': return actual < expected;
      case '<=': return actual <= expected;
      case '!=': return actual != expected; // intentional form-input coercion
      case '==': return actual == expected; // intentional form-input coercion
      default: return false;
    }
  }

  function entriesInPeriod(entry, history, period) {
    const days = period === 'monthly' ? 30 : 7;
    const end = new Date(`${entry.date}T00:00:00Z`);
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - (days - 1));
    return [...history, entry]
      .filter(item => item && item.date)
      .filter(item => {
        const date = new Date(`${item.date}T00:00:00Z`);
        return date >= start && date <= end;
      })
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  function datesAreConsecutive(entries) {
    for (let index = 1; index < entries.length; index += 1) {
      const previous = Date.parse(`${entries[index - 1].date}T00:00:00Z`);
      const current = Date.parse(`${entries[index].date}T00:00:00Z`);
      if (current - previous !== 24 * 60 * 60 * 1000) return false;
    }
    return true;
  }

  function matchesHabitEventRule(entry, rule, context) {
    const endDate = toIsoDate(entry?.date);
    if (!endDate) return false;
    const windowDays = rule.period === 'monthly'
      ? 30
      : rule.period === 'daily' ? 1 : 7;
    const end = new Date(`${endDate}T00:00:00Z`);
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - (windowDays - 1));
    const events = (Array.isArray(context?.habitEvents) ? context.habitEvents : [])
      .filter(event => event && !event.reversedAt && event.gameEffectsAllowed !== false)
      .filter(event => {
        if (rule.habitKey) return (event.habitKey || event.habitId) === rule.habitKey;
        return !rule.habitId || event.habitId === rule.habitId;
      })
      .filter(event => {
        const date = toIsoDate(event.date);
        if (!date) return false;
        const timestamp = new Date(`${date}T00:00:00Z`);
        return timestamp >= start && timestamp <= end;
      });
    return compare(events.length, rule.operator, rule.targetValue);
  }

  function matchesRule(entry, rule, history, context = {}) {
    if (rule.source === 'habitEvents') {
      return matchesHabitEventRule(entry, rule, context);
    }
    if (Array.isArray(rule.conditions) && rule.conditions.length > 0) {
      return rule.conditions.every(condition =>
        compare(entry[condition.metric], condition.operator, condition.targetValue)
      );
    }

    if (rule.aggregate && rule.period && rule.period !== 'daily') {
      const periodEntries = entriesInPeriod(entry, history, rule.period);
      const values = periodEntries
        .map(item => Number(item[rule.metric]) || 0);
      const actual = rule.aggregate === 'average'
        ? values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1)
        : values.reduce((sum, value) => sum + value, 0);
      const fallbackBudget = Math.max(1, Number(context.settings?.dailyBudget) || 500);
      const target = rule.dynamicTarget === 'weeklyBudget'
        ? periodEntries.reduce(
            (sum, item) => sum + (
              Number(item.budgetLimitAtSettlement) > 0
                ? Number(item.budgetLimitAtSettlement)
                : fallbackBudget
            ),
            0
          ) + Math.max(0, 7 - new Set(periodEntries.map(item => item.date)).size) * (
            Number(entry.budgetLimitAtSettlement) > 0
              ? Number(entry.budgetLimitAtSettlement)
              : fallbackBudget
          )
        : rule.targetValue;
      return compare(actual, rule.operator, target);
    }

    if (rule.consecutive && rule.consecutive > 1) {
      const recent = [...history, entry]
        .filter(item => item && item.date)
        .sort((a, b) => a.date.localeCompare(b.date))
        .slice(-rule.consecutive);
      return recent.length === rule.consecutive &&
        datesAreConsecutive(recent) &&
        recent.every(item => compare(item[rule.metric], rule.operator, rule.targetValue));
    }

    return compare(entry[rule.metric], rule.operator, rule.targetValue);
  }

  const RuleEngine = {
    evaluate(entry, rules, history = [], context = {}) {
      const result = {
        completedRuleIds: [],
        failedRuleIds: [],
        triggeredEffectRuleIds: [],
        triggeredBossRuleIds: [],
        triggeredBosses: [],
        rewards: { xp: 0, gold: 0, attributes: {} }
      };

      for (const rule of rules.filter(item => item.enabled !== false)) {
        const matched = matchesRule(entry, rule, history, context);
        if (rule.type === 'daily') {
          if (!matched) {
            result.failedRuleIds.push(rule.id);
            continue;
          }
          result.completedRuleIds.push(rule.id);
          result.rewards.xp += Number(rule.exp) || 0;
          result.rewards.gold += Number(rule.gold) || 0;
          if (rule.attrName && rule.attrVal) {
            const attr = String(rule.attrName).toLowerCase();
            result.rewards.attributes[attr] =
              (result.rewards.attributes[attr] || 0) + Number(rule.attrVal);
          }
          if (rule.buffName) result.triggeredEffectRuleIds.push(rule.id);
        } else if (matched && (rule.type === 'buff' || rule.type === 'debuff')) {
          result.triggeredEffectRuleIds.push(rule.id);
        } else if (matched && rule.type === 'boss') {
          result.triggeredBossRuleIds.push(rule.id);
          if (rule.bossId) {
            result.triggeredBosses.push({ ruleId: rule.id, bossId: rule.bossId });
          }
        } else if (matched && rule.type === 'achievement') {
          result.triggeredEffectRuleIds.push(rule.id);
        }
      }

      return result;
    }
  };

  const RecommendationEngine = {
    createRule({ recommendation = {}, id } = {}) {
      if (!recommendation.id || !recommendation.name) {
        throw new Error('Recommendation requires an id and name');
      }
      const rule = clone(recommendation);
      delete rule.reason;
      rule.id = id || `rule-from-${recommendation.id}`;
      rule.sourceRecommendationId = recommendation.id;
      rule.enabled = true;
      rule.isSystem = false;
      return rule;
    }
  };

  function round(value, digits = 1) {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
  }

  function dateRange(history, timeframe, today) {
    const days = timeframe === 'monthly' ? 30 : 7;
    const end = new Date(`${today}T00:00:00Z`);
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - (days - 1));
    return history
      .filter(entry => entry && entry.date)
      .filter(entry => {
        const date = new Date(`${entry.date}T00:00:00Z`);
        return date >= start && date <= end;
      })
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  const Insights = {
    calculate(
      history,
      timeframe = 'weekly',
      today = new Date().toISOString().slice(0, 10),
      options = {}
    ) {
      const entries = dateRange(history, timeframe, today);
      const count = entries.length;
      const dailyBudget = Number(options.dailyBudget ?? 500);
      const total = metric => entries.reduce((sum, entry) => sum + (Number(entry[metric]) || 0), 0);
      const taskCompletion = entries.reduce((summary, entry) => {
        const possible = Math.max(0, Math.trunc(Number(entry.totalRuleCount) || 0));
        const completed = Math.min(
          possible,
          Math.max(0, Math.trunc(Number(entry.completedCount) || 0))
        );
        summary.completed += completed;
        summary.possible += possible;
        return summary;
      }, { completed: 0, possible: 0 });
      const taskCompletionPercent = taskCompletion.possible
        ? Math.round((taskCompletion.completed / taskCompletion.possible) * 100)
        : 0;
      const taskCompletionLabel = taskCompletion.possible
        ? `${taskCompletionPercent}%`
        : '尚無可計算資料';
      const labels = entries.map(entry => entry.date.slice(5).replace('-', '/'));
      const budgetSuccessDays = entries.filter(entry =>
        Number(entry.expense) <= (
          Number(entry.budgetLimitAtSettlement) > 0
            ? Number(entry.budgetLimitAtSettlement)
            : dailyBudget
        ) &&
        Number(entry.impulse) === 0
      ).length;
      const averageSleep = count ? round(total('sleep') / count) : 0;
      const averageWater = count ? Math.round(total('water') / count) : 0;
      const exerciseTotal = total('exercise');
      const hasEnoughData = count >= 3;
      const statusEvents = Array.isArray(options.statusHistory)
        ? options.statusHistory
            .filter(item => item?.event === 'applied' && toIsoDate(item.date))
            .slice()
            .sort((a, b) => a.date.localeCompare(b.date))
        : [];
      const summarizeStatuses = type => {
        const counts = new Map();
        statusEvents.filter(item => item.type === type).forEach(item => {
          const id = String(item.effectId || item.id || item.title || 'unknown');
          const current = counts.get(id) || {
            id,
            name: String(item.title || id),
            count: 0
          };
          current.count += 1;
          counts.set(id, current);
        });
        return [...counts.values()]
          .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
          .slice(0, 5);
      };

      return {
        sampleDays: count,
        hasEnoughData,
        averages: { sleep: averageSleep, water: averageWater },
        totals: {
          exercise: exerciseTotal,
          expense: total('expense')
        },
        budgetSuccessDays,
        taskCompletionPercent,
        taskCompletionCompleted: taskCompletion.completed,
        taskCompletionPossible: taskCompletion.possible,
        radar: [
          Math.min(20, round(averageWater / 125)),
          Math.min(20, round(averageSleep * 2)),
          Math.min(20, round((budgetSuccessDays / Math.max(count, 1)) * 20)),
          Math.min(20, round(taskCompletionPercent / 5))
        ],
        expLine: {
          labels,
          data: entries.map(entry => Number(entry.expGained) || 0)
        },
        goldLine: {
          labels,
          data: entries.map(entry => Number(entry.goldGained) || 0)
        },
        sleepLine: {
          labels,
          data: entries.map(entry => Number(entry.sleep) || 0)
        },
        exerciseBar: {
          labels,
          data: entries.map(entry => Number(entry.exercise) || 0)
        },
        expenseCategoryPie: {
          labels: ['必要／一般支出', '衝動購物'],
          data: [
            entries.filter(entry => Number(entry.impulse) === 0).length,
            entries.filter(entry => Number(entry.impulse) > 0).length
          ]
        },
        topBuffs: summarizeStatuses('buff'),
        topDebuffs: summarizeStatuses('debuff'),
        insightCards: {
          bestHabit: count ? `預算內且無衝動消費 ${budgetSuccessDays} 天` : '尚無資料',
          biggestImprovement: count ? `累積運動 ${exerciseTotal} 分鐘` : '尚無資料',
          mostFrequentBadHabit: count
            ? `衝動消費 ${entries.filter(entry => Number(entry.impulse) > 0).length} 天`
            : '尚無資料',
          priorityImprovement: averageSleep && averageSleep < 7
            ? '優先把平均睡眠提升至 7 小時'
            : '維持目前節奏並持續記錄'
        },
        aiAnalysis: hasEnoughData
          ? `依據最近 ${count} 天真實紀錄：平均睡眠 ${averageSleep} 小時、累積運動 ${exerciseTotal} 分鐘、任務完成率 ${taskCompletionLabel}。`
          : '累積至少 3 天冒險紀錄後，公會導師才能產生可信的評析。',
        summaryWidget: {
          bestHabit: count ? `理性消費 ${budgetSuccessDays} 天` : '等待真實資料',
          biggestWeakness: averageSleep && averageSleep < 7 ? '平均睡眠未達 7 小時' : '持續累積資料',
          taskCompletionPercent: taskCompletionLabel
        },
        heatmap: entries.map(entry => ({
          date: entry.date,
          level: (() => {
            const possible = Math.max(0, Math.trunc(Number(entry.totalRuleCount) || 0));
            const completed = Math.min(
              possible,
              Math.max(0, Math.trunc(Number(entry.completedCount) || 0))
            );
            return possible ? Math.round((completed / possible) * 4) : 0;
          })()
        }))
      };
    }
  };

  const AdvisorEngine = {
    analyze({
      history = [],
      today = new Date().toISOString().slice(0, 10),
      goal = null,
      dailyBudget = 500,
      statusHistory = [],
      habitEvents = [],
      character = {},
      debuffs = [],
      rules = []
    } = {}) {
      const periodEnd = toIsoDate(today);
      const periodStart = periodEnd ? addIsoDays(periodEnd, -6) : null;
      const entries = periodEnd ? dateRange(history, 'weekly', periodEnd) : [];
      const sampleDays = entries.length;
      const reliability = sampleDays >= 7
        ? 'reliable'
        : sampleDays >= 3 ? 'provisional' : 'insufficient';
      const insights = Insights.calculate(history, 'weekly', periodEnd || today, {
        dailyBudget,
        statusHistory
      });
      const total = metric => entries.reduce((sum, entry) => sum + (Number(entry?.[metric]) || 0), 0);
      const average = metric => sampleDays ? round(total(metric) / sampleDays) : 0;
      const activeRules = (Array.isArray(rules) ? rules : []).filter(rule => rule?.enabled !== false);
      const metricTarget = (metric, fallback) => {
        const direct = activeRules.find(rule =>
          rule.type === 'daily' && rule.metric === metric && Number.isFinite(Number(rule.targetValue))
        );
        if (direct) return Number(direct.targetValue);
        const compound = activeRules
          .filter(rule => rule.type === 'daily' && Array.isArray(rule.conditions))
          .flatMap(rule => rule.conditions)
          .find(condition => condition.metric === metric && Number.isFinite(Number(condition.targetValue)));
        return compound ? Number(compound.targetValue) : fallback;
      };
      const periodHabitEvents = (Array.isArray(habitEvents) ? habitEvents : []).filter(event =>
        event && !event.reversedAt && toIsoDate(event.date) && periodStart && periodEnd &&
        event.date >= periodStart && event.date <= periodEnd
      );
      const learningReports = periodHabitEvents.filter(event =>
        event.direction !== 'bad' && (event.habitKey === 'skill_practice' || event.habitId === 'skill_practice')
      ).length;
      const evidence = {
        averageSleep: average('sleep'),
        averageWater: Math.round(average('water')),
        averageExercise: average('exercise'),
        budgetSuccessDays: insights.budgetSuccessDays,
        taskCompletionPercent: insights.taskCompletionPercent,
        taskCompletionPossible: insights.taskCompletionPossible,
        learningReports
      };
      const sleepTarget = metricTarget('sleep', 7);
      const exerciseTarget = metricTarget('exercise', 30);
      const waterTarget = metricTarget('water', 2000);
      const currentDebuff = (Array.isArray(debuffs) ? debuffs : [])[0] || null;
      let priority = 'maintain';
      let advice = '';

      if ((Number(character.hp) || 0) > 0 && Number(character.hp) < 15) {
        priority = 'low_hp';
        advice = `目前生命值 ${Number(character.hp)}，請先避免新增負面事件，並確認公會補給是否足夠。`;
      } else if (currentDebuff) {
        priority = 'active_debuff';
        const expiry = toIsoDate(currentDebuff.expiresOn);
        advice = `目前受到「${String(currentDebuff.title || currentDebuff.id)}」影響${expiry ? `，將依有效期於 ${expiry} 自動判定` : ''}；請持續完成正式冒險紀錄。`;
      } else if (sampleDays < 3) {
        priority = 'insufficient_data';
        advice = `最近 7 個日曆日只有 ${sampleDays} 天有效紀錄；至少累積 3 天後，導師才會提出暫時評析。`;
      } else if (goal === 'sleep') {
        priority = evidence.averageSleep < sleepTarget ? 'sleep_gap' : 'sleep_maintain';
        advice = evidence.averageSleep < sleepTarget
          ? `最近 ${sampleDays} 天平均睡眠 ${evidence.averageSleep} 小時，低於主線目標 ${sleepTarget} 小時；本期先優先補足睡眠。`
          : `最近 ${sampleDays} 天平均睡眠 ${evidence.averageSleep} 小時，已達主線目標 ${sleepTarget} 小時；請維持目前節奏。`;
      } else if (goal === 'spending') {
        priority = evidence.budgetSuccessDays < sampleDays ? 'spending_gap' : 'spending_maintain';
        advice = evidence.budgetSuccessDays < sampleDays
          ? `最近 ${sampleDays} 天有 ${evidence.budgetSuccessDays} 天符合當日預算且無衝動消費；請先改善未達標日期。`
          : `最近 ${sampleDays} 天皆符合當日預算且無衝動消費；請維持目前節奏。`;
      } else if (goal === 'exercise') {
        priority = evidence.averageExercise < exerciseTarget ? 'exercise_gap' : 'exercise_maintain';
        advice = evidence.averageExercise < exerciseTarget
          ? `最近 ${sampleDays} 天平均運動 ${evidence.averageExercise} 分鐘，低於主線目標 ${exerciseTarget} 分鐘；本期先提高規律活動量。`
          : `最近 ${sampleDays} 天平均運動 ${evidence.averageExercise} 分鐘，已達主線目標 ${exerciseTarget} 分鐘；請維持目前節奏。`;
      } else if (goal === 'learning') {
        priority = learningReports > 0 ? 'learning_maintain' : 'learning_gap';
        advice = learningReports > 0
          ? `最近 7 個日曆日留下 ${learningReports} 次技能訓練回報；請維持可持續的練習節奏。`
          : '最近 7 個日曆日尚無技能訓練回報；先完成一次主線訓練，再依紀錄調整節奏。';
      } else if (evidence.averageWater < waterTarget) {
        priority = 'water_gap';
        advice = `最近 ${sampleDays} 天平均飲水 ${evidence.averageWater} ml，低於法典目標 ${waterTarget} ml。`;
      } else if (!evidence.taskCompletionPossible) {
        priority = 'task_data_missing';
        advice = `最近 ${sampleDays} 天尚無可計算的任務總數；請先完成每日結算，再由公會導師評估完成率。`;
      } else {
        advice = `最近 ${sampleDays} 天任務完成率 ${evidence.taskCompletionPercent}%；目前沒有需要新增的優先法則。`;
      }

      return {
        periodStart,
        periodEnd,
        sampleDays,
        reliability,
        goal,
        priority,
        evidence,
        advice,
        recommendation: null
      };
    }
  };

  function longestConsecutiveMatch(entries, predicate) {
    let longest = 0;
    let current = 0;
    let previousDate = null;
    const sorted = entries
      .filter(entry => entry && entry.date)
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date));

    for (const entry of sorted) {
      if (!predicate(entry)) {
        current = 0;
        previousDate = entry.date;
        continue;
      }
      const consecutive = previousDate && datesAreConsecutive([
        { date: previousDate },
        { date: entry.date }
      ]);
      current = consecutive ? current + 1 : 1;
      longest = Math.max(longest, current);
      previousDate = entry.date;
    }
    return longest;
  }

  function achievementProgress(definition, context) {
    const condition = definition.condition || {};
    const history = Array.isArray(context.history) ? context.history : [];
    const target = Math.max(1, Number(definition.target) || 1);

    if (condition.kind === 'metric_consecutive') {
      const conditions = Array.isArray(condition.conditions) ? condition.conditions : [];
      return longestConsecutiveMatch(history, entry =>
        conditions.length > 0 && conditions.every(item =>
          compare(entry[item.metric], item.operator, item.targetValue)
        )
      );
    }

    if (condition.kind === 'perfect_day_consecutive') {
      return longestConsecutiveMatch(history, entry =>
        Number(entry.totalRuleCount) > 0 &&
        Number(entry.completedCount) >= Number(entry.totalRuleCount)
      );
    }

    if (condition.kind === 'character_value') {
      return Math.max(0, Number((context.character || {})[condition.field]) || 0);
    }

    if (condition.kind === 'context_flag') {
      return (context.flags || {})[condition.flag] ? target : 0;
    }

    if (condition.kind === 'habit_daily_count') {
      const counts = new Map();
      (Array.isArray(context.habitEvents) ? context.habitEvents : [])
        .filter(event => !event.reversedAt)
        .filter(event => !condition.titleIncludes || String(event.title || '').includes(condition.titleIncludes))
        .forEach(event => {
          const key = event.date || '';
          counts.set(key, (counts.get(key) || 0) + 1);
        });
      return Math.max(0, ...counts.values());
    }

    if (condition.kind === 'budget_success_days') {
      return history.filter(entry => {
        const budget = Number(entry.budgetLimitAtSettlement);
        return budget > 0 && Number(entry.expense) <= budget && Number(entry.impulse) === 0;
      }).length;
    }

    return Math.max(0, Number(definition.progress) || 0);
  }

  const AchievementEngine = {
    evaluate({
      achievements = [],
      history = [],
      habitEvents = [],
      character = {},
      flags = {},
      today = new Date().toISOString().slice(0, 10)
    }) {
      const newlyUnlockedIds = [];
      const evaluated = achievements.map(item => {
        const achievement = clone(item);
        const target = Math.max(1, Number(achievement.target) || 1);
        const progress = Math.min(target, achievementProgress(achievement, {
          history,
          habitEvents,
          character,
          flags
        }));
        achievement.target = target;
        achievement.progress = achievement.unlocked ? target : progress;
        if (!achievement.unlocked && progress >= target) {
          achievement.unlocked = true;
          achievement.unlockedAt = today;
          newlyUnlockedIds.push(achievement.id);
        }
        return achievement;
      });

      return { achievements: evaluated, newlyUnlockedIds };
    }
  };

  const AchievementRewardEngine = {
    evaluateAndGrant({
      achievements = [],
      history = [],
      habitEvents = [],
      character = {},
      flags = {},
      today = new Date().toISOString().slice(0, 10),
      rewardGems = 5
    }) {
      const evaluation = AchievementEngine.evaluate({
        achievements,
        history,
        habitEvents,
        character,
        flags,
        today
      });
      const nextCharacter = clone(character);
      const gemsGranted = evaluation.newlyUnlockedIds.length * (Number(rewardGems) || 0);
      nextCharacter.gems = (Number(nextCharacter.gems) || 0) + gemsGranted;
      return {
        achievements: evaluation.achievements,
        character: nextCharacter,
        newlyUnlockedIds: evaluation.newlyUnlockedIds,
        gemsGranted
      };
    }
  };

  function captureHabitSnapshot(state) {
    return {
      character: clone(state.character || {}),
      boss: clone(state.boss || {}),
      achievements: clone(state.achievements || []),
      bossHistory: clone(state.bossHistory || []),
      bossTransactions: clone(state.bossTransactions || []),
      processedBossIncidentKeys: clone(
        state.meta?.processedBossIncidentKeys || []
      )
    };
  }

  const HabitEngine = {
    captureSnapshot: captureHabitSnapshot,

    createEvent({
      id,
      habit,
      date,
      character = {},
      boss = {},
      operationKey = null,
      rewardGranted = true,
      createdAt = new Date().toISOString()
    }) {
      if (!habit || !habit.id) throw new Error('Habit event requires a habit');
      const isBadHabit = habit.direction === 'bad';
      const attributes = character.attributes || {};
      const equipped = character.equipped || {};
      let effect;
      if (isBadHabit) {
        const damage = equipped.armor === 'armor_shield' ? 3 : 5;
        effect = { xp: 0, gold: 0, hp: -damage, bossDamage: 0 };
      } else {
        const xp = 3 + Math.floor((Number(attributes.growth) || 0) / 4);
        const gold = 2 + (equipped.pet === 'pet_cactus' ? 1 : 0);
        // Boss damage is reserved for the data-defined recovery challenge.
        // Generic habit reports still grant their normal training reward, but
        // cannot be spammed to bypass the challenge's once-per-date guard.
        effect = { xp, gold, hp: 0, bossDamage: 0 };
      }
      if (!isBadHabit && !rewardGranted) {
        effect = { xp: 0, gold: 0, hp: 0, bossDamage: 0 };
      }
      return {
        id: id || `habit-${date}-${Date.now()}`,
        habitId: habit.id,
        habitKey: habit.systemKey || habit.id,
        operationKey: operationKey || id || `habit-operation-${date}-${Date.now()}`,
        title: String(habit.title || ''),
        direction: isBadHabit ? 'bad' : 'good',
        date,
        createdAt,
        reversedAt: null,
        dailyInput: clone(habit.dailyInput || null),
        rewardGranted: !isBadHabit && Boolean(rewardGranted),
        rewardPolicyVersion: 1,
        beforeCount: Number(habit.count) || 0,
        beforeDailyCount: Number((habit.dailyCounts || {})[date]) || 0,
        effect
      };
    },

    prepareEvent({
      id,
      habit,
      date,
      character = {},
      boss = {},
      existingEvents = [],
      operationKey,
      createdAt = new Date().toISOString()
    } = {}) {
      if (!habit?.id || !toIsoDate(date) || !operationKey) {
        return { ok: false, reason: 'invalid_event', event: null };
      }
      const events = Array.isArray(existingEvents) ? existingEvents : [];
      if (events.some(event => !event.reversedAt && event.operationKey === operationKey)) {
        return { ok: false, reason: 'duplicate_operation', event: null };
      }
      const habitKey = habit.systemKey || habit.id;
      const sameDayEvents = events.filter(event =>
        event && !event.reversedAt &&
        toIsoDate(event.date) === toIsoDate(date) &&
        (event.habitKey || event.habitId) === habitKey
      );
      const policy = isPlainObject(habit.rewardPolicy) ? habit.rewardPolicy : {};
      const maxDailyReports = Math.max(1, Number(policy.maxDailyReports) || 10);
      const configuredRewardLimit = Number.isFinite(Number(policy.maxDailyRewards))
        ? Math.max(0, Number(policy.maxDailyRewards))
        : 3;
      const maxDailyRewards = habit.isSystem
        ? configuredRewardLimit
        : habit.direction === 'bad' ? 0 : Math.min(1, configuredRewardLimit);
      if (sameDayEvents.length >= maxDailyReports) {
        return { ok: false, reason: 'daily_report_limit', event: null, maxDailyReports };
      }
      const rewardedCount = sameDayEvents.filter(event => event.rewardGranted).length;
      const rewardGranted = habit.direction !== 'bad' && rewardedCount < maxDailyRewards;
      const event = this.createEvent({
        id,
        habit,
        date,
        character,
        boss,
        operationKey,
        rewardGranted,
        createdAt
      });
      return {
        ok: true,
        reason: rewardGranted || habit.direction === 'bad' ? null : 'reward_limit_reached',
        event,
        rewardGranted,
        recordedCount: sameDayEvents.length + 1,
        rewardedCount: rewardedCount + (rewardGranted ? 1 : 0),
        maxDailyReports,
        maxDailyRewards
      };
    },

    auditDaily({ events = [], tasks = [], date } = {}) {
      const activeEvents = (Array.isArray(events) ? events : [])
        .filter(event => event && !event.reversedAt && toIsoDate(event.date) === toIsoDate(date));
      const seenOperations = new Set();
      const duplicateOperationKeys = [];
      const summary = {};
      activeEvents.forEach(event => {
        if (event.operationKey && seenOperations.has(event.operationKey)) {
          duplicateOperationKeys.push(event.operationKey);
        }
        if (event.operationKey) seenOperations.add(event.operationKey);
        const identity = event.habitKey || event.habitId;
        summary[identity] = summary[identity] || { recordedCount: 0, rewardedCount: 0, rewardLimit: null };
        summary[identity].recordedCount += 1;
        if (event.rewardGranted) summary[identity].rewardedCount += 1;
        const task = (Array.isArray(tasks) ? tasks : []).find(item =>
          (item.systemKey || item.id) === identity || item.id === event.habitId
        );
        if (task?.rewardPolicy) {
          summary[identity].rewardLimit = Math.max(0, Number(task.rewardPolicy.maxDailyRewards) || 0);
        }
      });
      const overRewardedKeys = Object.entries(summary)
        .filter(([, item]) => item.rewardLimit !== null && item.rewardedCount > item.rewardLimit)
        .map(([key]) => key);
      return {
        valid: duplicateOperationKeys.length === 0 && overRewardedKeys.length === 0,
        activeEventCount: activeEvents.length,
        duplicateOperationKeys: [...new Set(duplicateOperationKeys)],
        overRewardedKeys,
        summary
      };
    },

    undo({ state, eventId, reversedAt = new Date().toISOString() }) {
      const nextState = clone(state);
      const events = Array.isArray(nextState.habitEvents) ? nextState.habitEvents : [];
      const event = events.find(item => item.id === eventId);
      if (!event) return { ok: false, reason: 'not_found', state: nextState };
      if (event.reversedAt) return { ok: false, reason: 'already_reversed', state: nextState };
      const latest = events.slice().reverse().find(item => !item.reversedAt);
      if (!latest || latest.id !== event.id) {
        return { ok: false, reason: 'not_latest', state: nextState };
      }
      if (!event.beforeSnapshot || !event.afterSnapshot) {
        return { ok: false, reason: 'missing_snapshot', state: nextState };
      }
      if (JSON.stringify(captureHabitSnapshot(nextState)) !== JSON.stringify(event.afterSnapshot)) {
        return { ok: false, reason: 'state_changed', state: nextState };
      }

      nextState.character = clone(event.beforeSnapshot.character);
      nextState.boss = clone(event.beforeSnapshot.boss);
      nextState.achievements = clone(event.beforeSnapshot.achievements);
      nextState.bossHistory = clone(event.beforeSnapshot.bossHistory || []);
      nextState.bossTransactions = clone(event.beforeSnapshot.bossTransactions || []);
      nextState.meta = nextState.meta || {};
      nextState.meta.processedBossIncidentKeys = clone(
        event.beforeSnapshot.processedBossIncidentKeys || []
      );
      const habit = (nextState.tasks || []).find(item => item.id === event.habitId);
      if (habit) {
        habit.count = Number(event.beforeCount) || 0;
        habit.dailyCounts = habit.dailyCounts || {};
        habit.dailyCounts[event.date] = Number(event.beforeDailyCount) || 0;
      }
      event.reversedAt = reversedAt;
      return { ok: true, reason: null, state: nextState, event: clone(event) };
    }
  };

  const EquipmentEngine = {
    equip({ character = {}, items = [], itemId }) {
      const nextCharacter = clone(character);
      nextCharacter.attributes = nextCharacter.attributes || {};
      nextCharacter.equipped = nextCharacter.equipped || {};
      const item = items.find(candidate => candidate.id === itemId);
      if (!item || !['weapon', 'armor', 'pet'].includes(item.type)) {
        return { character: nextCharacter, changed: false, previousItemId: null };
      }

      const slot = item.type;
      const previousItemId = nextCharacter.equipped[slot] || null;
      if (previousItemId === item.id) {
        return { character: nextCharacter, changed: false, previousItemId };
      }

      const previousItem = items.find(candidate => candidate.id === previousItemId);
      for (const [attribute, amount] of Object.entries(previousItem?.attr || {})) {
        nextCharacter.attributes[attribute] = Math.max(
          1,
          (Number(nextCharacter.attributes[attribute]) || 0) - Number(amount)
        );
      }
      nextCharacter.equipped[slot] = item.id;
      for (const [attribute, amount] of Object.entries(item.attr || {})) {
        nextCharacter.attributes[attribute] =
          (Number(nextCharacter.attributes[attribute]) || 0) + Number(amount);
      }

      return { character: nextCharacter, changed: true, previousItemId };
    },

    unequipAll({ character = {}, items = [] } = {}) {
      const nextCharacter = clone(character);
      nextCharacter.attributes = nextCharacter.attributes || {};
      nextCharacter.equipped = nextCharacter.equipped || {};
      const unequippedItemIds = [];
      ['weapon', 'armor', 'pet'].forEach(slot => {
        const itemId = nextCharacter.equipped[slot] || null;
        if (!itemId) {
          nextCharacter.equipped[slot] = null;
          return;
        }
        const item = (Array.isArray(items) ? items : []).find(candidate => candidate.id === itemId);
        Object.entries(item?.attr || {}).forEach(([attribute, amount]) => {
          nextCharacter.attributes[attribute] = Math.max(
            1,
            (Number(nextCharacter.attributes[attribute]) || 0) - Number(amount || 0)
          );
        });
        unequippedItemIds.push(itemId);
        nextCharacter.equipped[slot] = null;
      });
      return { character: nextCharacter, unequippedItemIds };
    }
  };

  const SupplyEngine = {
    acquire({
      character = {},
      inventory = [],
      transactions = [],
      items = [],
      itemId,
      transactionId,
      purchasedAt = new Date().toISOString(),
      cost = null
    } = {}) {
      const nextCharacter = clone(character);
      const nextInventory = Array.isArray(inventory) ? clone(inventory) : [];
      const nextTransactions = Array.isArray(transactions) ? clone(transactions) : [];
      const item = items.find(candidate => candidate.id === itemId);
      if (!item || !['weapon', 'armor', 'pet'].includes(item.type)) {
        return {
          ok: false,
          reason: 'invalid_item',
          character: nextCharacter,
          inventory: nextInventory,
          transactions: nextTransactions
        };
      }
      if (!transactionId || nextTransactions.some(transaction => transaction.id === transactionId)) {
        return {
          ok: false,
          reason: 'duplicate_transaction',
          character: nextCharacter,
          inventory: nextInventory,
          transactions: nextTransactions
        };
      }

      const owned = nextInventory.includes(item.id);
      if (owned) {
        const equipped = EquipmentEngine.equip({
          character: nextCharacter,
          items,
          itemId: item.id
        });
        return {
          ok: equipped.changed,
          reason: equipped.changed ? 'equipped_owned' : 'already_equipped',
          character: equipped.character,
          inventory: nextInventory,
          transactions: nextTransactions
        };
      }

      const price = Math.max(0, Number(cost ?? item.cost) || 0);
      if ((Number(nextCharacter.gold) || 0) < price) {
        return {
          ok: false,
          reason: 'insufficient_gold',
          character: nextCharacter,
          inventory: nextInventory,
          transactions: nextTransactions
        };
      }

      nextCharacter.gold = (Number(nextCharacter.gold) || 0) - price;
      nextInventory.push(item.id);
      const previousItemId = nextCharacter.equipped?.[item.type] || null;
      const equipped = EquipmentEngine.equip({
        character: nextCharacter,
        items,
        itemId: item.id
      });
      nextTransactions.push({
        id: transactionId,
        type: 'equipment_purchase',
        itemId: item.id,
        itemName: String(item.title || item.id),
        cost: price,
        currency: 'gold',
        occurredAt: purchasedAt,
        slot: item.type,
        previousItemId
      });
      return {
        ok: true,
        reason: 'purchased_and_equipped',
        character: equipped.character,
        inventory: nextInventory,
        transactions: nextTransactions
      };
    },

    reversePurchase({
      character = {},
      inventory = [],
      transactions = [],
      items = [],
      transactionId,
      correctionId,
      correctedAt = new Date().toISOString()
    } = {}) {
      const nextCharacter = clone(character);
      nextCharacter.attributes = nextCharacter.attributes || {};
      nextCharacter.equipped = nextCharacter.equipped || {};
      const nextInventory = Array.isArray(inventory) ? clone(inventory) : [];
      const nextTransactions = Array.isArray(transactions) ? clone(transactions) : [];
      const original = nextTransactions.find(transaction => transaction.id === transactionId);
      if (!original || original.type !== 'equipment_purchase') {
        return { ok: false, reason: 'not_reversible', character: nextCharacter, inventory: nextInventory, transactions: nextTransactions };
      }
      if (nextTransactions.some(transaction => transaction.correctsTransactionId === original.id)) {
        return { ok: false, reason: 'already_corrected', character: nextCharacter, inventory: nextInventory, transactions: nextTransactions };
      }
      if (!correctionId || nextTransactions.some(transaction => transaction.id === correctionId)) {
        return { ok: false, reason: 'duplicate_correction', character: nextCharacter, inventory: nextInventory, transactions: nextTransactions };
      }
      const item = items.find(candidate => candidate.id === original.itemId);
      const inventoryIndex = nextInventory.indexOf(original.itemId);
      if (!item || inventoryIndex < 0) {
        return { ok: false, reason: 'item_unavailable', character: nextCharacter, inventory: nextInventory, transactions: nextTransactions };
      }

      const slot = original.slot || item.type;
      if (nextCharacter.equipped[slot] === item.id) {
        Object.entries(item.attr || {}).forEach(([attribute, amount]) => {
          nextCharacter.attributes[attribute] = Math.max(
            1,
            (Number(nextCharacter.attributes[attribute]) || 0) - Number(amount || 0)
          );
        });
        nextCharacter.equipped[slot] = null;
        const previousItemId = original.previousItemId || null;
        if (previousItemId && nextInventory.includes(previousItemId)) {
          const restored = EquipmentEngine.equip({ character: nextCharacter, items, itemId: previousItemId });
          Object.assign(nextCharacter, restored.character);
        }
      }
      nextInventory.splice(inventoryIndex, 1);
      const refund = Math.max(0, Number(original.cost) || 0);
      nextCharacter.gold = (Number(nextCharacter.gold) || 0) + refund;
      nextTransactions.push({
        id: correctionId,
        type: 'equipment_purchase_correction',
        correctsTransactionId: original.id,
        itemId: original.itemId,
        itemName: original.itemName,
        amount: refund,
        currency: original.currency || 'gold',
        occurredAt: correctedAt,
        reason: 'user_correction'
      });
      return {
        ok: true,
        reason: null,
        character: nextCharacter,
        inventory: nextInventory,
        transactions: nextTransactions,
        refund,
        itemId: original.itemId
      };
    }
  };

  const DailyGemEngine = {
    grantPerfectDay({
      character = {},
      transactions = [],
      date,
      completedCount,
      totalRuleCount,
      transactionId,
      grantedAt = new Date().toISOString()
    } = {}) {
      const nextCharacter = clone(character);
      const nextTransactions = Array.isArray(transactions) ? clone(transactions) : [];
      const normalizedDate = toIsoDate(date);
      const perfect = Number(totalRuleCount) > 0 && Number(completedCount) >= Number(totalRuleCount);
      if (!normalizedDate || !perfect) {
        return { character: nextCharacter, transactions: nextTransactions, granted: 0, reason: 'not_perfect' };
      }
      if (nextTransactions.some(transaction =>
        transaction.type === 'daily_perfect' && transaction.date === normalizedDate
      )) {
        return { character: nextCharacter, transactions: nextTransactions, granted: 0, reason: 'already_granted' };
      }
      if (!transactionId || nextTransactions.some(transaction => transaction.id === transactionId)) {
        return { character: nextCharacter, transactions: nextTransactions, granted: 0, reason: 'duplicate_transaction' };
      }
      nextCharacter.gems = (Number(nextCharacter.gems) || 0) + 1;
      nextTransactions.push({
        id: transactionId,
        type: 'daily_perfect',
        date: normalizedDate,
        amount: 1,
        currency: 'gems',
        occurredAt: grantedAt
      });
      return { character: nextCharacter, transactions: nextTransactions, granted: 1, reason: null };
    }
  };

  const RewardTicketEngine = {
    redeem({
      character = {},
      tickets = [],
      transactions = [],
      catalog = [],
      ticketId,
      transactionId,
      redeemedAt = new Date().toISOString()
    } = {}) {
      const nextCharacter = clone(character);
      const nextTickets = Array.isArray(tickets) ? clone(tickets) : [];
      const nextTransactions = Array.isArray(transactions) ? clone(transactions) : [];
      const definition = catalog.find(item => item.id === ticketId);
      if (!definition) {
        return { ok: false, reason: 'invalid_ticket', character: nextCharacter, tickets: nextTickets, transactions: nextTransactions, ticket: null };
      }
      if (!transactionId || nextTransactions.some(transaction => transaction.id === transactionId)) {
        return { ok: false, reason: 'duplicate_transaction', character: nextCharacter, tickets: nextTickets, transactions: nextTransactions, ticket: null };
      }
      const price = Math.max(0, Number(definition.cost) || 0);
      if ((Number(nextCharacter.gems) || 0) < price) {
        return { ok: false, reason: 'insufficient_gems', character: nextCharacter, tickets: nextTickets, transactions: nextTransactions, ticket: null };
      }
      nextCharacter.gems = (Number(nextCharacter.gems) || 0) - price;
      const ticket = {
        id: `reward-ticket-${transactionId}`,
        catalogId: definition.id,
        nameSnapshot: String(definition.title || definition.id),
        descriptionSnapshot: String(definition.description || ''),
        costSnapshot: price,
        status: 'unused',
        redeemedAt,
        usedAt: null,
        reversedAt: null,
        transactionId
      };
      nextTickets.push(ticket);
      nextTransactions.push({
        id: transactionId,
        type: 'reward_ticket_redeem',
        ticketInstanceId: ticket.id,
        catalogId: definition.id,
        amount: -price,
        currency: 'gems',
        occurredAt: redeemedAt
      });
      return { ok: true, reason: null, character: nextCharacter, tickets: nextTickets, transactions: nextTransactions, ticket: clone(ticket) };
    },

    use({ tickets = [], ownedTicketId, usedAt = new Date().toISOString() } = {}) {
      const nextTickets = Array.isArray(tickets) ? clone(tickets) : [];
      const ticket = nextTickets.find(item => item.id === ownedTicketId);
      if (!ticket) return { ok: false, reason: 'missing_ticket', tickets: nextTickets, ticket: null };
      if (ticket.status !== 'unused') {
        return { ok: false, reason: ticket.status === 'used' ? 'already_used' : 'already_reversed', tickets: nextTickets, ticket: clone(ticket) };
      }
      ticket.status = 'used';
      ticket.usedAt = usedAt;
      return { ok: true, reason: null, tickets: nextTickets, ticket: clone(ticket) };
    },

    reverse({
      character = {},
      tickets = [],
      transactions = [],
      ownedTicketId,
      reversedAt = new Date().toISOString()
    } = {}) {
      const nextCharacter = clone(character);
      const nextTickets = Array.isArray(tickets) ? clone(tickets) : [];
      const nextTransactions = Array.isArray(transactions) ? clone(transactions) : [];
      const ticket = nextTickets.find(item => item.id === ownedTicketId);
      if (!ticket) {
        return { ok: false, reason: 'missing_ticket', character: nextCharacter, tickets: nextTickets, transactions: nextTransactions, ticket: null };
      }
      if (ticket.status !== 'unused') {
        return {
          ok: false,
          reason: ticket.status === 'used' ? 'already_used' : 'already_reversed',
          character: nextCharacter,
          tickets: nextTickets,
          transactions: nextTransactions,
          ticket: clone(ticket)
        };
      }
      const refundId = `refund-${ticket.transactionId}`;
      if (nextTransactions.some(transaction => transaction.id === refundId)) {
        return { ok: false, reason: 'duplicate_refund', character: nextCharacter, tickets: nextTickets, transactions: nextTransactions, ticket: clone(ticket) };
      }
      const refund = Math.max(0, Number(ticket.costSnapshot) || 0);
      nextCharacter.gems = (Number(nextCharacter.gems) || 0) + refund;
      ticket.status = 'reversed';
      ticket.reversedAt = reversedAt;
      nextTransactions.push({
        id: refundId,
        type: 'reward_ticket_refund',
        ticketInstanceId: ticket.id,
        amount: refund,
        currency: 'gems',
        occurredAt: reversedAt
      });
      return { ok: true, reason: null, character: nextCharacter, tickets: nextTickets, transactions: nextTransactions, ticket: clone(ticket) };
    }
  };

  const PROFESSION_NAMES = new Set(['戰士', '法師', '盜賊', '牧師']);
  const ProfessionEngine = {
    setIdentity({ character = {}, profession } = {}) {
      const nextCharacter = clone(character);
      if (!PROFESSION_NAMES.has(profession)) {
        return { ok: false, reason: 'invalid_profession', character: nextCharacter };
      }
      nextCharacter.class = profession;
      return { ok: true, reason: null, character: nextCharacter };
    }
  };

  const BossEngine = {
    summon({
      boss = {},
      definitions = [],
      candidates = [],
      today,
      processedIncidentKeys = []
    }) {
      const currentBoss = clone(boss);
      const processed = new Set(processedIncidentKeys);
      const datedCandidates = Array.isArray(candidates) && today
        ? candidates
            .filter(candidate => candidate?.ruleId && candidate?.bossId)
            .map(candidate => ({
              ...candidate,
              incidentKey: `${candidate.ruleId}:${today}`
            }))
        : [];
      const unseenCandidates = datedCandidates.filter(
        candidate => !processed.has(candidate.incidentKey)
      );

      if (currentBoss.active || unseenCandidates.length === 0) {
        return {
          boss: currentBoss,
          summoned: false,
          selected: null,
          processedIncidentKeys: [...processed]
        };
      }

      const eligible = unseenCandidates
        .map(candidate => ({
          candidate,
          definition: definitions.find(item => item.id === candidate.bossId)
        }))
        .filter(item => item.definition)
        .sort((a, b) =>
          (Number(b.definition.priority) || 0) - (Number(a.definition.priority) || 0)
        );
      const selected = eligible[0];
      if (!selected) {
        return {
          boss: currentBoss,
          summoned: false,
          selected: null,
          processedIncidentKeys: [...processed]
        };
      }

      eligible.forEach(item => processed.add(item.candidate.incidentKey));

      const definition = selected.definition;
      const maxHp = Math.max(1, Number(definition.maxHp) || 100);
      const nextBoss = {
        id: definition.id,
        name: String(definition.name || definition.id),
        icon: String(definition.icon || '👾'),
        description: String(definition.description || ''),
        hp: maxHp,
        maxHp,
        active: true,
        type: definition.type || definition.id,
        triggerRuleId: selected.candidate.ruleId,
        incidentKey: selected.candidate.incidentKey,
        summonedAt: today,
        summonedOn: toIsoDate(today),
        rewards: clone(definition.rewards || { gold: 150, gems: 3 }),
        challenge: {
          ...clone(definition.challenge || {}),
          progress: 0,
          lastProgressDate: null
        }
      };

      return {
        boss: nextBoss,
        summoned: true,
        selected: clone(selected.candidate),
        processedIncidentKeys: [...processed]
      };
    },

    advanceChallenge({
      boss = {},
      character = {},
      entry = {},
      habitEvents = [],
      settings = {}
    }) {
      const nextBoss = clone(boss);
      const nextCharacter = clone(character);
      const date = toIsoDate(entry?.date);
      if (!nextBoss.active || !nextBoss.challenge) {
        return {
          boss: nextBoss,
          character: nextCharacter,
          advanced: false,
          reset: false,
          reason: 'inactive',
          damage: 0,
          defeated: false,
          rewards: { gold: 0, gems: 0 }
        };
      }
      if (!date) {
        return {
          boss: nextBoss,
          character: nextCharacter,
          advanced: false,
          reset: false,
          reason: 'missing_date',
          damage: 0,
          defeated: false,
          rewards: { gold: 0, gems: 0 }
        };
      }

      const summonedOn = toIsoDate(nextBoss.summonedOn || nextBoss.summonedAt);
      if (summonedOn && date < summonedOn) {
        return {
          boss: nextBoss,
          character: nextCharacter,
          advanced: false,
          reset: false,
          reason: 'before_summon',
          damage: 0,
          defeated: false,
          rewards: { gold: 0, gems: 0 }
        };
      }

      const challenge = nextBoss.challenge;
      if (challenge.lastProgressDate === date) {
        return {
          boss: nextBoss,
          character: nextCharacter,
          advanced: false,
          reset: false,
          reason: 'duplicate_date',
          damage: 0,
          defeated: false,
          rewards: { gold: 0, gems: 0 }
        };
      }

      let matched = false;
      if (challenge.source === 'habitEvents') {
        const count = habitEvents
          .filter(event => event && !event.reversedAt)
          .filter(event => event.date === date)
          .filter(event => {
            if (challenge.habitKey) return (event.habitKey || event.habitId) === challenge.habitKey;
            return !challenge.habitId || event.habitId === challenge.habitId;
          })
          .length;
        matched = compare(
          count,
          challenge.operator || '==',
          Number(challenge.targetValue) || 0
        );
      } else {
        const conditions = Array.isArray(challenge.conditions)
          ? challenge.conditions
          : [];
        matched = conditions.length > 0 && conditions.every(condition => {
          const expected = condition.setting === 'dailyBudget'
            ? (
                Number(entry.budgetLimitAtSettlement) > 0
                  ? Number(entry.budgetLimitAtSettlement)
                  : settings.dailyBudget
              )
            : condition.setting
              ? settings[condition.setting]
              : condition.targetValue;
          return compare(entry[condition.metric], condition.operator, expected);
        });
      }

      const priorDate = challenge.lastProgressDate;
      const wasConsecutive = !priorDate || datesAreConsecutive([
        { date: priorDate },
        { date }
      ]);
      challenge.lastProgressDate = date;
      if (!matched) {
        const reset = Number(challenge.progress) > 0;
        challenge.progress = 0;
        return {
          boss: nextBoss,
          character: nextCharacter,
          advanced: false,
          reset,
          reason: 'condition_failed',
          damage: 0,
          defeated: false,
          rewards: { gold: 0, gems: 0 }
        };
      }

      challenge.progress = wasConsecutive
        ? (Number(challenge.progress) || 0) + 1
        : 1;
      const target = Math.max(1, Number(challenge.target) || 1);
      let damage = Math.ceil((Number(nextBoss.maxHp) || 100) / target);
      const equipped = nextCharacter.equipped || {};
      if (equipped.weapon === 'weapon_sword') damage += 5;
      if (equipped.pet === 'pet_dragon') damage *= 2;
      const damageResult = this.damage({
        boss: nextBoss,
        character: nextCharacter,
        amount: damage,
        defeatRewards: nextBoss.rewards || { gold: 150, gems: 3 }
      });
      return {
        ...damageResult,
        advanced: true,
        reset: !wasConsecutive,
        reason: null,
        damage
      };
    },

    damage({ boss = {}, character = {}, amount, defeatRewards = { gold: 150, gems: 3 } }) {
      const nextBoss = clone(boss);
      const nextCharacter = clone(character);
      const damage = Math.max(0, Number(amount) || 0);
      if (!nextBoss.active || damage === 0) {
        return {
          boss: nextBoss,
          character: nextCharacter,
          applied: false,
          defeated: false,
          rewards: { gold: 0, gems: 0 }
        };
      }

      nextBoss.hp = Math.max(0, (Number(nextBoss.hp) || 0) - damage);
      const defeated = nextBoss.hp === 0;
      const rewards = defeated
        ? {
            gold: Number(defeatRewards.gold) || 0,
            gems: Number(defeatRewards.gems) || 0
          }
        : { gold: 0, gems: 0 };
      if (defeated) {
        nextBoss.active = false;
        nextBoss.challenge = null;
        nextCharacter.gold = (Number(nextCharacter.gold) || 0) + rewards.gold;
        nextCharacter.gems = (Number(nextCharacter.gems) || 0) + rewards.gems;
      }

      return {
        boss: nextBoss,
        character: nextCharacter,
        applied: true,
        defeated,
        rewards
      };
    },

    recordAction({
      transactions = [],
      id,
      actionType,
      incidentKey,
      actionDate,
      before,
      after,
      occurredAt = new Date().toISOString()
    } = {}) {
      const nextTransactions = Array.isArray(transactions) ? clone(transactions) : [];
      if (!id || nextTransactions.some(transaction => transaction.id === id)) {
        return { ok: false, reason: 'duplicate_transaction', transactions: nextTransactions };
      }
      if (!isPlainObject(before) || !isPlainObject(after)) {
        return { ok: false, reason: 'invalid_snapshot', transactions: nextTransactions };
      }
      nextTransactions.push({
        id,
        type: 'boss_action',
        actionType: actionType || 'unknown',
        incidentKey: incidentKey || after.boss?.incidentKey || before.boss?.incidentKey || null,
        actionDate: toIsoDate(actionDate),
        before: clone(before),
        after: clone(after),
        occurredAt
      });
      return { ok: true, reason: null, transactions: nextTransactions };
    },

    correctLatest({
      boss = {},
      character = {},
      bossHistory = [],
      achievements = [],
      processedIncidentKeys = [],
      transactions = [],
      correctionId,
      correctedAt = new Date().toISOString()
    } = {}) {
      const nextTransactions = Array.isArray(transactions) ? clone(transactions) : [];
      const correctedIds = new Set(nextTransactions
        .filter(transaction => transaction.type === 'boss_correction')
        .map(transaction => transaction.correctsTransactionId));
      const original = [...nextTransactions].reverse().find(transaction =>
        transaction.type === 'boss_action' && !correctedIds.has(transaction.id)
      );
      if (!original) {
        return { ok: false, reason: 'nothing_to_correct', boss: clone(boss), character: clone(character), bossHistory: clone(bossHistory), achievements: clone(achievements), processedIncidentKeys: clone(processedIncidentKeys), transactions: nextTransactions };
      }
      if (!correctionId || nextTransactions.some(transaction => transaction.id === correctionId)) {
        return { ok: false, reason: 'duplicate_correction', boss: clone(boss), character: clone(character), bossHistory: clone(bossHistory), achievements: clone(achievements), processedIncidentKeys: clone(processedIncidentKeys), transactions: nextTransactions };
      }
      const current = { boss, character, bossHistory, achievements, processedIncidentKeys };
      if (stableStringify(current) !== stableStringify(original.after)) {
        return { ok: false, reason: 'state_changed', boss: clone(boss), character: clone(character), bossHistory: clone(bossHistory), achievements: clone(achievements), processedIncidentKeys: clone(processedIncidentKeys), transactions: nextTransactions };
      }
      nextTransactions.push({
        id: correctionId,
        type: 'boss_correction',
        correctsTransactionId: original.id,
        actionType: original.actionType,
        incidentKey: original.incidentKey,
        actionDate: original.actionDate,
        occurredAt: correctedAt,
        reason: 'user_correction'
      });
      return {
        ok: true,
        reason: null,
        boss: clone(original.before.boss || {}),
        character: clone(original.before.character || {}),
        bossHistory: clone(original.before.bossHistory || []),
        achievements: clone(original.before.achievements || []),
        processedIncidentKeys: clone(original.before.processedIncidentKeys || []),
        transactions: nextTransactions,
        correctedTransaction: clone(original)
      };
    }
  };

  const StatusEffectEngine = {
    apply({ character = {}, buffs = [], debuffs = [], effect = {}, today = null, asOfDate = null }) {
      const nextCharacter = clone(character);
      nextCharacter.attributes = nextCharacter.attributes || {};
      const nextBuffs = clone(buffs);
      const nextDebuffs = clone(debuffs);
      const collection = effect.type === 'buff' ? nextBuffs : nextDebuffs;
      if (!effect.id || collection.some(item => item.id === effect.id)) {
        return {
          character: nextCharacter,
          buffs: nextBuffs,
          debuffs: nextDebuffs,
          applied: false
        };
      }

      const attributes = clone(effect.attributes || {});
      const appliedOn = toIsoDate(today);
      const duration = Math.max(1, Number(effect.duration) || 1);
      const expiresOn = appliedOn ? addIsoDays(appliedOn, duration) : null;
      const currentDate = toIsoDate(asOfDate);
      const type = effect.type === 'buff' ? 'buff' : 'debuff';
      const appliedEvent = appliedOn ? {
        effectId: effect.id,
        sourceRuleId: effect.sourceRuleId || effect.id,
        type,
        title: String(effect.title || effect.id),
        event: 'applied',
        date: appliedOn
      } : null;
      if (currentDate && expiresOn && expiresOn <= currentDate) {
        const expiredEvent = {
          effectId: effect.id,
          sourceRuleId: effect.sourceRuleId || effect.id,
          type,
          title: String(effect.title || effect.id),
          event: 'expired',
          date: expiresOn
        };
        return {
          character: nextCharacter,
          buffs: nextBuffs,
          debuffs: nextDebuffs,
          applied: false,
          historicalOnly: true,
          statusEvent: appliedEvent,
          statusEvents: [appliedEvent, expiredEvent].filter(Boolean)
        };
      }
      collection.push({
        id: effect.id,
        title: String(effect.title || effect.id),
        remainingDays: duration,
        ...(appliedOn ? {
          appliedOn,
          expiresOn
        } : {}),
        ...(effect.type === 'buff' ? {} : { effect: attributes })
      });
      if (effect.type !== 'buff') {
        for (const [attribute, amount] of Object.entries(attributes)) {
          nextCharacter.attributes[attribute] = Math.max(
            1,
            (Number(nextCharacter.attributes[attribute]) || 0) + Number(amount)
          );
        }
      }

      return {
        character: nextCharacter,
        buffs: nextBuffs,
        debuffs: nextDebuffs,
        applied: true,
        historicalOnly: false,
        statusEvent: appliedEvent,
        statusEvents: appliedEvent ? [appliedEvent] : []
      };
    },

    tick({ character = {}, buffs = [], debuffs = [], today = null }) {
      const nextCharacter = clone(character);
      nextCharacter.attributes = nextCharacter.attributes || {};
      const expiredBuffIds = [];
      const expiredDebuffIds = [];
      const currentDate = toIsoDate(today);
      const updateDuration = effect => {
        if (currentDate && toIsoDate(effect.expiresOn)) {
          return {
            ...effect,
            remainingDays: Math.max(0, daysUntil(currentDate, effect.expiresOn))
          };
        }
        return { ...effect, remainingDays: (Number(effect.remainingDays) || 0) - 1 };
      };
      const nextBuffs = clone(buffs)
        .map(updateDuration)
        .filter(buff => {
          if (buff.remainingDays > 0) return true;
          expiredBuffIds.push(buff.id);
          return false;
        });
      const nextDebuffs = clone(debuffs)
        .map(updateDuration)
        .filter(debuff => {
          if (debuff.remainingDays > 0) return true;
          expiredDebuffIds.push(debuff.id);
          for (const [attribute, amount] of Object.entries(debuff.effect || {})) {
            nextCharacter.attributes[attribute] =
              (Number(nextCharacter.attributes[attribute]) || 0) + Math.abs(Number(amount) || 0);
          }
          return false;
        });

      return {
        character: nextCharacter,
        buffs: nextBuffs,
        debuffs: nextDebuffs,
        expiredBuffIds,
        expiredDebuffIds,
        statusEvents: currentDate ? [
          ...clone(buffs).filter(item => expiredBuffIds.includes(item.id)).map(item => ({
            effectId: item.id,
            type: 'buff',
            title: String(item.title || item.id),
            event: 'expired',
            date: toIsoDate(item.expiresOn) || currentDate
          })),
          ...clone(debuffs).filter(item => expiredDebuffIds.includes(item.id)).map(item => ({
            effectId: item.id,
            type: 'debuff',
            title: String(item.title || item.id),
            event: 'expired',
            date: toIsoDate(item.expiresOn) || currentDate
          }))
        ] : []
      };
    },

    clearAll({ character = {}, buffs = [], debuffs = [], today = null } = {}) {
      const nextCharacter = clone(character);
      nextCharacter.attributes = nextCharacter.attributes || {};
      const clearedBuffIds = (Array.isArray(buffs) ? buffs : []).map(item => item.id).filter(Boolean);
      const clearedDebuffIds = [];
      (Array.isArray(debuffs) ? debuffs : []).forEach(debuff => {
        if (debuff?.id) clearedDebuffIds.push(debuff.id);
        Object.entries(debuff?.effect || {}).forEach(([attribute, amount]) => {
          nextCharacter.attributes[attribute] = Math.max(
            1,
            (Number(nextCharacter.attributes[attribute]) || 0) - Number(amount || 0)
          );
        });
      });
      const date = toIsoDate(today);
      const statusEvents = date ? [
        ...clearedBuffIds.map(effectId => ({ effectId, type: 'buff', event: 'cleared', date })),
        ...clearedDebuffIds.map(effectId => ({ effectId, type: 'debuff', event: 'cleared', date }))
      ] : [];
      return {
        character: nextCharacter,
        buffs: [],
        debuffs: [],
        clearedBuffIds,
        clearedDebuffIds,
        statusEvents
      };
    }
  };

  const DeathEngine = {
    resolve({ state = {}, items = [], today = null, goldLossRate = 0.15 } = {}) {
      const next = clone(state);
      next.character = next.character || {};
      next.inventory = Array.isArray(next.inventory) ? next.inventory : [];
      next.buffs = Array.isArray(next.buffs) ? next.buffs : [];
      next.debuffs = Array.isArray(next.debuffs) ? next.debuffs : [];
      next.recoveryTasks = Array.isArray(next.recoveryTasks) ? next.recoveryTasks : [];
      const loss = Math.floor((Number(next.character.gold) || 0) * Math.max(0, Number(goldLossRate) || 0));
      const weaponId = next.character.equipped?.weapon || null;
      const equipmentResult = EquipmentEngine.unequipAll({ character: next.character, items });
      const statusResult = StatusEffectEngine.clearAll({
        character: equipmentResult.character,
        buffs: next.buffs,
        debuffs: next.debuffs,
        today
      });
      next.character = statusResult.character;
      next.character.gold = Math.max(0, (Number(next.character.gold) || 0) - loss);
      next.character.hp = Math.max(1, Number(next.character.maxHp) || 1);
      next.buffs = statusResult.buffs;
      next.debuffs = statusResult.debuffs;
      const clearedDebuffs = new Set(statusResult.clearedDebuffIds);
      next.recoveryTasks = next.recoveryTasks.filter(task => !clearedDebuffs.has(task.targetDebuff));
      const destroyedItemIds = weaponId ? [weaponId] : [];
      destroyedItemIds.forEach(itemId => {
        const index = next.inventory.indexOf(itemId);
        if (index >= 0) next.inventory.splice(index, 1);
      });
      return {
        state: next,
        loss,
        destroyedItemIds,
        unequippedItemIds: equipmentResult.unequippedItemIds,
        clearedBuffIds: statusResult.clearedBuffIds,
        clearedDebuffIds: statusResult.clearedDebuffIds,
        statusEvents: statusResult.statusEvents
      };
    }
  };

  const RulePolicy = {
    remove({ rules = [], deletedRules = [], ruleId, deletedAt = new Date().toISOString() } = {}) {
      const nextRules = clone(Array.isArray(rules) ? rules : []);
      const nextDeleted = clone(Array.isArray(deletedRules) ? deletedRules : []);
      const index = nextRules.findIndex(rule => rule.id === ruleId);
      if (index < 0) return { ok: false, reason: 'not_found', rules: nextRules, deletedRules: nextDeleted };
      if (nextRules[index].isSystem) {
        return { ok: false, reason: 'system_rule_protected', rules: nextRules, deletedRules: nextDeleted };
      }
      const [rule] = nextRules.splice(index, 1);
      nextDeleted.push({ rule, index, deletedAt });
      return { ok: true, reason: null, rules: nextRules, deletedRules: nextDeleted, rule };
    },

    restoreLast({ rules = [], deletedRules = [] } = {}) {
      const nextRules = clone(Array.isArray(rules) ? rules : []);
      const nextDeleted = clone(Array.isArray(deletedRules) ? deletedRules : []);
      const record = nextDeleted.pop();
      if (!record?.rule?.id) {
        return { ok: false, reason: 'nothing_to_restore', rules: nextRules, deletedRules: nextDeleted };
      }
      if (!nextRules.some(rule => rule.id === record.rule.id)) {
        const index = Math.min(Math.max(0, Number(record.index) || 0), nextRules.length);
        nextRules.splice(index, 0, record.rule);
      }
      return { ok: true, reason: null, rules: nextRules, deletedRules: nextDeleted, rule: record.rule };
    },

    restoreDefaults({ rules = [], defaultRules = [] } = {}) {
      const currentRules = clone(Array.isArray(rules) ? rules : []);
      const customRules = currentRules.filter(rule => !rule.isSystem);
      const systemRules = (Array.isArray(defaultRules) ? defaultRules : [])
        .filter(rule => rule.isSystem)
        .map(canonical => {
          const existing = currentRules.find(rule => rule.id === canonical.id && rule.isSystem);
          return {
            ...clone(canonical),
            enabled: existing ? existing.enabled !== false : canonical.enabled !== false
          };
        });
      return { rules: dedupeRules([...systemRules, ...customRules]) };
    }
  };

  const SAFE_EXTERNAL_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
  const EXTERNAL_IDENTIFIER_FIELDS = /(?:^id$|Id$|Key$)/;
  const EXTERNAL_IDENTIFIER_ARRAY_FIELDS = /(?:Ids|Keys)$/;

  function hasSafeExternalIdentifiers(value, fieldName = '', depth = 0) {
    if (depth > 20) return false;
    if (value == null) return true;
    if (Array.isArray(value)) {
      if (value.length > 10000) return false;
      if (EXTERNAL_IDENTIFIER_ARRAY_FIELDS.test(fieldName)) {
        return value.every(item => typeof item === 'string' && SAFE_EXTERNAL_IDENTIFIER.test(item));
      }
      return value.every(item => hasSafeExternalIdentifiers(item, fieldName, depth + 1));
    }
    if (!isPlainObject(value)) return true;
    return Object.entries(value).every(([key, item]) => {
      if (EXTERNAL_IDENTIFIER_FIELDS.test(key) && item != null) {
        return typeof item === 'string' && SAFE_EXTERNAL_IDENTIFIER.test(item);
      }
      return hasSafeExternalIdentifiers(item, key, depth + 1);
    });
  }

  const CLOUD_IMPORT_ALLOWED_FIELDS = Object.freeze([
    'character.name',
    'character.goal',
    'settings.dailyBudget',
    'settings.timeZone',
    'settings.maxBackfillDays',
    'mainQuest.pending',
    'dailyLogHistory.rawMetrics',
    'dailyDrafts.rawMetrics',
    'habitEvents.historyOnly',
    'tasks.customDefinitions',
    'rules.systemEnabledState'
  ]);

  const CLOUD_IMPORT_PROTECTED_FIELDS = Object.freeze([
    'character.hp/xp/level/gold/gems/attributes/savings/equipped',
    'inventory',
    'supplyTransactions',
    'gemTransactions',
    'rewardTickets',
    'achievements',
    'boss/bossHistory/bossTransactions',
    'buffs/debuffs/statusHistory',
    'meta.operations/repositoryVersion',
    'custom rule rewards and settlement results'
  ]);

  function boundedNumber(value, minimum, maximum, fallback = 0) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(maximum, Math.max(minimum, parsed));
  }

  function sanitizeImportedDailyEntry(entry, dailyBudget) {
    const date = toIsoDate(entry?.date);
    if (!date) return null;
    return {
      id: `daily-${date}`,
      date,
      sleep: boundedNumber(entry.sleep, 0, 24),
      water: Math.round(boundedNumber(entry.water, 0, 100000)),
      exercise: Math.round(boundedNumber(entry.exercise, 0, 1440)),
      study: Math.round(boundedNumber(entry.study, 0, 1440)),
      expense: Math.round(boundedNumber(entry.expense, 0, 100000000)),
      impulse: Math.round(boundedNumber(entry.impulse, 0, 1000)),
      sugaryDrinks: Math.round(boundedNumber(entry.sugaryDrinks, 0, 1000)),
      budgetLimitAtSettlement: Math.round(boundedNumber(
        entry.budgetLimitAtSettlement,
        1,
        100000000,
        dailyBudget
      )),
      importedFromArchive: true,
      settlementEligible: false
    };
  }

  function sanitizeImportedDraft(draft, date) {
    const normalizedDate = toIsoDate(date || draft?.date);
    if (!normalizedDate) return null;
    return {
      date: normalizedDate,
      sleep: boundedNumber(draft?.sleep, 0, 24),
      water: Math.round(boundedNumber(draft?.water, 0, 100000)),
      exercise: Math.round(boundedNumber(draft?.exercise, 0, 1440)),
      study: Math.round(boundedNumber(draft?.study, 0, 1440)),
      expense: Math.round(boundedNumber(draft?.expense, 0, 100000000)),
      impulse: Math.round(boundedNumber(draft?.impulse, 0, 1000)),
      sugaryDrinks: Math.round(boundedNumber(draft?.sugaryDrinks, 0, 1000)),
      savedAt: typeof draft?.savedAt === 'string' && Number.isFinite(Date.parse(draft.savedAt))
        ? draft.savedAt
        : null
    };
  }

  function sanitizeImportedHabitEvent(event) {
    const date = toIsoDate(event?.date);
    const id = typeof event?.id === 'string' && SAFE_EXTERNAL_IDENTIFIER.test(event.id) ? event.id : null;
    if (!date || !id) return null;
    return {
      id,
      habitId: typeof event.habitId === 'string' && SAFE_EXTERNAL_IDENTIFIER.test(event.habitId)
        ? event.habitId
        : null,
      habitKey: typeof event.habitKey === 'string' && SAFE_EXTERNAL_IDENTIFIER.test(event.habitKey)
        ? event.habitKey
        : null,
      title: String(event.title || '').slice(0, 120),
      direction: event.direction === 'bad' ? 'bad' : 'good',
      date,
      createdAt: typeof event.createdAt === 'string' && Number.isFinite(Date.parse(event.createdAt))
        ? event.createdAt
        : null,
      reversedAt: typeof event.reversedAt === 'string' && Number.isFinite(Date.parse(event.reversedAt))
        ? event.reversedAt
        : null,
      importedFromArchive: true,
      gameEffectsAllowed: false,
      rewardGranted: false
    };
  }

  const SaveArchiveEngine = {
    create({ state = {}, exportedAt = new Date().toISOString() } = {}) {
      const payload = clone(state);
      return {
        format: 'lifequest-save',
        formatVersion: 1,
        schemaVersion: Number(payload.schemaVersion) || CURRENT_SCHEMA_VERSION,
        exportedAt,
        checksum: checksum(payload),
        state: payload
      };
    },

    validate({ archive, defaults = {}, defaultRules = [] } = {}) {
      if (!isPlainObject(archive) || archive.format !== 'lifequest-save') {
        return { ok: false, reason: 'invalid_format', state: null, summary: null };
      }
      if (Number(archive.formatVersion) !== 1 || !isPlainObject(archive.state)) {
        return { ok: false, reason: 'unsupported_version', state: null, summary: null };
      }
      if (!archive.checksum || archive.checksum !== checksum(archive.state)) {
        return { ok: false, reason: 'checksum_mismatch', state: null, summary: null };
      }
      let migrated;
      try {
        migrated = migrateState(archive.state, defaults, defaultRules);
      } catch (_error) {
        return { ok: false, reason: 'migration_failed', state: null, summary: null };
      }
      if (!hasSafeExternalIdentifiers(migrated)) {
        return { ok: false, reason: 'invalid_state', state: null, summary: null };
      }
      return {
        ok: true,
        reason: null,
        state: migrated,
        summary: {
          exportedAt: archive.exportedAt || null,
          sourceSchemaVersion: Number(archive.schemaVersion) || 0,
          targetSchemaVersion: CURRENT_SCHEMA_VERSION,
          adventurerName: String(migrated.character?.name || '未命名冒險者'),
          dailyEntryCount: Array.isArray(migrated.dailyLogHistory) ? migrated.dailyLogHistory.length : 0,
          habitEventCount: Array.isArray(migrated.habitEvents) ? migrated.habitEvents.length : 0,
          supplyTransactionCount: Array.isArray(migrated.supplyTransactions) ? migrated.supplyTransactions.length : 0,
          bossTransactionCount: Array.isArray(migrated.bossTransactions) ? migrated.bossTransactions.length : 0
        }
      };
    },

    prepareCloudImport({ importedState = {}, currentState = {}, defaults = {}, defaultRules = [] } = {}) {
      const current = migrateState(currentState, defaults, defaultRules);
      const imported = migrateState(importedState, defaults, defaultRules);
      const next = clone(current);
      const importedBudget = Math.round(boundedNumber(imported.settings?.dailyBudget, 1, 100000000, 500));
      const importedTimeZone = isValidTimeZone(imported.settings?.timeZone)
        ? imported.settings.timeZone
        : DEFAULT_TIME_ZONE;
      const importedBackfillDays = Math.round(boundedNumber(imported.settings?.maxBackfillDays, 0, 30, 7));

      next.character.name = String(imported.character?.name || current.character?.name || '').slice(0, 80);
      next.character.goal = ['sleep', 'spending', 'exercise', 'learning'].includes(imported.character?.goal)
        ? imported.character.goal
        : current.character?.goal || null;
      next.settings = {
        ...(next.settings || {}),
        dailyBudget: importedBudget,
        timeZone: importedTimeZone,
        maxBackfillDays: importedBackfillDays
      };
      const pendingGoal = imported.mainQuest?.pending;
      next.mainQuest = {
        pending: pendingGoal && ['sleep', 'spending', 'exercise', 'learning'].includes(pendingGoal.goal)
          ? {
              goal: pendingGoal.goal,
              requestedOn: toIsoDate(pendingGoal.requestedOn),
              effectiveOn: toIsoDate(pendingGoal.effectiveOn)
            }
          : null
      };

      const entriesByDate = new Map();
      (Array.isArray(imported.dailyLogHistory) ? imported.dailyLogHistory : []).forEach(entry => {
        const sanitized = sanitizeImportedDailyEntry(entry, importedBudget);
        if (sanitized) entriesByDate.set(sanitized.date, sanitized);
      });
      next.dailyLogHistory = [...entriesByDate.values()].sort((a, b) => a.date.localeCompare(b.date));

      next.dailyDrafts = {};
      Object.entries(isPlainObject(imported.dailyDrafts) ? imported.dailyDrafts : {}).forEach(([date, draft]) => {
        const sanitized = sanitizeImportedDraft(draft, date);
        if (sanitized) next.dailyDrafts[sanitized.date] = sanitized;
      });

      next.habitEvents = (Array.isArray(imported.habitEvents) ? imported.habitEvents : [])
        .map(sanitizeImportedHabitEvent)
        .filter(Boolean);

      const systemTasks = (Array.isArray(current.tasks) ? current.tasks : [])
        .filter(task => task.isSystem)
        .map(clone);
      const customTasks = (Array.isArray(imported.tasks) ? imported.tasks : [])
        .filter(task => !task.isSystem && typeof task.id === 'string' && SAFE_EXTERNAL_IDENTIFIER.test(task.id))
        .map(task => ({
          id: task.id,
          title: String(task.title || '').slice(0, 120),
          type: 'habit',
          direction: task.direction === 'bad' ? 'bad' : 'good',
          count: 0,
          dailyCounts: {},
          stat: 'growth',
          isSystem: false,
          systemKey: null,
          dailyInput: null,
          rewardPolicy: {
            maxDailyReports: Math.max(1, Math.min(10, Number(task.rewardPolicy?.maxDailyReports) || 10)),
            maxDailyRewards: task.direction === 'bad' ? 0 : 1
          }
        }));
      next.tasks = [...systemTasks, ...customTasks];

      const importedSystemEnabled = new Map(
        (Array.isArray(imported.rules) ? imported.rules : [])
          .filter(rule => rule.isSystem && typeof rule.id === 'string')
          .map(rule => [rule.id, rule.enabled !== false])
      );
      next.rules = (Array.isArray(current.rules) ? current.rules : []).map(rule =>
        rule.isSystem && importedSystemEnabled.has(rule.id)
          ? { ...rule, enabled: importedSystemEnabled.get(rule.id) }
          : rule
      );

      next.meta.lastSettlementDate = null;
      next.meta.processedBossIncidentKeys = clone(current.meta?.processedBossIncidentKeys || []);
      return {
        ok: true,
        reason: null,
        state: next,
        allowedFields: clone(CLOUD_IMPORT_ALLOWED_FIELDS),
        protectedFields: clone(CLOUD_IMPORT_PROTECTED_FIELDS),
        summary: {
          dailyEntryCount: next.dailyLogHistory.length,
          dailyDraftCount: Object.keys(next.dailyDrafts).length,
          habitEventCount: next.habitEvents.length,
          customHabitCount: customTasks.length,
          protectedFieldCount: CLOUD_IMPORT_PROTECTED_FIELDS.length
        }
      };
    }
  };

  const SettlementEngine = {
    calculate({
      entry,
      rules = [],
      history = [],
      habitEvents = [],
      dailyBudget,
      previousEntry = null,
      lastSettlementDate = null,
      character = {},
      randomValue = Math.random()
    }) {
      const isDuplicate = Boolean(
        previousEntry || lastSettlementDate === entry.date
      );
      const evaluation = RuleEngine.evaluate(entry, rules, history, {
        habitEvents,
        settings: { dailyBudget }
      });
      const previouslyTriggeredBossRuleIds = new Set(
        Array.isArray(previousEntry?.triggeredBossRuleIds)
          ? previousEntry.triggeredBossRuleIds
          : []
      );
      const newTriggeredBossRuleIds = evaluation.triggeredBossRuleIds.filter(
        id => !previouslyTriggeredBossRuleIds.has(id)
      );
      const dailyRuleCount = rules.filter(rule =>
        rule.enabled !== false && rule.type === 'daily'
      ).length;

      if (isDuplicate) {
        return {
          isDuplicate: true,
          evaluation,
          newTriggeredBossRuleIds,
          dailyRuleCount,
          rewards: { xp: 0, gold: 0, attributes: {} },
          damage: 0,
          critical: false
        };
      }

      const attributes = character.attributes || {};
      const equipped = character.equipped || {};
      let xp = Math.round(
        (Number(evaluation.rewards.xp) || 0) *
        (1 + (Number(attributes.growth) || 0) / 100)
      );
      let gold = Number(evaluation.rewards.gold) || 0;
      const critical = randomValue * 100 < (Number(attributes.energy) || 0) * 1.5;
      if (critical) {
        xp *= 2;
        gold *= 2;
      }
      if (equipped.pet === 'pet_cactus') gold += 2;

      let damage = 0;
      if (evaluation.failedRuleIds.length > 0) {
        const baseDamage = evaluation.failedRuleIds.length * 6;
        const damageReduction = Math.floor((Number(attributes.health) || 0) / 4);
        damage = Math.max(2, baseDamage - damageReduction);
        if (equipped.armor === 'armor_shield') damage = Math.max(2, damage - 2);
      }

      return {
        isDuplicate: false,
        evaluation,
        newTriggeredBossRuleIds,
        dailyRuleCount,
        rewards: {
          xp,
          gold,
          attributes: clone(evaluation.rewards.attributes)
        },
        damage,
        critical
      };
    }
  };

  return {
    CURRENT_SCHEMA_VERSION,
    BusinessDatePolicy,
    StateStore,
    DailyDataEngine,
    DailyRecordPolicy,
    MainQuestEngine,
    RuleEngine,
    RecommendationEngine,
    Insights,
    AdvisorEngine,
    SettlementEngine,
    SettlementRevisionEngine,
    AchievementEngine,
    AchievementRewardEngine,
    HabitEngine,
    EquipmentEngine,
    SupplyEngine,
    DailyGemEngine,
    RewardTicketEngine,
    ProfessionEngine,
    BossEngine,
    StatusEffectEngine,
    DeathEngine,
    RulePolicy,
    SaveArchiveEngine,
    CLOUD_IMPORT_ALLOWED_FIELDS,
    CLOUD_IMPORT_PROTECTED_FIELDS
  };
});
