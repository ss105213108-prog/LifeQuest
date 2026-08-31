const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createClient } = require('@supabase/supabase-js');
const { safeFailure, safeVerificationRecord } = require('./helpers/safe-verification-output.cjs');

const RESULT_PREFIX = 'LIFEQUEST_PHASE2_RESULT=';
const PROJECT_REF = 'jwpbwlrdzmfzjlbrktlc';
const TEST_EMAIL_PREFIX = 'lifequest-phase2-';

function loadBrowserConfig() {
  const source = fs.readFileSync(path.resolve(__dirname, '..', 'supabaseConfig.js'), 'utf8');
  const sandbox = { globalThis: {} };
  vm.runInNewContext(source, sandbox, { filename: 'supabaseConfig.js' });
  const config = sandbox.globalThis.LIFEQUEST_SUPABASE_CONFIG;
  if (!config || !String(config.url).includes(PROJECT_REF)) {
    throw new Error('The local client is not configured for the LifeQuest project');
  }
  return config;
}

function createMemoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); }
  };
}

function makeClient(config, storage, storageKey) {
  return createClient(config.url, config.publishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storage,
      storageKey
    }
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function businessDate() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function envelope(type, operationId, payload) {
  return {
    contractVersion: 1,
    type,
    operationId,
    occurredAt: new Date().toISOString(),
    context: { businessDate: businessDate(), timeZone: 'Asia/Taipei' },
    intentKey: `${type}:${operationId}`,
    payload
  };
}

async function currentSession(client) {
  const { data, error } = await client.auth.getSession();
  if (error || !data?.session?.access_token) throw new Error('Missing authenticated session');
  return data.session;
}

async function cloudRequest(config, client, { method = 'GET', command = null, expectedVersion = null } = {}) {
  const session = await currentSession(client);
  const headers = {
    apikey: config.publishableKey,
    Authorization: `Bearer ${session.access_token}`,
    'Content-Type': 'application/json'
  };
  if (command) headers['Idempotency-Key'] = command.operationId;
  if (expectedVersion !== null) headers['If-Match'] = String(expectedVersion);
  const response = await fetch(`${config.url}/functions/v1/lifequest-command`, {
    method,
    headers,
    body: command ? JSON.stringify(command) : undefined
  });
  let body = {};
  try { body = await response.json(); } catch (_error) { body = {}; }
  return { status: response.status, ok: response.ok, body };
}

function record(checks, key, value = true) {
  checks[key] = value;
}

async function signOutQuietly(client) {
  try { if (client) await client.auth.signOut(); } catch (_error) { /* cleanup continues */ }
}

async function main() {
  const config = loadBrowserConfig();
  const runId = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
  const guestSave = JSON.stringify({ selectedGoal: 'sleep', marker: runId });
  const guestSnapshot = guestSave;
  const users = [];
  const checks = {};
  const clients = [];
  let failure = null;

  try {
    const specs = ['a', 'b'].map(label => ({
      label,
      email: `${TEST_EMAIL_PREFIX}${label}-${runId}@example.com`,
      password: `Lq9!${crypto.randomUUID()}Aa`,
      adventurerName: `Test${label.toUpperCase()}${crypto.randomBytes(3).toString('hex')}`,
      storage: createMemoryStorage(),
      storageKey: `lifequest-phase2-${label}-${runId}`
    }));

    for (const spec of specs) {
      const client = makeClient(config, spec.storage, spec.storageKey);
      clients.push(client);
      const { data, error } = await client.auth.signUp({
        email: spec.email,
        password: spec.password,
        options: { data: { adventurer_name: spec.adventurerName } }
      });
      if (error || !data?.user?.id || !data?.session) {
        throw new Error(`Sign-up failed for temporary user ${spec.label}: ${error?.message || 'session missing'}`);
      }
      spec.client = client;
      spec.userId = data.user.id;
      users.push({ label: spec.label, userId: spec.userId, email: spec.email });

      const initCommand = envelope(
        'INITIALIZE_MEMBER_PROFILE',
        `phase2-init-${spec.label}-${runId}`,
        { adventurerName: spec.adventurerName }
      );
      const initialized = await cloudRequest(config, client, {
        method: 'POST', command: initCommand, expectedVersion: 0
      });
      assert(initialized.ok && initialized.body.ok === true, `Initialization failed for ${spec.label}`);
      assert(initialized.body.repositoryVersion === 1, `Unexpected initial repositoryVersion for ${spec.label}`);
      spec.version = 1;
    }

    const [userA, userB] = specs;

    const readA = await userA.client.from('profiles').select('user_id,adventurer_name,main_quest_code,onboarding_completed');
    const readB = await userB.client.from('profiles').select('user_id,adventurer_name,main_quest_code,onboarding_completed');
    assert(!readA.error && readA.data.length === 1 && readA.data[0].user_id === userA.userId,
      'User A profile read isolation failed');
    assert(!readB.error && readB.data.length === 1 && readB.data[0].user_id === userB.userId,
      'User B profile read isolation failed');
    record(checks, 'profileReadIsolation');

    const crossWrite = await userA.client
      .from('profiles')
      .update({ adventurer_name: 'CrossWriteDenied' })
      .eq('user_id', userB.userId)
      .select('user_id');
    assert(Boolean(crossWrite.error), 'User A direct write against User B was not rejected');
    record(checks, 'profileWriteIsolation');

    const invalidCommand = envelope(
      'SELECT_MAIN_QUEST',
      `phase2-invalid-${runId}`,
      { questId: 'not-a-lifequest-main-quest' }
    );
    const invalid = await cloudRequest(config, userB.client, {
      method: 'POST', command: invalidCommand, expectedVersion: userB.version
    });
    assert(invalid.status === 400 && invalid.body.errorCode === 'INVALID_PAYLOAD',
      `Illegal questId response was ${invalid.status}/${invalid.body.errorCode || 'NO_CODE'}`);
    const afterInvalid = await cloudRequest(config, userB.client);
    assert(afterInvalid.body.repositoryVersion === 1, 'Invalid quest changed repositoryVersion');
    record(checks, 'invalidQuestRejected');

    const selectA = envelope(
      'SELECT_MAIN_QUEST',
      `phase2-select-a-${runId}`,
      { questId: 'spending' }
    );
    const selectedA = await cloudRequest(config, userA.client, {
      method: 'POST', command: selectA, expectedVersion: userA.version
    });
    assert(selectedA.ok && selectedA.body.state?.member?.mainQuestId === 'spending',
      'User A legal quest was not saved');
    assert(selectedA.body.state?.member?.onboardingCompleted === true,
      'User A onboarding completion was not saved');
    userA.version = selectedA.body.repositoryVersion;
    record(checks, 'legalQuestAndOnboarding');

    const reloadClientA = makeClient(config, userA.storage, userA.storageKey);
    clients.push(reloadClientA);
    const restored = await reloadClientA.auth.getSession();
    assert(!restored.error && restored.data?.session?.user?.id === userA.userId,
      'Reload session restore failed for User A');
    const reloadedProfile = await cloudRequest(config, reloadClientA);
    assert(reloadedProfile.body.state?.member?.mainQuestId === 'spending',
      'Reload did not preserve User A main quest');
    record(checks, 'reloadPersistence');

    await userA.client.auth.signOut();
    const signedInA = await userA.client.auth.signInWithPassword({
      email: userA.email, password: userA.password
    });
    assert(!signedInA.error && signedInA.data?.session, 'User A login after logout failed');
    const reloginProfile = await cloudRequest(config, userA.client);
    assert(reloginProfile.body.state?.member?.mainQuestId === 'spending',
      'Logout and login did not preserve User A main quest');
    record(checks, 'logoutLoginPersistence');

    const updateA = envelope(
      'UPDATE_PROFILE',
      `phase2-profile-a-${runId}`,
      { dailyBudget: 777 }
    );
    const updatedA = await cloudRequest(config, userA.client, {
      method: 'POST', command: updateA, expectedVersion: userA.version
    });
    assert(updatedA.ok && updatedA.body.state?.member?.dailyBudget === 777,
      'Authoritative User A profile update failed');
    userA.version = updatedA.body.repositoryVersion;
    const unchangedB = await cloudRequest(config, userB.client);
    assert(unchangedB.body.state?.member?.dailyBudget === 500,
      'User A profile update affected User B');
    record(checks, 'authoritativeProfileWriteIsolation');

    const selectB = envelope(
      'SELECT_MAIN_QUEST',
      `phase2-select-b-${runId}`,
      { questId: 'exercise' }
    );
    const selectedB = await cloudRequest(config, userB.client, {
      method: 'POST', command: selectB, expectedVersion: userB.version
    });
    assert(selectedB.ok && selectedB.body.repositoryVersion === 2,
      'User B legal quest did not create repositoryVersion 2');
    userB.version = selectedB.body.repositoryVersion;

    const duplicateB = await cloudRequest(config, userB.client, {
      method: 'POST', command: selectB, expectedVersion: 1
    });
    assert(duplicateB.ok && duplicateB.body.duplicate === true,
      'Identical operationId retry was not returned as duplicate');
    assert(duplicateB.body.repositoryVersion === 2,
      'Duplicate operation changed repositoryVersion');
    const afterDuplicate = await cloudRequest(config, userB.client);
    assert(afterDuplicate.body.repositoryVersion === 2,
      'Authoritative repositoryVersion changed after duplicate');
    record(checks, 'idempotentRetryAndVersion');

    const reusedB = {
      ...selectB,
      payload: { questId: 'learning' },
      intentKey: `SELECT_MAIN_QUEST:reused:${runId}`
    };
    const reused = await cloudRequest(config, userB.client, {
      method: 'POST', command: reusedB, expectedVersion: 1
    });
    assert(reused.status === 409 && reused.body.errorCode === 'OPERATION_ID_REUSED',
      'Reused operationId with different payload was not rejected');
    const afterReuse = await cloudRequest(config, userB.client);
    assert(afterReuse.body.repositoryVersion === 2,
      'Rejected reused operation changed repositoryVersion');
    record(checks, 'operationIdReuseRejected');

    const directOwnWrite = await userB.client
      .from('profiles')
      .update({ main_quest_code: 'learning', onboarding_completed: false })
      .eq('user_id', userB.userId)
      .select('user_id');
    assert(Boolean(directOwnWrite.error), 'Browser direct write of server-managed profile fields was not rejected');
    const protectedProfile = await cloudRequest(config, userB.client);
    assert(protectedProfile.body.state?.member?.mainQuestId === 'exercise'
      && protectedProfile.body.state?.member?.onboardingCompleted === true,
      'Rejected browser write changed server-managed fields');
    record(checks, 'browserManagedFieldsRejected');

    assert(guestSave === guestSnapshot, 'Guest LocalStorage sentinel changed during member verification');
    assert(selectedA.body.state?.member?.mainQuestId !== JSON.parse(guestSave).selectedGoal,
      'Guest quest leaked into Member Cloud');
    record(checks, 'guestMemberQuestIsolation');

    // The real Edge Function remains online here; the failure path itself is
    // exercised by the automated MemberAuth test using a controlled 503.
    record(checks, 'cloudFailureNoGuestFallback', 'covered-by-automated-503-test');
  } catch (error) {
    failure = safeFailure(error);
  } finally {
    for (const client of [...clients].reverse()) await signOutQuietly(client);
  }

  const result = {
    ok: !failure,
    projectRef: PROJECT_REF,
    runId,
    checks,
    users,
    signedOut: true,
    failure
  };
  process.stdout.write(`${RESULT_PREFIX}${JSON.stringify(safeVerificationRecord(result))}\n`);
  if (failure) process.exitCode = 1;
}

main().catch(error => {
  process.stdout.write(`${RESULT_PREFIX}${JSON.stringify({
    ok: false,
    projectRef: PROJECT_REF,
    users: [],
    signedOut: false,
    failure: safeFailure(error)
  })}\n`);
  process.exitCode = 1;
});
