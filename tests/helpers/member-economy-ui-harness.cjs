// Test-only DOM/transport harness. Runs production renderers, delegated clicks,
// command handlers, Auth coordinator, Application, Repository and serialization.
// Scripted responses are NOT a substitute for live Supabase transaction/RLS tests.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Contract = require('../../backendContract.js');
const Application = require('../../gameApplication.js');
const Auth = require('../../memberAuth.js');
const EconomyUi = require('../../memberEconomyUi.js');
const app = fs.readFileSync(path.join(__dirname, '../../app.js'), 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));

function between(start, end, offset = 0) {
  const a = app.indexOf(start, offset);
  const b = app.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, 'production source boundary exists: ' + start);
  return app.slice(a, b);
}
function storage() {
  const values = new Map();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
    entries: () => [...values.entries()]
  };
}
function classList() {
  const values = new Set();
  return {
    add: name => values.add(name), remove: name => values.delete(name),
    contains: name => values.has(name),
    toggle(name, enabled) { if (enabled) values.add(name); else values.delete(name); }
  };
}
class Element {
  constructor() { this.children = []; this.dataset = {}; this.classList = classList(); this.parts = new Map(); }
  set innerHTML(html) {
    this.html = html;
    this.children = [];
    this.parts.clear();
    for (const match of html.matchAll(/data-member-([a-z-]+)(?=>)/g)) {
      this.parts.set('[data-member-' + match[1] + ']', new Element());
    }
  }
  get innerHTML() { return this.html || ''; }
  querySelector(selector) { return this.parts.get(selector) || null; }
  appendChild(child) { this.children.push(child); }
  setAttribute(name, value) { this[name] = String(value); }
  removeAttribute() {}
  markup() { return this.innerHTML + [...this.parts.values(), ...this.children].map(x => x.markup()).join(''); }
}
function fixture() {
  return {
    meta: { repositoryVersion: 20, operations: [] },
    member: { adventurerName: '隔離測試員', onboardingCompleted: true, mainQuestId: 'sleep', dailyBudget: 500, timeZone: 'Asia/Taipei' },
    player: { totalXp: 0, level: 1, hp: 40, maxHp: 50, gold: 500, gems: 20, baseStats: { health: 10, energy: 10, wealth: 10, growth: 10 } },
    dailyDrafts: {}, customHabits: [], rulePreferences: {}, dailyEntries: [], habitEvents: [], statusEffects: [],
    activeBoss: null, achievements: [{ code: 'boss_slayer', unlockedAt: '2026-08-26T10:00:00Z', rewardState: 'granted' }],
    achievementProgress: { boss_slayer: 1 },
    catalog: [
      { itemKey: 'potion_red', displayName: '紅色藥水', itemType: 'potion', basePrice: 25, currency: 'gold', catalogVersion: 1 },
      ...['weapon', 'armor', 'pet'].map((slot, index) => ({
        itemKey: ['weapon_sword', 'armor_shield', 'pet_cactus'][index], slot, displayName: slot,
        itemType: 'equipment', basePrice: 60, currency: 'gold', catalogVersion: 1
      })),
      { itemKey: 'rest_30', displayName: '短暫休憩券', itemType: 'reward_ticket', basePrice: 3, currency: 'gems', catalogVersion: 1 }
    ],
    inventory: [], equipment: [], rewardTickets: [], recentEconomyTransactions: [],
    derivedEquipmentModifiers: { health: 0, energy: 0, wealth: 0, growth: 0 },
    derivedStats: { health: 10, energy: 10, wealth: 10, growth: 10 }
  };
}

async function createHarness({ server = { state: fixture() }, local = storage(), navigation = storage(), autoStart = true, gameplayProjection = false } = {}) {
  const guest = '{"character":{"gold":987,"gems":88},"inventory":["guest-only"]}';
  if (!local.getItem('lifequest_state')) local.setItem('lifequest_state', guest);
  const sessionValue = { access_token: 'test-only-token', user: { id: 'isolated-economy-ui' } };
  let session = sessionValue;
  let getCount = 0;
  let getFailure = false;
  const requests = [], queue = [], modals = [], pending = new Set();
  const elements = { listShopRewards: new Element(), authOverlay: new Element(), onboardingOverlay: new Element(), authLoginStatus: new Element() };
  elements.navTabs = ['dashboard', 'supply', 'privacy-settings', 'rules'].map(tab => Object.assign(new Element(), { dataset: { tab } }));
  elements.panes = elements.navTabs.map(tab => Object.assign(new Element(), { id: 'pane-' + tab.dataset.tab }));
  const listeners = {};
  const document = {
    body: new Element(),
    createElement: () => new Element(),
    addEventListener: (type, listener) => { listeners[type] = listener; },
    querySelectorAll: () => [],
    getElementById: () => null
  };
  const context = vm.createContext({
    window: { scrollTo() {} }, document, elements, sessionStorage: navigation, localStorage: local,
    BackendContract: Contract, PENDING_OPERATION_STORAGE_KEY: 'lifequest_pending_operations',
    restoreGuestEntranceAfterLogout() {}, showMemberBootstrap: value => { context.bootstrapView = value; },
    activeMember: null, state: {}, memberEconomyActionPending: false,
    rulesState: {}, editingHabitId: null, pendingModalAction: null,
    habitActionLocks: new Set(), ruleToggleLocks: new Set(),
    escapeHtml: value => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;'),
    getShopItemArtwork: () => '', syncGuestModeUi() {}, setCampStage() {}, populateDailyLogForDate() {},
    getSelectedRecordDate: () => '2026-08-27', updateCharts() {}, renderInsightsPage() {}, renderRulesPage() {},
    setAuthEntranceView: view => { context.authView = view; },
    setAuthStatus: (_element, message) => { context.authMessage = message; },
    showModal(title, message, icon, options = {}) { modals.push({ title, message, icon, ...options }); }
  });
  function apply(raw) {
    context.activeMember = { id: sessionValue.user.id, state: clone(raw) };
    if (gameplayProjection) {
      context.applyMemberGameplayProjection(raw);
      return;
    }
    context.state = { memberEconomy: EconomyUi.createMemberEconomyViewModel(raw) };
    context.renderMemberShopRewards();
  }
  context.applyMemberGameplayProjection = apply;
  vm.runInContext(
    between('const MEMBER_PHASE5_TABS', 'let ', app.indexOf('const MEMBER_PHASE5_TABS')).split('\n').filter(line =>
      line.startsWith('const MEMBER_PHASE5_TABS') || line.startsWith('const MEMBER_VIEW_STORAGE_KEY') ||
      line.startsWith('const MEMBER_RESTORABLE_VIEWS')).join('\n') +
    '\nconst MEMBER_GAMEPLAY_ENABLED = true;\n' +
    between('function normalizeMemberView', 'function returnToMemberBootstrap') +
    between('window.switchToTab = function', '// ==========================================', app.indexOf('window.switchToTab = function')) +
    '\nconst switchToTab = window.switchToTab;\n' +
    between('function formatMemberEconomyDelta', 'function renderShopRewards') +
    between('function renderEquipmentLoadout', 'function renderDashboardInsightsWidget') +
    between('async function handleMemberCommandFailure', 'async function submitMemberDailyEntry') +
    between('function clearMemberRuntimeForLogin()', 'async function initializeMemberAuth()') +
    between('async function initializeMemberAuth()', 'function bindMemberAuthForms()') +
    between("document.addEventListener('click', event => {", "document.addEventListener('change', event => {", app.indexOf('function bindUIEvents')),
    context
  );
  if (gameplayProjection) {
    // Opt-in full production projection + achievement rendering for snapshot
    // regression tests; only the DOM and remote service remain test boundaries.
    elements.achievementsGrid = new Element();
    context.CURRENT_SCHEMA_VERSION = require('../../lifequestCore.js').CURRENT_SCHEMA_VERSION;
    context.rulesState = {};
    context.window.LifeQuestMemberEconomyUi = EconomyUi;
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../../mockData.js'), 'utf8'), context);
    context.BOSS_DEFINITIONS = context.window.BOSS_DEFINITIONS;
    context.renderAll = () => { context.renderMemberShopRewards(); context.renderAchievements(); };
    vm.runInContext(
      between('const DEFAULT_STATE =', '// 公會補給站裝備道具清單') +
      between('function stripPictographs', "document.addEventListener('DOMContentLoaded'") +
      between('function createMemberGameplayProjection', 'function normalizeMemberView') +
      between('function renderAchievements()', 'function getShopItemArtwork'),
      context
    );
  }
  const originalRunner = context.runMemberEconomyAction;
  context.runMemberEconomyAction = args => {
    const promise = originalRunner(args);
    pending.add(promise);
    promise.finally(() => pending.delete(promise));
    return promise;
  };
  const authClient = {
    auth: {
      getSession: async () => ({ data: { session }, error: null }),
      signInWithPassword: async () => { session = sessionValue; return { data: { session }, error: null }; },
      signOut: async () => { session = null; return { error: null }; },
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } })
    }
  };
  const coordinator = Auth.createMemberAuthCoordinator({
    supabaseClient: authClient, projectUrl: 'https://isolated.invalid', publishableKey: 'test-public',
    storage: local, contract: Contract, application: Application,
    onMemberReady: ({ state }) => apply(state),
    onSignedOut: async details => {
      if (details?.reason === 'session-expired' || details?.remoteFailed) context.clearMemberRuntimeForLogin();
      else { context.activeMember = null; context.state = {}; context.clearCurrentMemberView(); }
    },
    fetchImpl: async (url, options) => {
      if (options.method === 'GET') {
        getCount++;
        return response(getFailure ? { ok: false, errorCode: 'NETWORK_ERROR', retryable: true } : { ok: true, state: clone(server.state) });
      }
      const command = JSON.parse(options.body);
      assert.equal(Contract.validateCommandEnvelope(command).ok, true);
      requests.push({ command, headers: options.headers, url });
      const next = queue.shift();
      assert.ok(next, 'every POST needs an explicit scripted server response');
      return response(await next(command, options));
    }
  });
  context.memberAuthCoordinator = coordinator;
  context.window.LIFEQUEST_SUPABASE_CONFIG = { url: 'https://isolated.invalid', publishableKey: 'test-public' };
  context.window.LifeQuestSupabase = { getSupabaseClient: () => authClient };
  context.window.LifeQuestMemberAuth = {
    createMemberAuthCoordinator: () => coordinator,
    safeMemberReloadMessage: Auth.safeMemberReloadMessage
  };
  if (autoStart) {
    const initial = await coordinator.start();
    assert.equal(initial.ok, true);
    context.restoreMemberGameplayWorkspace(initial);
  }
  function response(body) {
    return { ok: body.ok !== false, status: body.ok === false ? 409 : 200, json: async () => clone(body) };
  }
  function click(action, id) {
    const markup = elements.listShopRewards.markup();
    const button = [...markup.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)]
      .map(match => match[0])
      .find(html => html.includes('data-lifequest-action="' + action + '"') && html.includes('data-entity-id="' + id + '"'));
    assert.ok(button, 'rendered action exists: ' + action + ' ' + id);
    if (/\bdisabled\b/.test(button)) return false;
    const target = { dataset: { lifequestAction: action, entityId: id }, matches: () => false, closest() { return this; } };
    listeners.click({ target, preventDefault() {} });
    return true;
  }
  return {
    context, coordinator, server, local, navigation, elements, requests, modals, queue, click,
    markup: () => elements.listShopRewards.markup(),
    confirm: () => { const modal = modals.at(-1); assert.equal(typeof modal.onConfirm, 'function'); return modal.onConfirm(); },
    async idle() { while (pending.size) await Promise.all([...pending]); },
    success(change = () => {}) {
      queue.push(command => {
        change(server.state, command);
        server.state.meta.repositoryVersion++;
        return { ok: true, state: clone(server.state), repositoryVersion: server.state.meta.repositoryVersion, result: { operationId: command.operationId } };
      });
    },
    failure(code) { queue.push(() => ({ ok: false, errorCode: code, retryable: false })); },
    setGetFailure: value => { getFailure = value; },
    getCount: () => getCount
  };
}
module.exports = { createHarness, fixture, storage, app, clone };
