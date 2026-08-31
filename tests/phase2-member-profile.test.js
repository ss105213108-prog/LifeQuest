const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const BackendContract = require('../backendContract.js');
const Application = require('../gameApplication.js');
const MemberAuth = require('../memberAuth.js');

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
    value(key) { return values.get(key); }
  };
}

function createAuthClient(session) {
  return {
    auth: {
      async getSession() { return { data: { session }, error: null }; },
      onAuthStateChange() {
        return { data: { subscription: { unsubscribe() {} } } };
      },
      async signOut() { session = null; return { error: null }; }
    }
  };
}

function memberState({ version = 1, questId = null } = {}) {
  return {
    meta: { repositoryVersion: version, operations: [] },
    member: {
      adventurerName: '雲端冒險者',
      onboardingStatus: questId ? 'main_quest_selected' : 'profile_initialized',
      onboardingCompleted: Boolean(questId),
      mainQuestId: questId,
      dailyBudget: 500,
      timeZone: 'Asia/Taipei'
    }
  };
}

test('Phase 2 contract accepts only four quest ids and safe profile fields', () => {
  const validQuest = BackendContract.createCommandEnvelope({
    type: 'SELECT_MAIN_QUEST',
    operationId: 'main-quest-operation-0001',
    payload: { questId: 'sleep' }
  });
  const forgedQuest = { ...validQuest, payload: { questId: 'sleep', userId: 'forged' } };
  const invalidQuest = { ...validQuest, payload: { questId: 'unknown' } };
  const validProfile = BackendContract.createCommandEnvelope({
    type: 'UPDATE_PROFILE',
    operationId: 'profile-update-operation-0001',
    payload: { adventurerName: '測試冒險者', dailyBudget: 800 }
  });
  const forgedProfile = { ...validProfile, payload: { mainQuestId: 'sleep', repositoryVersion: 99 } };

  assert.equal(BackendContract.validateCommandEnvelope(validQuest).ok, true);
  assert.equal(BackendContract.validateCommandEnvelope(forgedQuest).reason, 'invalid_payload');
  assert.equal(BackendContract.validateCommandEnvelope(invalidQuest).reason, 'invalid_payload');
  assert.equal(BackendContract.validateCommandEnvelope(validProfile).ok, true);
  assert.equal(BackendContract.validateCommandEnvelope(forgedProfile).reason, 'invalid_payload');
});

test('profile contract rejects invalid names, budgets and server-managed fields', () => {
  const command = payload => BackendContract.createCommandEnvelope({
    type: 'UPDATE_PROFILE',
    operationId: `profile-update-${Math.random().toString(16).slice(2)}`,
    payload
  });

  assert.equal(BackendContract.validateCommandEnvelope(command({ adventurerName: 'A' })).reason, 'invalid_payload');
  assert.equal(BackendContract.validateCommandEnvelope(command({ dailyBudget: 0 })).reason, 'invalid_payload');
  assert.equal(BackendContract.validateCommandEnvelope(command({ dailyBudget: 1.5 })).reason, 'invalid_payload');
  assert.equal(BackendContract.validateCommandEnvelope(command({ onboardingCompleted: true })).reason, 'invalid_payload');
  assert.equal(BackendContract.validateCommandEnvelope(command({})).reason, 'invalid_payload');
});

test('member onboarding submits only quest intent and adopts authoritative cloud state', async () => {
  const guestSave = JSON.stringify({ character: { goal: 'sleep' } });
  const storage = createStorage({ lifequest_state: guestSave });
  const session = { access_token: 'member-token', user: { id: 'member-a' } };
  const requests = [];
  let cloudState = memberState();
  const coordinator = MemberAuth.createMemberAuthCoordinator({
    supabaseClient: createAuthClient(session),
    projectUrl: 'https://jwpbwlrdzmfzjlbrktlc.supabase.co',
    publishableKey: 'sb_publishable_example',
    storage,
    contract: BackendContract,
    application: Application,
    fetchImpl: async (_url, options) => {
      requests.push(options);
      if (options.method === 'GET') {
        return { ok: true, status: 200, async json() { return { ok: true, state: cloudState }; } };
      }
      const command = JSON.parse(options.body);
      assert.equal(command.type, 'SELECT_MAIN_QUEST');
      assert.deepEqual(command.payload, { questId: 'spending' });
      assert.equal(command.userId, undefined);
      cloudState = memberState({ version: 2, questId: 'spending' });
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            ok: true,
            operationId: command.operationId,
            repositoryVersion: 2,
            state: cloudState,
            result: { questId: 'spending', onboardingCompleted: true }
          };
        }
      };
    }
  });

  const loaded = await coordinator.start();
  assert.equal(loaded.state.member.mainQuestId, null);
  const selected = await coordinator.selectMainQuest({ questId: 'spending' });

  assert.equal(selected.ok, true);
  assert.equal(selected.state.member.mainQuestId, 'spending');
  assert.equal(selected.state.meta.repositoryVersion, 2);
  assert.equal(storage.value('lifequest_state'), guestSave);
  assert.equal(requests.filter(request => request.method === 'POST').length, 1);
});

test('cloud load failure rejects instead of reading the guest save', async () => {
  const guestSave = JSON.stringify({ character: { goal: 'exercise' } });
  const storage = createStorage({ lifequest_state: guestSave });
  const session = { access_token: 'member-token', user: { id: 'member-a' } };
  const coordinator = MemberAuth.createMemberAuthCoordinator({
    supabaseClient: createAuthClient(session),
    projectUrl: 'https://jwpbwlrdzmfzjlbrktlc.supabase.co',
    publishableKey: 'sb_publishable_example',
    storage,
    contract: BackendContract,
    application: Application,
    fetchImpl: async () => ({
      ok: false,
      status: 503,
      async json() { return { ok: false, errorCode: 'INTERNAL_ERROR', retryable: true }; }
    })
  });

  await assert.rejects(() => coordinator.start(), error => error.code === 'INTERNAL_ERROR');
  assert.equal(coordinator.getMemberState(), null);
  assert.equal(storage.value('lifequest_state'), guestSave);
});

test('safe profile update sends only allowed intent and adopts the server result', async () => {
  const session = { access_token: 'member-token', user: { id: 'member-a' } };
  const posted = [];
  let cloudState = memberState({ version: 2, questId: 'sleep' });
  const coordinator = MemberAuth.createMemberAuthCoordinator({
    supabaseClient: createAuthClient(session),
    projectUrl: 'https://jwpbwlrdzmfzjlbrktlc.supabase.co',
    publishableKey: 'sb_publishable_example',
    storage: createStorage(),
    contract: BackendContract,
    application: Application,
    fetchImpl: async (_url, options) => {
      if (options.method === 'GET') {
        return { ok: true, status: 200, async json() { return { ok: true, state: cloudState }; } };
      }
      const command = JSON.parse(options.body);
      posted.push(command);
      cloudState = {
        ...memberState({ version: 3, questId: 'sleep' }),
        member: { ...memberState({ version: 3, questId: 'sleep' }).member, adventurerName: '新名稱', dailyBudget: 900 }
      };
      return {
        ok: true,
        status: 200,
        async json() { return { ok: true, state: cloudState, result: { updatedFields: ['adventurerName', 'dailyBudget'] } }; }
      };
    }
  });

  await coordinator.start();
  const result = await coordinator.updateProfile({ adventurerName: '新名稱', dailyBudget: 900 });

  assert.equal(result.ok, true);
  assert.deepEqual(posted[0].payload, { adventurerName: '新名稱', dailyBudget: 900 });
  assert.equal(posted[0].userId, undefined);
  assert.equal(result.state.member.adventurerName, '新名稱');
  assert.equal(result.state.meta.repositoryVersion, 3);
});

test('reload obtains the returning member quest from cloud instead of a guest goal', async () => {
  const guestSave = JSON.stringify({ character: { goal: 'exercise' } });
  const storage = createStorage({ lifequest_state: guestSave });
  const session = { access_token: 'member-token', user: { id: 'member-a' } };
  let loads = 0;
  const coordinator = MemberAuth.createMemberAuthCoordinator({
    supabaseClient: createAuthClient(session),
    projectUrl: 'https://jwpbwlrdzmfzjlbrktlc.supabase.co',
    publishableKey: 'sb_publishable_example',
    storage,
    contract: BackendContract,
    application: Application,
    fetchImpl: async () => {
      loads += 1;
      return {
        ok: true,
        status: 200,
        async json() { return { ok: true, state: memberState({ version: 4, questId: 'learning' }) }; }
      };
    }
  });

  await coordinator.start();
  const reloaded = await coordinator.reloadMember();

  assert.equal(reloaded.state.member.mainQuestId, 'learning');
  assert.equal(loads, 2);
  assert.equal(storage.value('lifequest_state'), guestSave);
});

test('Phase 2 migration and Edge Function keep server-managed fields behind commands', () => {
  const root = path.resolve(__dirname, '..');
  const sql = fs.readFileSync(
    path.join(root, 'supabase/migrations/20260822233000_phase_2_member_profile_main_quest.sql'),
    'utf8'
  );
  const hardeningSql = fs.readFileSync(
    path.join(root, 'supabase/migrations/20260822234000_phase_2_profile_budget_validation_hardening.sql'),
    'utf8'
  );
  const edge = fs.readFileSync(path.join(root, 'supabase/functions/lifequest-command/index.ts'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

  assert.match(sql, /add column onboarding_completed boolean not null default false/i);
  assert.match(sql, /main_quest_code in \('sleep', 'spending', 'exercise', 'learning'\)/i);
  assert.match(sql, /timezone = 'Asia\/Taipei'/i);
  assert.match(sql, /revoke insert, update, delete on public\.profiles[\s\S]*authenticated/i);
  assert.match(sql, /grant execute on function public\.select_main_quest[\s\S]*to service_role/i);
  assert.match(sql, /primary|command_operations/i);
  assert.doesNotMatch(sql, /create table .*daily|create table .*habit|\bexp\b|\bgold\b|\bgems\b|\bboss\b/i);
  assert.match(hardeningSql, /jsonb_typeof\(v_payload -> 'dailyBudget'\) <> 'number'/i);
  assert.match(hardeningSql, /revoke all on function public\.update_member_profile[\s\S]*authenticated/i);

  assert.match(edge, /SELECT_MAIN_QUEST:\s*'select_main_quest'/);
  assert.match(edge, /UPDATE_PROFILE:\s*'update_member_profile'/);
  assert.match(edge, /p_user_id:\s*userData\.user\.id/);
  assert.doesNotMatch(edge, /command\.userId|payload\.userId/);
  assert.match(app, /memberAuthCoordinator\.selectMainQuest\(\{ questId: goal \}\)/);
  assert.match(app, /if \(activeMember\)[\s\S]*memberAuthCoordinator\.selectMainQuest/);
});

test('Phase 2 SQL preserves idempotency and repository version rules', () => {
  const root = path.resolve(__dirname, '..');
  const sql = fs.readFileSync(
    path.join(root, 'supabase/migrations/20260822233000_phase_2_member_profile_main_quest.sql'),
    'utf8'
  );

  assert.match(sql, /on conflict \(user_id, operation_id\) do nothing/gi);
  assert.match(sql, /OPERATION_ID_REUSED/);
  assert.match(sql, /OPERATION_IN_PROGRESS/);
  assert.match(sql, /repository_version = repository_version \+ 1/gi);
  assert.match(sql, /v_existing\.result \|\| jsonb_build_object\('duplicate', true\)/gi);
  assert.match(sql, /p_expected_version[\s\S]*VERSION_CONFLICT/gi);
});

test('Phase 2 payload validation uses a PostgreSQL-supported JSON key count', () => {
  const root = path.resolve(__dirname, '..');
  const repairSql = fs.readFileSync(
    path.join(root, 'supabase/migrations/20260822235000_phase_2_jsonb_payload_count_fix.sql'),
    'utf8'
  );

  assert.match(repairSql, /private\.select_main_quest\(uuid,jsonb,bigint\)/i);
  assert.match(repairSql, /private\.update_member_profile\(uuid,jsonb,bigint\)/i);
  assert.match(repairSql, /select count\(\*\) from jsonb_object_keys/i);
  assert.match(repairSql, /pg_get_functiondef/i);
});

test('member onboarding UI preserves retry, logout, and authoritative member workspace entry', () => {
  const root = path.resolve(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

  assert.match(html, /id="auth-member-retry"[^>]*hidden/);
  assert.match(html, /id="member-onboarding-logout"/);
  assert.match(html, /id="auth-member-main-quest"/);
  assert.match(app, /elements\.authOverlay\.classList\.toggle\('active', showMemberView\)/);
  assert.match(app, /elements\.onboardingOverlay\.classList\.toggle\('active', !showMemberView\)/);
  assert.match(app, /會員卷宗、角色資源、每日結算與習慣事件均由公會伺服器核定/);
});
