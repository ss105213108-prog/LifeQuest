const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createClient } = require('@supabase/supabase-js');
const { safeFailure, safeVerificationRecord } = require('./helpers/safe-verification-output.cjs');
const { createTemporaryAccountCleanup } = require('./helpers/temporary-account-cleanup.cjs');

const PROJECT_REF = 'jwpbwlrdzmfzjlbrktlc';
const PREFIX = 'LIFEQUEST_PHASE5A_RESULT=';
const temporaryCleanup = createTemporaryAccountCleanup(record =>
  process.stdout.write(`${PREFIX}${JSON.stringify(safeVerificationRecord(record))}\n`));
const TABLES = [
  'player_inventory', 'player_equipment', 'player_reward_tickets', 'economy_transactions'
];

const assert = (value, message) => { if (!value) throw new Error(message); };

function config() {
  const source = fs.readFileSync(path.resolve(__dirname, '..', 'supabaseConfig.js'), 'utf8');
  const sandbox = { globalThis: {} };
  vm.runInNewContext(source, sandbox, { filename: 'supabaseConfig.js' });
  const value = sandbox.globalThis.LIFEQUEST_SUPABASE_CONFIG;
  if (!value || !String(value.url).includes(PROJECT_REF)) throw new Error('Wrong Supabase project');
  return value;
}

function storage() {
  const values = new Map();
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key)
  };
}

function makeClient(value, runId, label) {
  return createClient(value.url, value.publishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storage: storage(),
      storageKey: `phase5a-${label}-${runId}`
    }
  });
}

function password() {
  return crypto.randomBytes(24).toString('base64url') + '!Aa9';
}

function userSpec(value, runId, label) {
  return {
    label,
    runId,
    email: `lifequest-phase5a-${label}-${runId}@example.com`,
    password: password(),
    client: makeClient(value, runId, label)
  };
}

function envelope(type, operationId, payload) {
  return {
    contractVersion: 1,
    type,
    operationId,
    occurredAt: new Date().toISOString(),
    context: { businessDate: '2026-08-24', timeZone: 'Asia/Taipei' },
    intentKey: `${type}:${operationId}`,
    payload
  };
}

async function accessToken(user) {
  const { data, error } = await user.client.auth.getSession();
  if (error || !data?.session?.access_token) throw new Error(`Missing session ${user.label}`);
  return data.session.access_token;
}

async function edge(value, user, command, expectedVersion) {
  const token = await accessToken(user);
  const response = await fetch(`${value.url}/functions/v1/lifequest-command`, {
    method: 'POST',
    headers: {
      apikey: value.publishableKey,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': command.operationId,
      'If-Match': String(expectedVersion)
    },
    body: JSON.stringify(command)
  });
  let body = {};
  try { body = await response.json(); } catch (_) { /* keep empty */ }
  return { ok: response.ok, status: response.status, body };
}

async function login(user) {
  const { data, error } = await user.client.auth.signInWithPassword({
    email: user.email,
    password: user.password
  });
  assert(!error && data?.session && data?.user?.id, `Login failed ${user.label}`);
  user.userId = data.user.id;
}

async function setup(value, runId) {
  const users = ['a', 'b'].map(label => userSpec(value, runId, label));
  for (const user of users) {
    const adventurerName = `P5A${user.label.toUpperCase()}${runId.slice(-6)}`;
    const { data, error } = await user.client.auth.signUp({
      email: user.email,
      password: user.password,
      options: { data: { adventurer_name: adventurerName } }
    });
    temporaryCleanup.track(user, data?.user);
    assert(!error && data?.session && data?.user?.id, `Signup failed ${user.label}: ${error?.message || 'no session'}`);
    user.userId = data.user.id;
    const command = envelope('INITIALIZE_MEMBER_PROFILE', `phase5a-${user.label}-init-${runId}`, {
      adventurerName
    });
    const response = await edge(value, user, command, 0);
    assert(response.ok && response.body.repositoryVersion === 1, `Initialize failed ${user.label}`);
  }
  return users.map(({ label, userId }) => ({ label, userId }));
}

async function verify(value, runId) {
  const users = ['a', 'b'].map(label => userSpec(value, runId, label));
  await Promise.all(users.map(login));
  const [a, b] = users;
  const checks = {};

  for (const user of users) {
    const catalog = await user.client.from('item_catalog').select('item_key,active');
    assert(!catalog.error && catalog.data.length === 9 && catalog.data.every(row => row.active),
      `Active catalog read failed ${user.label}`);
  }
  checks.authenticatedCatalogRead = true;

  const ownA = await a.client.from('player_inventory').select('*');
  const ownB = await b.client.from('player_inventory').select('*');
  assert(!ownA.error && ownA.data.length === 1 && ownA.data[0].user_id === a.userId, 'A own inventory failed');
  assert(!ownB.error && ownB.data.length === 1 && ownB.data[0].user_id === b.userId, 'B own inventory failed');
  const leakA = await a.client.from('player_inventory').select('*').eq('user_id', b.userId);
  const leakB = await b.client.from('player_inventory').select('*').eq('user_id', a.userId);
  assert(!leakA.error && leakA.data.length === 0 && !leakB.error && leakB.data.length === 0,
    'Cross-user inventory read leaked');
  checks.userABReadIsolation = true;

  for (const user of users) {
    for (const table of TABLES) {
      const inserted = await user.client.from(table).insert({ user_id: user.userId });
      const updated = await user.client.from(table).update({ user_id: user.userId }).eq('user_id', user.userId);
      const deleted = await user.client.from(table).delete().eq('user_id', user.userId);
      assert(inserted.error && updated.error && deleted.error, `Browser DML not denied: ${user.label}/${table}`);
    }
  }
  checks.browserSensitiveWritesDenied = true;

  const direct = await a.client.rpc('get_phase4b_operation_receipt', {
    p_user_id: a.userId,
    p_command: {}
  });
  assert(direct.error, 'Authenticated browser can call a service-only operation function');
  checks.sensitiveRpcDenied = true;

  const before = await a.client.from('member_game_roots').select('repository_version').single();
  assert(!before.error && before.data.repository_version === 1, 'A root not initialized');
  const unsupported = envelope('PURCHASE_ITEM', `phase5a-a-purchase-${runId}`, {
    itemKey: 'weapon_sword', seenCatalogVersion: 1, seenBasePrice: 60
  });
  const unsupportedResponse = await edge(value, a, unsupported, 1);
  assert(!unsupportedResponse.ok, 'Phase 5B purchase command is already open');
  const after = await a.client.from('member_game_roots').select('repository_version').single();
  assert(!after.error && after.data.repository_version === 1, 'Locked command changed repositoryVersion');
  checks.phase5MemberCommandsLocked = true;

  const anonymous = makeClient(value, runId, 'anonymous');
  const anonymousCatalog = await anonymous.from('item_catalog').select('*');
  assert(anonymousCatalog.error || anonymousCatalog.data.length === 0, 'Anon can read catalog');
  for (const table of TABLES) {
    const read = await anonymous.from(table).select('*');
    assert(read.error || read.data.length === 0, `Anon can read ${table}`);
  }
  checks.anonymousReadDenied = true;

  await Promise.all(users.map(user => user.client.auth.signOut({ scope: 'global' })));
  return { users: users.map(({ label, userId }) => ({ label, userId })), checks };
}

async function signout(value, runId) {
  const users = ['a', 'b'].map(label => userSpec(value, runId, label));
  for (const user of users) {
    await login(user);
    const { error } = await user.client.auth.signOut({ scope: 'global' });
    assert(!error, `Global sign out failed ${user.label}`);
  }
  return users.map(({ label, userId }) => ({ label, userId }));
}

async function main() {
  const mode = process.argv[2];
  const runId = process.argv[3];
  if (!/^[a-z0-9-]{8,40}$/.test(runId || '')) {
    throw new Error('Usage: node phase5a-live-verification.cjs setup <run-id>');
  }
  // Do not reconstruct credentials for historical cross-process verify/signout.
  if (mode !== 'setup') throw new Error('Legacy cross-process resume disabled');
  const value = config();
  let details;
  try {
    details = await setup(value, runId);
  } finally {
    await temporaryCleanup.finish();
  }
  process.stdout.write(`${PREFIX}${JSON.stringify(safeVerificationRecord({ ok: true, mode, runId,
    projectRef: PROJECT_REF, details, cleanupRequired: true }))}\n`);
}

main().catch(error => {
  process.stdout.write(`${PREFIX}${JSON.stringify({ ok: false, projectRef: PROJECT_REF,
    failure: safeFailure(error) })}\n`);
  process.exitCode = 1;
});
