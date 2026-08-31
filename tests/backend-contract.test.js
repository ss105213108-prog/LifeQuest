const test = require('node:test');
const assert = require('node:assert/strict');

const BackendContract = require('../backendContract.js');

test('backend command envelope fixes operation, timezone and business-date semantics', () => {
  const command = BackendContract.createCommandEnvelope({
    type: 'SUBMIT_DAILY_ENTRY',
    operationId: 'daily-operation-0001',
    occurredAt: '2026-08-18T16:30:00.000Z',
    timeZone: 'Asia/Taipei',
    payload: {
      sleep: 7.5, water: 2000, exercise: 30, study: 30,
      expense: 100, impulse: 0, sugaryDrinks: 0
    }
  });

  assert.equal(command.contractVersion, 1);
  assert.equal(command.context.businessDate, '2026-08-19');
  assert.equal(command.context.timeZone, 'Asia/Taipei');
  assert.equal(BackendContract.validateCommandEnvelope(command).ok, true);
});

test('API request sends an idempotency key and command only', () => {
  const command = BackendContract.createCommandEnvelope({
    type: 'PURCHASE_SUPPLY',
    operationId: 'purchase-operation-0001',
    occurredAt: '2026-08-19T01:00:00.000Z',
    timeZone: 'Asia/Taipei',
    businessDate: '2026-08-19',
    payload: { itemId: 'weapon_sword' }
  });
  const prepared = BackendContract.createApiRequest(command);

  assert.equal(prepared.ok, true);
  assert.equal(prepared.request.headers['Idempotency-Key'], 'purchase-operation-0001');
  assert.deepEqual(prepared.request.body.payload, { itemId: 'weapon_sword' });
  assert.equal('state' in prepared.request.body, false);
});

test('backend contract rejects unknown commands and invalid timezone values', () => {
  const unknown = BackendContract.createCommandEnvelope({
    type: 'OVERWRITE_ALL_STATE',
    operationId: 'unsafe-operation-0001',
    occurredAt: '2026-08-19T01:00:00.000Z',
    businessDate: '2026-08-19',
    payload: {}
  });
  const invalidTimeZone = {
    ...BackendContract.createCommandEnvelope({
      type: 'UPDATE_PROFILE',
      operationId: 'profile-operation-0001',
      occurredAt: '2026-08-19T01:00:00.000Z',
      businessDate: '2026-08-19',
      payload: { name: '測試冒險者' }
    }),
    context: { businessDate: '2026-08-19', timeZone: 'Invalid/Timezone' }
  };

  assert.equal(BackendContract.validateCommandEnvelope(unknown).reason, 'unsupported_command');
  assert.equal(BackendContract.validateCommandEnvelope(invalidTimeZone).reason, 'invalid_time_zone');
});

test('member profile initialization accepts only an adventurer name intent', () => {
  const valid = BackendContract.createCommandEnvelope({
    type: 'INITIALIZE_MEMBER_PROFILE',
    operationId: 'member-profile-operation-0001',
    occurredAt: '2026-08-22T12:00:00.000Z',
    payload: { adventurerName: '測試冒險者' }
  });
  const forged = {
    ...valid,
    payload: { adventurerName: '測試冒險者', userId: 'forged', gold: 999999 }
  };

  assert.equal(BackendContract.validateCommandEnvelope(valid).ok, true);
  assert.equal(BackendContract.validateCommandEnvelope(forged).reason, 'invalid_payload');
});
