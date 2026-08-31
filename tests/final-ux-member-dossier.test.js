const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Auth = require('../memberAuth.js');
const LogoutUi = require('../memberLogoutUi.js');
const GuestMode = require('../guestMode.js');
const Application = require('../gameApplication.js');
const { createHarness, fixture, app, clone } = require('./helpers/member-economy-ui-harness.cjs');

function section(start, end) {
  const a = app.indexOf(start), b = app.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, 'production UI section exists');
  return app.slice(a, b);
}

// Real UI handlers/renderers, Auth coordinator, projection, repository and
// transport; only DOM, Auth service, HTTP and browser storage are isolated.
async function navigationHarness(t, { restored = false, onboarding = true } = {}) {
  const h = await createHarness({ autoStart: false, gameplayProjection: true });
  h.coordinator.stop();
  const { context, elements, local } = h;
  const Element = elements.authOverlay.constructor;
  function node() {
    const element = new Element();
    element.listeners = {};
    element.addEventListener = (type, fn) => { element.listeners[type] = fn; };
    element.fire = type => element.listeners[type]({ preventDefault() {} });
    element.focus = () => {};
    element.textContent = '';
    return element;
  }
  for (const key of ['authHomeView', 'authLoginView', 'authRegisterView', 'authMemberView',
    'authLoginForm', 'authAccount', 'authPassword', 'authLoginSubmit', 'authMemberName',
    'authMemberMainQuest', 'authMemberStatus', 'authMemberRetry', 'authLogoutSubmit',
    'memberOnboardingStatus', 'memberOnboardingControls', 'authMemberPhase3Actions', 'memberWorkspaceReturn']) {
    elements[key] = node();
  }
  elements.authAccount.value = 'navigation@example.invalid';
  elements.authPassword.value = 'test-only';
  elements.memberWorkspaceReturn.hidden = true;
  elements.campStages = ['quest', 'log', 'settlement'].map(name => Object.assign(node(), { dataset: { campStage: name } }));
  elements.authOverlay.classList.add('active');
  context.window.requestAnimationFrame = callback => callback();
  context.window.LifeQuestApplication = Application;
  context.window.LifeQuestMemberLogoutUi = LogoutUi;
  context.memberLogoutUi = null;
  context.guestModeController = GuestMode.createGuestModeController({ storage: local });
  const guest = vm.runInContext('JSON.parse(JSON.stringify(DEFAULT_STATE))', context);
  guest.character.gold = 987;
  local.setItem('lifequest_state', JSON.stringify(guest));
  const guestBefore = local.getItem('lifequest_state');
  context.gameApplication = new Application.GameApplication({
    repository: new Application.LocalStorageRepository({ storage: local, key: 'lifequest_state' })
  });
  vm.runInContext(
    section('function setAuthEntranceView(', 'window.showAuthLoginPage') +
    section('function getGoalName(', '\n}\n') + '\n}\n' +
    section('function setAuthStatus(', 'function createMemberGameplayProjection(') +
    section('function returnToMemberBootstrap(', 'function clearMemberRuntimeForLogin(') +
    section('function setCampStage(', 'function populateDailyLogForm(') +
    section('function bindMemberAuthForms(', 'function bindUIEvents('), context);
  // Bind the unchanged right-header dossier entrance through production wiring.
  const entry = app.match(/elements\.memberWorkspaceReturn\?\.addEventListener\('click', returnToMemberBootstrap\);/);
  assert.ok(entry);
  vm.runInContext(entry[0], context);
  const sessionValue = { access_token: 'test-only-navigation', user: { id: 'navigation-member' } };
  let session = restored ? sessionValue : null;
  const server = { state: fixture(), read: null, failed: false };
  server.state.meta.repositoryVersion = 82;
  server.state.member.onboardingCompleted = onboarding;
  if (!onboarding) server.state.member.mainQuestId = null;
  const posts = [], expectedVersions = [], signOuts = [];
  const client = { auth: {
    getSession: async () => ({ data: { session }, error: null }),
    signInWithPassword: async () => { session = sessionValue; return { data: { session }, error: null }; },
    signOut: async options => { signOuts.push(options); session = null; return { error: null }; },
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } })
  } };
  context.window.LifeQuestSupabase = { getSupabaseClient: () => client };
  context.window.LifeQuestMemberAuth = { ...Auth, createMemberAuthCoordinator: options =>
    Auth.createMemberAuthCoordinator({ ...options, fetchImpl: async (_url, request) => {
      if (request.method === 'GET') {
        if (server.read) await server.read;
        if (server.failed) throw new TypeError('Failed to fetch');
      } else {
        posts.push(JSON.parse(request.body));
        expectedVersions.push(Number(request.headers['If-Match']));
        server.state.meta.repositoryVersion++;
      }
      return { ok: true, status: 200, json: async () => ({ ok: true, state: clone(server.state),
        ...(request.method === 'GET' ? {} : { result: { operationId: posts.at(-1).operationId } }) }) };
    } }) };
  const initial = await context.initializeMemberAuth();
  assert.equal(initial.ok, true, 'isolated Auth service initialized');
  const coordinator = context.memberAuthCoordinator;
  t.after(() => coordinator.stop());
  context.bindMemberAuthForms();
  return { ...h, coordinator, initial, server, posts, expectedVersions, signOuts, guestBefore,
    login: () => elements.authLoginForm.fire('submit'),
    currentTab: () => elements.navTabs.find(tab => tab.classList.contains('active'))?.dataset.tab };
}

test('Login form waits for Cloud bootstrap then opens the existing camp instead of the dossier', async t => {
  const h = await navigationHarness(t);
  h.navigation.setItem('currentMemberView', 'rules');
  let finishRead;
  h.server.read = new Promise(resolve => { finishRead = resolve; });
  const pending = h.login();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.context.document.body.classList.contains('member-gameplay-mode'), false);
  finishRead();
  await pending;
  assert.equal(h.context.document.body.classList.contains('member-gameplay-mode'), true);
  assert.equal(h.currentTab(), 'dashboard');
  assert.equal(h.elements.campStages.find(stage => !stage.hidden).dataset.campStage, 'quest');
  assert.equal(h.elements.authOverlay.classList.contains('active'), false);
  assert.equal(h.elements.memberWorkspaceReturn.hidden, false);
  assert.equal(h.coordinator.getMemberState().meta.repositoryVersion, 82);
  assert.equal(h.elements.authLoginSubmit.disabled, false);
  assert.equal(h.posts.length, 0);
  assert.equal(h.local.getItem('lifequest_state'), h.guestBefore);
});

test('Dossier omits its version display while keeping member identity, quest and management controls', async t => {
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  const dossier = html.slice(html.indexOf('id="auth-member-view"'), html.indexOf('<!-- onboarding 第二步'));
  assert.doesNotMatch(dossier, /卷宗版本|auth-member-version/);
  for (const id of ['auth-member-name', 'auth-member-main-quest', 'auth-member-retry', 'auth-logout-submit']) {
    assert.ok(dossier.includes('id="' + id + '"'));
  }
  for (const area of ['draft', 'habits', 'rules']) assert.ok(dossier.includes('data-member-workspace="' + area + '"'));
  const h = await navigationHarness(t);
  await h.login();
  await h.elements.memberWorkspaceReturn.fire('click');
  assert.equal(h.elements.authMemberName.textContent, '隔離測試員');
  assert.equal(h.elements.authMemberMainQuest.textContent, '改善睡眠');
  assert.equal(h.coordinator.getMemberState().meta.repositoryVersion, 82);
});

test('Header dossier entry opens the existing page and its logout returns home without losing Guest save', async t => {
  const h = await navigationHarness(t);
  await h.login();
  assert.equal(h.elements.memberWorkspaceReturn.hidden, false);
  await h.elements.memberWorkspaceReturn.fire('click');
  assert.equal(h.elements.authOverlay.classList.contains('active'), true);
  assert.equal(h.elements.authMemberView.hidden, false);
  assert.equal(h.context.document.body.classList.contains('member-gameplay-mode'), false);
  assert.equal(h.elements.authMemberPhase3Actions.hidden, false);
  await h.elements.authLogoutSubmit.fire('click');
  assert.deepEqual(h.signOuts, [{ scope: 'local' }]);
  assert.equal(h.coordinator.getSession(), null);
  assert.equal(h.context.activeMember, null);
  assert.equal(h.elements.authHomeView.hidden, false);
  assert.equal(h.elements.authMemberView.hidden, true);
  assert.equal(h.local.getItem('lifequest_state'), h.guestBefore);
  assert.equal(h.navigation.getItem('currentMemberView'), null);
});

test('Hidden dossier version remains authoritative and is sent as expectedVersion on Member commands', async t => {
  const h = await navigationHarness(t);
  await h.login();
  await h.elements.memberWorkspaceReturn.fire('click');
  assert.equal(h.context.activeMember.state.meta.repositoryVersion, 82);
  const result = await h.coordinator.setRuleEnabled({ ruleId: 'rule_1', enabled: false });
  assert.equal(result.ok, true);
  assert.equal(h.posts.length, 1);
  assert.equal(h.expectedVersions[0], 82);
  assert.equal(Object.hasOwn(h.posts[0], 'expectedVersion'), false);
  assert.equal(h.coordinator.getMemberState().meta.repositoryVersion, 83);
  assert.equal(h.context.activeMember.state.meta.repositoryVersion, 83);
});

test('F5 Session Restore still loads Cloud state and restores the legal saved Member gameplay page', async t => {
  const h = await navigationHarness(t, { restored: true });
  h.navigation.setItem('currentMemberView', 'rules');
  assert.equal(h.context.restoreMemberGameplayWorkspace(h.initial), true);
  assert.equal(h.currentTab(), 'rules');
  assert.equal(h.elements.authOverlay.classList.contains('active'), false);
  assert.equal(h.coordinator.getMemberState().meta.repositoryVersion, 82);
  assert.equal(h.context.state.character.name, '隔離測試員');
  assert.equal(h.local.getItem('lifequest_state'), h.guestBefore);
  assert.equal(h.posts.length, 0);
});

test('Login Cloud failure never enters camp or presents Guest state as a Member projection', async t => {
  const h = await navigationHarness(t);
  h.server.failed = true;
  await h.login();
  assert.equal(h.context.document.body.classList.contains('member-gameplay-mode'), false);
  assert.equal(h.coordinator.getMemberState(), null);
  assert.equal(h.elements.authOverlay.classList.contains('active'), true);
  assert.equal(h.elements.authLoginSubmit.disabled, false);
  assert.equal(h.elements.authLoginStatus.dataset.status, 'error');
  assert.equal(h.local.getItem('lifequest_state'), h.guestBefore);
  assert.equal(h.posts.length, 0);
});

test('A Member without onboarding remains in the existing main-quest selection flow', async t => {
  const h = await navigationHarness(t, { onboarding: false });
  await h.login();
  assert.equal(h.context.document.body.classList.contains('member-gameplay-mode'), false);
  assert.equal(h.elements.onboardingOverlay.classList.contains('active'), true);
  assert.equal(h.coordinator.getMemberState().member.onboardingCompleted, false);
  assert.equal(h.coordinator.getMemberState().meta.repositoryVersion, 82);
  assert.equal(h.local.getItem('lifequest_state'), h.guestBefore);
  assert.equal(h.posts.length, 0);
});
