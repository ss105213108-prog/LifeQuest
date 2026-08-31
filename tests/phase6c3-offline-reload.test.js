const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const MemberAuth = require('../memberAuth.js');
const BackendContract = require('../backendContract.js');
const Application = require('../gameApplication.js');
const { fixture, storage, clone } = require('./helpers/member-economy-ui-harness.cjs');

function response(body, status = body.ok === false ? 503 : 200) {
  return { ok: body.ok !== false, status, json: async () => clone(body) };
}

async function createOfflineReloadHarness() {
  const user = { id: 'offline-member' };
  const session = { access_token: 'test-only-token', user };
  const local = storage();
  const guestSave = JSON.stringify({ character: { gold: 987 }, marker: 'guest-must-survive' });
  local.setItem('lifequest_state', guestSave);
  const server = { state: fixture(), offline: false };
  const ready = [];
  const loading = [];
  const coordinator = MemberAuth.createMemberAuthCoordinator({
    supabaseClient: {
      auth: {
        getSession: async () => ({ data: { session }, error: null }),
        signOut: async () => ({ error: null }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } })
      }
    },
    projectUrl: 'https://isolated.invalid',
    publishableKey: 'test-public',
    storage: local,
    contract: BackendContract,
    application: Application,
    onMemberLoading: value => loading.push(clone(value)),
    onMemberReady: value => ready.push(clone(value)),
    fetchImpl: async (_url, options) => {
      assert.equal(options.method, 'GET');
      if (server.offline) {
        return response({
          ok: false,
          errorCode: 'NETWORK_ERROR',
          message: 'Unable to load remote game state',
          retryable: true
        });
      }
      return response({ ok: true, state: server.state });
    }
  });
  assert.equal((await coordinator.start()).ok, true);
  return { coordinator, server, local, guestSave, ready, loading, session };
}

test('offline Member reload preserves the last successful projection, identity and Guest save', async t => {
  const h = await createOfflineReloadHarness();
  t.after(() => h.coordinator.stop());
  const before = h.coordinator.getMemberState();
  h.server.offline = true;

  await assert.rejects(h.coordinator.reloadMember(), error => error.code === 'NETWORK_ERROR');

  assert.deepEqual(h.coordinator.getMemberState(), before);
  assert.equal(h.coordinator.getSession().user.id, h.session.user.id);
  assert.equal(h.local.getItem('lifequest_state'), h.guestSave);
  assert.deepEqual(h.ready.at(-1).state, before);
});

test('offline Member reload uses a safe Chinese message and never exposes provider diagnostics', () => {
  const message = MemberAuth.safeMemberReloadMessage({
    code: 'NETWORK_ERROR',
    message: 'Unable to load remote game state: Failed to fetch token'
  });
  assert.equal(message, '目前無法連線，請檢查網路後再試。');
  assert.doesNotMatch(message, /Unable|Failed to fetch|token|stack|Supabase/i);
});

test('network recovery reload adopts the next authoritative projection', async t => {
  const h = await createOfflineReloadHarness();
  t.after(() => h.coordinator.stop());
  h.server.offline = true;
  await assert.rejects(h.coordinator.reloadMember());

  h.server.offline = false;
  h.server.state = fixture();
  h.server.state.meta.repositoryVersion = 21;
  h.server.state.member.adventurerName = '網路恢復後的冒險者';
  const recovered = await h.coordinator.reloadMember();

  assert.equal(recovered.ok, true);
  assert.equal(recovered.state.meta.repositoryVersion, 21);
  assert.equal(recovered.state.member.adventurerName, '網路恢復後的冒險者');
  assert.deepEqual(h.coordinator.getMemberState(), recovered.state);
  assert.equal(h.local.getItem('lifequest_state'), h.guestSave);
});

test('Member retry UI preserves the active projection and uses the safe reload message mapper', () => {
  const app = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
  const start = app.indexOf("elements.authMemberRetry?.addEventListener('click'");
  const end = app.indexOf('\n  });', start) + 6;
  const handler = app.slice(start, end);
  assert.match(handler, /state:\s*activeMember\?\.state/);
  assert.match(handler, /safeMemberReloadMessage/);
  assert.doesNotMatch(handler, /error\?\.message\s*\|\|/);
});
