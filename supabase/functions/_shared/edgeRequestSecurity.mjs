// Public transport errors only. Database/domain diagnostics must never become
// response codes or messages. Gameplay decisions remain in the existing engine.
const PUBLIC_MESSAGES = Object.freeze({
  INTERNAL_ERROR: '系統暫時無法完成操作，請稍後再試。',
  AUTH_REQUIRED: '請先登入冒險者帳號。',
  SESSION_EXPIRED: '登入狀態已失效，請重新登入。',
  AUTH_UNAVAILABLE: '登入服務暫時無法使用，請稍後再試。',
  INVALID_PAYLOAD: '操作資料格式不正確，請確認後再試。',
  INVALID_BUSINESS_DATE: '冒險紀錄日期不正確。',
  BACKFILL_NOT_ALLOWED: '冒險紀錄已超出可補記的七日範圍。',
  FORBIDDEN: '這份會員卷宗目前不允許執行此操作。',
  NOT_FOUND: '找不到指定的會員紀錄。',
  MEMBER_PROFILE_NOT_INITIALIZED: '會員卷宗尚未完成初始化。',
  HABIT_NOT_FOUND: '找不到指定的習慣。',
  HABIT_EVENT_NOT_FOUND: '找不到指定的習慣回報。',
  HABIT_EVENT_NOT_TODAY: '習慣事件只接受公會今日回報。',
  DAILY_LIMIT_REACHED: '此習慣今日回報已達上限。',
  LIMIT_REACHED: '自訂習慣數量已達上限。',
  REVERSAL_BLOCKED: '此紀錄已有後續依賴，無法安全復原。',
  DAILY_REVISION_BLOCKED: '此日結算已有後續依賴，無法安全更正。',
  VERSION_CONFLICT: '會員卷宗已有較新的版本，請重新整理後再試。',
  OPERATION_ID_REUSED: '同一操作識別碼不可用於不同內容。',
  OPERATION_IN_PROGRESS: '相同操作仍在處理中，請稍後重試。',
  CATALOG_CHANGED: '補給品目錄已更新，請重新讀取後再確認交易。',
  INSUFFICIENT_RESOURCE: '目前持有的資源不足。',
  INVENTORY_LIMIT_REACHED: '此補給品已達持有上限。',
  ITEM_ALREADY_OWNED: '已持有此裝備。',
  ITEM_NOT_AVAILABLE: '此補給品目前無法取得。',
  ITEM_NOT_EQUIPPABLE: '此補給品不能裝備。',
  ITEM_NOT_FOUND: '找不到指定的補給品。',
  ITEM_NOT_OWNED: '尚未持有此補給品。',
  ITEM_NOT_USABLE: '此補給品不能使用。',
  INVALID_EQUIPMENT_SLOT: '裝備欄位不正確。',
  HP_ALREADY_FULL: '生命值已滿，不需要使用藥水。',
  TICKET_ALREADY_USED: '此犒賞券已使用。',
  TICKET_NOT_FOUND: '找不到指定的犒賞券。'
});

export function publicErrorCode(value) {
  return typeof value === 'string' && Object.hasOwn(PUBLIC_MESSAGES, value) ? value : 'INTERNAL_ERROR';
}

export function classifyAuthError(error) {
  // Status/code evidence only; never interpret arbitrary message substrings.
  if (error?.status >= 500 || error?.status === 429) return 'AUTH_UNAVAILABLE';
  if (error?.status === 401 || error?.name === 'AuthSessionMissingError'
    || ['bad_jwt', 'session_expired', 'session_not_found', 'user_not_found'].includes(error?.code)) {
    return 'SESSION_EXPIRED';
  }
  return 'AUTH_UNAVAILABLE';
}

export function publicErrorBody(value, options = {}) {
  const code = publicErrorCode(value);
  return {
    ok: false, errorCode: code, reason: code, message: PUBLIC_MESSAGES[code],
    retryable: code === 'AUTH_UNAVAILABLE' || (code !== 'INTERNAL_ERROR' && options.retryable === true),
    ...(typeof options.operationId === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/.test(options.operationId)
      ? { operationId: options.operationId } : {}),
    ...(Number.isSafeInteger(options.currentVersion) && options.currentVersion >= 0
      ? { currentVersion: options.currentVersion } : {})
  };
}

// Normal envelopes (including the duplicated intent JSON) are under a few KB.
// Count streamed bytes, not just Content-Length, before JSON.parse or Auth I/O.
export const MAX_COMMAND_BYTES = 32 * 1024;
export async function readCommandBody(request) {
  const declared = request.headers.get('content-length');
  if (declared !== null && /^\d+$/.test(declared) && Number(declared) > MAX_COMMAND_BYTES) {
    return { ok: false, status: 413 };
  }
  if (!request.body) return { ok: false, status: 400 };
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_COMMAND_BYTES) {
        // A remote stream cancellation must not delay the rejection response.
        void reader.cancel().catch(() => {});
        return { ok: false, status: 413 };
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return { ok: true, command: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) };
  } catch (_error) {
    return { ok: false, status: 400 };
  } finally {
    reader.releaseLock();
  }
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function exactKeys(value, keys) {
  return isObject(value) && Object.keys(value).length === keys.length
    && Object.keys(value).every(key => keys.includes(key));
}
function isDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function isTimestamp(value) {
  if (typeof value !== 'string' || value.length > 40) return false;
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
  return Boolean(match && isDate(match[1]) && Number(match[2]) < 24
    && Number(match[3]) < 60 && Number(match[4]) < 60 && Number.isFinite(Date.parse(value)));
}

export function isValidCommandEnvelope(command) {
  if (!exactKeys(command, ['contractVersion', 'type', 'operationId', 'occurredAt', 'context', 'intentKey', 'payload'])
    || command.contractVersion !== 1
    || typeof command.type !== 'string' || !/^[A-Z][A-Z_]{1,63}$/.test(command.type)
    || typeof command.operationId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/.test(command.operationId)
    || !isTimestamp(command.occurredAt)
    || !exactKeys(command.context, ['businessDate', 'timeZone'])
    || !isDate(command.context.businessDate)
    || typeof command.context.timeZone !== 'string' || command.context.timeZone.length > 100
    || !isObject(command.payload)
    || typeof command.intentKey !== 'string' || command.intentKey.length > 4096
    || /[\u0000-\u001f\u007f]/.test(command.intentKey)) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: command.context.timeZone });
    const prefix = `${command.type}:${command.context.businessDate}:`;
    if (!command.intentKey.startsWith(prefix)) {
      // Existing Phase 2/4B/5A/5B verification clients use TYPE:operation-token.
      const legacyPrefix = `${command.type}:`;
      return command.intentKey.startsWith(legacyPrefix)
        && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(command.intentKey.slice(legacyPrefix.length));
    }
    // Check the existing TYPE:date:JSON format, not ownership or request hash.
    // The existing receipt/kernel still decides same-operation payload reuse.
    return isObject(JSON.parse(command.intentKey.slice(prefix.length)));
  } catch (_error) { return false; }
}

// Match the existing Phase 1-3 wire contract, without Number/String coercion.
// Domain existence, dates allowed by policy and ownership stay with the RPC.
export function isValidProfilePayload(type, payload) {
  if (!isObject(payload)) return false;
  const keys = Object.keys(payload);
  const has = key => Object.hasOwn(payload, key);
  const name = value => typeof value === 'string' && value.trim().length >= 2
    && value.trim().length <= 16 && /^[\p{L}\p{N}]+$/u.test(value.trim());
  const title = value => typeof value === 'string' && value.trim().length >= 1 && value.trim().length <= 80;
  const uuid = value => typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  if (type === 'INITIALIZE_MEMBER_PROFILE') return exactKeys(payload, ['adventurerName']) && name(payload.adventurerName);
  if (type === 'SELECT_MAIN_QUEST') return exactKeys(payload, ['questId'])
    && ['sleep', 'spending', 'exercise', 'learning'].includes(payload.questId);
  if (type === 'UPDATE_PROFILE') return keys.length > 0 && keys.every(key => ['adventurerName', 'dailyBudget'].includes(key))
    && (!has('adventurerName') || name(payload.adventurerName))
    && (!has('dailyBudget') || (Number.isInteger(payload.dailyBudget) && payload.dailyBudget >= 1 && payload.dailyBudget <= 100000000));
  if (type === 'SAVE_DAILY_DRAFT') {
    const bounds = { sleep: 24, water: 100000, exercise: 1440, study: 1440, expense: 1000000000, impulse: 1000, sugaryDrinks: 1000 };
    return exactKeys(payload, ['date', 'draft']) && isDate(payload.date) && exactKeys(payload.draft, Object.keys(bounds))
      && Object.entries(bounds).every(([key, max]) => {
        const value = payload.draft[key];
        return value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max
          && (key === 'sleep' || Number.isInteger(value)));
      });
  }
  if (type === 'CREATE_CUSTOM_HABIT') return exactKeys(payload, ['title', 'direction'])
    && title(payload.title) && ['good', 'bad'].includes(payload.direction);
  if (type === 'UPDATE_CUSTOM_HABIT') return keys.length >= 2 && keys.length <= 3
    && keys.every(key => ['habitId', 'title', 'direction'].includes(key)) && uuid(payload.habitId)
    && (!has('title') || title(payload.title)) && (!has('direction') || ['good', 'bad'].includes(payload.direction));
  if (type === 'REMOVE_CUSTOM_HABIT' || type === 'RESTORE_CUSTOM_HABIT') return exactKeys(payload, ['habitId']) && uuid(payload.habitId);
  if (type === 'SET_RULE_ENABLED') return exactKeys(payload, ['ruleId', 'enabled']) && typeof payload.enabled === 'boolean'
    && ['rule_1', 'rule_2', 'rule_water', 'rule_exercise', 'rule_5', 'rule_3', 'rule_boss_sleep',
      'rule_boss_lazy', 'rule_boss_budget', 'rule_boss_fried_food', 'rule_4', 'rule_6'].includes(payload.ruleId);
  return true; // Later-phase commands use their existing dedicated validators.
}
