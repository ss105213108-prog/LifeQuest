(function(root, factory) {
  const exported = factory();
  if (typeof module === 'object' && module.exports) module.exports = exported;
  if (root) root.LifeQuestApplication = exported;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  function clone(value) {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
  }

  function wait(milliseconds) {
    if (!milliseconds) return Promise.resolve();
    return new Promise(resolve => setTimeout(resolve, milliseconds));
  }

  function normalizeState(value) {
    const state = value && typeof value === 'object' ? clone(value) : {};
    state.meta = state.meta && typeof state.meta === 'object' ? state.meta : {};
    state.meta.repositoryVersion = Math.max(0, Number(state.meta.repositoryVersion) || 0);
    state.meta.operations = Array.isArray(state.meta.operations) ? state.meta.operations : [];
    return state;
  }

  function getRepositoryVersion(state) {
    return Math.max(0, Number(state?.meta?.repositoryVersion) || 0);
  }

  function prepareCommittedState(state, nextVersion) {
    const committed = normalizeState(state);
    committed.meta.repositoryVersion = nextVersion;
    return committed;
  }

  function createOperationId(prefix = 'operation') {
    const cryptoObject = typeof globalThis !== 'undefined' ? globalThis.crypto : null;
    if (cryptoObject?.randomUUID) return `${prefix}-${cryptoObject.randomUUID()}`;
    const bytes = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
    const hex = bytes.map(value => value.toString(16).padStart(2, '0')).join('');
    return `${prefix}-${hex}`;
  }

  function getCommandIntentKey(command = {}) {
    if (command.intentKey) return String(command.intentKey);
    const businessDate = command.context?.businessDate || command.businessDate || '';
    return `${String(command.type || '')}:${String(businessDate)}:${JSON.stringify(command.payload || {})}`;
  }

  class OperationStore {
    async reserve() {
      throw new Error('OperationStore.reserve must be implemented');
    }

    async complete() {
      throw new Error('OperationStore.complete must be implemented');
    }

    async fail() {
      throw new Error('OperationStore.fail must be implemented');
    }
  }

  class MemoryOperationStore extends OperationStore {
    constructor({ records = [] } = {}) {
      super();
      this.records = clone(Array.isArray(records) ? records : []);
    }

    async reserve({ intentKey, operationId, command, createdAt }) {
      const existing = this.records.find(record => record.intentKey === intentKey && record.status === 'pending');
      if (existing) return { ok: true, reused: true, record: clone(existing) };
      const record = {
        operationId,
        intentKey,
        status: 'pending',
        attempts: 0,
        createdAt,
        command: clone(command)
      };
      this.records.push(record);
      return { ok: true, reused: false, record: clone(record) };
    }

    async complete(operationId) {
      this.records = this.records.filter(record => record.operationId !== operationId);
      return { ok: true };
    }

    async fail(operationId, { reason = 'operation_failed', retryable = true, pendingRecord = null } = {}) {
      let record = this.records.find(item => item.operationId === operationId);
      if (!record && retryable && pendingRecord?.operationId === operationId) {
        record = clone(pendingRecord);
        this.records.push(record);
      }
      if (!record) return { ok: true };
      if (!retryable) {
        this.records = this.records.filter(item => item.operationId !== operationId);
        return { ok: true };
      }
      record.attempts = (Number(record.attempts) || 0) + 1;
      record.lastFailureReason = reason;
      return { ok: true };
    }

    async list() {
      return clone(this.records);
    }
  }

  class LocalStorageOperationStore extends OperationStore {
    constructor({
      storage,
      key = 'lifequest_pending_operations',
      namespace = 'guest',
      migrateLegacy = namespace === 'guest'
    } = {}) {
      super();
      if (!storage) throw new Error('LocalStorageOperationStore requires storage');
      this.storage = storage;
      this.baseKey = key;
      this.namespace = String(namespace || 'guest');
      this.key = `${key}:${this.namespace}`;
      if (migrateLegacy && this.storage.getItem(this.key) === null) {
        const legacy = this.storage.getItem(key);
        if (legacy !== null) {
          this.storage.setItem(this.key, legacy);
          this.storage.removeItem(key);
        }
      }
    }

    readRecords() {
      try {
        const raw = this.storage.getItem(this.key);
        const parsed = raw ? JSON.parse(raw) : [];
        return { ok: true, records: Array.isArray(parsed) ? parsed : [] };
      } catch (error) {
        return { ok: false, reason: 'operation_journal_read_failed', errorName: error?.name || 'Error', records: [] };
      }
    }

    writeRecords(records) {
      try {
        this.storage.setItem(this.key, JSON.stringify(records));
        return { ok: true, reason: null };
      } catch (error) {
        return { ok: false, reason: 'operation_journal_write_failed', errorName: error?.name || 'Error' };
      }
    }

    async reserve({ intentKey, operationId, command, createdAt }) {
      const read = this.readRecords();
      if (!read.ok) return read;
      const existing = read.records.find(record => record.intentKey === intentKey && record.status === 'pending');
      if (existing) return { ok: true, reused: true, record: clone(existing) };
      const record = {
        operationId,
        intentKey,
        status: 'pending',
        attempts: 0,
        createdAt,
        command: clone(command)
      };
      read.records.push(record);
      const written = this.writeRecords(read.records);
      return written.ok
        ? { ok: true, reused: false, record: clone(record) }
        : written;
    }

    async complete(operationId) {
      const read = this.readRecords();
      if (!read.ok) return read;
      return this.writeRecords(read.records.filter(record => record.operationId !== operationId));
    }

    async fail(operationId, { reason = 'operation_failed', retryable = true, pendingRecord = null } = {}) {
      const read = this.readRecords();
      if (!read.ok) return read;
      if (!retryable) {
        return this.writeRecords(read.records.filter(record => record.operationId !== operationId));
      }
      let record = read.records.find(item => item.operationId === operationId);
      if (!record && pendingRecord?.operationId === operationId) {
        record = clone(pendingRecord);
        read.records.push(record);
      }
      if (record) {
        record.attempts = (Number(record.attempts) || 0) + 1;
        record.lastFailureReason = reason;
      }
      return this.writeRecords(read.records);
    }

    async list() {
      const read = this.readRecords();
      return read.ok ? clone(read.records) : [];
    }

    async clear() {
      try {
        this.storage.removeItem(this.key);
        return { ok: true, reason: null };
      } catch (error) {
        return { ok: false, reason: 'operation_journal_write_failed', errorName: error?.name || 'Error' };
      }
    }
  }

  class GameRepository {
    constructor() {
      this.executionMode = 'local';
      this.supportsTrustedReplace = false;
    }

    async load() {
      throw new Error('GameRepository.load must be implemented');
    }

    async commit() {
      throw new Error('GameRepository.commit must be implemented');
    }

    async replace(nextState, options = {}) {
      return this.commit(nextState, options);
    }

    async clear() {
      throw new Error('GameRepository.clear must be implemented');
    }
  }

  class MemoryRepository extends GameRepository {
    constructor({ initialState = {}, delayMs = 0, failures = 0 } = {}) {
      super();
      this.supportsTrustedReplace = true;
      this.state = normalizeState(initialState);
      this.delayMs = Math.max(0, Number(delayMs) || 0);
      this.failures = Math.max(0, Number(failures) || 0);
    }

    async load() {
      return clone(this.state);
    }

    async commit(nextState, { expectedVersion = null } = {}) {
      await wait(this.delayMs);
      const currentVersion = getRepositoryVersion(this.state);
      if (expectedVersion !== null && Number(expectedVersion) !== currentVersion) {
        return { ok: false, reason: 'version_conflict', state: clone(this.state) };
      }
      if (this.failures > 0) {
        this.failures -= 1;
        return { ok: false, reason: 'storage_write_failed', state: clone(this.state) };
      }
      this.state = prepareCommittedState(nextState, currentVersion + 1);
      return { ok: true, reason: null, state: clone(this.state) };
    }

    async replace(nextState, options = {}) {
      return this.commit(nextState, options);
    }

    async clear() {
      this.state = normalizeState({});
      return { ok: true, reason: null, state: clone(this.state) };
    }
  }

  class LocalStorageRepository extends GameRepository {
    constructor({
      storage,
      key,
      readState = null,
      writeState = null,
      removeState = null,
      fallbackState = {}
    } = {}) {
      super();
      this.supportsTrustedReplace = true;
      if (!storage) throw new Error('LocalStorageRepository requires storage');
      if (!key) throw new Error('LocalStorageRepository requires a key');
      this.storage = storage;
      this.key = key;
      this.readState = typeof readState === 'function' ? readState : null;
      this.writeState = typeof writeState === 'function' ? writeState : null;
      this.removeState = typeof removeState === 'function' ? removeState : null;
      this.fallbackState = normalizeState(fallbackState);
    }

    async load() {
      try {
        if (this.readState) return normalizeState(await this.readState());
        const raw = this.storage.getItem(this.key);
        return raw ? normalizeState(JSON.parse(raw)) : clone(this.fallbackState);
      } catch (error) {
        const wrapped = new Error('Unable to read repository state');
        wrapped.code = 'storage_read_failed';
        wrapped.cause = error;
        throw wrapped;
      }
    }

    async commit(nextState, { expectedVersion = null } = {}) {
      let current;
      try {
        current = await this.load();
      } catch (error) {
        return { ok: false, reason: error.code || 'storage_read_failed', errorName: error.cause?.name || error.name };
      }
      const currentVersion = getRepositoryVersion(current);
      if (expectedVersion !== null && Number(expectedVersion) !== currentVersion) {
        return { ok: false, reason: 'version_conflict', state: current };
      }
      const committed = prepareCommittedState(nextState, currentVersion + 1);
      try {
        if (this.writeState) {
          const result = await this.writeState(committed);
          if (result && result.ok === false) {
            return { ...result, state: current };
          }
        } else {
          this.storage.setItem(this.key, JSON.stringify(committed));
        }
        return { ok: true, reason: null, state: clone(committed) };
      } catch (error) {
        return {
          ok: false,
          reason: 'storage_write_failed',
          errorName: error?.name || 'Error',
          state: current
        };
      }
    }

    async replace(nextState, options = {}) {
      return this.commit(nextState, options);
    }

    async clear() {
      try {
        if (this.removeState) {
          const result = await this.removeState();
          if (result && result.ok === false) return result;
        } else {
          this.storage.removeItem(this.key);
        }
        return { ok: true, reason: null, state: clone(this.fallbackState) };
      } catch (error) {
        return { ok: false, reason: 'storage_write_failed', errorName: error?.name || 'Error' };
      }
    }
  }

  class RemoteCommandRepository extends GameRepository {
    constructor({ transport, contract } = {}) {
      super();
      if (typeof transport !== 'function') throw new Error('RemoteCommandRepository requires a transport adapter');
      if (!contract || typeof contract.createApiRequest !== 'function') {
        throw new Error('RemoteCommandRepository requires the backend contract');
      }
      this.executionMode = 'remote';
      this.supportsTrustedReplace = false;
      this.transport = transport;
      this.contract = contract;
    }

    async load() {
      const response = await this.transport({ method: 'GET', path: '/v1/game/state', headers: {} });
      if (!response?.ok) {
        const error = new Error('Unable to load remote game state');
        error.code = response?.errorCode || response?.reason || 'remote_load_failed';
        error.retryable = response?.retryable !== false;
        throw error;
      }
      return normalizeState(response.state);
    }

    async execute(command, { expectedVersion = null } = {}) {
      const prepared = this.contract.createApiRequest(command);
      if (!prepared.ok) return prepared;
      const request = clone(prepared.request);
      if (expectedVersion !== null) request.headers['If-Match'] = String(expectedVersion);
      const response = await this.transport(request);
      if (!response?.ok) {
        return {
          ok: false,
          reason: response?.errorCode || response?.reason || 'remote_command_failed',
          errorCode: response?.errorCode || response?.reason || 'remote_command_failed',
          retryable: response?.retryable !== false,
          cancelled: response?.cancelled === true,
          unknownResult: response?.unknownResult === true,
          state: response?.state ? normalizeState(response.state) : null,
          currentVersion: response?.currentVersion ?? null
        };
      }
      return {
        ok: true,
        reason: null,
        state: normalizeState(response.state),
        result: clone({
          ...(response.result || {}),
          duplicate: Boolean(response.duplicate ?? response.result?.duplicate),
          repositoryVersion: response.repositoryVersion ?? response.state?.meta?.repositoryVersion ?? null,
          serverTimestamp: response.serverTimestamp || null
        })
      };
    }

    async commit() {
      return { ok: false, reason: 'remote_snapshot_forbidden' };
    }

    async replace() {
      return { ok: false, reason: 'remote_snapshot_forbidden' };
    }

    async clear() {
      return { ok: false, reason: 'remote_clear_requires_command' };
    }
  }

  class GameApplication {
    constructor({
      repository,
      commandHandlers = {},
      clock = () => new Date().toISOString(),
      operationStore = new MemoryOperationStore(),
      commandValidator = null,
      initialState = null
    } = {}) {
      if (!repository || typeof repository.load !== 'function') {
        throw new Error('GameApplication requires a repository interface');
      }
      this.repository = repository;
      this.commandHandlers = { ...commandHandlers };
      this.clock = clock;
      this.operationStore = operationStore;
      this.commandValidator = typeof commandValidator === 'function' ? commandValidator : null;
      this.state = initialState === null ? null : normalizeState(initialState);
      this.queue = Promise.resolve();
    }

    async initialize() {
      this.state = normalizeState(await this.repository.load());
      return this.getState();
    }

    getState() {
      if (!this.state) throw new Error('GameApplication must be initialized before use');
      return clone(this.state);
    }

    execute(command) {
      const run = () => this.executeNow(command);
      const pending = this.queue.then(run, run);
      this.queue = pending.catch(() => undefined);
      return pending;
    }

    async executeNow(command = {}) {
      if (!this.state) await this.initialize();
      const preparedCommand = clone(command);
      const type = String(preparedCommand.type || '').trim();
      let operationId = String(preparedCommand.operationId || '').trim();
      if (!type || !operationId) {
        return { ok: false, reason: 'invalid_command', operationId: operationId || null };
      }

      if (this.commandValidator) {
        const validation = this.commandValidator(preparedCommand);
        if (!validation?.ok) return { ok: false, reason: validation?.reason || 'invalid_command', operationId };
      }

      const intentKey = getCommandIntentKey(preparedCommand);
      const reservation = await this.operationStore.reserve({
        intentKey,
        operationId,
        command: preparedCommand,
        createdAt: preparedCommand.occurredAt || this.clock()
      });
      if (!reservation.ok) {
        return { ok: false, reason: reservation.reason || 'operation_journal_failed', operationId };
      }
      if (reservation.reused && reservation.record.command) {
        Object.assign(preparedCommand, clone(reservation.record.command));
      }
      operationId = reservation.record.operationId;
      preparedCommand.operationId = operationId;

      const completed = this.state.meta.operations.find(operation => operation.id === operationId);
      if (completed) {
        await this.operationStore.complete(operationId);
        return {
          ...clone(completed.result),
          operationId,
          duplicate: true
        };
      }

      if (this.repository.executionMode === 'remote') {
        const remote = await this.repository.execute(preparedCommand, {
          expectedVersion: getRepositoryVersion(this.state)
        });
        if (!remote.ok) {
          if (remote.state) this.state = normalizeState(remote.state);
          await this.operationStore.fail(operationId, {
            reason: remote.reason,
            retryable: remote.retryable !== false,
            pendingRecord: reservation.record
          });
          return {
            ok: false,
            reason: remote.reason || 'remote_command_failed',
            errorCode: remote.errorCode || remote.reason || 'remote_command_failed',
            operationId,
            retryable: remote.retryable !== false,
            cancelled: remote.cancelled === true,
            unknownResult: remote.unknownResult === true,
            currentVersion: remote.currentVersion ?? null,
            state: this.getState()
          };
        }
        this.state = normalizeState(remote.state);
        await this.operationStore.complete(operationId);
        return { ...clone(remote.result || {}), ok: true, operationId, duplicate: Boolean(remote.result?.duplicate) };
      }

      const handler = this.commandHandlers[type];
      if (typeof handler !== 'function') {
        await this.operationStore.fail(operationId, { reason: 'unsupported_command', retryable: false });
        return { ok: false, reason: 'unsupported_command', operationId };
      }

      const draft = clone(this.state);
      let result;
      try {
        result = await handler(draft, clone(command.payload || {}), {
          command: { type, operationId, payload: clone(preparedCommand.payload || {}) },
          occurredAt: preparedCommand.occurredAt || this.clock(),
          context: clone(preparedCommand.context || {})
        });
      } catch (error) {
        await this.operationStore.fail(operationId, { reason: 'command_failed', retryable: false });
        return { ok: false, reason: 'command_failed', operationId, errorName: error?.name || 'Error' };
      }
      if (!result || result.ok === false) {
        await this.operationStore.fail(operationId, { reason: result?.reason || 'command_rejected', retryable: false });
        return { ok: false, reason: result?.reason || 'command_rejected', operationId };
      }

      draft.meta = draft.meta || {};
      draft.meta.operations = Array.isArray(draft.meta.operations) ? draft.meta.operations : [];
      const durableResult = clone({ ...result, operationId });
      draft.meta.operations.push({
        id: operationId,
        type,
        occurredAt: preparedCommand.occurredAt || this.clock(),
        result: durableResult
      });
      if (draft.meta.operations.length > 1000) {
        draft.meta.operations = draft.meta.operations.slice(-1000);
      }

      const committed = await this.repository.commit(draft, {
        expectedVersion: getRepositoryVersion(this.state),
        command: clone(preparedCommand)
      });
      if (!committed.ok) {
        if (committed.reason === 'version_conflict' && committed.state) {
          this.state = normalizeState(committed.state);
        }
        await this.operationStore.fail(operationId, {
          reason: committed.reason || 'storage_write_failed',
          retryable: true
        });
        return {
          ok: false,
          reason: committed.reason || 'storage_write_failed',
          operationId,
          retryable: true
        };
      }
      this.state = normalizeState(committed.state || draft);
      await this.operationStore.complete(operationId);
      return { ...durableResult, duplicate: false };
    }

    commitLocalTransition(nextState, { operationId = createOperationId('local-transition'), intentKey = null } = {}) {
      const run = async () => {
        if (!this.state) await this.initialize();
        if (this.repository.executionMode !== 'local') {
          return { ok: false, reason: 'local_transition_forbidden', operationId };
        }
        const command = {
          type: 'LOCAL_STATE_TRANSITION',
          operationId,
          intentKey: intentKey || `LOCAL_STATE_TRANSITION:${operationId}`,
          payload: {}
        };
        const reservation = await this.operationStore.reserve({
          intentKey: command.intentKey,
          operationId,
          command,
          createdAt: this.clock()
        });
        if (!reservation.ok) return { ok: false, reason: reservation.reason, operationId };
        const resolvedOperationId = reservation.record.operationId;
        const next = normalizeState(nextState);
        next.meta.operations.push({
          id: resolvedOperationId,
          type: command.type,
          occurredAt: this.clock(),
          result: { ok: true, operationId: resolvedOperationId }
        });
        if (next.meta.operations.length > 1000) next.meta.operations = next.meta.operations.slice(-1000);
        const committed = await this.repository.commit(next, {
          expectedVersion: getRepositoryVersion(this.state),
          command: { ...command, operationId: resolvedOperationId }
        });
        if (!committed.ok) {
          if (committed.reason === 'version_conflict' && committed.state) {
            this.state = normalizeState(committed.state);
          }
          await this.operationStore.fail(resolvedOperationId, {
            reason: committed.reason || 'storage_write_failed',
            retryable: true
          });
          return { ...committed, operationId: resolvedOperationId };
        }
        this.state = normalizeState(committed.state || next);
        await this.operationStore.complete(resolvedOperationId);
        return { ...committed, operationId: resolvedOperationId };
      };
      const pending = this.queue.then(run, run);
      this.queue = pending.catch(() => undefined);
      return pending;
    }

    replaceState(nextState, { trusted = false, reason = '' } = {}) {
      const run = async () => {
        if (!this.state) await this.initialize();
        if (!trusted || !this.repository.supportsTrustedReplace || this.repository.executionMode !== 'local') {
          return { ok: false, reason: 'state_replace_forbidden' };
        }
        const committed = await this.repository.replace(normalizeState(nextState), {
          expectedVersion: getRepositoryVersion(this.state),
          reason
        });
        if (committed.ok) this.state = normalizeState(committed.state || nextState);
        if (!committed.ok && committed.reason === 'version_conflict' && committed.state) {
          this.state = normalizeState(committed.state);
        }
        return committed;
      };
      const pending = this.queue.then(run, run);
      this.queue = pending.catch(() => undefined);
      return pending;
    }

    clear() {
      const run = async () => {
        const result = await this.repository.clear();
        if (result.ok) this.state = normalizeState(result.state || {});
        return result;
      };
      const pending = this.queue.then(run, run);
      this.queue = pending.catch(() => undefined);
      return pending;
    }
  }

  function createLifeQuestCommandHandlers({ core = {}, supplyItems = [], rewardTicketCatalog = [] } = {}) {
    const catalog = Array.isArray(supplyItems) ? clone(supplyItems) : [];
    const ticketCatalog = Array.isArray(rewardTicketCatalog) ? clone(rewardTicketCatalog) : [];
    return {
      SET_RULE_ENABLED(draft, payload) {
        const ruleId = String(payload.ruleId || '');
        const rule = (Array.isArray(draft.rules) ? draft.rules : []).find(item => item.id === ruleId);
        if (!rule) return { ok: false, reason: 'rule_not_found' };
        rule.enabled = Boolean(payload.enabled);
        return { ok: true, reason: null, ruleId, enabled: rule.enabled };
      },

      PURCHASE_SUPPLY(draft, payload, context) {
        const itemId = String(payload.itemId || '');
        const item = catalog.find(candidate => candidate.id === itemId);
        if (!item) return { ok: false, reason: 'invalid_item' };
        draft.character = draft.character || {};
        const wealthDiscount = Math.min(
          0.2,
          Math.max(0, Number(draft.character.attributes?.wealth) || 0) * 0.01
        );
        const canonicalCost = Math.floor(Math.max(0, Number(item.cost) || 0) * (1 - wealthDiscount));
        draft.inventory = Array.isArray(draft.inventory) ? draft.inventory : [];
        draft.supplyTransactions = Array.isArray(draft.supplyTransactions) ? draft.supplyTransactions : [];

        if (item.type === 'potion') {
          if ((Number(draft.character.gold) || 0) < canonicalCost) {
            return { ok: false, reason: 'insufficient_gold' };
          }
          draft.character.gold = (Number(draft.character.gold) || 0) - canonicalCost;
          draft.character.hp = Math.min(
            Number(draft.character.maxHp) || 0,
            (Number(draft.character.hp) || 0) + Math.max(0, Number(item.value) || 0)
          );
          draft.supplyTransactions.push({
            id: context.command.operationId,
            type: 'consumable_purchase',
            itemId: item.id,
            itemName: String(item.title || item.id),
            cost: canonicalCost,
            currency: 'gold',
            occurredAt: context.occurredAt
          });
          return {
            ok: true,
            reason: 'purchased_and_used',
            itemId: item.id,
            cost: canonicalCost,
            restoredHp: Math.max(0, Number(item.value) || 0)
          };
        }

        if (!core.SupplyEngine?.acquire) {
          return { ok: false, reason: 'supply_engine_unavailable' };
        }
        const acquired = core.SupplyEngine.acquire({
          character: draft.character,
          inventory: draft.inventory,
          transactions: draft.supplyTransactions,
          items: catalog,
          itemId: item.id,
          transactionId: context.command.operationId,
          purchasedAt: context.occurredAt,
          cost: canonicalCost
        });
        if (!acquired.ok) return { ok: false, reason: acquired.reason || 'purchase_rejected' };
        draft.character = acquired.character;
        draft.inventory = acquired.inventory;
        draft.supplyTransactions = acquired.transactions;
        return {
          ok: true,
          reason: acquired.reason,
          itemId: item.id,
          cost: acquired.reason === 'equipped_owned' ? 0 : canonicalCost
        };
      },

      REVERSE_SUPPLY_PURCHASE(draft, payload, context) {
        if (!core.SupplyEngine?.reversePurchase) {
          return { ok: false, reason: 'supply_engine_unavailable' };
        }
        const transactionId = String(payload.transactionId || '');
        const reversed = core.SupplyEngine.reversePurchase({
          character: draft.character,
          inventory: draft.inventory,
          transactions: draft.supplyTransactions,
          items: catalog,
          transactionId,
          correctionId: context.command.operationId,
          correctedAt: context.occurredAt
        });
        if (!reversed.ok) return { ok: false, reason: reversed.reason || 'correction_rejected' };
        draft.character = reversed.character;
        draft.inventory = reversed.inventory;
        draft.supplyTransactions = reversed.transactions;
        return {
          ok: true,
          reason: null,
          transactionId,
          refund: reversed.refund,
          itemId: reversed.itemId
        };
      },

      REDEEM_REWARD_TICKET(draft, payload, context) {
        if (!core.RewardTicketEngine?.redeem) {
          return { ok: false, reason: 'reward_ticket_engine_unavailable' };
        }
        const ticketId = String(payload.ticketId || '');
        const redeemed = core.RewardTicketEngine.redeem({
          character: draft.character,
          tickets: draft.rewardTickets,
          transactions: draft.gemTransactions,
          catalog: ticketCatalog,
          ticketId,
          transactionId: context.command.operationId,
          redeemedAt: context.occurredAt
        });
        if (!redeemed.ok) return { ok: false, reason: redeemed.reason || 'redemption_rejected' };
        draft.character = redeemed.character;
        draft.rewardTickets = redeemed.tickets;
        draft.gemTransactions = redeemed.transactions;
        return {
          ok: true,
          reason: null,
          ticketId,
          ticket: redeemed.ticket
        };
      },

      USE_REWARD_TICKET(draft, payload, context) {
        if (!core.RewardTicketEngine?.use) {
          return { ok: false, reason: 'reward_ticket_engine_unavailable' };
        }
        const ownedTicketId = String(payload.ownedTicketId || '');
        const used = core.RewardTicketEngine.use({
          tickets: draft.rewardTickets,
          ownedTicketId,
          usedAt: context.occurredAt
        });
        if (!used.ok) return { ok: false, reason: used.reason || 'ticket_use_rejected' };
        draft.rewardTickets = used.tickets;
        return { ok: true, reason: null, ownedTicketId, ticket: used.ticket };
      },

      REVERSE_REWARD_TICKET(draft, payload, context) {
        if (!core.RewardTicketEngine?.reverse) {
          return { ok: false, reason: 'reward_ticket_engine_unavailable' };
        }
        const ownedTicketId = String(payload.ownedTicketId || '');
        const reversed = core.RewardTicketEngine.reverse({
          character: draft.character,
          tickets: draft.rewardTickets,
          transactions: draft.gemTransactions,
          ownedTicketId,
          reversedAt: context.occurredAt
        });
        if (!reversed.ok) return { ok: false, reason: reversed.reason || 'ticket_reverse_rejected' };
        draft.character = reversed.character;
        draft.rewardTickets = reversed.tickets;
        draft.gemTransactions = reversed.transactions;
        return { ok: true, reason: null, ownedTicketId, ticket: reversed.ticket };
      }
    };
  }

  return {
    GameApplication,
    GameRepository,
    MemoryRepository,
    LocalStorageRepository,
    RemoteCommandRepository,
    OperationStore,
    MemoryOperationStore,
    LocalStorageOperationStore,
    createLifeQuestCommandHandlers,
    createOperationId
  };
});
