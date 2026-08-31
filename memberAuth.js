(function(root, factory) {
  const exported = factory();
  if (typeof module === 'object' && module.exports) module.exports = exported;
  if (root) root.LifeQuestMemberAuth = exported;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  function clone(value) {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
  }

  function selectLatestHabitEvent(events = []) {
    return (Array.isArray(events) ? events : [])
      .filter(event => event && !event.reversedAt && !event.reversed_at)
      .reduce((latest, event) => {
        if (!latest) return event;
        const eventTime = Date.parse(event.occurredAt || event.occurred_at || event.createdAt || event.created_at || '');
        const latestTime = Date.parse(latest.occurredAt || latest.occurred_at || latest.createdAt || latest.created_at || '');
        if (Number.isFinite(eventTime) && (!Number.isFinite(latestTime) || eventTime > latestTime)) return event;
        return latest;
      }, null);
  }

  function createMemberState(version = 0) {
    return {
      meta: { repositoryVersion: Math.max(0, Number(version) || 0), operations: [] },
      member: null,
      dailyDrafts: {},
      customHabits: [],
      rulePreferences: {},
      player: null,
      dailyEntries: [],
      habitEvents: [],
      statusEffects: [],
      activeBoss: null,
      achievements: [],
      achievementProgress: {},
      catalog: [],
      inventory: [],
      equipment: [],
      rewardTickets: [],
      economySummary: null,
      derivedEquipmentModifiers: { health: 0, energy: 0, wealth: 0, growth: 0 },
      derivedStats: null,
      recentEconomyTransactions: []
    };
  }

  function normalizeMemberAchievement(achievement) {
    const normalized = { ...achievement };
    // Omitted fields in a slim RPC row are not authoritative empty values.
    // Preserve their absence so a later merge can keep the full Cloud snapshot.
    const aliases = [
      ['code', 'achievement_code'],
      ['unlockedAt', 'unlocked_at'],
      ['rewardState', 'reward_state'],
      ['definitionVersion', 'definition_version'],
      ['targetSnapshot', 'target_snapshot'],
      ['rewardSnapshot', 'reward_snapshot']
    ];
    aliases.forEach(([camel, snake]) => {
      if (Object.prototype.hasOwnProperty.call(achievement, camel)) normalized[camel] = achievement[camel];
      else if (Object.prototype.hasOwnProperty.call(achievement, snake)) normalized[camel] = achievement[snake];
    });
    return normalized;
  }

  function normalizeMemberCloudState(value = {}) {
    const source = value && typeof value === 'object' ? clone(value) : {};
    const read = (record, camel, snake, fallback = null) => {
      if (record && Object.prototype.hasOwnProperty.call(record, camel)) return record[camel];
      if (record && Object.prototype.hasOwnProperty.call(record, snake)) return record[snake];
      return fallback;
    };
    const list = value => Array.isArray(value) ? value : [];
    const player = source.player && typeof source.player === 'object' ? source.player : null;
    return {
      ...createMemberState(read(source.meta, 'repositoryVersion', 'repository_version', 0)),
      ...source,
      meta: {
        ...(source.meta || {}),
        repositoryVersion: Math.max(0, Number(read(source.meta, 'repositoryVersion', 'repository_version', 0)) || 0),
        operations: list(source.meta?.operations)
      },
      player: player ? {
        ...player,
        totalXp: Math.max(0, Number(read(player, 'totalXp', 'total_xp', 0)) || 0),
        level: Math.max(1, Number(player.level) || 1),
        hp: Math.max(0, Number(player.hp) || 0),
        maxHp: Math.max(1, Number(read(player, 'maxHp', 'max_hp', 50)) || 50),
        gold: Math.max(0, Number(player.gold) || 0),
        gems: Math.max(0, Number(player.gems) || 0),
        baseStats: read(player, 'baseStats', 'base_stats', {}) || {},
        levelCurveVersion: read(player, 'levelCurveVersion', 'level_curve_version', 'level-v1')
      } : null,
      dailyEntries: list(source.dailyEntries || source.daily_entries).map(entry => ({
        ...entry,
        businessDate: read(entry, 'businessDate', 'business_date', ''),
        currentRevision: Number(read(entry, 'currentRevision', 'current_revision', 1)) || 1,
        sugaryDrinks: Number(read(entry, 'sugaryDrinks', 'sugary_drinks', 0)) || 0,
        effectiveInput: read(entry, 'effectiveInput', 'effective_input', {}) || {},
        settlement: read(entry, 'settlement', 'settlement_snapshot', {}) || {},
        settledAt: read(entry, 'settledAt', 'settled_at', null)
      })),
      habitEvents: list(source.habitEvents || source.habit_events).map(event => ({
        ...event,
        businessDate: read(event, 'businessDate', 'business_date', ''),
        systemKey: read(event, 'systemKey', 'system_key', null),
        customHabitId: read(event, 'customHabitId', 'custom_habit_id', null),
        occurredAt: read(event, 'occurredAt', 'occurred_at', null),
        reversedAt: read(event, 'reversedAt', 'reversed_at', null),
        policy: read(event, 'policy', 'policy_snapshot', {}) || {}
      })),
      statusEffects: list(source.statusEffects || source.status_effects).map(effect => ({
        ...effect,
        key: read(effect, 'key', 'effect_key', null),
        type: read(effect, 'type', 'effect_type', null),
        title: read(effect, 'title', 'title_snapshot', ''),
        appliedOn: read(effect, 'appliedOn', 'applied_on', null),
        expiresOn: read(effect, 'expiresOn', 'expires_on', null),
        modifiers: read(effect, 'modifiers', 'modifier_snapshot', {}) || {}
      })),
      activeBoss: source.activeBoss || source.active_boss || null,
      achievements: list(source.achievements).map(normalizeMemberAchievement),
      achievementProgress: Object.fromEntries(Object.entries(
        source.achievementProgress || source.achievement_progress || {}
      ).map(([code, progress]) => [code, Math.max(0, Number(progress) || 0)])),
      catalog: list(source.catalog).map(item => ({
        ...item,
        itemKey: read(item, 'itemKey', 'item_key', null),
        displayName: read(item, 'displayName', 'display_name', ''),
        itemType: read(item, 'itemType', 'item_type', null),
        description: String(item.description || ''),
        rarity: String(item.rarity || 'common'),
        currency: read(item, 'currency', 'currency_type', null),
        basePrice: Number(read(item, 'basePrice', 'base_price', 0)) || 0,
        catalogVersion: Number(read(item, 'catalogVersion', 'catalog_version', 0)) || 0,
        maxStack: Number(read(item, 'maxStack', 'max_stack', 1)) || 1,
        equipmentSlot: read(item, 'equipmentSlot', 'equipment_slot', null),
        effectKey: read(item, 'effectKey', 'effect_key', null),
        equipmentModifiers: read(item, 'equipmentModifiers', 'equipment_modifiers', {}) || {},
        memberEffects: read(item, 'memberEffects', 'member_effects', {}) || {}
      })),
      inventory: list(source.inventory).map(item => ({
        ...item,
        itemKey: read(item, 'itemKey', 'item_key', null),
        displayName: read(item, 'displayName', 'display_name', ''),
        itemType: read(item, 'itemType', 'item_type', null),
        quantity: Math.max(0, Number(item.quantity) || 0),
        acquiredAt: read(item, 'acquiredAt', 'acquired_at', null),
        updatedAt: read(item, 'updatedAt', 'updated_at', null)
      })),
      equipment: list(source.equipment).map(item => ({
        ...item,
        slot: read(item, 'slot', 'equipment_slot', null),
        itemKey: read(item, 'itemKey', 'item_key', null),
        displayName: read(item, 'displayName', 'display_name', ''),
        equipmentModifiers: read(item, 'equipmentModifiers', 'equipment_modifiers', {}) || {},
        memberEffects: read(item, 'memberEffects', 'member_effects', {}) || {},
        equippedAt: read(item, 'equippedAt', 'equipped_at', null),
        updatedAt: read(item, 'updatedAt', 'updated_at', null)
      })),
      rewardTickets: list(source.rewardTickets || source.reward_tickets).map(ticket => ({
        ...ticket,
        ticketKey: read(ticket, 'ticketKey', 'ticket_key', null),
        name: read(ticket, 'name', 'name_snapshot', ''),
        status: String(ticket.status || 'unused'),
        gemCost: Number(read(ticket, 'gemCost', 'gem_cost_snapshot', 0)) || 0,
        catalogVersion: Number(read(ticket, 'catalogVersion', 'catalog_version_snapshot', 0)) || 0,
        issuedAt: read(ticket, 'issuedAt', 'issued_at', null),
        usedAt: read(ticket, 'usedAt', 'used_at', null),
        reversedAt: read(ticket, 'reversedAt', 'reversed_at', null),
        updatedAt: read(ticket, 'updatedAt', 'updated_at', null)
      })),
      economySummary: (() => {
        const summary = source.economySummary || source.economy_summary;
        return summary && typeof summary === 'object' ? {
          ...summary,
          gold: Math.max(0, Number(summary.gold) || 0),
          gems: Math.max(0, Number(summary.gems) || 0),
          inventoryCount: Math.max(0, Number(read(summary, 'inventoryCount', 'inventory_count', 0)) || 0),
          ticketCount: Math.max(0, Number(read(summary, 'ticketCount', 'ticket_count', 0)) || 0)
        } : null;
      })(),
      derivedEquipmentModifiers: source.derivedEquipmentModifiers
        || source.derived_equipment_modifiers
        || { health: 0, energy: 0, wealth: 0, growth: 0 },
      derivedStats: source.derivedStats || source.derived_stats || null,
      recentEconomyTransactions: list(
        source.recentEconomyTransactions || source.recent_economy_transactions
      ).map(transaction => ({
        ...transaction,
        operationId: read(transaction, 'operationId', 'operation_id', null),
        itemKey: read(transaction, 'itemKey', 'item_key', null),
        ticketId: read(transaction, 'ticketId', 'ticket_id', null),
        currencyDelta: Number(read(transaction, 'currencyDelta', 'currency_delta', 0)) || 0,
        basePrice: Number(read(transaction, 'basePrice', 'base_price_snapshot', 0)) || 0,
        paidAmount: Number(read(transaction, 'paidAmount', 'paid_amount', 0)) || 0,
        itemName: read(transaction, 'itemName', 'item_name_snapshot', ''),
        catalogVersion: Number(read(transaction, 'catalogVersion', 'catalog_version_snapshot', 0)) || 0,
        createdAt: read(transaction, 'createdAt', 'created_at', null),
        detail: transaction.detail && typeof transaction.detail === 'object' ? transaction.detail : {}
      }))
    };
  }

  function mergeMemberCloudState(currentState = {}, incomingState = {}) {
    const current = normalizeMemberCloudState(currentState);
    const incoming = incomingState && typeof incomingState === 'object' ? clone(incomingState) : {};
    if (Number(incoming.meta?.repositoryVersion) < Number(current.meta?.repositoryVersion)) return current;
    if (Array.isArray(incoming.achievements)) {
      const existingByCode = new Map(current.achievements.filter(row => row.code).map(row => [row.code, row]));
      // The server still owns array membership (including an explicit []).
      // Only enrich rows it returned, using the same achievement's cached fields.
      incoming.achievements = incoming.achievements.map(row => {
        const normalized = normalizeMemberAchievement(row);
        return { ...(existingByCode.get(normalized.code) || {}), ...normalized };
      });
    }
    const incomingPlayer = incoming.player && typeof incoming.player === 'object'
      ? incoming.player
      : null;
    let mergedPlayer = incomingPlayer
      ? { ...(current.player || {}), ...incomingPlayer }
      : current.player;
    if (incomingPlayer && mergedPlayer) {
      const aliases = [
        ['totalXp', 'total_xp'],
        ['maxHp', 'max_hp'],
        ['levelCurveVersion', 'level_curve_version']
      ];
      aliases.forEach(([camel, snake]) => {
        if (!Object.prototype.hasOwnProperty.call(incomingPlayer, camel)
          && Object.prototype.hasOwnProperty.call(incomingPlayer, snake)) {
          mergedPlayer[camel] = incomingPlayer[snake];
        }
      });
      const incomingBaseStats = Object.prototype.hasOwnProperty.call(incomingPlayer, 'baseStats')
        ? incomingPlayer.baseStats
        : incomingPlayer.base_stats;
      mergedPlayer.baseStats = incomingBaseStats && typeof incomingBaseStats === 'object'
        ? { ...(current.player?.baseStats || {}), ...incomingBaseStats }
        : { ...(current.player?.baseStats || {}) };
    }
    return normalizeMemberCloudState({
      ...current,
      ...incoming,
      player: mergedPlayer,
      meta: {
        ...(current.meta || {}),
        ...(incoming.meta || {})
      }
    });
  }

  function safeAuthMessage(error, fallback = '會員服務目前無法完成操作，請稍後再試。') {
    const message = String(error?.message || '').toLowerCase();
    if (message.includes('invalid login credentials')) return 'Email 或密碼不正確。';
    if (message.includes('email not confirmed')) return '請先完成 Email 驗證後再登入。';
    if (message.includes('user already registered')) return fallback;
    if (message.includes('password')) return '密碼不符合目前的安全要求。';
    if (message.includes('network') || message.includes('fetch')) return '目前無法連線至會員服務，請檢查網路後重試。';
    return fallback;
  }

  function safeMemberReloadMessage(error) {
    const code = String(error?.code || error?.errorCode || error?.reason || '').toUpperCase();
    if (['NETWORK_ERROR', 'AUTH_UNAVAILABLE'].includes(code)) {
      return '目前無法連線，請檢查網路後再試。';
    }
    if (['AUTH_REQUIRED', 'SESSION_EXPIRED'].includes(code)) {
      return '會員登入狀態已失效，請重新登入。';
    }
    return '會員卷宗暫時無法載入，請稍後再試。';
  }

  function safeLoginMessage(error) {
    const message = String(error?.message || '').toLowerCase();
    const status = Number(error?.status);
    if (message.includes('network') || message.includes('fetch') || status === 429 || status >= 500) {
      return '會員服務暫時無法完成登入。';
    }
    if (message.includes('email not confirmed')) return safeAuthMessage(error);
    return 'Email 或密碼不正確。';
  }

  const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const hasStateVersion = value => isRecord(value) && isRecord(value.meta)
    && Number.isSafeInteger(value.meta.repositoryVersion) && value.meta.repositoryVersion >= 0;
  function isProjectionShape(state) {
    return hasStateVersion(state)
      && ['customHabits', 'dailyEntries', 'habitEvents', 'statusEffects', 'achievements', 'catalog',
        'inventory', 'equipment', 'rewardTickets', 'recentEconomyTransactions'].every(key =>
        !Object.prototype.hasOwnProperty.call(state, key) || Array.isArray(state[key]))
      && ['member', 'dailyDrafts', 'rulePreferences', 'achievementProgress'].every(key =>
        !Object.prototype.hasOwnProperty.call(state, key) || isRecord(state[key]));
  }
  const isSessionFailure = code => code === 'AUTH_REQUIRED' || code === 'SESSION_EXPIRED';
  const cancelledRequest = () => ({ ok: false, cancelled: true, errorCode: 'SESSION_EXPIRED', reason: 'SESSION_EXPIRED', retryable: false });

  function sessionFailure(data, error) {
    const session = data?.session;
    const invalid = error?.status === 401 || ['session_not_found', 'refresh_token_not_found',
      'refresh_token_already_used', 'bad_jwt'].includes(error?.code);
    const expired = Number.isFinite(session?.expires_at) && session.expires_at * 1000 <= Date.now();
    // A thrown/network-only failure does not prove expiry. An explicit SDK null
    // session means no usable credential remains (including failed refresh).
    if (invalid || expired || (data && !session?.access_token)) {
      return { ok: false, errorCode: 'AUTH_REQUIRED', reason: 'AUTH_REQUIRED', retryable: false };
    }
    if (error || !session?.access_token) {
      return { ok: false, errorCode: 'AUTH_UNAVAILABLE', reason: 'AUTH_UNAVAILABLE', retryable: true };
    }
    return null;
  }

  function isMemberBootstrapReady(state) {
    if (!hasStateVersion(state) || !isRecord(state.member)) return false;
    if (state.member.onboardingCompleted !== true) return state.member.onboardingCompleted === false;
    return isRecord(state.player) && isRecord(state.dailyDrafts) && isRecord(state.rulePreferences)
      && isRecord(state.achievementProgress) && isRecord(state.derivedStats)
      && isRecord(state.derivedEquipmentModifiers)
      && ['customHabits', 'dailyEntries', 'habitEvents', 'statusEffects', 'achievements',
        'catalog', 'inventory', 'equipment', 'rewardTickets', 'recentEconomyTransactions']
        .every(key => Array.isArray(state[key]))
      && Object.prototype.hasOwnProperty.call(state, 'activeBoss');
  }

  function createSupabaseTransport({ client, projectUrl, publishableKey, fetchImpl = globalThis.fetch } = {}) {
    if (!client?.auth?.getSession) throw new Error('Supabase transport requires an auth client');
    if (typeof fetchImpl !== 'function') throw new Error('Supabase transport requires fetch');
    const endpoint = `${String(projectUrl || '').replace(/\/$/, '')}/functions/v1/lifequest-command`;

    return async function transport(request = {}) {
      const guard = request.identityGuard;
      if (guard && !guard.isCurrent()) return cancelledRequest();
      let data, error;
      try { ({ data, error } = await client.auth.getSession()); }
      catch (caught) { error = caught; }
      if (guard && !guard.isCurrent()) return cancelledRequest();
      if (guard && data?.session?.access_token && data.session.user?.id !== guard.userId) return cancelledRequest();
      const failure = sessionFailure(data, error);
      if (failure) return failure;
      const accessToken = data?.session?.access_token;

      const headers = {
        ...(request.headers || {}),
        apikey: publishableKey,
        Authorization: `Bearer ${accessToken}`
      };
      const options = { method: request.method || 'GET', headers };
      if (request.body !== undefined) options.body = JSON.stringify(request.body);
      const mutation = options.method !== 'GET';
      const malformed = () => ({ ok: false, errorCode: 'MALFORMED_RESPONSE', reason: 'MALFORMED_RESPONSE',
        retryable: true, unknownResult: mutation });

      try {
        if (guard && !guard.isCurrent()) return cancelledRequest();
        const response = await fetchImpl(endpoint, options);
        if (guard && !guard.isCurrent()) return cancelledRequest();
        let payload;
        try {
          payload = await response.json();
        } catch (_error) {
          if (guard && !guard.isCurrent()) return cancelledRequest();
          if (response.status === 401) return { ok: false, errorCode: 'SESSION_EXPIRED', retryable: false };
          return malformed();
        }
        if (guard && !guard.isCurrent()) return cancelledRequest();
        if (!isRecord(payload)) return malformed();
        if (response.ok && payload.ok !== false
          && (payload.ok !== true || !isProjectionShape(payload.state)
            || (payload.result !== undefined && !isRecord(payload.result)))) return malformed();
        if (response.ok && payload.ok === true && mutation
          && [payload.operationId, payload.result?.operationId].some(id => id !== undefined && id !== request.body?.operationId)) return malformed();
        if (response.ok && payload.ok === true && request.requireCompleteBootstrap && !isMemberBootstrapReady(payload.state)) return malformed();
        const errorCode = payload.errorCode || payload.reason || (response.status === 401 ? 'SESSION_EXPIRED' : 'INTERNAL_ERROR');
        return {
          ...payload,
          ...(payload.state && !isProjectionShape(payload.state) ? { state: undefined } : {}),
          ok: response.ok && payload.ok === true,
          errorCode: response.ok && payload.ok === true ? null : errorCode,
          reason: response.ok && payload.ok === true ? null : errorCode,
          retryable: payload.retryable === true || response.status >= 500
        };
      } catch (_error) {
        if (guard && !guard.isCurrent()) return cancelledRequest();
        return { ok: false, errorCode: 'NETWORK_ERROR', reason: 'NETWORK_ERROR', retryable: true, unknownResult: mutation };
      }
    };
  }

  function createMemberAuthCoordinator({
    supabaseClient,
    projectUrl,
    publishableKey,
    storage,
    pendingOperationKey = 'lifequest_pending_operations',
    contract,
    application,
    fetchImpl = globalThis.fetch,
    requireCompleteBootstrap = false,
    onMemberLoading = () => undefined,
    onMemberReady = () => undefined,
    onSignedOut = () => undefined
  } = {}) {
    if (!supabaseClient?.auth) throw new Error('Member auth coordinator requires Supabase Auth');
    if (!storage) throw new Error('Member auth coordinator requires storage');
    if (!contract || !application) throw new Error('Member auth coordinator requires application contracts');

    const transport = createSupabaseTransport({
      client: supabaseClient,
      projectUrl,
      publishableKey,
      fetchImpl
    });
    let authSubscription = null;
    let currentSession = null;
    let currentMemberState = null;
    let currentOperationStore = null;
    let bootstrapUserId = null;
    let bootstrapPromise = null;
    let signedOutNotified = false;
    let logoutContext = null;
    let runtimeGeneration = 0;
    let bootstrapGeneration = 0;
    let latestMemberState = null;

    function isCurrentRuntime(userId, generation) {
      return !logoutContext && generation === runtimeGeneration && currentSession?.user?.id === userId;
    }

    function createRuntime(userId, initialState = null, readGeneration = null) {
      const generation = runtimeGeneration;
      const isCurrent = () => isCurrentRuntime(userId, generation)
        && (readGeneration === null || readGeneration === bootstrapGeneration);
      const operationStore = new application.LocalStorageOperationStore({
        storage,
        key: pendingOperationKey,
        namespace: `member:${userId}`,
        migrateLegacy: false
      });
      const repository = new application.RemoteCommandRepository({ contract, transport: request => transport({
        ...request,
        requireCompleteBootstrap: requireCompleteBootstrap && request.method === 'GET',
        identityGuard: { userId, isCurrent }
      }) });
      const guardedStore = {
        reserve: args => isCurrent() ? operationStore.reserve(args) : Promise.resolve({ ok: false, reason: 'SESSION_EXPIRED' }),
        complete: id => isCurrent() ? operationStore.complete(id) : Promise.resolve(),
        fail: (id, details) => isCurrent() ? operationStore.fail(id, details) : Promise.resolve()
      };
      const gameApplication = new application.GameApplication({
        repository,
        operationStore: guardedStore,
        commandValidator: command => contract.validateCommandEnvelope(command),
        initialState
      });
      currentOperationStore = operationStore;
      return { repository, gameApplication, operationStore: guardedStore };
    }

    async function loadMemberState(session, preferredName = '', readGeneration) {
      const runtime = createRuntime(session.user.id, null, readGeneration);
      try {
        const loaded = normalizeMemberCloudState(await runtime.gameApplication.initialize());
        return { ok: true, state: loaded, initialized: false };
      } catch (error) {
        if (error?.code !== 'MEMBER_PROFILE_NOT_INITIALIZED') throw error;
      }

      const adventurerName = String(
        preferredName || session.user.user_metadata?.adventurer_name || ''
      ).trim();
      if (!adventurerName) {
        const error = new Error('會員卷宗尚未初始化，且缺少冒險者名稱。');
        error.code = 'MEMBER_PROFILE_NOT_INITIALIZED';
        throw error;
      }

      const initializingRuntime = createRuntime(session.user.id, createMemberState(0), readGeneration);
      const operationId = application.createOperationId('member-profile');
      const command = contract.createCommandEnvelope({
        type: 'INITIALIZE_MEMBER_PROFILE',
        operationId,
        payload: { adventurerName }
      });
      const result = await initializingRuntime.gameApplication.execute(command);
      if (!result.ok) {
        const error = new Error(result.reason || 'MEMBER_PROFILE_INITIALIZATION_FAILED');
        error.code = result.reason || 'MEMBER_PROFILE_INITIALIZATION_FAILED';
        error.retryable = result.retryable !== false;
        throw error;
      }
      const authoritativeState = normalizeMemberCloudState(await initializingRuntime.repository.load());
      return {
        ok: true,
        state: authoritativeState,
        initialized: true,
        duplicate: Boolean(result.duplicate)
      };
    }

    async function ensureMemberSession(session, preferredName = '', { forceReload = false } = {}) {
      if (!session?.user?.id || logoutContext) return { ok: false, errorCode: 'AUTH_REQUIRED' };
      if (currentSession?.user?.id !== session.user.id) {
        runtimeGeneration++;
        latestMemberState = null;
        currentMemberState = null;
      }
      const generation = runtimeGeneration;
      currentSession = session;
      signedOutNotified = false;
      if (!forceReload && bootstrapUserId === session.user.id && currentMemberState) {
        return { ok: true, state: clone(currentMemberState), initialized: false };
      }
      if (bootstrapUserId === session.user.id && bootstrapPromise) return bootstrapPromise;

      const readGeneration = ++bootstrapGeneration;
      onMemberLoading(clone(session.user), clone(currentMemberState));
      bootstrapUserId = session.user.id;
      bootstrapPromise = loadMemberState(session, preferredName, readGeneration)
        .then(result => {
          if (!isCurrentRuntime(session.user.id, generation) || readGeneration !== bootstrapGeneration) {
            return cancelledRequest();
          }
          const normalizedState = mergeMemberCloudState(latestMemberState, result.state);
          latestMemberState = clone(normalizedState);
          currentMemberState = clone(normalizedState);
          onMemberReady({ user: clone(session.user), state: clone(normalizedState) });
          return { ...result, state: normalizedState };
        })
        .catch(async error => {
          if (!isCurrentRuntime(session.user.id, generation) || readGeneration !== bootstrapGeneration) return cancelledRequest();
          if (isSessionFailure(error.code)) await logout({ reason: 'session-expired' });
          throw error;
        })
        .finally(() => {
          if (generation === runtimeGeneration && readGeneration === bootstrapGeneration) bootstrapPromise = null;
        });
      return bootstrapPromise;
    }

    async function handleSignedOut({ notify = true, reason = 'logout', remoteFailed = false } = {}) {
      const operationStore = currentOperationStore;
      logoutContext = { reason, remoteFailed };
      runtimeGeneration++;
      currentSession = null;
      currentMemberState = null;
      latestMemberState = null;
      bootstrapGeneration++;
      currentOperationStore = null;
      bootstrapUserId = null;
      bootstrapPromise = null;
      const generation = runtimeGeneration;
      try {
        if (operationStore?.clear) await operationStore.clear();
      } finally {
        if (notify && !signedOutNotified && generation === runtimeGeneration) {
          signedOutNotified = true;
          await onSignedOut({ reason, remoteFailed });
        }
      }
    }

    async function start() {
      const generation = runtimeGeneration;
      let data, error;
      try { ({ data, error } = await supabaseClient.auth.getSession()); }
      catch (caught) { error = caught; }
      if (generation !== runtimeGeneration) return cancelledRequest();
      if (error) {
        const failure = sessionFailure(data, error);
        if (isSessionFailure(failure.errorCode)) await logout({ reason: 'session-expired' });
        return { ...failure, message: safeAuthMessage(error) };
      }

      if (!authSubscription) {
        const listener = supabaseClient.auth.onAuthStateChange((event, session) => {
          if (event === 'INITIAL_SESSION') return;
          const generation = runtimeGeneration;
          setTimeout(() => {
            if (generation !== runtimeGeneration || (session && logoutContext)) return;
            if (session?.user?.id) ensureMemberSession(session).catch(() => undefined);
            else handleSignedOut(logoutContext || {}).catch(() => undefined);
          }, 0);
        });
        authSubscription = listener?.data?.subscription || null;
      }

      if (!data?.session) return { ok: true, session: null, state: null };
      const result = await ensureMemberSession(data.session);
      return { ...result, session: data.session };
    }

    async function register({ adventurerName, email, password } = {}) {
      const { data, error } = await supabaseClient.auth.signUp({
        email: String(email || '').trim(),
        password: String(password || ''),
        options: { data: { adventurer_name: String(adventurerName || '').trim() } }
      });
      if (error) return {
        ok: false,
        errorCode: 'REGISTER_FAILED',
        message: safeAuthMessage(error, '目前無法完成註冊，請確認資料或稍後再試。')
      };
      if (!data?.session) {
        return {
          ok: true,
          verificationRequired: true,
          session: null,
          message: '帳號已建立；目前專案要求 Email 驗證，請先完成驗證後再登入。'
        };
      }
      logoutContext = null;
      const bootstrap = await ensureMemberSession(data.session, adventurerName);
      return { ...bootstrap, session: data.session, verificationRequired: false };
    }

    async function login({ email, password } = {}) {
      const { data, error } = await supabaseClient.auth.signInWithPassword({
        email: String(email || '').trim(),
        password: String(password || '')
      });
      if (error || !data?.session) {
        return { ok: false, errorCode: 'LOGIN_FAILED', message: safeLoginMessage(error) };
      }
      logoutContext = null;
      const bootstrap = await ensureMemberSession(data.session);
      return { ...bootstrap, session: data.session };
    }

    async function logout({ reason = 'logout' } = {}) {
      const context = { reason, remoteFailed: false };
      logoutContext = context;
      runtimeGeneration++;
      // Expiry closes local access immediately, not after an unavailable Auth
      // service responds. Keep ordinary logout's existing entrance policy.
      if (reason === 'session-expired') await handleSignedOut(context);
      const generation = runtimeGeneration;
      let remoteError = null;
      try {
        const result = await supabaseClient.auth.signOut({ scope: 'local' });
        remoteError = result?.error || null;
      } catch (error) {
        remoteError = error;
      } finally {
        context.remoteFailed = Boolean(remoteError);
        if (generation === runtimeGeneration && reason !== 'session-expired') await handleSignedOut(context);
      }
      if (remoteError) {
        return { ok: false, errorCode: 'LOGOUT_FAILED', localCleanupComplete: true,
          message: safeAuthMessage(remoteError) };
      }
      return { ok: true };
    }

    async function executeMemberCommand({ type, payload, operationPrefix, businessDate = null, timeZone = null }) {
      if (logoutContext || !currentSession?.user?.id || !currentMemberState) {
        return {
          ok: false,
          errorCode: currentSession && !logoutContext ? 'MEMBER_NOT_READY' : 'AUTH_REQUIRED',
          reason: currentSession && !logoutContext ? 'MEMBER_NOT_READY' : 'AUTH_REQUIRED',
          retryable: false,
          message: '請先完成會員卷宗載入。'
        };
      }

      const userId = currentSession.user.id;
      const generation = runtimeGeneration;
      const runtime = createRuntime(userId, currentMemberState);
      const command = contract.createCommandEnvelope({
        type,
        operationId: application.createOperationId(operationPrefix),
        payload,
        businessDate,
        timeZone: timeZone || currentMemberState?.member?.timeZone || contract.DEFAULT_TIME_ZONE
      });
      const result = await runtime.gameApplication.execute(command);
      if (!isCurrentRuntime(userId, generation)) {
        await runtime.operationStore.fail(result.operationId || command.operationId, { retryable: false });
        return { ok: false, cancelled: true, errorCode: 'SESSION_EXPIRED', reason: 'SESSION_EXPIRED', retryable: false };
      }
      if (result.cancelled) {
        // SDK identity changed before the Auth listener caught up. Invalidate
        // only this runtime; never sign out the other account's SDK session.
        await handleSignedOut({ reason: 'session-expired' });
        return result;
      }
      if (!result.ok && isSessionFailure(result.errorCode || result.reason)) {
        await logout({ reason: 'session-expired' });
        return { ...result, state: null, localCleanupComplete: true };
      }
      if (!result.ok) {
        latestMemberState = mergeMemberCloudState(latestMemberState, runtime.gameApplication.getState());
        if (currentMemberState) currentMemberState = clone(latestMemberState);
        return { ...result, state: clone(currentMemberState) };
      }

      latestMemberState = mergeMemberCloudState(latestMemberState, runtime.gameApplication.getState());
      if (currentMemberState) currentMemberState = clone(latestMemberState);
      if (currentMemberState) onMemberReady({
        user: clone(currentSession.user),
        state: clone(currentMemberState)
      });
      return { ...result, state: clone(currentMemberState) };
    }

    async function selectMainQuest({ questId } = {}) {
      return executeMemberCommand({
        type: 'SELECT_MAIN_QUEST',
        operationPrefix: 'member-main-quest',
        payload: { questId: String(questId || '').trim() }
      });
    }

    async function updateProfile({ adventurerName, dailyBudget } = {}) {
      const payload = {};
      if (adventurerName !== undefined) payload.adventurerName = String(adventurerName || '').trim();
      if (dailyBudget !== undefined) payload.dailyBudget = Number(dailyBudget);
      return executeMemberCommand({
        type: 'UPDATE_PROFILE',
        operationPrefix: 'member-profile-update',
        payload
      });
    }

    async function saveDailyDraft({ date, draft } = {}) {
      const safeDraft = {};
      ['sleep', 'water', 'exercise', 'study', 'expense', 'impulse', 'sugaryDrinks'].forEach(key => {
        const value = draft?.[key];
        safeDraft[key] = value === '' || value === undefined ? null : Number(value);
      });
      return executeMemberCommand({
        type: 'SAVE_DAILY_DRAFT',
        operationPrefix: 'member-daily-draft',
        payload: { date: String(date || '').trim(), draft: safeDraft }
      });
    }

    async function createCustomHabit({ title, direction } = {}) {
      return executeMemberCommand({
        type: 'CREATE_CUSTOM_HABIT',
        operationPrefix: 'member-custom-habit-create',
        payload: { title: String(title || '').trim(), direction: direction === 'bad' ? 'bad' : 'good' }
      });
    }

    async function updateCustomHabit({ habitId, title, direction } = {}) {
      const payload = { habitId: String(habitId || '').trim() };
      if (title !== undefined) payload.title = String(title || '').trim();
      if (direction !== undefined) payload.direction = direction === 'bad' ? 'bad' : 'good';
      return executeMemberCommand({
        type: 'UPDATE_CUSTOM_HABIT',
        operationPrefix: 'member-custom-habit-update',
        payload
      });
    }

    async function removeCustomHabit({ habitId } = {}) {
      return executeMemberCommand({
        type: 'REMOVE_CUSTOM_HABIT',
        operationPrefix: 'member-custom-habit-remove',
        payload: { habitId: String(habitId || '').trim() }
      });
    }

    async function restoreCustomHabit({ habitId } = {}) {
      return executeMemberCommand({
        type: 'RESTORE_CUSTOM_HABIT',
        operationPrefix: 'member-custom-habit-restore',
        payload: { habitId: String(habitId || '').trim() }
      });
    }

    async function setRuleEnabled({ ruleId, enabled } = {}) {
      return executeMemberCommand({
        type: 'SET_RULE_ENABLED',
        operationPrefix: 'member-rule-preference',
        payload: { ruleId: String(ruleId || '').trim(), enabled: Boolean(enabled) }
      });
    }

    async function reportHabitEvent({ habitId, businessDate } = {}) {
      return executeMemberCommand({
        type: 'REPORT_HABIT_EVENT',
        operationPrefix: 'member-habit-report',
        businessDate: String(businessDate || '').trim() || null,
        payload: { habitId: String(habitId || '').trim() }
      });
    }

    async function reverseHabitEvent({ eventId, businessDate } = {}) {
      return executeMemberCommand({
        type: 'REVERSE_HABIT_EVENT',
        operationPrefix: 'member-habit-reverse',
        businessDate: String(businessDate || '').trim() || null,
        payload: { eventId: String(eventId || '').trim() }
      });
    }

    async function submitDailyEntry({ businessDate, input } = {}) {
      const payload = {};
      ['sleep', 'water', 'exercise', 'study', 'expense', 'impulse', 'sugaryDrinks'].forEach(key => {
        payload[key] = Number(input?.[key]);
      });
      return executeMemberCommand({
        type: 'SUBMIT_DAILY_ENTRY',
        operationPrefix: 'member-daily-entry',
        businessDate: String(businessDate || '').trim() || null,
        payload
      });
    }

    async function purchaseItem({ itemKey, seenCatalogVersion } = {}) {
      return executeMemberCommand({
        type: 'PURCHASE_ITEM',
        operationPrefix: 'member-item-purchase',
        payload: {
          itemKey: String(itemKey || '').trim(),
          seenCatalogVersion: Number(seenCatalogVersion)
        }
      });
    }

    async function useItem({ itemKey } = {}) {
      return executeMemberCommand({
        type: 'USE_ITEM',
        operationPrefix: 'member-item-use',
        payload: { itemKey: String(itemKey || '').trim() }
      });
    }

    async function equipItem({ itemKey } = {}) {
      return executeMemberCommand({
        type: 'EQUIP_ITEM',
        operationPrefix: 'member-item-equip',
        payload: { itemKey: String(itemKey || '').trim() }
      });
    }

    async function unequipItem({ slot } = {}) {
      return executeMemberCommand({
        type: 'UNEQUIP_ITEM',
        operationPrefix: 'member-item-unequip',
        payload: { slot: String(slot || '').trim() }
      });
    }

    async function redeemRewardTicket({ ticketKey, seenCatalogVersion } = {}) {
      return executeMemberCommand({
        type: 'REDEEM_REWARD_TICKET',
        operationPrefix: 'member-ticket-redeem',
        payload: {
          ticketKey: String(ticketKey || '').trim(),
          seenCatalogVersion: Number(seenCatalogVersion)
        }
      });
    }

    async function useRewardTicket({ ticketInstanceId } = {}) {
      return executeMemberCommand({
        type: 'USE_REWARD_TICKET',
        operationPrefix: 'member-ticket-use',
        payload: { ticketInstanceId: String(ticketInstanceId || '').trim() }
      });
    }

    async function reverseRewardTicket({ ticketInstanceId } = {}) {
      return executeMemberCommand({
        type: 'REVERSE_REWARD_TICKET',
        operationPrefix: 'member-ticket-reverse',
        payload: { ticketInstanceId: String(ticketInstanceId || '').trim() }
      });
    }

    async function reloadMember() {
      if (!currentSession?.user?.id) {
        return { ok: false, errorCode: 'AUTH_REQUIRED', message: '請先登入冒險者帳號。' };
      }
      bootstrapUserId = null;
      bootstrapPromise = null;
      return ensureMemberSession(currentSession, '', { forceReload: true });
    }

    function stop() {
      authSubscription?.unsubscribe?.();
      authSubscription = null;
    }

    return {
      start,
      register,
      login,
      logout,
      selectMainQuest,
      updateProfile,
      saveDailyDraft,
      createCustomHabit,
      updateCustomHabit,
      removeCustomHabit,
      restoreCustomHabit,
      setRuleEnabled,
      reportHabitEvent,
      reverseHabitEvent,
      submitDailyEntry,
      purchaseItem,
      useItem,
      equipItem,
      unequipItem,
      redeemRewardTicket,
      useRewardTicket,
      reverseRewardTicket,
      reloadMember,
      stop,
      getSession: () => currentSession,
      captureRuntime: ({ includeBootstrap = false } = {}) => {
        const userId = currentSession?.user?.id, generation = runtimeGeneration;
        const readGeneration = bootstrapGeneration;
        return () => Boolean(userId) && isCurrentRuntime(userId, generation)
          && (!includeBootstrap || readGeneration === bootstrapGeneration);
      },
      getMemberState: () => clone(currentMemberState)
    };
  }

  return {
    createMemberState,
    selectLatestHabitEvent,
    mergeMemberCloudState,
    isMemberBootstrapReady,
    normalizeMemberCloudState,
    safeAuthMessage,
    safeMemberReloadMessage,
    createSupabaseTransport,
    createMemberAuthCoordinator
  };
});
