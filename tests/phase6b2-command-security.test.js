const test = require('node:test');
const assert = require('node:assert/strict');
const Contract = require('../backendContract.js');
const { createEdgeHarness, envelope } = require('./helpers/edge-handler-harness.cjs');
const uuid = '00000000-0000-4000-8000-000000000001';
const daily = { sleep: 8, water: 2000, exercise: 40, study: 30, expense: 200, impulse: 0, sugaryDrinks: 0 };
const intents = {
  SELECT_MAIN_QUEST: { questId: 'sleep' }, UPDATE_PROFILE: { dailyBudget: 500 },
  SAVE_DAILY_DRAFT: { date: '2026-08-28', draft: daily },
  CREATE_CUSTOM_HABIT: { title: '測試任務', direction: 'good' },
  UPDATE_CUSTOM_HABIT: { habitId: uuid, title: '更新任務' },
  REMOVE_CUSTOM_HABIT: { habitId: uuid }, RESTORE_CUSTOM_HABIT: { habitId: uuid },
  SET_RULE_ENABLED: { ruleId: 'rule_1', enabled: true },
  REPORT_HABIT_EVENT: { habitId: 'exercise_training' }, REVERSE_HABIT_EVENT: { eventId: uuid },
  SUBMIT_DAILY_ENTRY: daily,
  PURCHASE_ITEM: { itemKey: 'potion_red', seenCatalogVersion: 1 }, USE_ITEM: { itemKey: 'potion_red' },
  EQUIP_ITEM: { itemKey: 'weapon_sword' }, UNEQUIP_ITEM: { slot: 'weapon' },
  REDEEM_REWARD_TICKET: { ticketKey: 'rest_30', seenCatalogVersion: 1 },
  USE_REWARD_TICKET: { ticketInstanceId: uuid }, REVERSE_REWARD_TICKET: { ticketInstanceId: uuid }
};

for (const [type, payload] of Object.entries(intents)) {
  test(`6B-2 HTTP ${type} rejects a missing If-Match before any mutation/read`, async () => {
    const h = await createEdgeHarness();
    const r = await h.request(envelope(type, payload), { headers: { 'if-match': null } });
    assert.equal(r.status, 400);
    assert.equal(r.body.errorCode, 'INVALID_PAYLOAD');
    assert.deepEqual(h.calls, []);
    assert.deepEqual(h.reads, []);
  });
}

test('6B-2 INITIALIZE_MEMBER_PROFILE retains its no-version exception', async () => {
  const h = await createEdgeHarness();
  const r = await h.request(envelope('INITIALIZE_MEMBER_PROFILE', { adventurerName: '測試員' }),
    { headers: { 'if-match': null } });
  assert.equal(r.body.ok, true);
  assert.equal(h.calls[0].args.p_expected_version, null);
});

for (const [type, key] of [['PURCHASE_ITEM', 'itemKey'], ['REDEEM_REWARD_TICKET', 'ticketKey']]) {
  test(`6B-2 ${type} requires seenCatalogVersion at both HTTP and client contract`, async () => {
    const command = envelope(type, { [key]: type === 'PURCHASE_ITEM' ? 'potion_red' : 'rest_30' });
    const h = await createEdgeHarness();
    const r = await h.request(command);
    assert.equal(r.status, 400);
    assert.equal(r.body.errorCode, 'INVALID_PAYLOAD');
    assert.deepEqual(h.calls, []);
    assert.equal(Contract.createApiRequest(command).ok, false);
  });
}

test('6B-2 valid version/payload reaches existing RPC unchanged, using only verified ownership', async () => {
  for (const [type, payload] of Object.entries(intents).filter(([type]) =>
    !['REPORT_HABIT_EVENT','REVERSE_HABIT_EVENT','SUBMIT_DAILY_ENTRY'].includes(type))) {
    const h = await createEdgeHarness({ user: { id: uuid } });
    const command = envelope(type,payload);
    const response = await h.request(command,{headers:{'if-match':'7'}});
    assert.equal(response.body.ok,true,type);
    assert.equal(h.calls.length,1,type);
    assert.equal(h.calls[0].args.p_expected_version,7);
    assert.equal(h.calls[0].args.p_user_id,uuid);
    assert.deepEqual(h.calls[0].args.p_command,command);
    assert.equal(Object.hasOwn(command,'expectedVersion'),false);
  }
});

test('6B-2 HTTP preserves DB stale/future VERSION_CONFLICT instead of retrying', async () => {
  for (const version of ['6','8']) {
    const h = await createEdgeHarness({rpcResult:{ok:false,errorCode:'VERSION_CONFLICT',currentVersion:7}});
    const r = await h.request(envelope('UPDATE_PROFILE',{dailyBudget:500}),{headers:{'if-match':version}});
    assert.equal(r.status,409);
    assert.equal(r.body.currentVersion,7);
    assert.equal(h.calls.length,1);
    assert.equal(h.calls[0].args.p_expected_version,Number(version));
  }
});

test('6B-2 completed receipt replay with original version remains duplicate across all RPC families', async () => {
  for (const type of ['UPDATE_PROFILE','SET_RULE_ENABLED','PURCHASE_ITEM','REPORT_HABIT_EVENT']) {
    const receipt={ok:true,duplicate:true,repositoryVersion:9,operationRepositoryVersion:2,
      state:{meta:{repositoryVersion:9},marker:'authoritative-latest'}};
    const h=await createEdgeHarness({rpcResult:receipt,receiptResult:receipt});
    const r=await h.request(envelope(type,intents[type]),{headers:{'if-match':'1'}});
    assert.equal(r.status,200);
    assert.deepEqual(r.body,receipt);
    assert.equal(h.calls.length,1);
    assert.equal(h.reads.length,0);
  }
});

test('6B-2 operation reuse and stale catalog failures keep safe existing HTTP semantics', async () => {
  for (const errorCode of ['OPERATION_ID_REUSED','CATALOG_CHANGED']) {
    const h=await createEdgeHarness({rpcResult:{ok:false,errorCode}});
    const r=await h.request(envelope('PURCHASE_ITEM',intents.PURCHASE_ITEM));
    assert.equal(r.status,409);
    assert.equal(r.body.errorCode,errorCode);
    assert.equal(h.calls.length,1);
  }
});

test('6B-2 ownership fields and fake prices/rewards cannot reach RPC even with valid versions', async () => {
  for (const type of ['UPDATE_PROFILE','SET_RULE_ENABLED','PURCHASE_ITEM','REDEEM_REWARD_TICKET']) {
    for (const field of ['userId','ownerId','playerId','profileId','price','discount','reward']) {
      const h=await createEdgeHarness();
      const r=await h.request(envelope(type,{...intents[type],[field]:uuid}));
      assert.equal(r.status,400,`${type}/${field}`);
      assert.equal(r.body.errorCode,'INVALID_PAYLOAD');
      assert.equal(h.calls.length,0);
      assert.equal(h.reads.length,0);
    }
  }
});

test('6B-2 catalog versions reject null/string/fraction/unsafe values in both boundaries', async () => {
  for(const type of ['PURCHASE_ITEM','REDEEM_REWARD_TICKET']) {
    for(const value of [null,'1',0,-1,1.5,9007199254740992]) {
      const c=envelope(type,{...intents[type],seenCatalogVersion:value});
      const h=await createEdgeHarness();
      assert.equal((await h.request(c)).status,400);
      assert.equal(h.calls.length,0);
      assert.equal(Contract.createApiRequest(c).ok,false);
    }
  }
});
