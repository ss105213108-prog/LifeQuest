const test = require('node:test');
const assert = require('node:assert/strict');
const { createEdgeHarness, envelope } = require('./helpers/edge-handler-harness.cjs');
const rawDaily = { sleep: 8, water: 2000, exercise: 40, study: 30, expense: 200, impulse: 0, sugaryDrinks: 0 };
const uuid = '00000000-0000-4000-8000-000000000001';
const commandExamples = {
  INITIALIZE_MEMBER_PROFILE: { adventurerName: '測試員' }, SELECT_MAIN_QUEST: { questId: 'sleep' },
  UPDATE_PROFILE: { dailyBudget: 500 }, SAVE_DAILY_DRAFT: { date: '2026-08-28', draft: rawDaily },
  CREATE_CUSTOM_HABIT: { title: '安全測試', direction: 'good' },
  UPDATE_CUSTOM_HABIT: { habitId: uuid, title: '安全測試' },
  REMOVE_CUSTOM_HABIT: { habitId: uuid }, RESTORE_CUSTOM_HABIT: { habitId: uuid },
  SET_RULE_ENABLED: { ruleId: 'rule_1', enabled: true }, REPORT_HABIT_EVENT: { habitId: 'exercise_training' },
  REVERSE_HABIT_EVENT: { eventId: uuid }, SUBMIT_DAILY_ENTRY: rawDaily,
  PURCHASE_ITEM: { itemKey: 'potion_red', seenCatalogVersion: 1 }, USE_ITEM: { itemKey: 'potion_red' },
  EQUIP_ITEM: { itemKey: 'weapon_sword' }, UNEQUIP_ITEM: { slot: 'weapon' },
  REDEEM_REWARD_TICKET: { ticketKey: 'rest_30', seenCatalogVersion: 1 },
  USE_REWARD_TICKET: { ticketInstanceId: uuid }, REVERSE_REWARD_TICKET: { ticketInstanceId: uuid }
};

for (const [label, diagnostic] of [
  ['unknown domain exception', 'private diagnostic must not be public'],
  ['SQL exception', 'SELECT secret FROM private.command_operations; SQLSTATE 23505'],
  ['stack exception', 'Error: broken\n at /srv/private/phase4Domain.mjs:45:9'],
  ['constraint exception', 'duplicate key violates player_states_user_id_key'],
  ['internal engine code', 'INVALID_REWARD_PLAN']
]) test(`Edge boundary hides ${label}`, async () => {
  const h = await createEdgeHarness({ readThrows: new Error(diagnostic) });
  const response = await h.request(envelope('REPORT_HABIT_EVENT', { habitId: 'exercise_training' }));
  assert.equal(response.status, 500);
  assert.equal(response.body.errorCode, 'INTERNAL_ERROR');
  assert.equal(response.body.reason, 'INTERNAL_ERROR');
  assert.equal(response.body.message, '系統暫時無法完成操作，請稍後再試。');
  assert.ok(!response.text.includes(diagnostic));
  assert.equal(h.calls.filter(call => call.name === 'execute_phase4b_command').length, 0);
});

test('Edge boundary also contains rejected RPC promises and GET failures', async () => {
  for (const method of ['POST', 'GET']) {
    const h = await createEdgeHarness({ rpcThrows: new Error('SQLSTATE secret'), readThrows: new Error('SQLSTATE secret') });
    const response = await h.request(envelope(), { method });
    assert.equal(response.status, 500);
    assert.equal(response.body.errorCode, 'INTERNAL_ERROR');
    assert.ok(!response.text.includes('SQLSTATE'));
  }
});

test('RPC error codes are allowlisted and cannot reflect arbitrary diagnostics or metadata', async () => {
  const h = await createEdgeHarness({ rpcResult: { ok: false, errorCode: 'private.sql_constraint',
    message: 'secret', currentVersion: 'SELECT secret', retryable: true } });
  const response = await h.request();
  assert.equal(response.status, 500);
  assert.equal(response.body.errorCode, 'INTERNAL_ERROR');
  assert.ok(!/secret|sql_constraint|SELECT/.test(response.text));
});

test('known version conflict remains a conflict with its safe version and operation id', async () => {
  const h = await createEdgeHarness({ rpcResult: { ok: false, errorCode: 'VERSION_CONFLICT', currentVersion: 9 } });
  const response = await h.request();
  assert.equal(response.status, 409);
  assert.equal(response.body.errorCode, 'VERSION_CONFLICT');
  assert.equal(response.body.currentVersion, 9);
  assert.equal(response.body.operationId, envelope().operationId);
});

for (const [label, value] of [['null', null], ['array', []], ['string', 'command'], ['number', 1], ['boolean', true]]) {
  test(`Edge rejects ${label} request bodies without any RPC`, async () => {
    const h = await createEdgeHarness();
    const response = await h.request(value);
    assert.equal(response.status, 400);
    assert.equal(response.body.errorCode, 'INVALID_PAYLOAD');
    assert.equal(h.calls.length, 0);
  });
}
test('malformed JSON and an empty body produce a safe validation error', async () => {
  for (const raw of ['', '{bad json']) {
    const h = await createEdgeHarness();
    const response = await h.request(envelope(), { raw });
    assert.equal(response.status, 400);
    assert.equal(response.body.errorCode, 'INVALID_PAYLOAD');
    assert.equal(h.calls.length, 0);
  }
});
test('body limit is enforced on actual bytes, including chunked bodies and forged Content-Length', async () => {
  const bytes = new TextEncoder().encode(JSON.stringify(envelope()) + ' '.repeat(32768));
  for (const contentLength of [null, '1', String(bytes.length)]) {
    const h = await createEdgeHarness();
    const raw = new ReadableStream({ start(controller) {
      controller.enqueue(bytes.subarray(0, 200)); controller.enqueue(bytes.subarray(200)); controller.close();
    } });
    const response = await h.request(envelope(), { raw, headers: { 'content-length': contentLength } });
    assert.equal(response.status, 413);
    assert.equal(response.body.errorCode, 'INVALID_PAYLOAD');
    assert.equal(h.calls.length, 0);
    assert.equal(h.authCalls, 0, 'reject oversized body before Auth/domain work');
  }
});
for (const value of ['-1', '1.5', '9007199254740992', 'Infinity', 'NaN', '123junk', '"1"', 'true', '']) {
  test(`If-Match rejects unsafe integer syntax: ${JSON.stringify(value)}`, async () => {
    const h = await createEdgeHarness();
    const response = await h.request(envelope(), { headers: { 'if-match': value } });
    assert.equal(response.status, 400);
    assert.equal(response.body.errorCode, 'INVALID_PAYLOAD');
    assert.equal(h.calls.length, 0);
  });
}
test('safe If-Match endpoints are preserved and 6B-2 rejects missing mutable versions', async () => {
  for (const value of ['0', '9007199254740991', null]) {
    const h = await createEdgeHarness();
    const response = await h.request(envelope('UPDATE_PROFILE', { dailyBudget: 500 }), { headers: { 'if-match': value } });
    if (value === null) {
      assert.equal(response.status, 400);
      assert.equal(response.body.errorCode, 'INVALID_PAYLOAD');
      assert.equal(h.calls.length, 0);
      continue;
    }
    assert.equal(response.status, 200);
    assert.equal(h.calls[0].args.p_expected_version, value === null ? null : Number(value));
  }
});
for (const [label, change] of [
  ['wrong version', c => { c.contractVersion = '1'; }],
  ['extra field', c => { c.userId = 'victim'; }],
  ['body expectedVersion', c => { c.expectedVersion = 1; }],
  ['invalid operation id', c => { c.operationId = 'bad'; }],
  ['non-string operation id', c => { c.operationId = 123456789; }],
  ['huge operation id', c => { c.operationId = 'a'.repeat(201); }],
  ['missing intent', c => { delete c.intentKey; }],
  ['object intent', c => { c.intentKey = {}; }],
  ['array intent', c => { c.intentKey = []; }],
  ['huge intent', c => { c.intentKey = 'a'.repeat(4097); }],
  ['wrong intent format', c => { c.intentKey = 'arbitrary'; }],
  ['invalid timestamp', c => { c.occurredAt = 'not a date'; }],
  ['invalid calendar timestamp', c => { c.occurredAt = '2026-02-30T01:00:00Z'; }],
  ['timestamp number', c => { c.occurredAt = 123; }],
  ['date without time', c => { c.occurredAt = '2026-08-28'; }],
  ['missing context', c => { delete c.context; }],
  ['invalid business date', c => { c.context.businessDate = '2026-02-30'; }],
  ['invalid timezone', c => { c.context.timeZone = 'Not/AZone'; }],
  ['extra context', c => { c.context.ownerId = 'victim'; }],
  ['null payload', c => { c.payload = null; }],
  ['array payload', c => { c.payload = []; }],
  ['primitive payload', c => { c.payload = 'x'; }],
  ['inherited route', c => { c.type = 'constructor'; }]
]) test(`Envelope rejects ${label}`, async () => {
  const h = await createEdgeHarness();
  const command = envelope('UPDATE_PROFILE', { dailyBudget: 500 });
  change(command);
  const response = await h.request(command);
  assert.equal(response.status, 400);
  assert.equal(response.body.errorCode, 'INVALID_PAYLOAD');
  assert.equal(h.calls.length, 0);
});

for (const type of Object.keys(commandExamples)) test(`${type} accepts its current Client contract and rejects forged authority`, async () => {
  const receiptResult = { ok: true, duplicate: true, repositoryVersion: 10, state: { marker: 'latest' } };
  const command = envelope(type, commandExamples[type]);
  const valid = await createEdgeHarness({ receiptResult });
  assert.equal((await valid.request(command)).status, 200);
  assert.equal(valid.calls[0].args.p_user_id, 'verified-user');
  assert.deepEqual(JSON.parse(JSON.stringify(valid.calls[0].args.p_command)), command);
  for (const field of ['Gold', 'Gems', 'HP', 'EXP', 'price', 'discount', 'reward', 'userId', 'ownerId', 'quantity', 'repositoryVersion']) {
    const h = await createEdgeHarness({ receiptResult });
    const response = await h.request(envelope(type, { ...commandExamples[type], [field]: 999 }));
    assert.equal(response.status, 400, `${type} must reject ${field}`);
    assert.equal(h.calls.length, 0);
  }
});
test('Daily submit rejects numeric strings, booleans, null and empty input without receipt or settlement work', async () => {
  for (const value of ['8', true, false, null, '']) {
    const h = await createEdgeHarness({ receiptResult: { ok: true, duplicate: true } });
    const response = await h.request(envelope('SUBMIT_DAILY_ENTRY', { ...rawDaily, sleep: value }));
    assert.equal(response.status, 400, `reject ${JSON.stringify(value)}`);
    assert.equal(h.calls.length, 0);
  }
});
test('Draft null remains legal; non-null draft fields and Profile budget require actual numbers', async () => {
  const h = await createEdgeHarness();
  assert.equal((await h.request(envelope('SAVE_DAILY_DRAFT', {
    date: '2026-08-28', draft: { ...rawDaily, sleep: null, expense: null }
  }))).status, 200);
  for (const value of ['8', true, false, '']) {
    for (const [type, payload] of [
      ['SAVE_DAILY_DRAFT', { date: '2026-08-28', draft: { ...rawDaily, sleep: value } }],
      ['UPDATE_PROFILE', { dailyBudget: value }]
    ]) {
      const invalid = await createEdgeHarness();
      assert.equal((await invalid.request(envelope(type, payload))).status, 400);
      assert.equal(invalid.calls.length, 0);
    }
  }
});
test('identity strings cannot be coerced from objects, arrays or numbers; seen version must be safe', async () => {
  for (const [type, payload] of [
    ['REPORT_HABIT_EVENT', { habitId: 123 }], ['REPORT_HABIT_EVENT', { habitId: ['exercise_training'] }],
    ['USE_ITEM', { itemKey: ['potion_red'] }], ['UNEQUIP_ITEM', { slot: ['weapon'] }],
    ['CREATE_CUSTOM_HABIT', { title: {}, direction: 'good' }],
    ['SET_RULE_ENABLED', { ruleId: 'rule_1', enabled: 'true' }],
    ['PURCHASE_ITEM', { itemKey: 'potion_red', seenCatalogVersion: 9007199254740992 }],
    ['PURCHASE_ITEM', { itemKey: 'potion_red', seenCatalogVersion: '1' }]
  ]) {
    const h = await createEdgeHarness({ receiptResult: { ok: true, duplicate: true } });
    assert.equal((await h.request(envelope(type, payload))).status, 400);
    assert.equal(h.calls.length, 0);
  }
  // Phase 6B-2 formally requires seenCatalogVersion; all coercion cases above remain unchanged.
  const missingCatalog = await createEdgeHarness();
  assert.equal((await missingCatalog.request(envelope('PURCHASE_ITEM', { itemKey: 'potion_red' }))).status, 400);
  assert.equal(missingCatalog.calls.length, 0);
});

test('confirmed invalid Auth returns SESSION_EXPIRED and never creates a service client', async () => {
  for (const authError of [{ status: 401, message: 'private JWT details' }, { status: 400, code: 'bad_jwt' }]) {
    const h = await createEdgeHarness({ authError, user: null });
    const response = await h.request();
    assert.equal(response.status, 401);
    assert.equal(response.body.errorCode, 'SESSION_EXPIRED');
    assert.equal(h.calls.length, 0); assert.equal(h.serviceClients, 0);
    assert.ok(!response.text.includes('JWT'));
  }
});
test('Auth 503, rate limits and thrown network failures are unavailable, not permanent expiry', async () => {
  for (const options of [
    { authError: { status: 503, message: 'SELECT Auth private detail' } },
    { authError: { status: 503, code: 'bad_jwt' } },
    { authError: { status: 429, message: 'rate limit' } },
    { authThrows: new TypeError('fetch secret network failure') },
    { authThrows: Object.assign(new Error('private Auth detail'), { status: 503 }) }
  ]) {
    const h = await createEdgeHarness(options);
    const response = await h.request();
    assert.equal(response.status, 503);
    assert.equal(response.body.errorCode, 'AUTH_UNAVAILABLE');
    assert.equal(response.body.retryable, true);
    assert.equal(h.serviceClients, 0); assert.equal(h.calls.length, 0); assert.equal(h.reads.length, 0);
    assert.ok(!/SELECT|secret|private|bad_jwt/.test(response.text));
  }
});
test('Edge Auth unavailable keeps the existing Phase 6A Member runtime and Guest boundary intact', async t => {
  const { createHarness } = require('./helpers/member-economy-ui-harness.cjs');
  const ui = await createHarness({ gameplayProjection: true });
  t.after(() => ui.coordinator.stop());
  const before = ui.coordinator.getMemberState();
  const guest = ui.local.getItem('lifequest_state');
  const edge = await createEdgeHarness({ authError: { status: 503, message: 'Auth internal failure' } });
  ui.queue.push(async command => (await edge.request(command)).body);
  const result = await ui.coordinator.purchaseItem({ itemKey: 'potion_red', seenCatalogVersion: 1 });
  assert.equal(result.errorCode, 'AUTH_UNAVAILABLE');
  assert.equal(result.ok, false);
  assert.deepEqual(ui.coordinator.getMemberState(), before);
  assert.ok(ui.context.activeMember);
  assert.equal(ui.local.getItem('lifequest_state'), guest);
  assert.equal(edge.calls.length, 0);
});

test('historical live-verification intent keys remain compatible without changing receipt identity', async () => {
  for (const intentKey of ['PURCHASE_ITEM:old-operation-0001', 'PURCHASE_ITEM:reused:verification-run']) {
    const command = { ...envelope(), intentKey };
    const h = await createEdgeHarness();
    assert.equal((await h.request(command)).status, 200);
    assert.equal(h.calls[0].args.p_command.intentKey, intentKey);
  }
});
