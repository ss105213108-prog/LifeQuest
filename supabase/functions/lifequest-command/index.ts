import { createClient } from '@supabase/supabase-js';
import {
  PHASE4_BOSS_DEFINITIONS,
  PHASE4_SYSTEM_HABITS,
  buildDailySettlementPlan,
  buildHabitEventPlan,
  levelFromTotalXp,
  maxHpFromTotalXp
} from '../_shared/phase4Domain.mjs';
import { applySettlementEquipmentGoldBonus } from '../_shared/phase5EconomyDomain.mjs';
import { publicErrorCode, publicErrorBody, readCommandBody, isValidCommandEnvelope, isValidProfilePayload, classifyAuthError } from '../_shared/edgeRequestSecurity.mjs';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, idempotency-key, if-match, x-lifequest-contract-version',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8'
};

type JsonRecord = Record<string, unknown>;

function jsonResponse(body: JsonRecord, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function errorResponse(errorCode: string, status: number, options: JsonRecord = {}) {
  const code = publicErrorCode(errorCode);
  return jsonResponse(publicErrorBody(code, options), code === 'INTERNAL_ERROR' ? 500 : status);
}

function statusForError(errorCode: string) {
  if (errorCode === 'AUTH_UNAVAILABLE') return 503;
  if (errorCode === 'AUTH_REQUIRED' || errorCode === 'SESSION_EXPIRED') return 401;
  if (['INVALID_PAYLOAD', 'INVALID_BUSINESS_DATE', 'BACKFILL_NOT_ALLOWED', 'HABIT_EVENT_NOT_TODAY'].includes(errorCode)) return 400;
  if (errorCode === 'FORBIDDEN') return 403;
  if (['NOT_FOUND', 'MEMBER_PROFILE_NOT_INITIALIZED', 'HABIT_NOT_FOUND', 'HABIT_EVENT_NOT_FOUND',
    'ITEM_NOT_FOUND', 'ITEM_NOT_OWNED', 'TICKET_NOT_FOUND'].includes(errorCode)) return 404;
  if (['LIMIT_REACHED', 'DAILY_LIMIT_REACHED', 'REVERSAL_BLOCKED', 'DAILY_REVISION_BLOCKED',
    'INSUFFICIENT_RESOURCE', 'INVENTORY_LIMIT_REACHED', 'CATALOG_CHANGED', 'HP_ALREADY_FULL',
    'TICKET_ALREADY_USED', 'ITEM_NOT_AVAILABLE', 'ITEM_ALREADY_OWNED', 'ITEM_NOT_USABLE', 'ITEM_NOT_EQUIPPABLE',
    'INVALID_EQUIPMENT_SLOT'].includes(errorCode)) return 409;
  if (['OPERATION_ID_REUSED', 'OPERATION_IN_PROGRESS', 'VERSION_CONFLICT'].includes(errorCode)) return 409;
  return 500;
}

function getTaipeiBusinessDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function secureRandomFraction() {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return values[0] / 0x1_0000_0000;
}

function mapPlayerState(row: JsonRecord) {
  const totalXp = Number(row.total_xp);
  return {
    totalXp,
    hp: Number(row.hp),
    gold: Number(row.gold),
    gems: Number(row.gems),
    level: levelFromTotalXp(totalXp),
    maxHp: maxHpFromTotalXp(totalXp),
    baseStats: {
      health: Number(row.base_health), energy: Number(row.base_energy),
      wealth: Number(row.base_wealth), growth: Number(row.base_growth)
    }
  };
}

function isValidPhase4Payload(type: string, payload: unknown) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  const value = payload as JsonRecord;
  const keys = Object.keys(value);
  if (type === 'REPORT_HABIT_EVENT') {
    return keys.length === 1 && keys[0] === 'habitId'
      && typeof value.habitId === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value.habitId);
  }
  if (type === 'REVERSE_HABIT_EVENT') {
    return keys.length === 1 && keys[0] === 'eventId'
      && isUuid(value.eventId);
  }
  if (type === 'SUBMIT_DAILY_ENTRY') {
    const allowed = ['sleep', 'water', 'exercise', 'study', 'expense', 'impulse', 'sugaryDrinks'];
    const bounds: Record<string, [number, number]> = {
      sleep: [0, 24], water: [0, 100000], exercise: [0, 1440], study: [0, 1440],
      expense: [0, 1000000000], impulse: [0, 1000], sugaryDrinks: [0, 1000]
    };
    return keys.length === allowed.length && keys.every(key => allowed.includes(key))
      && allowed.every(key => {
        const number = value[key];
        return typeof number === 'number' && Number.isFinite(number) && number >= bounds[key][0] && number <= bounds[key][1]
          && (key === 'sleep' || Number.isInteger(number));
      });
  }
  return true;
}

function isUuid(value: unknown) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isValidPhase5Payload(type: string, payload: unknown) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  const value = payload as JsonRecord;
  const keys = Object.keys(value);
  if (type === 'PURCHASE_ITEM' || type === 'REDEEM_REWARD_TICKET') {
    const identityKey = type === 'PURCHASE_ITEM' ? 'itemKey' : 'ticketKey';
    const hasVersion = Object.prototype.hasOwnProperty.call(value, 'seenCatalogVersion');
    return keys.length === 2 && hasVersion
      && keys.every(key => [identityKey, 'seenCatalogVersion'].includes(key))
      && typeof value[identityKey] === 'string' && /^[a-z][a-z0-9_]{1,63}$/.test(value[identityKey] as string)
      && Number.isSafeInteger(value.seenCatalogVersion) && Number(value.seenCatalogVersion) >= 1;
  }
  if (type === 'USE_ITEM' || type === 'EQUIP_ITEM') {
    return keys.length === 1 && keys[0] === 'itemKey'
      && typeof value.itemKey === 'string' && /^[a-z][a-z0-9_]{1,63}$/.test(value.itemKey);
  }
  if (type === 'UNEQUIP_ITEM') {
    return keys.length === 1 && keys[0] === 'slot'
      && typeof value.slot === 'string' && ['weapon', 'armor', 'pet'].includes(value.slot);
  }
  if (type === 'USE_REWARD_TICKET' || type === 'REVERSE_REWARD_TICKET') {
    return keys.length === 1 && keys[0] === 'ticketInstanceId' && isUuid(value.ticketInstanceId);
  }
  return false;
}

async function getSettlementEquipmentGoldBonus(commandWriter: any, userId: string) {
  const equipment = await commandWriter.from('player_equipment')
    .select('item_key').eq('user_id', userId).eq('slot', 'pet').maybeSingle();
  if (equipment.error) throw new Error('INTERNAL_ERROR');
  if (!equipment.data?.item_key) return 0;
  const catalog = await commandWriter.from('item_catalog')
    .select('member_effects,items_version,active').eq('item_key', equipment.data.item_key).maybeSingle();
  if (catalog.error) throw new Error('INTERNAL_ERROR');
  if (!catalog.data?.active || catalog.data.items_version !== 'items-v1') return 0;
  const bonus = Number((catalog.data.member_effects as JsonRecord)?.settlementGoldBonus || 0);
  return Number.isSafeInteger(bonus) && bonus >= 0 ? bonus : 0;
}

async function buildPhase4Plan(commandWriter: any, userId: string, command: JsonRecord, expectedVersion: number | null) {
  const type = String(command.type || '');
  const payload = command.payload as JsonRecord;
  const context = command.context as JsonRecord;
  const businessDate = String(context?.businessDate || '');
  const serverBusinessDate = getTaipeiBusinessDate();
  if (String(context?.timeZone || '') !== 'Asia/Taipei') throw new Error('INVALID_BUSINESS_DATE');

  const profileResult = await commandWriter.from('profiles')
    .select('daily_budget,timezone').eq('user_id', userId).single();
  const playerResult = await commandWriter.from('player_states')
    .select('total_xp,hp,gold,gems,base_health,base_energy,base_wealth,base_growth')
    .eq('user_id', userId).single();
  const statusesResult = await commandWriter.from('status_effects')
    .select('id,effect_key,state,expires_on').eq('user_id', userId).eq('state', 'active');
  if (profileResult.error || playerResult.error || statusesResult.error) throw new Error('NOT_FOUND');
  const player = mapPlayerState(playerResult.data as JsonRecord);
  const activeStatusIds = (statusesResult.data || []).map((item: JsonRecord) => String(item.id));

  if (type === 'REPORT_HABIT_EVENT') {
    if (businessDate !== serverBusinessDate) throw new Error('HABIT_EVENT_NOT_TODAY');
    const habitId = String(payload?.habitId || '');
    let habit: JsonRecord | null = null;
    if (Object.prototype.hasOwnProperty.call(PHASE4_SYSTEM_HABITS, habitId)) {
      habit = { ...(PHASE4_SYSTEM_HABITS as JsonRecord)[habitId] as JsonRecord, kind: 'system' };
    } else {
      const custom = await commandWriter.from('custom_habits')
        .select('id,title,direction,deleted_at').eq('user_id', userId).eq('id', habitId).maybeSingle();
      if (custom.error || !custom.data || custom.data.deleted_at) throw new Error('HABIT_NOT_FOUND');
      habit = { id: custom.data.id, title: custom.data.title, direction: custom.data.direction, kind: 'custom' };
    }
    const sameDay = await commandWriter.from('habit_events')
      .select('id,system_key,custom_habit_id,policy_snapshot,reversed_at')
      .eq('user_id', userId).eq('business_date', businessDate).is('reversed_at', null);
    const sevenDaysAgo = new Date(`${businessDate}T00:00:00Z`);
    sevenDaysAgo.setUTCDate(sevenDaysAgo.getUTCDate() - 6);
    const fried = await commandWriter.from('habit_events').select('id')
      .eq('user_id', userId).eq('system_key', 'fried_food').is('reversed_at', null)
      .gte('business_date', sevenDaysAgo.toISOString().slice(0, 10)).lte('business_date', businessDate);
    const activeBoss = await commandWriter.from('boss_encounters').select('id')
      .eq('user_id', userId).eq('state', 'active').maybeSingle();
    const incident = await commandWriter.from('boss_encounters').select('id')
      .eq('user_id', userId).eq('incident_key', `fried-food-beast:${businessDate}`).maybeSingle();
    const habitAchievements = await commandWriter.from('player_achievements').select('achievement_code').eq('user_id', userId);
    if (sameDay.error || fried.error || activeBoss.error || incident.error
      || habitAchievements.error) throw new Error('INTERNAL_ERROR');
    const matching = (sameDay.data || []).filter((event: JsonRecord) => habit?.kind === 'system'
      ? event.system_key === habitId : event.custom_habit_id === habitId);
    const rewarded = matching.filter((event: JsonRecord) => (event.policy_snapshot as JsonRecord)?.rewardGranted === true).length;
    try {
      return buildHabitEventPlan({
        habit, player, businessDate, serverBusinessDate,
        sameDayReports: matching.length, sameDayRewards: rewarded, activeStatusIds,
        recentFriedFoodReports: (fried.data || []).length,
        hasActiveBoss: Boolean(activeBoss.data), incidentAlreadyExists: Boolean(incident.data),
        achievementCodes: (habitAchievements.data || []).map((item: JsonRecord) => item.achievement_code)
      });
    } catch (error) {
      if (String(error).includes('daily habit report limit')) throw new Error('DAILY_LIMIT_REACHED');
      throw error;
    }
  }

  if (type === 'REVERSE_HABIT_EVENT') {
    const eventId = String(payload?.eventId || '');
    const eventResult = await commandWriter.from('habit_events')
      .select('id,source_operation_id,reversed_at,policy_snapshot').eq('user_id', userId).eq('id', eventId).maybeSingle();
    if (eventResult.error || !eventResult.data) throw new Error('HABIT_EVENT_NOT_FOUND');
    if (eventResult.data.reversed_at) throw new Error('REVERSAL_BLOCKED');
    const bossDependency = await commandWriter.from('boss_actions').select('id')
      .eq('user_id', userId).eq('source_type', 'habit_event').eq('source_id', eventId).limit(1);
    if (bossDependency.error) throw new Error('INTERNAL_ERROR');
    if ((bossDependency.data || []).length > 0) throw new Error('REVERSAL_BLOCKED');
    return {
      kind: 'habit_reversal', eventId, sourceOperationId: eventResult.data.source_operation_id,
      original: eventResult.data.policy_snapshot
    };
  }

  if (type === 'SUBMIT_DAILY_ENTRY') {
    const requested = new Date(`${businessDate}T00:00:00Z`);
    const today = new Date(`${serverBusinessDate}T00:00:00Z`);
    const daysAgo = Math.round((today.getTime() - requested.getTime()) / 86_400_000);
    if (daysAgo < 0) throw new Error('INVALID_BUSINESS_DATE');
    if (daysAgo > 7) throw new Error('BACKFILL_NOT_ALLOWED');
    const existing = await commandWriter.from('daily_entries')
      .select('id,current_revision,settlement_snapshot').eq('user_id', userId)
      .eq('business_date', businessDate).maybeSingle();
    let calculationPlayer = player;
    let correction: JsonRecord | null = null;
    if (existing.data) {
      const latestRevision = await commandWriter.from('daily_entry_revisions')
        .select('operation_id,settlement_snapshot').eq('user_id', userId)
        .eq('daily_entry_id', existing.data.id).eq('revision_no', existing.data.current_revision).single();
      if (latestRevision.error) throw new Error('INTERNAL_ERROR');
      const oldPlan = latestRevision.data.settlement_snapshot as JsonRecord;
      const unsafe = Boolean((oldPlan?.resource as JsonRecord)?.died)
        || Array.isArray(oldPlan?.statuses) && (oldPlan.statuses as unknown[]).length > 0
        || Boolean(oldPlan?.boss)
        || Array.isArray(oldPlan?.achievementEvents) && (oldPlan.achievementEvents as unknown[]).length > 0;
      if (unsafe) {
        throw new Error('DAILY_REVISION_BLOCKED');
      }
      calculationPlayer = ((oldPlan?.resource as JsonRecord)?.before || player) as any;
      correction = {
        entryId: existing.data.id, currentRevision: existing.data.current_revision,
        previousOperationId: latestRevision.data.operation_id,
        expectedPlayerAfter: (oldPlan?.resource as JsonRecord)?.after
      };
    }
    const historyStart = new Date(`${businessDate}T00:00:00Z`);
    historyStart.setUTCDate(historyStart.getUTCDate() - 6);
    const historyResult = await commandWriter.from('daily_entries')
      .select('business_date,effective_input').eq('user_id', userId)
      .gte('business_date', historyStart.toISOString().slice(0, 10)).lt('business_date', businessDate)
      .order('business_date');
    const eventsResult = await commandWriter.from('habit_events')
      .select('system_key,reversed_at').eq('user_id', userId).eq('business_date', businessDate);
    const preferencesResult = await commandWriter.from('rule_preferences')
      .select('rule_id,enabled').eq('user_id', userId);
    const achievementsResult = await commandWriter.from('player_achievements')
      .select('achievement_code').eq('user_id', userId);
    const activeBossResult = await commandWriter.from('boss_encounters')
      .select('id,boss_key,max_hp,hp,summoned_on').eq('user_id', userId).eq('state', 'active').maybeSingle();
    const incidentResult = await commandWriter.from('boss_encounters').select('incident_key').eq('user_id', userId);
    if (existing.error || historyResult.error || eventsResult.error || preferencesResult.error
      || achievementsResult.error || activeBossResult.error || incidentResult.error) throw new Error('INTERNAL_ERROR');
    let activeBoss: JsonRecord | null = activeBossResult.data;
    if (activeBoss) {
      const lastAction = await commandWriter.from('boss_actions').select('business_date')
        .eq('user_id', userId).eq('encounter_id', activeBoss.id).eq('action_type', 'progress')
        .order('business_date', { ascending: false }).limit(1).maybeSingle();
      if (lastAction.error) throw new Error('INTERNAL_ERROR');
      activeBoss = { ...activeBoss, bossKey: activeBoss.boss_key, maxHp: activeBoss.max_hp,
        summonedOn: activeBoss.summoned_on, lastActionDate: lastAction.data?.business_date || null };
    }
    const history = (historyResult.data || []).map((entry: JsonRecord) => ({
      ...(entry.effective_input as JsonRecord), businessDate: entry.business_date
    }));
    const habitEvents = (eventsResult.data || []).map((event: JsonRecord) => ({
      systemKey: event.system_key,
      reversedAt: event.reversed_at
    }));
    const rulePreferences = Object.fromEntries((preferencesResult.data || []).map((item: JsonRecord) => [item.rule_id, item.enabled]));
    const plan = buildDailySettlementPlan({
      rawInput: payload, habitEvents, history,
      player: calculationPlayer, profile: { dailyBudget: Number(profileResult.data.daily_budget) },
      rulePreferences, businessDate, serverBusinessDate, randomValue: secureRandomFraction(), activeStatusIds,
      activeBoss, achievementCodes: (achievementsResult.data || []).map((item: JsonRecord) => item.achievement_code),
      incidentKeys: (incidentResult.data || []).map((item: JsonRecord) => item.incident_key)
    });
    const settlementGoldBonus = await getSettlementEquipmentGoldBonus(commandWriter, userId);
    return {
      ...applySettlementEquipmentGoldBonus(plan, settlementGoldBonus),
      correction,
      budgetSnapshot: Number(profileResult.data.daily_budget),
      timezone: 'Asia/Taipei'
    };
  }
  throw new Error('INVALID_PAYLOAD');
}

function getExpectedVersion(request: Request) {
  const raw = request.headers.get('if-match');
  if (raw === null) return null;
  if (!/^\d+$/.test(raw)) return Number.NaN;
  const version = Number(raw);
  return Number.isSafeInteger(version) && version >= 0 ? version : Number.NaN;
}

async function handleRequest(request: Request) {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (!['GET', 'POST'].includes(request.method)) {
    return errorResponse('INVALID_PAYLOAD', 405, { message: '不支援的請求方法。' });
  }

  let command: JsonRecord = {};
  const expectedVersion = request.method === 'POST' ? getExpectedVersion(request) : null;
  if (request.method === 'POST') {
    const parsed = await readCommandBody(request);
    if (!parsed.ok) return errorResponse('INVALID_PAYLOAD', parsed.status);
    if (!isValidCommandEnvelope(parsed.command) || Number.isNaN(expectedVersion)
      || (parsed.command.type !== 'INITIALIZE_MEMBER_PROFILE' && expectedVersion === null)) {
      return errorResponse('INVALID_PAYLOAD', 400);
    }
    command = parsed.command;
  }

  const authorization = request.headers.get('authorization') || '';
  if (!authorization.toLowerCase().startsWith('bearer ')) {
    return errorResponse('AUTH_REQUIRED', 401, { message: '請先登入冒險者帳號。' });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
    return errorResponse('INTERNAL_ERROR', 500, { message: '會員服務設定尚未完成。' });
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false }
  });

  let authResult;
  try {
    authResult = await supabase.auth.getUser();
  } catch (error) {
    const code = classifyAuthError(error);
    return errorResponse(code, statusForError(code));
  }
  const { data: userData, error: userError } = authResult;
  if (userError) {
    const code = classifyAuthError(userError);
    return errorResponse(code, statusForError(code));
  }
  if (userData?.user === null) {
    return errorResponse('SESSION_EXPIRED', 401, { message: '登入狀態已失效，請重新登入。' });
  }
  if (typeof userData?.user?.id !== 'string' || !userData.user.id) {
    return errorResponse('AUTH_UNAVAILABLE', 503);
  }

  // The service role never leaves the Edge runtime. After the access token is
  // verified above, every server-side read is still explicitly scoped to that
  // verified user id. This avoids relying on five concurrent REST requests to
  // each establish the same RLS session during a just-created Auth session.
  const commandWriter = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  if (request.method === 'GET') {
    // Keep bootstrap reads sequential. The Edge runtime intermittently returned
    // one 401 when five PostgREST requests shared a just-created session in
    // parallel, even though the other four requests used the same credentials.
    const bootstrapAttempts = 3;
    let lastObservedRepositoryVersion: number | null = null;
    for (let attempt = 0; attempt < bootstrapAttempts; attempt++) {
    const startRootQuery = await commandWriter
      .from('member_game_roots')
      .select('repository_version')
      .eq('user_id', userData.user.id)
      .maybeSingle();
    const profileQuery = await commandWriter
      .from('profiles')
      .select('adventurer_name,onboarding_status,onboarding_completed,main_quest_code,daily_budget,timezone,created_at,updated_at')
      .eq('user_id', userData.user.id)
      .maybeSingle();
    const draftsQuery = await commandWriter
      .from('daily_drafts')
      .select('entry_date,sleep,water,exercise,study,expense,impulse,sugary_drinks,updated_at')
      .eq('user_id', userData.user.id)
      .order('entry_date');
    const habitsQuery = await commandWriter
      .from('custom_habits')
      .select('id,title,direction,deleted_at,created_at,updated_at')
      .eq('user_id', userData.user.id)
      .order('created_at');
    const preferencesQuery = await commandWriter
      .from('rule_preferences')
      .select('rule_id,enabled')
      .eq('user_id', userData.user.id);
    const playerQuery = await commandWriter
      .from('player_states')
      .select('total_xp,hp,gold,gems,base_health,base_energy,base_wealth,base_growth,level_curve_version,updated_at')
      .eq('user_id', userData.user.id)
      .maybeSingle();
    const statusesQuery = await commandWriter
      .from('status_effects')
      .select('id,effect_key,effect_type,title_snapshot,modifier_snapshot,applied_on,expires_on,state')
      .eq('user_id', userData.user.id)
      .order('created_at', { ascending: false })
      .limit(30);
    const entriesQuery = await commandWriter
      .from('daily_entries')
      .select('id,business_date,current_revision,sleep,water,exercise,study,expense,impulse,sugary_drinks,effective_input,settlement_snapshot,settled_at')
      .eq('user_id', userData.user.id)
      .order('business_date', { ascending: false })
      .limit(30);
    const eventsQuery = await commandWriter
      .from('habit_events')
      .select('id,business_date,habit_kind,system_key,custom_habit_id,direction,title_snapshot,policy_snapshot,occurred_at,reversed_at')
      .eq('user_id', userData.user.id)
      .order('occurred_at', { ascending: false })
      .limit(50);
    const bossQuery = await commandWriter
      .from('boss_encounters')
      .select('id,boss_key,name_snapshot,max_hp,hp,state,summoned_on,reward_snapshot')
      .eq('user_id', userData.user.id)
      .eq('state', 'active')
      .maybeSingle();
    const achievementsQuery = await commandWriter
      .from('player_achievements')
      .select('achievement_code,definition_version,target_snapshot,reward_snapshot,unlocked_at,reward_state')
      .eq('user_id', userData.user.id);
    const gymRatProgressQuery = await commandWriter
      .from('habit_events')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userData.user.id)
      .eq('business_date', getTaipeiBusinessDate())
      .eq('system_key', 'exercise_training')
      .is('reversed_at', null);
    const economyQuery = await commandWriter.rpc('get_phase5b_economy_state', {
      p_user_id: userData.user.id
    });
    const catalogQuery = await commandWriter
      .from('item_catalog')
      .select('item_key,display_name,description,item_type,rarity,currency_type,base_price,catalog_version,stackable,max_stack,usable,equippable,equipment_slot,effect_key,equipment_modifiers,member_effects')
      .eq('active', true)
      .order('item_key');
    const endRootQuery = await commandWriter
      .from('member_game_roots')
      .select('repository_version')
      .eq('user_id', userData.user.id)
      .maybeSingle();

    if (startRootQuery.error || profileQuery.error || draftsQuery.error || habitsQuery.error || preferencesQuery.error
      || playerQuery.error || statusesQuery.error || entriesQuery.error || eventsQuery.error
      || bossQuery.error || achievementsQuery.error || gymRatProgressQuery.error || economyQuery.error
      || catalogQuery.error || endRootQuery.error) {
      return errorResponse('INTERNAL_ERROR', 500, { message: '無法讀取會員卷宗。' });
    }
    if (!profileQuery.data || !startRootQuery.data || !endRootQuery.data) {
      return errorResponse('MEMBER_PROFILE_NOT_INITIALIZED', 404, {
        message: '會員卷宗尚未初始化。'
      });
    }
    lastObservedRepositoryVersion = endRootQuery.data.repository_version;
    if (startRootQuery.data.repository_version !== endRootQuery.data.repository_version) continue;
    const stableRepositoryVersion = endRootQuery.data.repository_version;

    const dailyDrafts = Object.fromEntries((draftsQuery.data || []).map(draft => [
      draft.entry_date,
      {
        date: draft.entry_date,
        sleep: draft.sleep,
        water: draft.water,
        exercise: draft.exercise,
        study: draft.study,
        expense: draft.expense,
        impulse: draft.impulse,
        sugaryDrinks: draft.sugary_drinks,
        updatedAt: draft.updated_at
      }
    ]));
    const customHabits = (habitsQuery.data || []).map(habit => ({
      id: habit.id,
      title: habit.title,
      direction: habit.direction,
      deletedAt: habit.deleted_at,
      createdAt: habit.created_at,
      updatedAt: habit.updated_at
    }));
    const rulePreferences = Object.fromEntries((preferencesQuery.data || []).map(preference => [
      preference.rule_id,
      preference.enabled
    ]));

    return jsonResponse({
      ok: true,
      repositoryVersion: stableRepositoryVersion,
      serverTimestamp: new Date().toISOString(),
      state: {
        meta: {
          repositoryVersion: stableRepositoryVersion,
          operations: []
        },
        member: {
          adventurerName: profileQuery.data.adventurer_name,
          onboardingStatus: profileQuery.data.onboarding_status,
          onboardingCompleted: profileQuery.data.onboarding_completed,
          mainQuestId: profileQuery.data.main_quest_code,
          dailyBudget: profileQuery.data.daily_budget,
          timeZone: profileQuery.data.timezone,
          createdAt: profileQuery.data.created_at,
          updatedAt: profileQuery.data.updated_at
        },
        dailyDrafts,
        customHabits,
        rulePreferences,
        player: playerQuery.data ? mapPlayerState(playerQuery.data as JsonRecord) : null,
        statusEffects: statusesQuery.data || [],
        dailyEntries: entriesQuery.data || [],
        habitEvents: eventsQuery.data || [],
        activeBoss: bossQuery.data || null,
        achievements: (achievementsQuery.data || []).map(achievement => ({
          code: achievement.achievement_code,
          definitionVersion: achievement.definition_version,
          targetSnapshot: achievement.target_snapshot,
          rewardSnapshot: achievement.reward_snapshot,
          unlockedAt: achievement.unlocked_at,
          rewardState: achievement.reward_state
        })),
        achievementProgress: {
          gym_rat: Math.min(5, Math.max(0, gymRatProgressQuery.count || 0))
        },
        catalog: (catalogQuery.data || []).map(item => ({
          itemKey: item.item_key,
          displayName: item.display_name,
          description: item.description,
          itemType: item.item_type,
          rarity: item.rarity,
          currency: item.currency_type,
          basePrice: item.base_price,
          catalogVersion: item.catalog_version,
          stackable: item.stackable,
          maxStack: item.max_stack,
          usable: item.usable,
          equippable: item.equippable,
          equipmentSlot: item.equipment_slot,
          effectKey: item.effect_key,
          equipmentModifiers: item.equipment_modifiers,
          memberEffects: item.member_effects
        })),
        ...((economyQuery.data && typeof economyQuery.data === 'object') ? economyQuery.data : {})
      },
      result: { initialized: true }
    });
    }
    return errorResponse('VERSION_CONFLICT', 409, {
      retryable: true,
      currentVersion: lastObservedRepositoryVersion,
      message: '會員卷宗正在更新，請稍後重新讀取。'
    });
  }

  const operationId = String(command.operationId || '');
  const idempotencyKey = request.headers.get('idempotency-key') || '';
  const commandType = String(command.type || '');
  const commandRpcs: Record<string, string> = {
    INITIALIZE_MEMBER_PROFILE: 'initialize_member_profile',
    SELECT_MAIN_QUEST: 'select_main_quest',
    UPDATE_PROFILE: 'update_member_profile',
    SAVE_DAILY_DRAFT: 'execute_phase3_command',
    CREATE_CUSTOM_HABIT: 'execute_phase3_command',
    UPDATE_CUSTOM_HABIT: 'execute_phase3_command',
    REMOVE_CUSTOM_HABIT: 'execute_phase3_command',
    RESTORE_CUSTOM_HABIT: 'execute_phase3_command',
    SET_RULE_ENABLED: 'execute_phase3_command',
    REPORT_HABIT_EVENT: 'execute_phase4b_command',
    REVERSE_HABIT_EVENT: 'execute_phase4b_command',
    SUBMIT_DAILY_ENTRY: 'execute_phase4b_command',
    PURCHASE_ITEM: 'execute_phase5b_economy_command',
    USE_ITEM: 'execute_phase5b_economy_command',
    EQUIP_ITEM: 'execute_phase5b_economy_command',
    UNEQUIP_ITEM: 'execute_phase5b_economy_command',
    REDEEM_REWARD_TICKET: 'execute_phase5b_economy_command',
    USE_REWARD_TICKET: 'execute_phase5b_economy_command',
    REVERSE_REWARD_TICKET: 'execute_phase5b_economy_command'
  };
  if (!Object.prototype.hasOwnProperty.call(commandRpcs, commandType)
    || command.contractVersion !== 1
    || !operationId
    || idempotencyKey !== operationId) {
    return errorResponse('INVALID_PAYLOAD', 400, {
      operationId: operationId || null,
      message: '會員 Command 不完整或不屬於目前開放範圍。'
    });
  }

  let phase4Plan: JsonRecord | null = null;
  if (!isValidProfilePayload(commandType, command.payload)) {
    return errorResponse('INVALID_PAYLOAD', 400, { operationId });
  }
  if (['REPORT_HABIT_EVENT', 'REVERSE_HABIT_EVENT', 'SUBMIT_DAILY_ENTRY'].includes(commandType)) {
    if (!isValidPhase4Payload(commandType, command.payload)) {
      return errorResponse('INVALID_PAYLOAD', 400, { operationId, message: '會員遊戲操作資料不正確。' });
    }
    const receipt = await commandWriter.rpc('get_phase4b_operation_receipt', {
      p_user_id: userData.user.id,
      p_command: command
    });
    if (receipt.error || !receipt.data || typeof receipt.data !== 'object') {
      return errorResponse('INTERNAL_ERROR', 500, { operationId, message: '無法核對會員操作收據。' });
    }
    const receiptResult = receipt.data as JsonRecord;
    if (receiptResult.ok !== true) {
      const receiptError = String(receiptResult.errorCode || 'INTERNAL_ERROR');
      return errorResponse(receiptError, statusForError(receiptError), {
        operationId,
        retryable: receiptResult.retryable === true,
        message: receiptError === 'OPERATION_ID_REUSED'
          ? '同一操作識別碼不可用於不同內容。'
          : receiptError === 'OPERATION_IN_PROGRESS'
            ? '相同操作仍在處理中，請稍後重試。'
            : '無法核對會員操作收據。'
      });
    }
    if (receiptResult.duplicate === true) return jsonResponse(receiptResult);
    try {
      phase4Plan = await buildPhase4Plan(commandWriter, userData.user.id, command, expectedVersion);
    } catch (error) {
      const errorCode = publicErrorCode((error as Error)?.message);
      return errorResponse(errorCode, statusForError(errorCode), {
        operationId,
        message: errorCode === 'HABIT_EVENT_NOT_TODAY'
          ? '習慣事件只接受公會今日回報。'
          : errorCode === 'DAILY_LIMIT_REACHED'
            ? '此習慣今日回報已達上限。'
            : errorCode === 'DAILY_REVISION_BLOCKED'
              ? '此日結算已有後續依賴，無法安全更正。'
              : errorCode === 'REVERSAL_BLOCKED'
                ? '此習慣事件已有後續依賴，無法安全復原。'
                : errorCode.endsWith('NOT_FOUND') ? '找不到指定的公會紀錄。' : '會員遊戲操作資料不正確。'
      });
    }
  }
  if (['PURCHASE_ITEM', 'USE_ITEM', 'EQUIP_ITEM', 'UNEQUIP_ITEM',
    'REDEEM_REWARD_TICKET', 'USE_REWARD_TICKET', 'REVERSE_REWARD_TICKET'].includes(commandType)
    && !isValidPhase5Payload(commandType, command.payload)) {
    return errorResponse('INVALID_PAYLOAD', 400, {
      operationId,
      message: '會員交易操作資料不正確。'
    });
  }

  // The service role remains inside the Edge runtime. Ownership comes only from
  // the user identity verified above, never from the browser command payload.
  const { data, error } = await commandWriter.rpc(commandRpcs[commandType], {
    p_user_id: userData.user.id,
    p_command: command,
    p_expected_version: expectedVersion,
    ...(phase4Plan ? { p_plan: phase4Plan } : {})
  });

  if (error || !data || typeof data !== 'object') {
    return errorResponse('INTERNAL_ERROR', 500, {
      operationId,
      message: '會員卷宗操作失敗。'
    });
  }

  const result = data as JsonRecord;
  if (result.ok !== true) {
    const errorCode = String(result.errorCode || 'INTERNAL_ERROR');
    return errorResponse(errorCode, statusForError(errorCode), {
      operationId,
      retryable: result.retryable === true,
      currentVersion: result.currentVersion ?? null,
      message: errorCode === 'VERSION_CONFLICT'
        ? '會員卷宗已有較新的版本，請重新整理後再試。'
        : errorCode === 'OPERATION_ID_REUSED'
          ? '同一操作識別碼不可用於不同內容。'
          : errorCode === 'OPERATION_IN_PROGRESS'
            ? '相同操作仍在處理中，請稍後重試。'
            : errorCode === 'FORBIDDEN'
              ? '這份會員卷宗目前不允許執行此操作。'
              : errorCode === 'NOT_FOUND'
                ? '找不到可更新的會員卷宗。'
                : errorCode === 'CATALOG_CHANGED'
                  ? '補給品目錄已更新，請重新讀取後再確認交易。'
                  : errorCode === 'INSUFFICIENT_RESOURCE'
                    ? '目前持有的資源不足。'
                    : errorCode === 'HP_ALREADY_FULL'
                      ? '生命值已滿，不需要使用藥水。'
                      : errorCode.endsWith('_NOT_FOUND') || errorCode === 'ITEM_NOT_OWNED'
                        ? '找不到指定的補給品或犒賞券。'
                : errorCode === 'INVALID_BUSINESS_DATE'
                  ? '草稿日期不可晚於公會今日日期。'
                  : errorCode === 'BACKFILL_NOT_ALLOWED'
                    ? '草稿日期已超出可補記的七日範圍。'
                    : errorCode === 'LIMIT_REACHED'
                      ? '自訂習慣數量已達上限。'
                      : '會員卷宗資料不正確。'
    });
  }

  return jsonResponse(result);
}

Deno.serve(async (request: Request) => {
  try {
    return await handleRequest(request);
  } catch (_error) {
    // Includes unexpected Auth/SDK, read, RPC and response-encoding failures.
    // No raw exception text or full Member state is logged or reflected.
    return errorResponse('INTERNAL_ERROR', 500);
  }
});
