const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const GuestMode = require('../guestMode.js');

class TrackingStorage {
  constructor(entries = {}) {
    this.values = new Map(Object.entries(entries));
    this.removedKeys = [];
    this.clearCount = 0;
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }

  removeItem(key) {
    this.removedKeys.push(key);
    this.values.delete(key);
  }

  clear() {
    this.clearCount += 1;
    this.values.clear();
  }
}

function createRichGuestSave() {
  return JSON.stringify({
    character: { name: '測試冒險者', exp: 88, gold: 320, gems: 5, hp: 42 },
    habits: [{ id: 'water', count: 3 }],
    dailyLogs: [{ date: '2026-08-24', sleep: 7.5 }],
    boss: { id: 'sleep-nightmare', hp: 40 },
    achievements: [{ id: 'first-step', unlocked: true }],
    onboarding: { authChoice: 'guest' }
  });
}

test('leaving guest mode changes only app mode and preserves the complete guest save', () => {
  const guestSave = createRichGuestSave();
  const storage = new TrackingStorage({
    lifequest_state: guestSave,
    lifequest_app_mode: 'guest'
  });
  const controller = GuestMode.createGuestModeController({ storage });

  controller.exitGuest();

  assert.equal(controller.getMode(), 'landing');
  assert.equal(storage.getItem('lifequest_state'), guestSave);
  assert.equal(storage.clearCount, 0);
  assert.deepEqual(storage.removedKeys, []);
});

test('guest re-entry preserves the save and switches only the separate app mode', () => {
  const guestSave = createRichGuestSave();
  const storage = new TrackingStorage({
    lifequest_state: guestSave,
    lifequest_app_mode: 'landing'
  });
  const controller = GuestMode.createGuestModeController({ storage });

  controller.enterGuest();

  assert.equal(controller.getMode(), 'guest');
  assert.equal(storage.getItem('lifequest_state'), guestSave);
  assert.equal(storage.clearCount, 0);
  assert.deepEqual(storage.removedKeys, []);
});

test('legacy guest saves remain in guest mode until the user explicitly leaves', () => {
  const storage = new TrackingStorage({ lifequest_state: createRichGuestSave() });
  const controller = GuestMode.createGuestModeController({
    storage,
    fallbackMode: 'guest'
  });

  assert.equal(controller.getMode(), 'guest');
  assert.equal(storage.getItem('lifequest_app_mode'), null);
});

test('guest exit UI and application wiring preserve repository hydration and member isolation', () => {
  const html = fs.readFileSync(path.join(projectRoot, 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(projectRoot, 'app.js'), 'utf8');

  assert.match(html, /id="guest-exit-button"[^>]*onclick="requestGuestExit\(\)"/);
  assert.match(html, /離開訪客模式/);
  assert.match(html, /<script src="guestMode\.js\?v=1"><\/script>/);
  assert.match(app, /window\.requestGuestExit\s*=\s*function/);
  assert.match(app, /你的訪客冒險紀錄會保留/);
  assert.match(app, /guestModeController\.exitGuest\(\)/);
  assert.match(app, /guestModeController\.enterGuest\(\)/);
  assert.match(app, /state\s*=\s*await gameApplication\.initialize\(\)/);
  assert.match(app, /if \(method !== 'guest'\) return;\s+if \(activeMember\) return/);

  const exitStart = app.indexOf('window.requestGuestExit');
  const exitEnd = app.indexOf('function getAuthMethodLabel', exitStart);
  const exitFlow = app.slice(exitStart, exitEnd);
  assert.doesNotMatch(exitFlow, /localStorage\.clear\(/);
  assert.doesNotMatch(exitFlow, /removeItem\(STATE_STORAGE_KEY\)/);
  assert.doesNotMatch(exitFlow, /gameApplication\.clear\(/);

  const logoutStart = app.indexOf('async function restoreGuestEntranceAfterLogout');
  const logoutEnd = app.indexOf('async function initializeMemberAuth', logoutStart);
  const memberLogoutFlow = app.slice(logoutStart, logoutEnd);
  assert.match(memberLogoutFlow, /guestModeController\.exitGuest\(\)/);
  assert.match(memberLogoutFlow, /const guestState = await gameApplication\.initialize\(\);\s*if \(memberAuthCoordinator\?\.getSession\?\.\(\)\?\.user\) return;\s*state = guestState;/,
    'hydrate existing Guest save, but never replace a newly authenticated Member');
  assert.doesNotMatch(memberLogoutFlow, /localStorage\.clear\(|removeItem\(STATE_STORAGE_KEY\)/);
});

function runtimeGuestApplication(storage) {
  const vm = require('node:vm');
  const Core = require('../lifequestCore.js');
  const Contract = require('../backendContract.js');
  const { GameApplication, LocalStorageRepository } = require('../gameApplication.js');
  const app = fs.readFileSync(path.join(projectRoot, 'app.js'), 'utf8');
  const start = app.indexOf('const DEFAULT_STATE =');
  const end = app.indexOf('// 公會補給站裝備道具清單', start);
  assert.ok(start >= 0 && end > start);
  const defaults = JSON.parse(vm.runInNewContext(app.slice(start, end) + '\nJSON.stringify(DEFAULT_STATE)', {
    CURRENT_SCHEMA_VERSION: Core.CURRENT_SCHEMA_VERSION, BackendContract: Contract
  }));
  const repository = new LocalStorageRepository({
    storage, key: 'lifequest_state', fallbackState: defaults,
    readState: () => Core.StateStore.load(storage, 'lifequest_state', defaults, []),
    writeState: state => Core.StateStore.save(storage, 'lifequest_state', state)
  });
  return new GameApplication({ repository });
}

test('new Guest startup uses the approved neutral name in runtime and HTML defaults', async () => {
  const storage = new TrackingStorage();
  const app = runtimeGuestApplication(storage);
  const state = await app.initialize();
  assert.equal(state.character.name, '測試冒險者');
  const html = fs.readFileSync(path.join(projectRoot, 'index.html'), 'utf8');
  assert.match(html, /id="char-name-display">測試冒險者<\/h2>/);
  assert.match(html, /id="archive-character-name">測試冒險者<\/h3>/);
  assert.match(html, /id="settings-name" value="測試冒險者"/);
  const saved = await app.commitLocalTransition(state, { operationId: 'neutral-guest-save' });
  assert.equal(saved.ok, true);
  const restored = await runtimeGuestApplication(storage).initialize();
  assert.deepEqual(restored.character, app.getState().character);
  assert.equal(restored.character.name, '測試冒險者');
});

test('neutral Demo default does not rename or overwrite an existing Guest save on re-entry', async () => {
  const storage = new TrackingStorage();
  const initial = await runtimeGuestApplication(storage).initialize();
  initial.character.name = '自訂旅人';
  initial.character.gold = 123;
  const raw = JSON.stringify(initial);
  storage.setItem('lifequest_state', raw);
  const controller = GuestMode.createGuestModeController({ storage });
  controller.exitGuest();
  controller.enterGuest();
  const restored = await runtimeGuestApplication(storage).initialize();
  assert.equal(restored.character.name, '自訂旅人');
  assert.equal(restored.character.gold, 123);
  assert.equal(storage.getItem('lifequest_state'), raw);
  assert.equal(storage.clearCount, 0);
  assert.deepEqual(storage.removedKeys, []);
});
