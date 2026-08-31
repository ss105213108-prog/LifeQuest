const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Auth = require('../memberAuth.js');
const Application = require('../gameApplication.js');
const GuestMode = require('../guestMode.js');
const { createHarness, fixture, app, clone } = require('./helpers/member-economy-ui-harness.cjs');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

// First-paint contract: it must work before any JavaScript or external CSS.
// Async startup tests below complement this static markup/style guard.
test('initial HTML hides gameplay before JavaScript and exposes only the safe boot status', () => {
  assert.match(html, /<body\s+class="app-booting">/,
    'the delivered HTML must start gated, not hide Guest after startup');
  const style = html.match(/<style id="initial-boot-style">([\s\S]*?)<\/style>/);
  assert.ok(style, 'the first-paint guard is inline, independent of external styles');
  assert.ok(html.indexOf(style[0]) < html.indexOf('<script src='));
  assert.match(style[1], /body\.app-booting > :not\(#initial-boot\)[\s\S]*visibility: hidden !important/);
  assert.match(style[1], /#initial-boot\[hidden\][\s\S]*display: none !important/);
  const boot = html.match(/<div id="initial-boot"[^>]*>([\s\S]*?)<\/div>/);
  assert.ok(boot);
  assert.match(boot[0], /role="status"/);
  assert.match(boot[1], /LifeQuest/);
  assert.match(boot[1], /正在確認冒險者卷宗/);
  assert.doesNotMatch(boot[1], /測試冒險者|今日主線任務/);
});

function section(start, end) {
  const a = app.indexOf(start), b = app.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, 'production startup section exists');
  return app.slice(a, b);
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

// Exercise the actual DOMContentLoaded callback, route selection, Auth
// coordinator, Cloud normalization and Guest repository. DOM and remote I/O
// are isolated; unrelated chart/coach/settlement rendering is not under test.
async function startupHarness(t, { guest = false, exited = false, member = false, cloudFailure = false } = {}) {
  const h = await createHarness({ autoStart: false, gameplayProjection: true });
  h.coordinator.stop();
  const { context, elements, local } = h;
  const Element = elements.authOverlay.constructor;
  for (const key of ['authHomeView', 'authLoginView', 'authRegisterView', 'authMemberView',
    'authMemberName', 'authMemberMainQuest', 'authMemberStatus', 'authMemberRetry',
    'memberOnboardingStatus', 'memberOnboardingControls', 'authMemberPhase3Actions', 'memberWorkspaceReturn']) {
    elements[key] = new Element();
  }
  elements.authMemberView.hidden = true;
  const bootStatus = new Element();
  bootStatus.hidden = false;
  context.document.body.classList.add('app-booting');
  context.document.getElementById = id => id === 'initial-boot' ? bootStatus : null;
  context.window.requestAnimationFrame = callback => callback();
  context.window.LifeQuestApplication = Application;
  context.memberLogoutUi = null;
  const defaults = vm.runInContext('JSON.parse(JSON.stringify(DEFAULT_STATE))', context);
  local.removeItem('lifequest_state');
  if (guest) {
    const save = clone(defaults);
    save.onboarding.authChoice = 'guest';
    save.character.goal = 'sleep';
    save.character.name = '既有訪客';
    save.character.gold = 321;
    local.setItem('lifequest_state', JSON.stringify(save));
    local.setItem('lifequest_app_mode', exited ? 'landing' : 'guest');
  }
  const guestBefore = local.getItem('lifequest_state');
  context.guestModeController = GuestMode.createGuestModeController({ storage: local });
  context.gameApplication = new Application.GameApplication({
    repository: new Application.LocalStorageRepository({ storage: local, key: 'lifequest_state', fallbackState: defaults })
  });
  const localRead = deferred(), sessionRead = deferred(), cloudRead = deferred();
  context.gameApplicationReady = localRead.promise.then(() => context.gameApplication.initialize());
  context.initialStorageStatus = null;
  for (const name of ['showPersistenceWarning', 'initializeRpgInformationArchitecture', 'bindUIEvents',
    'applyPendingMainQuest', 'updateStatusDuration', 'evaluateAchievements', 'initAllCharts', 'triggerAICoach']) {
    context[name] = () => {};
  }
  context.getTodayDateString = () => '2026-08-31';
  context.evaluateHabitBossCandidates = () => ({ summoned: false });
  context.saveState = async () => {};
  const cloudState = fixture();
  const sessionValue = { access_token: 'test-only-boot', user: { id: 'boot-member' } };
  let session = member ? sessionValue : null;
  const calls = { session: 0, cloud: 0, commands: 0, signOut: [] };
  const client = { auth: {
    async getSession() { calls.session++; await sessionRead.promise; return { data: { session }, error: null }; },
    async signOut(options) { calls.signOut.push(options); session = null; return { error: null }; },
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } })
  } };
  context.window.LifeQuestSupabase = { getSupabaseClient: () => client };
  context.window.LifeQuestMemberAuth = { ...Auth, createMemberAuthCoordinator: options =>
    Auth.createMemberAuthCoordinator({ ...options, fetchImpl: async (_url, request) => {
      if (request.method !== 'GET') { calls.commands++; throw new Error('Unexpected startup mutation'); }
      calls.cloud++;
      await cloudRead.promise;
      if (cloudFailure) throw new TypeError('Failed to fetch');
      return { ok: true, status: 200, json: async () => ({ ok: true, state: clone(cloudState) }) };
    } }) };
  vm.runInContext(
    section('function checkOnboarding()', 'window.showAuthLoginPage') +
    section('function getGoalName(', '\n}\n') + '\n}\n' +
    section('function setAuthStatus(', 'function createMemberGameplayProjection(') +
    section('async function restoreGuestEntranceAfterLogout(', 'function clearMemberRuntimeForLogin('), context);
  let start;
  context.document.addEventListener = (event, callback) => { if (event === 'DOMContentLoaded') start = callback; };
  vm.runInContext(section("document.addEventListener('DOMContentLoaded'", 'function applyPendingMainQuest('), context);
  t.after(() => context.memberAuthCoordinator?.stop());
  return { ...h, bootStatus, calls, start, localRead, sessionRead, cloudRead, guestBefore,
    gated: () => context.document.body.classList.contains('app-booting'),
    async finish() { localRead.resolve(); sessionRead.resolve(); cloudRead.resolve(); } };
}

test('fresh startup stays gated through LocalStorage and Session reads, then shows the entrance', async t => {
  const h = await startupHarness(t);
  const pending = h.start();
  await tick();
  assert.equal(h.gated(), true);
  assert.equal(h.bootStatus.hidden, false);
  assert.equal(h.calls.session, 0, 'Guest repository hydration precedes Auth check');
  h.localRead.resolve();
  await tick();
  assert.equal(h.calls.session, 1);
  assert.equal(h.gated(), true, 'do not reveal Guest while session is unknown');
  h.sessionRead.resolve();
  await pending;
  assert.equal(h.gated(), false);
  assert.equal(h.bootStatus.hidden, true);
  assert.equal(h.elements.authOverlay.classList.contains('active'), true);
  assert.equal(h.context.activeMember, null);
  assert.equal(h.calls.cloud, 0);
  assert.equal(h.calls.commands, 0);
});

test('existing Guest and Guest F5 restore keep the original save and reveal Guest only after Auth resolution', async t => {
  // Two independent startup runtimes represent opening/reloading the same save.
  for (let load = 0; load < 2; load++) {
    const h = await startupHarness(t, { guest: true });
    const pending = h.start();
    h.localRead.resolve();
    await tick();
    assert.equal(h.gated(), true);
    h.sessionRead.resolve();
    await pending;
    assert.equal(h.gated(), false);
    assert.equal(h.elements.authOverlay.classList.contains('active'), false);
    assert.equal(h.context.state.character.name, '既有訪客');
    assert.equal(h.context.state.character.gold, 321);
    assert.equal(h.local.getItem('lifequest_state'), h.guestBefore);
    assert.equal(h.calls.cloud, 0);
  }
});

test('a preserved Guest save with explicit exit still returns to the entrance on reload', async t => {
  const h = await startupHarness(t, { guest: true, exited: true });
  const pending = h.start();
  await h.finish();
  await pending;
  assert.equal(h.gated(), false);
  assert.equal(h.elements.authOverlay.classList.contains('active'), true);
  assert.equal(h.local.getItem('lifequest_state'), h.guestBefore);
});

test('Member reload waits for full Cloud bootstrap before revealing the authoritative camp', async t => {
  const h = await startupHarness(t, { guest: true, member: true });
  const pending = h.start();
  h.localRead.resolve();
  h.sessionRead.resolve();
  await tick();
  assert.equal(h.calls.cloud, 1);
  assert.equal(h.gated(), true);
  assert.equal(h.context.document.body.classList.contains('member-gameplay-mode'), false);
  h.cloudRead.resolve();
  await pending;
  assert.equal(h.gated(), false);
  assert.equal(h.bootStatus.hidden, true);
  assert.equal(h.context.document.body.classList.contains('member-gameplay-mode'), true);
  assert.equal(h.elements.authOverlay.classList.contains('active'), false);
  assert.equal(h.context.state.character.name, '隔離測試員');
  assert.equal(h.context.activeMember.state.meta.repositoryVersion, 20);
  assert.equal(h.local.getItem('lifequest_state'), h.guestBefore);
  assert.equal(h.calls.commands, 0);
});

test('Member bootstrap failure reveals the existing safe dossier retry page, never Guest gameplay', async t => {
  const h = await startupHarness(t, { guest: true, member: true, cloudFailure: true });
  const pending = h.start();
  await h.finish();
  await pending;
  assert.equal(h.gated(), false);
  assert.equal(h.elements.authOverlay.classList.contains('active'), true);
  assert.equal(h.elements.authMemberView.hidden, false);
  assert.equal(h.context.document.body.classList.contains('member-gameplay-mode'), false);
  assert.equal(h.context.activeMember.id, 'boot-member');
  assert.equal(h.elements.authMemberRetry.hidden, false);
  assert.equal(h.local.getItem('lifequest_state'), h.guestBefore);
  assert.equal(h.calls.commands, 0);
});

test('logout after initial Member restore returns home without reinstating boot or changing Guest save', async t => {
  const h = await startupHarness(t, { guest: true, member: true });
  const pending = h.start();
  await h.finish();
  await pending;
  await h.context.memberAuthCoordinator.logout();
  assert.equal(h.gated(), false);
  assert.equal(h.bootStatus.hidden, true);
  assert.equal(h.context.activeMember, null);
  assert.equal(h.elements.authOverlay.classList.contains('active'), true);
  assert.equal(h.elements.authHomeView.hidden, false);
  assert.equal(h.local.getItem('lifequest_state'), h.guestBefore);
  assert.equal(h.calls.signOut.length, 1);
  assert.equal(h.calls.signOut[0].scope, 'local');
  assert.equal(h.calls.commands, 0);
});
