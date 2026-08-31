const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const BackendContract = require('../backendContract.js');
const Application = require('../gameApplication.js');
const MemberAuth = require('../memberAuth.js');
const SupabaseClient = require('../supabaseClient.js');

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
    has(key) { return values.has(key); },
    value(key) { return values.get(key); }
  };
}

function createAuthClient({ session = null, signUpResult = null, signInResult = null } = {}) {
  let listener = null;
  return {
    auth: {
      async getSession() { return { data: { session }, error: null }; },
      async signUp() { return signUpResult || { data: { user: null, session: null }, error: null }; },
      async signInWithPassword() { return signInResult || { data: { session }, error: null }; },
      async signOut() {
        session = null;
        if (listener) listener('SIGNED_OUT', null);
        return { error: null };
      },
      onAuthStateChange(callback) {
        listener = callback;
        return { data: { subscription: { unsubscribe() { listener = null; } } } };
      }
    }
  };
}

test('Supabase browser config accepts only a project URL and publishable key', () => {
  assert.deepEqual(SupabaseClient.validateConfig({
    url: 'https://jwpbwlrdzmfzjlbrktlc.supabase.co',
    publishableKey: 'sb_publishable_example'
  }), {
    url: 'https://jwpbwlrdzmfzjlbrktlc.supabase.co',
    publishableKey: 'sb_publishable_example'
  });
  assert.throws(() => SupabaseClient.validateConfig({
    url: 'https://jwpbwlrdzmfzjlbrktlc.supabase.co',
    publishableKey: 'service_role_secret'
  }));
});

test('member transport adds the current access token and never adds a client userId', async () => {
  const requests = [];
  const client = createAuthClient({
    session: { access_token: 'member-token', user: { id: 'member-a' } }
  });
  const transport = MemberAuth.createSupabaseTransport({
    client,
    projectUrl: 'https://jwpbwlrdzmfzjlbrktlc.supabase.co',
    publishableKey: 'sb_publishable_example',
    fetchImpl: async (_url, options) => {
      requests.push(options);
      return { ok: true, status: 200, async json() { return { ok: true, state: { meta: {} } }; } };
    }
  });
  await transport({ method: 'POST', headers: {}, body: { type: 'INITIALIZE_MEMBER_PROFILE' } });

  assert.equal(requests[0].headers.Authorization, 'Bearer member-token');
  assert.equal(requests[0].headers.apikey, 'sb_publishable_example');
  assert.equal(JSON.parse(requests[0].body).userId, undefined);
});

test('pending operation journals isolate guest and each member namespace', async () => {
  const storage = createStorage();
  const guest = new Application.LocalStorageOperationStore({ storage, key: 'pending', namespace: 'guest' });
  const memberA = new Application.LocalStorageOperationStore({ storage, key: 'pending', namespace: 'member:A', migrateLegacy: false });
  const memberB = new Application.LocalStorageOperationStore({ storage, key: 'pending', namespace: 'member:B', migrateLegacy: false });
  await guest.reserve({ intentKey: 'guest', operationId: 'guest-operation-1', command: {}, createdAt: 'now' });
  await memberA.reserve({ intentKey: 'member-a', operationId: 'member-operation-a', command: {}, createdAt: 'now' });

  assert.equal((await guest.list()).length, 1);
  assert.equal((await memberA.list()).length, 1);
  assert.equal((await memberB.list()).length, 0);
  await memberA.clear();
  assert.equal((await guest.list()).length, 1);
  assert.equal(storage.has('pending:member:A'), false);
});

test('retry reuses the complete original command as well as its operationId', async () => {
  const storage = createStorage();
  const operationStore = new Application.LocalStorageOperationStore({ storage, key: 'pending', namespace: 'member:A' });
  const requests = [];
  let shouldFail = true;
  const repository = new Application.RemoteCommandRepository({
    contract: BackendContract,
    transport: async request => {
      requests.push(request);
      if (shouldFail) {
        shouldFail = false;
        return { ok: false, errorCode: 'NETWORK_ERROR', retryable: true };
      }
      return {
        ok: true,
        state: { meta: { repositoryVersion: 1, operations: [] }, member: { adventurerName: '測試冒險者' } },
        result: { initialized: true }
      };
    }
  });
  const app = new Application.GameApplication({
    repository,
    operationStore,
    commandValidator: command => BackendContract.validateCommandEnvelope(command),
    initialState: { meta: { repositoryVersion: 0, operations: [] } }
  });
  const first = BackendContract.createCommandEnvelope({
    type: 'INITIALIZE_MEMBER_PROFILE',
    operationId: 'member-operation-original',
    occurredAt: '2026-08-22T10:00:00.000Z',
    payload: { adventurerName: '測試冒險者' }
  });
  const second = BackendContract.createCommandEnvelope({
    type: 'INITIALIZE_MEMBER_PROFILE',
    operationId: 'member-operation-newclick',
    occurredAt: '2026-08-22T10:05:00.000Z',
    payload: { adventurerName: '測試冒險者' }
  });
  await app.execute(first);
  await app.execute(second);

  assert.equal(requests[1].body.operationId, first.operationId);
  assert.equal(requests[1].body.occurredAt, first.occurredAt);
});

test('registration safely handles a created user with no session', async () => {
  const client = createAuthClient({
    signUpResult: { data: { user: { id: 'pending-user' }, session: null }, error: null }
  });
  const coordinator = MemberAuth.createMemberAuthCoordinator({
    supabaseClient: client,
    projectUrl: 'https://jwpbwlrdzmfzjlbrktlc.supabase.co',
    publishableKey: 'sb_publishable_example',
    storage: createStorage(),
    contract: BackendContract,
    application: Application,
    fetchImpl: async () => { throw new Error('must not call member command without a session'); }
  });
  const result = await coordinator.register({
    adventurerName: '測試冒險者',
    email: 'member@example.com',
    password: 'password123'
  });

  assert.equal(result.ok, true);
  assert.equal(result.verificationRequired, true);
  assert.equal(result.session, null);
});

test('Phase 1 migration and Edge Function enforce the member boundary', () => {
  const root = path.resolve(__dirname, '..');
  const sql = fs.readFileSync(path.join(root, 'supabase/migrations/20260822191500_phase_1_member_identity.sql'), 'utf8');
  const hardeningSql = fs.readFileSync(path.join(root, 'supabase/migrations/20260822194000_phase_1_harden_command_authority.sql'), 'utf8');
  const edge = fs.readFileSync(path.join(root, 'supabase/functions/lifequest-command/index.ts'), 'utf8');

  assert.match(sql, /create table public\.profiles/i);
  assert.match(sql, /create table public\.member_game_roots/i);
  assert.match(sql, /create table private\.command_operations/i);
  assert.match(sql, /primary key \(user_id, operation_id\)/i);
  assert.match(sql, /alter table public\.profiles enable row level security/i);
  assert.match(sql, /\(select auth\.uid\(\)\) = user_id/i);
  assert.match(hardeningSql, /security invoker[\s\S]*set search_path = ''/i);
  assert.match(hardeningSql, /revoke all on function public\.initialize_member_profile[\s\S]*from public, anon, authenticated/i);
  assert.match(hardeningSql, /grant execute on function public\.initialize_member_profile[\s\S]*to service_role/i);
  assert.doesNotMatch(sql, /^\s*(exp|level|gold|gems|boss|achievement|inventory)\s+/im);

  assert.match(edge, /supabase\.auth\.getUser\(\)/);
  assert.match(edge, /p_user_id:\s*userData\.user\.id/);
  assert.match(edge, /INITIALIZE_MEMBER_PROFILE:\s*'initialize_member_profile'/);
  assert.match(edge, /SELECT_MAIN_QUEST:\s*'select_main_quest'/);
  assert.match(edge, /UPDATE_PROFILE:\s*'update_member_profile'/);
  assert.doesNotMatch(edge, /command\.userId|payload\.userId/);
});
