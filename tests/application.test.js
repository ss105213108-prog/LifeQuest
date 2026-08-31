const test = require('node:test');
const assert = require('node:assert/strict');

const {
  GameApplication,
  MemoryRepository,
  LocalStorageRepository,
  RemoteCommandRepository,
  LocalStorageOperationStore,
  createLifeQuestCommandHandlers
} = require('../gameApplication.js');
const LifeQuestCore = require('../lifequestCore.js');
const BackendContract = require('../backendContract.js');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function baseState() {
  return {
    schemaVersion: 17,
    character: {
      gold: 100,
      gems: 5,
      hp: 40,
      maxHp: 50,
      attributes: { health: 10, energy: 10, wealth: 10, growth: 10 },
      equipped: { weapon: null, armor: null, pet: null }
    },
    inventory: [],
    supplyTransactions: [],
    rules: [
      { id: 'rule_sleep', name: '每天睡滿七小時', enabled: true, exp: 20 }
    ],
    meta: { repositoryVersion: 0, operations: [] }
  };
}

test('GameApplication exposes committed state only after a delayed repository succeeds', async () => {
  const repository = new MemoryRepository({ initialState: { count: 0, meta: {} }, delayMs: 25 });
  const application = new GameApplication({
    repository,
    commandHandlers: {
      INCREMENT(draft) {
        draft.count += 1;
        return { ok: true, value: draft.count };
      }
    }
  });
  await application.initialize();

  const pending = application.execute({ type: 'INCREMENT', operationId: 'op-delay-1', payload: {} });
  assert.equal(application.getState().count, 0);

  const result = await pending;
  assert.equal(result.ok, true);
  assert.equal(application.getState().count, 1);
});

test('GameApplication leaves state unchanged on failure and safely retries the same operation id', async () => {
  let calls = 0;
  const repository = new MemoryRepository({ initialState: { count: 0, meta: {} }, failures: 1 });
  const application = new GameApplication({
    repository,
    commandHandlers: {
      INCREMENT(draft) {
        calls += 1;
        draft.count += 1;
        return { ok: true, value: draft.count };
      }
    }
  });
  await application.initialize();

  const failed = await application.execute({ type: 'INCREMENT', operationId: 'op-retry-1', payload: {} });
  assert.equal(failed.ok, false);
  assert.equal(failed.reason, 'storage_write_failed');
  assert.equal(application.getState().count, 0);

  const retried = await application.execute({ type: 'INCREMENT', operationId: 'op-retry-1', payload: {} });
  assert.equal(retried.ok, true);
  assert.equal(application.getState().count, 1);
  assert.equal(calls, 2);
});

test('GameApplication returns the original result for a completed operation without applying it twice', async () => {
  let calls = 0;
  const repository = new MemoryRepository({ initialState: { count: 0, meta: {} } });
  const application = new GameApplication({
    repository,
    commandHandlers: {
      INCREMENT(draft) {
        calls += 1;
        draft.count += 1;
        return { ok: true, value: draft.count };
      }
    }
  });
  await application.initialize();

  const first = await application.execute({ type: 'INCREMENT', operationId: 'op-once-1', payload: {} });
  const duplicate = await application.execute({ type: 'INCREMENT', operationId: 'op-once-1', payload: {} });

  assert.equal(first.value, 1);
  assert.equal(duplicate.value, 1);
  assert.equal(duplicate.duplicate, true);
  assert.equal(application.getState().count, 1);
  assert.equal(calls, 1);
});

test('GameApplication serializes concurrent commands so delayed writes do not lose updates', async () => {
  const repository = new MemoryRepository({ initialState: { count: 0, meta: {} }, delayMs: 10 });
  const application = new GameApplication({
    repository,
    commandHandlers: {
      INCREMENT(draft) {
        draft.count += 1;
        return { ok: true, value: draft.count };
      }
    }
  });
  await application.initialize();

  const [first, second] = await Promise.all([
    application.execute({ type: 'INCREMENT', operationId: 'op-queue-1', payload: {} }),
    application.execute({ type: 'INCREMENT', operationId: 'op-queue-2', payload: {} })
  ]);

  assert.equal(first.value, 1);
  assert.equal(second.value, 2);
  assert.equal(application.getState().count, 2);
});

test('GameApplication adopts the newer repository state on a version conflict and retries without overwriting it', async () => {
  const repository = new MemoryRepository({ initialState: { count: 0, meta: {} } });
  const application = new GameApplication({
    repository,
    commandHandlers: {
      INCREMENT(draft) {
        draft.count += 1;
        return { ok: true, value: draft.count };
      }
    }
  });
  await application.initialize();

  await repository.commit({ count: 5, meta: {} }, { expectedVersion: 0 });
  const conflicted = await application.execute({ type: 'INCREMENT', operationId: 'op-conflict-1' });

  assert.equal(conflicted.ok, false);
  assert.equal(conflicted.reason, 'version_conflict');
  assert.equal(application.getState().count, 5);

  const retried = await application.execute({ type: 'INCREMENT', operationId: 'op-conflict-1' });
  assert.equal(retried.ok, true);
  assert.equal(application.getState().count, 6);
});

test('supply commands accept an item id and always use the catalog price', async () => {
  const items = [
    { id: 'weapon_sword', title: '木劍', type: 'weapon', cost: 60, attr: { energy: 2 } }
  ];
  const core = {
    SupplyEngine: {
      acquire({ character, inventory, transactions, items: catalog, itemId, transactionId, purchasedAt, cost }) {
        const item = catalog.find(candidate => candidate.id === itemId);
        const nextCharacter = clone(character);
        const nextInventory = clone(inventory);
        const nextTransactions = clone(transactions);
        nextCharacter.gold -= cost;
        nextInventory.push(item.id);
        nextCharacter.equipped[item.type] = item.id;
        nextTransactions.push({ id: transactionId, itemId, cost, occurredAt: purchasedAt });
        return { ok: true, reason: 'purchased_and_equipped', character: nextCharacter, inventory: nextInventory, transactions: nextTransactions };
      }
    }
  };
  const repository = new MemoryRepository({ initialState: baseState() });
  const application = new GameApplication({
    repository,
    commandHandlers: createLifeQuestCommandHandlers({ core, supplyItems: items })
  });
  await application.initialize();

  const result = await application.execute({
    type: 'PURCHASE_SUPPLY',
    operationId: 'op-supply-1',
    payload: { itemId: 'weapon_sword', cost: 1 }
  });

  assert.equal(result.ok, true);
  assert.equal(application.getState().character.gold, 46);
  assert.equal(application.getState().supplyTransactions[0].cost, 54);
});

test('rule commands accept only an existing rule id and ignore forged rule definitions', async () => {
  const repository = new MemoryRepository({ initialState: baseState() });
  const application = new GameApplication({
    repository,
    commandHandlers: createLifeQuestCommandHandlers({ core: {}, supplyItems: [] })
  });
  await application.initialize();

  const changed = await application.execute({
    type: 'SET_RULE_ENABLED',
    operationId: 'op-rule-1',
    payload: {
      ruleId: 'rule_sleep',
      enabled: false,
      rule: { id: 'rule_sleep', exp: 999999 }
    }
  });
  const missing = await application.execute({
    type: 'SET_RULE_ENABLED',
    operationId: 'op-rule-2',
    payload: { ruleId: 'missing_rule', enabled: true }
  });

  assert.equal(changed.ok, true);
  assert.equal(application.getState().rules[0].enabled, false);
  assert.equal(application.getState().rules[0].exp, 20);
  assert.equal(missing.ok, false);
  assert.equal(missing.reason, 'rule_not_found');
});

test('reward ticket commands accept only a catalog id and cannot be retried for a second deduction', async () => {
  const catalog = [
    { id: 'favorite_drink', title: '喜愛飲品券', cost: 5, description: '購買一次喜歡的飲品' }
  ];
  const repository = new MemoryRepository({ initialState: baseState() });
  const application = new GameApplication({
    repository,
    commandHandlers: createLifeQuestCommandHandlers({
      core: LifeQuestCore,
      supplyItems: [],
      rewardTicketCatalog: catalog
    })
  });
  await application.initialize();
  const command = {
    type: 'REDEEM_REWARD_TICKET',
    operationId: 'op-ticket-1',
    payload: { ticketId: 'favorite_drink', cost: 0 }
  };

  const first = await application.execute(command);
  const duplicate = await application.execute(command);

  assert.equal(first.ok, true);
  assert.equal(duplicate.duplicate, true);
  assert.equal(application.getState().character.gems, 0);
  assert.equal(application.getState().rewardTickets[0].costSnapshot, 5);
});

test('LocalStorageRepository presents the same asynchronous interface and reports write failures', async () => {
  let saved = JSON.stringify(baseState());
  let shouldFail = true;
  const storage = {
    getItem() { return saved; },
    setItem(_key, value) {
      if (shouldFail) throw new Error('quota');
      saved = String(value);
    },
    removeItem() { saved = null; }
  };
  const repository = new LocalStorageRepository({ storage, key: 'lifequest_state' });
  const loaded = await repository.load();
  const failed = await repository.commit({ ...loaded, character: { ...loaded.character, gold: 10 } }, { expectedVersion: 0 });

  assert.equal(failed.ok, false);
  assert.equal(failed.reason, 'storage_write_failed');

  shouldFail = false;
  const savedResult = await repository.commit({ ...loaded, character: { ...loaded.character, gold: 10 } }, { expectedVersion: 0 });
  assert.equal(savedResult.ok, true);
  assert.equal((await repository.load()).character.gold, 10);
});

test('initialization adopts repository state without writing an older client snapshot back', async () => {
  let writes = 0;
  const repository = {
    executionMode: 'local',
    async load() { return { count: 7, meta: { repositoryVersion: 3, operations: [] } }; },
    async commit() { writes += 1; return { ok: true }; }
  };
  const application = new GameApplication({ repository });

  const loaded = await application.initialize();

  assert.equal(loaded.count, 7);
  assert.equal(writes, 0);
});

test('persistent operation journal reuses the first id after a retryable failure', async () => {
  let pending = null;
  const storage = {
    getItem() { return pending; },
    setItem(_key, value) { pending = String(value); }
  };
  const operationStore = new LocalStorageOperationStore({ storage, key: 'pending' });
  const repository = new MemoryRepository({ initialState: { count: 0, meta: {} }, failures: 1 });
  const application = new GameApplication({
    repository,
    operationStore,
    commandHandlers: {
      INCREMENT(draft) {
        draft.count += 1;
        return { ok: true, value: draft.count };
      }
    }
  });
  await application.initialize();

  const first = await application.execute({
    type: 'INCREMENT',
    operationId: 'operation-original-0001',
    intentKey: 'increment:today',
    payload: {}
  });
  const retry = await application.execute({
    type: 'INCREMENT',
    operationId: 'operation-new-click-0002',
    intentKey: 'increment:today',
    payload: {}
  });

  assert.equal(first.ok, false);
  assert.equal(retry.ok, true);
  assert.equal(retry.operationId, 'operation-original-0001');
  assert.equal(application.getState().count, 1);
  assert.deepEqual(await operationStore.list(), []);
});

test('remote repository sends the command envelope without a client state snapshot', async () => {
  const requests = [];
  const transport = async request => {
    requests.push(clone(request));
    if (request.method === 'GET') {
      return { ok: true, state: { count: 5, meta: { repositoryVersion: 2, operations: [] } } };
    }
    return {
      ok: true,
      state: { count: 6, meta: { repositoryVersion: 3, operations: [] } },
      result: { ok: true, value: 6 }
    };
  };
  const repository = new RemoteCommandRepository({ transport, contract: BackendContract });
  const application = new GameApplication({
    repository,
    commandValidator: command => BackendContract.validateCommandEnvelope(command)
  });
  await application.initialize();
  const command = BackendContract.createCommandEnvelope({
    type: 'SUBMIT_DAILY_ENTRY',
    operationId: 'daily-operation-remote-0001',
    occurredAt: '2026-08-19T02:00:00.000Z',
    businessDate: '2026-08-19',
    timeZone: 'Asia/Taipei',
    payload: {
      sleep: 7, water: 2000, exercise: 30, study: 30,
      expense: 100, impulse: 0, sugaryDrinks: 0
    }
  });

  const result = await application.execute(command);
  const remoteBody = requests.find(request => request.method === 'POST').body;

  assert.equal(result.ok, true);
  assert.equal(application.getState().count, 6);
  assert.equal('state' in remoteBody, false);
  assert.deepEqual(remoteBody.payload, {
    sleep: 7, water: 2000, exercise: 30, study: 30,
    expense: 100, impulse: 0, sugaryDrinks: 0
  });
});

test('remote repository rejects full-state replacement and local transition paths', async () => {
  const repository = new RemoteCommandRepository({
    contract: BackendContract,
    transport: async request => request.method === 'GET'
      ? { ok: true, state: { count: 1, meta: {} } }
      : { ok: false, reason: 'unexpected_request' }
  });
  const application = new GameApplication({ repository });
  await application.initialize();

  const localTransition = await application.commitLocalTransition({ count: 99, meta: {} });
  const replacement = await application.replaceState({ count: 99, meta: {} }, { trusted: true });

  assert.equal(localTransition.reason, 'local_transition_forbidden');
  assert.equal(replacement.reason, 'state_replace_forbidden');
  assert.equal(application.getState().count, 1);
});
