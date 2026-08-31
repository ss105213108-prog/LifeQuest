(function(root, factory) {
  const exported = factory();
  if (typeof module === 'object' && module.exports) module.exports = exported;
  if (root) root.LifeQuestBackendContract = exported;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  const API_CONTRACT_VERSION = 1;
  const DEFAULT_TIME_ZONE = 'Asia/Taipei';
  const DEFAULT_MAX_BACKFILL_DAYS = 7;
  const COMMAND_ENDPOINT = '/v1/game/commands';
  const PHASE3_RULE_IDS = Object.freeze([
    'rule_1',
    'rule_2',
    'rule_water',
    'rule_exercise',
    'rule_5',
    'rule_3',
    'rule_boss_sleep',
    'rule_boss_lazy',
    'rule_boss_budget',
    'rule_boss_fried_food',
    'rule_4',
    'rule_6'
  ]);

  const REMOTE_COMMAND_TYPES = Object.freeze([
    'INITIALIZE_MEMBER_PROFILE',
    'SELECT_AUTH_METHOD',
    'SELECT_MAIN_QUEST',
    'SAVE_DAILY_DRAFT',
    'SUBMIT_DAILY_ENTRY',
    'REPORT_HABIT_EVENT',
    'REVERSE_HABIT_EVENT',
    'CREATE_CUSTOM_HABIT',
    'UPDATE_CUSTOM_HABIT',
    'REMOVE_CUSTOM_HABIT',
    'RESTORE_CUSTOM_HABIT',
    'UPDATE_PROFILE',
    'SET_RULE_ENABLED',
    'PURCHASE_ITEM',
    'USE_ITEM',
    'EQUIP_ITEM',
    'UNEQUIP_ITEM',
    'PURCHASE_SUPPLY',
    'REVERSE_SUPPLY_PURCHASE',
    'REDEEM_REWARD_TICKET',
    'USE_REWARD_TICKET',
    'REVERSE_REWARD_TICKET',
    'IMPORT_CLOUD_DATA'
  ]);

  function clone(value) {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
  }

  function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function isIsoDate(value) {
    const text = String(value || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
    const [year, month, day] = text.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year
      && date.getUTCMonth() === month - 1
      && date.getUTCDate() === day;
  }

  function isUuid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(String(value || ''));
  }

  function isIsoTimestamp(value) {
    return typeof value === 'string' && Number.isFinite(Date.parse(value));
  }

  function isValidTimeZone(value) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: String(value || '') }).format(new Date(0));
      return true;
    } catch (_error) {
      return false;
    }
  }

  function getBusinessDate({ now = new Date(), timeZone = DEFAULT_TIME_ZONE } = {}) {
    const selectedTimeZone = isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIME_ZONE;
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: selectedTimeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(now instanceof Date ? now : new Date(now));
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  }

  function stableStringify(value) {
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    if (isPlainObject(value)) {
      return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
  }

  function createIntentKey({ type, businessDate, payload = {} } = {}) {
    return `${String(type || '').trim()}:${String(businessDate || '').trim()}:${stableStringify(payload)}`;
  }

  function createCommandEnvelope({
    type,
    operationId,
    payload = {},
    occurredAt = new Date().toISOString(),
    businessDate = null,
    timeZone = DEFAULT_TIME_ZONE,
    intentKey = null
  } = {}) {
    const selectedTimeZone = isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIME_ZONE;
    const selectedBusinessDate = isIsoDate(businessDate)
      ? businessDate
      : getBusinessDate({ now: occurredAt, timeZone: selectedTimeZone });
    const safePayload = isPlainObject(payload) ? clone(payload) : {};
    return {
      contractVersion: API_CONTRACT_VERSION,
      type: String(type || '').trim(),
      operationId: String(operationId || '').trim(),
      occurredAt: new Date(occurredAt).toISOString(),
      context: {
        businessDate: selectedBusinessDate,
        timeZone: selectedTimeZone
      },
      intentKey: String(intentKey || createIntentKey({
        type,
        businessDate: selectedBusinessDate,
        payload: safePayload
      })),
      payload: safePayload
    };
  }

  function validateCommandEnvelope(command, { allowedTypes = REMOTE_COMMAND_TYPES } = {}) {
    if (!isPlainObject(command)) return { ok: false, reason: 'invalid_command' };
    if (Number(command.contractVersion) !== API_CONTRACT_VERSION) {
      return { ok: false, reason: 'unsupported_contract_version' };
    }
    if (!Array.isArray(allowedTypes) || !allowedTypes.includes(command.type)) {
      return { ok: false, reason: 'unsupported_command' };
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/.test(String(command.operationId || ''))) {
      return { ok: false, reason: 'invalid_operation_id' };
    }
    if (!isIsoTimestamp(command.occurredAt)) return { ok: false, reason: 'invalid_occurred_at' };
    if (!isPlainObject(command.context) || !isIsoDate(command.context.businessDate)) {
      return { ok: false, reason: 'invalid_business_date' };
    }
    if (!isValidTimeZone(command.context.timeZone)) return { ok: false, reason: 'invalid_time_zone' };
    if (!isPlainObject(command.payload)) return { ok: false, reason: 'invalid_payload' };
    if (command.type === 'INITIALIZE_MEMBER_PROFILE') {
      const adventurerName = String(command.payload.adventurerName || '').trim();
      if (adventurerName.length < 2
        || adventurerName.length > 16
        || !/^[\p{L}\p{N}]+$/u.test(adventurerName)
        || Object.keys(command.payload).some(key => key !== 'adventurerName')) {
        return { ok: false, reason: 'invalid_payload' };
      }
    }
    if (command.type === 'SELECT_MAIN_QUEST') {
      const questId = String(command.payload.questId || '').trim();
      if (!['sleep', 'spending', 'exercise', 'learning'].includes(questId)
        || Object.keys(command.payload).some(key => key !== 'questId')) {
        return { ok: false, reason: 'invalid_payload' };
      }
    }
    if (command.type === 'UPDATE_PROFILE') {
      const keys = Object.keys(command.payload);
      const allowedKeys = ['adventurerName', 'dailyBudget'];
      const hasAdventurerName = Object.prototype.hasOwnProperty.call(command.payload, 'adventurerName');
      const hasDailyBudget = Object.prototype.hasOwnProperty.call(command.payload, 'dailyBudget');
      const adventurerName = String(command.payload.adventurerName || '').trim();
      const dailyBudget = Number(command.payload.dailyBudget);
      if (keys.length === 0
        || keys.some(key => !allowedKeys.includes(key))
        || (hasAdventurerName && (
          adventurerName.length < 2
          || adventurerName.length > 16
          || !/^[\p{L}\p{N}]+$/u.test(adventurerName)
        ))
        || (hasDailyBudget && (
          !Number.isInteger(dailyBudget)
          || dailyBudget < 1
          || dailyBudget > 100000000
        ))) {
        return { ok: false, reason: 'invalid_payload' };
      }
    }
    if (command.type === 'SAVE_DAILY_DRAFT') {
      const keys = Object.keys(command.payload);
      const draft = command.payload.draft;
      const draftKeys = isPlainObject(draft) ? Object.keys(draft) : [];
      const allowedDraftKeys = ['sleep', 'water', 'exercise', 'study', 'expense', 'impulse', 'sugaryDrinks'];
      const bounds = {
        sleep: [0, 24],
        water: [0, 100000],
        exercise: [0, 1440],
        study: [0, 1440],
        expense: [0, 1000000000],
        impulse: [0, 1000],
        sugaryDrinks: [0, 1000]
      };
      const invalidValue = allowedDraftKeys.some(key => {
        const value = draft?.[key];
        if (value === null) return false;
        const number = Number(value);
        const [min, max] = bounds[key];
        const requiresInteger = key !== 'sleep';
        return !Number.isFinite(number)
          || number < min
          || number > max
          || (requiresInteger && !Number.isInteger(number));
      });
      if (keys.length !== 2
        || keys.some(key => !['date', 'draft'].includes(key))
        || !isIsoDate(command.payload.date)
        || !isPlainObject(draft)
        || draftKeys.length !== allowedDraftKeys.length
        || draftKeys.some(key => !allowedDraftKeys.includes(key))
        || invalidValue) {
        return { ok: false, reason: 'invalid_payload' };
      }
    }
    if (command.type === 'CREATE_CUSTOM_HABIT') {
      const keys = Object.keys(command.payload);
      const title = String(command.payload.title || '').trim();
      if (keys.length !== 2
        || keys.some(key => !['title', 'direction'].includes(key))
        || title.length < 1
        || title.length > 80
        || !['good', 'bad'].includes(command.payload.direction)) {
        return { ok: false, reason: 'invalid_payload' };
      }
    }
    if (command.type === 'UPDATE_CUSTOM_HABIT') {
      const keys = Object.keys(command.payload);
      const hasTitle = Object.prototype.hasOwnProperty.call(command.payload, 'title');
      const hasDirection = Object.prototype.hasOwnProperty.call(command.payload, 'direction');
      const title = String(command.payload.title || '').trim();
      if (keys.length < 2
        || keys.length > 3
        || keys.some(key => !['habitId', 'title', 'direction'].includes(key))
        || !isUuid(command.payload.habitId)
        || (!hasTitle && !hasDirection)
        || (hasTitle && (title.length < 1 || title.length > 80))
        || (hasDirection && !['good', 'bad'].includes(command.payload.direction))) {
        return { ok: false, reason: 'invalid_payload' };
      }
    }
    if (command.type === 'REMOVE_CUSTOM_HABIT' || command.type === 'RESTORE_CUSTOM_HABIT') {
      const keys = Object.keys(command.payload);
      if (keys.length !== 1
        || keys[0] !== 'habitId'
        || !isUuid(command.payload.habitId)) {
        return { ok: false, reason: 'invalid_payload' };
      }
    }
    if (command.type === 'SET_RULE_ENABLED') {
      const keys = Object.keys(command.payload);
      if (keys.length !== 2
        || keys.some(key => !['ruleId', 'enabled'].includes(key))
        || !PHASE3_RULE_IDS.includes(String(command.payload.ruleId || ''))
        || typeof command.payload.enabled !== 'boolean') {
        return { ok: false, reason: 'invalid_payload' };
      }
    }
    if (command.type === 'REPORT_HABIT_EVENT') {
      const keys = Object.keys(command.payload);
      const habitId = String(command.payload.habitId || '').trim();
      if (keys.length !== 1
        || keys[0] !== 'habitId'
        || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(habitId)) {
        return { ok: false, reason: 'invalid_payload' };
      }
    }
    if (command.type === 'REVERSE_HABIT_EVENT') {
      const keys = Object.keys(command.payload);
      if (keys.length !== 1
        || keys[0] !== 'eventId'
        || !isUuid(command.payload.eventId)) {
        return { ok: false, reason: 'invalid_payload' };
      }
    }
    if (command.type === 'SUBMIT_DAILY_ENTRY') {
      const allowedKeys = ['sleep', 'water', 'exercise', 'study', 'expense', 'impulse', 'sugaryDrinks'];
      const keys = Object.keys(command.payload);
      const bounds = {
        sleep: [0, 24],
        water: [0, 100000],
        exercise: [0, 1440],
        study: [0, 1440],
        expense: [0, 1000000000],
        impulse: [0, 1000],
        sugaryDrinks: [0, 1000]
      };
      const invalidValue = allowedKeys.some(key => {
        const number = Number(command.payload[key]);
        const [min, max] = bounds[key];
        return !Number.isFinite(number)
          || number < min
          || number > max
          || (key !== 'sleep' && !Number.isInteger(number));
      });
      if (keys.length !== allowedKeys.length
        || keys.some(key => !allowedKeys.includes(key))
        || invalidValue) {
        return { ok: false, reason: 'invalid_payload' };
      }
    }
    if (command.type === 'PURCHASE_ITEM' || command.type === 'REDEEM_REWARD_TICKET') {
      const keys = Object.keys(command.payload);
      const expectedKey = command.type === 'PURCHASE_ITEM' ? 'itemKey' : 'ticketKey';
      const catalogKey = String(command.payload[expectedKey] || '').trim();
      const hasSeenCatalogVersion = Object.prototype.hasOwnProperty.call(
        command.payload,
        'seenCatalogVersion'
      );
      if (keys.length !== 2
        || !hasSeenCatalogVersion
        || keys.some(key => ![expectedKey, 'seenCatalogVersion'].includes(key))
        || !/^[a-z][a-z0-9_]{1,63}$/.test(catalogKey)
        || !Number.isSafeInteger(command.payload.seenCatalogVersion)
        || command.payload.seenCatalogVersion < 1) {
        return { ok: false, reason: 'invalid_payload' };
      }
    }
    if (command.type === 'USE_ITEM' || command.type === 'EQUIP_ITEM') {
      const keys = Object.keys(command.payload);
      if (keys.length !== 1
        || keys[0] !== 'itemKey'
        || !/^[a-z][a-z0-9_]{1,63}$/.test(String(command.payload.itemKey || ''))) {
        return { ok: false, reason: 'invalid_payload' };
      }
    }
    if (command.type === 'UNEQUIP_ITEM') {
      const keys = Object.keys(command.payload);
      if (keys.length !== 1
        || keys[0] !== 'slot'
        || !['weapon', 'armor', 'pet'].includes(command.payload.slot)) {
        return { ok: false, reason: 'invalid_payload' };
      }
    }
    if (command.type === 'USE_REWARD_TICKET' || command.type === 'REVERSE_REWARD_TICKET') {
      const keys = Object.keys(command.payload);
      if (keys.length !== 1
        || keys[0] !== 'ticketInstanceId'
        || !isUuid(command.payload.ticketInstanceId)) {
        return { ok: false, reason: 'invalid_payload' };
      }
    }
    return { ok: true, reason: null };
  }

  function createApiRequest(command) {
    const validation = validateCommandEnvelope(command);
    if (!validation.ok) return validation;
    return {
      ok: true,
      reason: null,
      request: {
        method: 'POST',
        path: COMMAND_ENDPOINT,
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': command.operationId,
          'X-LifeQuest-Contract-Version': String(API_CONTRACT_VERSION)
        },
        body: clone(command)
      }
    };
  }

  return {
    API_CONTRACT_VERSION,
    DEFAULT_TIME_ZONE,
    DEFAULT_MAX_BACKFILL_DAYS,
    PHASE3_RULE_IDS,
    COMMAND_ENDPOINT,
    REMOTE_COMMAND_TYPES,
    createCommandEnvelope,
    validateCommandEnvelope,
    createApiRequest,
    createIntentKey,
    getBusinessDate,
    isValidTimeZone
  };
});
