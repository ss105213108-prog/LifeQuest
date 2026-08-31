// LifeQuest: Real Life RPG Web Application Script
const {
  CURRENT_SCHEMA_VERSION,
  StateStore,
  DailyDataEngine,
  DailyRecordPolicy,
  BusinessDatePolicy,
  MainQuestEngine,
  RuleEngine,
  RecommendationEngine,
  Insights,
  AdvisorEngine,
  SettlementEngine,
  SettlementRevisionEngine,
  AchievementEngine,
  AchievementRewardEngine,
  HabitEngine,
  EquipmentEngine,
  SupplyEngine,
  DailyGemEngine,
  RewardTicketEngine,
  BossEngine,
  StatusEffectEngine,
  DeathEngine,
  RulePolicy,
  SaveArchiveEngine
} = window.LifeQuestCore;
const {
  GameApplication,
  LocalStorageRepository,
  LocalStorageOperationStore,
  createLifeQuestCommandHandlers,
  createOperationId
} = window.LifeQuestApplication;
const BackendContract = window.LifeQuestBackendContract;
const DailyFormSubmission = window.LifeQuestDailyFormSubmission;
const GuestMode = window.LifeQuestGuestMode;

const STATE_STORAGE_KEY = 'lifequest_state';
const APP_MODE_STORAGE_KEY = 'lifequest_app_mode';
const PRE_IMPORT_BACKUP_KEY = 'lifequest_state_backup_before_import';
const PENDING_OPERATION_STORAGE_KEY = 'lifequest_pending_operations';
const BOSS_DEFINITIONS = Array.isArray(window.BOSS_DEFINITIONS)
  ? window.BOSS_DEFINITIONS
  : [];

// ==========================================
// 1. 遊戲資料初始化與儲存 (State Management)
// ==========================================
const DEFAULT_STATE = {
  schemaVersion: CURRENT_SCHEMA_VERSION,
  onboarding: {
    authChoice: null
  },
  mainQuest: {
    pending: null
  },
  character: {
    name: "測試冒險者",
    class: "戰士",
    level: 1,
    hp: 50,
    maxHp: 50,
    xp: 0,
    maxXp: 50,
    gold: 80,
    gems: 5,
    streak: 3,
    goal: null, // 'sleep', 'spending', 'exercise', 'learning'
    attributes: {
      health: 10,
      energy: 10,
      wealth: 10,
      growth: 10
    },
    savings: 0,
    equipped: {
      weapon: null,
      armor: null,
      pet: null
    }
  },
  tasks: [
    { id: 'h1', systemKey: 'hydration', isSystem: true, title: '多喝水 500ml 💧', type: 'habit', direction: 'good', count: 0, dailyCounts: {}, stat: 'health', dailyInput: { metric: 'water', amount: 500 }, rewardPolicy: { maxDailyReports: 12, maxDailyRewards: 4 } },
    { id: 'h2', systemKey: 'exercise_training', isSystem: true, title: '有氧運動 10 分鐘 🏃', type: 'habit', direction: 'good', count: 0, dailyCounts: {}, stat: 'energy', dailyInput: { metric: 'exercise', amount: 10 }, rewardPolicy: { maxDailyReports: 12, maxDailyRewards: 3 } },
    { id: 'h3', systemKey: 'skill_practice', isSystem: true, title: '研習技能 30 分鐘', type: 'habit', direction: 'good', count: 0, dailyCounts: {}, stat: 'growth', dailyInput: { metric: 'study', amount: 30 }, rewardPolicy: { maxDailyReports: 8, maxDailyRewards: 1 } },
    { id: 'h4', systemKey: 'fried_food', isSystem: true, title: '吃油炸垃圾食物 🍔', type: 'habit', direction: 'bad', count: 0, dailyCounts: {}, stat: 'health', dailyInput: null, rewardPolicy: { maxDailyReports: 10, maxDailyRewards: 0 } },
    { id: 'h5', systemKey: 'impulse_purchase', isSystem: true, title: '衝動購物 / 亂花錢 💸', type: 'habit', direction: 'bad', count: 0, dailyCounts: {}, stat: 'wealth', dailyInput: { metric: 'impulse', amount: 1 }, rewardPolicy: { maxDailyReports: 10, maxDailyRewards: 0 } },
    { id: 'h6', systemKey: 'sedentary_screen', isSystem: true, title: '久坐不起滑手機 📱', type: 'habit', direction: 'bad', count: 0, dailyCounts: {}, stat: 'energy', dailyInput: null, rewardPolicy: { maxDailyReports: 12, maxDailyRewards: 0 } }
  ],
  customRewards: [
    { id: 'r_tv', title: '看電視 / 玩遊戲放鬆 🎮', cost: 15, type: 'custom' },
    { id: 'r_snack', title: '吃點心零食犒賞自己 🍰', cost: 20, type: 'custom' }
  ],
  inventory: [],
  supplyTransactions: [],
  gemTransactions: [],
  rewardTickets: [],
  buffs: [],
  debuffs: [],
  statusHistory: [],
  recoveryTasks: [],
  habitEvents: [],
  achievements: [
    { id: 'streak_3', title: '🔥 燃燒鬥志', desc: '連續完成所有每日目標 3 天', unlocked: false, progress: 0, target: 3, condition: { kind: 'perfect_day_consecutive' } },
    { id: 'boss_slayer', title: '⚔️ 巨獸獵人', desc: '成功擊敗一隻習慣魔獸', unlocked: false, progress: 0, target: 1, condition: { kind: 'context_flag', flag: 'bossDefeated' } },
    { id: 'gold_hoarder', title: '💰 金庫守望者', desc: '累積 7 天支出不超過當日預算且沒有衝動消費', unlocked: false, progress: 0, target: 7, condition: { kind: 'budget_success_days' } },
    { id: 'healthy_heart', title: '❤️ 養生達人', desc: '連續 3 天睡眠與飲水皆達標', unlocked: false, progress: 0, target: 3, condition: { kind: 'metric_consecutive', conditions: [{ metric: 'sleep', operator: '>=', targetValue: 7 }, { metric: 'water', operator: '>=', targetValue: 2000 }] } },
    { id: 'exercise_streak_3', title: '🏃 活力充沛', desc: '連續 3 天運動達 30 分鐘', unlocked: false, progress: 0, target: 3, condition: { kind: 'metric_consecutive', conditions: [{ metric: 'exercise', operator: '>=', targetValue: 30 }] } },
    { id: 'gym_rat', title: '💪 今日健將', desc: '一天內完成 5 次運動訓練任務', unlocked: false, progress: 0, target: 5, condition: { kind: 'habit_daily_count', titleIncludes: '運動' } }
  ],
  boss: {
    id: null,
    name: "森林安寧無恙 🌲",
    icon: "🌲",
    description: "目前沒有需要討伐的習慣魔獸。",
    hp: 0,
    maxHp: 0,
    active: false,
    type: null,
    challenge: null
  },
  bossHistory: [],
  bossTransactions: [],
  logs: [
    "歡迎加入 LifeQuest！系統正本機保存您的資料，防護個人隱私。"
  ],
  dailyLogHistory: [],
  dailyDrafts: {},
  settings: {
    dailyBudget: 500,
    timeZone: BackendContract.DEFAULT_TIME_ZONE,
    maxBackfillDays: BackendContract.DEFAULT_MAX_BACKFILL_DAYS
  },
  rules: [],
  deletedRules: [],
  ignoredRuleIds: [],
  meta: {
    lastSettlementDate: null,
    lastInterestDate: null,
    processedBossIncidentKeys: [],
    repositoryVersion: 0,
    operations: []
  }
};

// 公會補給站裝備道具清單
const SHOP_ITEMS = [
  { id: 'potion_red', title: '生命藥水 🧪', cost: 25, type: 'potion', effect: '恢復 15 生命值', icon: '🧪', value: 15 },
  { id: 'weapon_sword', title: '木劍 ⚔️', cost: 60, type: 'weapon', effect: '對習慣魔獸戰鬥傷害 +5', icon: '⚔️', attr: { energy: 2 } },
  { id: 'armor_shield', title: '鐵盾 🛡️', cost: 80, type: 'armor', effect: '失敗懲罰扣血減少 2 點', icon: '🛡️', attr: { health: 3 } },
  { id: 'pet_cactus', title: '仙人掌寵物 🌵', cost: 90, type: 'pet', effect: '金幣結算額外 +1', icon: '🌵', attr: { wealth: 2 } },
  { id: 'pet_dragon', title: '小青龍寵物 🐉', cost: 130, type: 'pet', effect: '戰鬥對習慣魔獸傷害加倍', icon: '🐉', attr: { health: 2, growth: 2 } }
];

const REWARD_TICKET_CATALOG = [
  { id: 'rest_30', title: '短暫休憩券', cost: 3, description: '安心休息或娛樂 30 分鐘' },
  { id: 'favorite_drink', title: '喜愛飲品券', cost: 5, description: '購買一次自己喜歡的飲品' },
  { id: 'free_evening', title: '自由晚間券', cost: 7, description: '安排一晚個人娛樂時間' },
  { id: 'weekend_reward', title: '週末犒賞券', cost: 12, description: '安排一次較大型的休閒活動' }
];

const initialLocalState = StateStore.load(
  localStorage,
  STATE_STORAGE_KEY,
  DEFAULT_STATE,
  window.RULES_MOCK_DATA.presetRules
);
let state = initialLocalState;
const initialStorageStatus = initialLocalState.storageStatus;
let pendingImportedState = null;
let activeMember = null;
let memberAuthCoordinator = null;
let memberLogoutUi = null;
const guestModeController = GuestMode.createGuestModeController({
  storage: localStorage,
  modeKey: APP_MODE_STORAGE_KEY,
  fallbackMode: initialLocalState.onboarding?.authChoice === 'guest' ? 'guest' : 'landing'
});
const MEMBER_PHASE5_TABS = new Set(['privacy-settings']);
const MEMBER_VIEW_STORAGE_KEY = 'currentMemberView';
const MEMBER_RESTORABLE_VIEWS = new Set(['dashboard', 'rules', 'training', 'boss-battle', 'insights', 'analytics', 'supply']);
// Phase 4C acceptance gate: enabled only after the authoritative UI test suite passes.
const MEMBER_GAMEPLAY_ENABLED = true;

const stateRepository = new LocalStorageRepository({
  storage: localStorage,
  key: STATE_STORAGE_KEY,
  fallbackState: initialLocalState,
  readState: () => StateStore.load(
    localStorage,
    STATE_STORAGE_KEY,
    DEFAULT_STATE,
    window.RULES_MOCK_DATA.presetRules
  ),
  writeState: nextState => StateStore.save(localStorage, STATE_STORAGE_KEY, nextState),
  removeState: () => {
    try {
      localStorage.removeItem(STATE_STORAGE_KEY);
      return { ok: true, reason: null };
    } catch (error) {
      return { ok: false, reason: 'storage_write_failed', errorName: error?.name || 'Error' };
    }
  }
});
const operationStore = new LocalStorageOperationStore({
  storage: localStorage,
  key: PENDING_OPERATION_STORAGE_KEY
});
const gameApplication = new GameApplication({
  repository: stateRepository,
  operationStore,
  commandValidator: command => BackendContract.validateCommandEnvelope(command),
  commandHandlers: createLifeQuestCommandHandlers({
    core: window.LifeQuestCore,
    supplyItems: SHOP_ITEMS,
    rewardTicketCatalog: REWARD_TICKET_CATALOG
  })
});
// Repository 載入結果是唯一真相；不可在初始化後把先前的本機快照寫回去。
const gameApplicationReady = gameApplication.initialize();

state.bossHistory = Array.isArray(state.bossHistory) ? state.bossHistory : [];
state.bossTransactions = Array.isArray(state.bossTransactions) ? state.bossTransactions : [];
state.dailyDrafts = state.dailyDrafts && typeof state.dailyDrafts === 'object'
  ? state.dailyDrafts
  : {};
state.statusHistory = Array.isArray(state.statusHistory) ? state.statusHistory : [];
state.supplyTransactions = Array.isArray(state.supplyTransactions) ? state.supplyTransactions : [];
state.gemTransactions = Array.isArray(state.gemTransactions) ? state.gemTransactions : [];
state.rewardTickets = Array.isArray(state.rewardTickets) ? state.rewardTickets : [];
state.deletedRules = Array.isArray(state.deletedRules) ? state.deletedRules : [];
state.mainQuest = state.mainQuest && typeof state.mainQuest === 'object'
  ? state.mainQuest
  : { pending: null };
state.meta.processedBossIncidentKeys = Array.isArray(state.meta.processedBossIncidentKeys)
  ? state.meta.processedBossIncidentKeys
  : [];
state.onboarding = state.onboarding && typeof state.onboarding === 'object'
  ? state.onboarding
  : { authChoice: null };
if (!state.character.goal && state.onboarding.authChoice !== 'guest') {
  state.onboarding.authChoice = null;
}

if (state.boss.active && !state.boss.id) {
  const legacyBossId = state.boss.type === 'spend'
    ? 'budget-vampire'
    : state.boss.type === 'exercise' ? 'laziness-beast' : 'sugar-monster';
  const definition = BOSS_DEFINITIONS.find(item => item.id === legacyBossId);
  if (definition) {
    state.boss = {
      ...state.boss,
      id: definition.id,
      name: definition.name,
      icon: definition.icon,
      description: definition.description,
      rewards: JSON.parse(JSON.stringify(definition.rewards)),
      challenge: {
        ...JSON.parse(JSON.stringify(definition.challenge)),
        progress: Number(state.boss.challenge?.progress) || 0,
        lastProgressDate: state.boss.challenge?.lastProgressDate || null
      }
    };
  }
}

// Insights & Rule Engine 前端 State (頁面重新整理恢復預設值)
let insightsTimeframe = 'weekly';
let journalFolio = 'summary';
let editingHabitId = null;
let pendingModalAction = null;
let modalFocusManager = null;
const habitActionLocks = new Set();
const ruleToggleLocks = new Set();
let memberEconomyActionPending = false;

let rulesState = {
  activeCategory: 'all',
  rules: state.rules,
  aiRecs: []
};

// ==========================================
// 2. DOM 元素宣告
// ==========================================
const elements = {
  navTabs: document.querySelectorAll('.nav-tab'),
  panes: document.querySelectorAll('.tab-pane'),
  
  gemCount: document.getElementById('gem-count'),
  goldCount: document.getElementById('gold-count'),
  headerGoal: document.getElementById('header-goal-display'),
  logbookDate: document.getElementById('logbook-date'),
  charName: document.getElementById('char-name-display'),
  charClass: document.getElementById('char-class-display'),
  avatarMini: document.getElementById('avatar-mini-display'),
  avatarLarge: document.getElementById('character-avatar-display'),
  hpText: document.getElementById('hp-text'),
  hpBar: document.getElementById('hp-bar'),
  xpText: document.getElementById('xp-text'),
  xpBar: document.getElementById('xp-bar'),
  
  attrHealth: document.getElementById('attr-health'),
  attrEnergy: document.getElementById('attr-energy'),
  attrWealth: document.getElementById('attr-wealth'),
  attrGrowth: document.getElementById('attr-growth'),
  
  savingsAmount: document.getElementById('savings-amount'),
  inputSavings: document.getElementById('input-savings-amount'),
  
  dashboardBuffs: document.getElementById('dashboard-buffs'),
  dashboardDebuffs: document.getElementById('dashboard-debuffs'),
  
  aiCoachText: document.getElementById('ai-coach-bubble-text'),
  settlementAdvisorText: document.getElementById('settlement-advisor-text'),
  advisorReviewPeriod: document.getElementById('advisor-review-period'),
  achievementsGrid: document.getElementById('achievements-grid'),
  
  listRecovery: document.getElementById('list-recovery-tasks'),
  listAutoQuests: document.getElementById('list-auto-quests'),
  listHabits: document.getElementById('list-habits'),
  listShopRewards: document.getElementById('list-shop-rewards'),
  
  settingsName: document.getElementById('settings-name'),
  settingsGoal: document.getElementById('settings-goal'),
  settingsGoalStatus: document.getElementById('settings-goal-status'),
  settingsBudget: document.getElementById('settings-budget'),
  logDate: document.getElementById('log-date'),
  btnSaveDraft: document.getElementById('btn-save-draft'),
  
  authOverlay: document.getElementById('auth-overlay'),
  authHomeView: document.getElementById('auth-home-view'),
  authLoginView: document.getElementById('auth-login-view'),
  authRegisterView: document.getElementById('auth-register-view'),
  authMemberView: document.getElementById('auth-member-view'),
  authOpenLogin: document.getElementById('auth-open-login'),
  authOpenRegister: document.getElementById('auth-open-register'),
  authLoginForm: document.getElementById('auth-login-form'),
  authAccount: document.getElementById('auth-account'),
  authPassword: document.getElementById('auth-password'),
  authPasswordToggle: document.getElementById('auth-password-toggle'),
  authLoginSubmit: document.getElementById('auth-login-submit'),
  authLoginStatus: document.getElementById('auth-login-status'),
  authRegisterForm: document.getElementById('auth-register-form'),
  authRegisterName: document.getElementById('auth-register-name'),
  authRegisterEmail: document.getElementById('auth-register-email'),
  authRegisterPassword: document.getElementById('auth-register-password'),
  authRegisterConfirm: document.getElementById('auth-register-confirm'),
  authRegisterTerms: document.getElementById('auth-register-terms'),
  authRegisterSubmit: document.getElementById('auth-register-submit'),
  authRegisterStatus: document.getElementById('auth-register-status'),
  authMemberName: document.getElementById('auth-member-name'),
  authMemberMainQuest: document.getElementById('auth-member-main-quest'),
  authMemberStatus: document.getElementById('auth-member-status'),
  authMemberRetry: document.getElementById('auth-member-retry'),
  authMemberPhase3Actions: document.getElementById('auth-member-phase3-actions'),
  memberWorkspaceReturn: document.getElementById('member-workspace-return'),
  guestExitButton: document.getElementById('guest-exit-button'),
  authLogoutSubmit: document.getElementById('auth-logout-submit'),
  onboardingOverlay: document.getElementById('onboarding-overlay'),
  memberOnboardingControls: document.getElementById('member-onboarding-controls'),
  memberOnboardingStatus: document.getElementById('member-onboarding-status'),
  memberOnboardingLogout: document.getElementById('member-onboarding-logout'),
  
  modalOverlay: document.getElementById('achievement-overlay'),
  modalKicker: document.getElementById('modal-kicker'),
  modalIcon: document.getElementById('modal-icon'),
  modalTitle: document.getElementById('modal-title'),
  modalDesc: document.getElementById('modal-desc'),
  modalGoalName: document.getElementById('modal-goal-name'),
  modalErasureReceipt: document.getElementById('modal-erasure-receipt'),
  modalCloseBtn: document.getElementById('modal-close-btn'),
  modalCancelBtn: document.getElementById('modal-cancel-btn'),
  persistenceAlert: document.getElementById('persistence-alert'),
  persistenceAlertTitle: document.getElementById('persistence-alert-title'),
  persistenceAlertMessage: document.getElementById('persistence-alert-message'),
  
  bossName: document.getElementById('boss-name'),
  bossHpText: document.getElementById('boss-hp-text'),
  bossHpBar: document.getElementById('boss-hp-bar'),
  bossDesc: document.getElementById('boss-desc'),
  bossAlertBadge: document.getElementById('boss-alert-badge'),
  arenaPlayer: document.getElementById('arena-player-avatar'),
  arenaBoss: document.getElementById('arena-boss-avatar'),
  arenaPlayerName: document.getElementById('arena-player-name'),
  arenaBossName: document.getElementById('arena-boss-name'),
  bossChallengeContainer: document.getElementById('boss-challenge-task-container'),
  battleLogs: document.getElementById('battle-logs'),
  
  inputReward: document.getElementById('input-reward'),
  inputRewardCost: document.getElementById('input-reward-cost'),
  btnAddReward: document.getElementById('btn-add-reward'),
  inputHabit: document.getElementById('input-habit'),
  inputHabitDirection: document.getElementById('input-habit-direction'),
  btnAddHabit: document.getElementById('btn-add-habit'),
  btnCancelHabitEdit: document.getElementById('btn-cancel-habit-edit'),
  habitUndoBar: document.getElementById('habit-undo-bar'),

  campStages: document.querySelectorAll('[data-camp-stage]'),
  campGoalName: document.getElementById('camp-goal-name'),
  campQuestProgress: document.getElementById('camp-quest-progress'),
  campQuestState: document.getElementById('camp-quest-state'),
  campBuffSummary: document.getElementById('camp-buff-summary'),
  campDebuffSummary: document.getElementById('camp-debuff-summary'),
  btnStartAdventure: document.getElementById('btn-start-adventure'),
  startAdventureLabel: document.getElementById('start-adventure-label'),
  btnEditTodayLog: document.getElementById('btn-edit-today-log'),
  btnReturnQuest: document.getElementById('btn-return-quest'),
  btnReturnCamp: document.getElementById('btn-return-camp'),
  settlementMessage: document.getElementById('settlement-message'),
  settlementProgress: document.getElementById('settlement-progress'),
  settlementRuleResults: document.getElementById('settlement-rule-results'),
  settlementExp: document.getElementById('settlement-exp'),
  settlementGold: document.getElementById('settlement-gold'),
  settlementHp: document.getElementById('settlement-hp'),
  settlementStatusText: document.getElementById('settlement-status-text'),
  settlementBossText: document.getElementById('settlement-boss-text'),
  settlementBossBtn: document.getElementById('settlement-boss-btn'),

  // Insights 頁面元素
  insightsTimeBtns: document.querySelectorAll('.time-toggle-btn'),
  journalFolioBtns: document.querySelectorAll('[data-journal-folio]'),
  journalFolios: document.querySelectorAll('[data-journal-page]'),
  dashBestHabit: document.getElementById('dash-best-habit'),
  dashBiggestWeakness: document.getElementById('dash-biggest-weakness'),
  dashTaskCompletionPercent: document.getElementById('dash-task-completion-percent'),

  insightCardBestHabit: document.getElementById('insight-card-best-habit'),
  insightCardBiggestImprovement: document.getElementById('insight-card-biggest-improvement'),
  insightCardMostBadHabit: document.getElementById('insight-card-most-bad-habit'),
  insightCardPriorityImprovement: document.getElementById('insight-card-priority-improvement'),

  insightsHeatmapGrid: document.getElementById('insights-heatmap-grid'),
  insightsTopBuffs: document.getElementById('insights-top-buffs'),
  insightsTopDebuffs: document.getElementById('insights-top-debuffs'),
  insightsAiAnalysisText: document.getElementById('insights-ai-analysis-text'),

  // Rules 頁面元素
  ruleCatTabs: document.querySelectorAll('.rule-cat-tab'),
  aiRulesRecsContainer: document.getElementById('ai-rules-recommendations-container'),
  activeRulesContainer: document.getElementById('active-rules-container')
};

// ==========================================
// 3. 初始化與事件綁定 (Initialization)
// ==========================================
async function commitLocalStateTransition() {
  if (activeMember) {
    applyMemberGameplayProjection(activeMember.state);
    return { ok: false, reason: 'member_local_snapshot_forbidden', retryable: false };
  }
  state.rules = rulesState.rules;
  const snapshot = JSON.parse(JSON.stringify(state));
  await gameApplicationReady;
  const operationId = createOperationId('local-transition');
  const result = await gameApplication.commitLocalTransition(snapshot, {
    operationId,
    intentKey: `LOCAL_STATE_TRANSITION:${operationId}`
  });
  if (result.ok) {
    state = gameApplication.getState();
    rulesState.rules = state.rules;
  } else {
    // UI 操作先在暫存副本計算；持久化失敗時必須回到最後一次成功提交的狀態。
    state = gameApplication.getState();
    rulesState.rules = state.rules;
  }
  if (!result.ok) showPersistenceWarning(result);
  return result;
}

// 過渡期相容名稱：所有舊 UI 儲存都被限制在本機 adapter，遠端 adapter 會明確拒絕。
const saveState = commitLocalStateTransition;

async function executeGameCommand(command) {
  if (activeMember) {
    applyMemberGameplayProjection(activeMember.state);
    return { ok: false, reason: 'member_local_command_forbidden', retryable: false };
  }
  await gameApplicationReady;
  const timeZone = state.settings?.timeZone || BackendContract.DEFAULT_TIME_ZONE;
  const businessDate = command.context?.businessDate || command.businessDate || command.payload?.date || getTodayDateString();
  const envelope = command.contractVersion
    ? command
    : BackendContract.createCommandEnvelope({
        ...command,
        operationId: command.operationId || createOperationId(String(command.type || 'operation').toLowerCase()),
        businessDate,
        timeZone
      });
  const result = await gameApplication.execute(envelope);
  if (result.ok) {
    state = gameApplication.getState();
    rulesState.rules = state.rules;
  } else {
    state = gameApplication.getState();
    rulesState.rules = state.rules;
    if (['storage_write_failed', 'storage_read_failed', 'version_conflict'].includes(result.reason)) {
      showPersistenceWarning(result);
    }
  }
  return result;
}

function showPersistenceWarning(status) {
  if (!status || status.ok || !elements.persistenceAlert) return;
  const recovered = status.reason === 'corrupted_state_recovered';
  elements.persistenceAlert.hidden = false;
  const conflict = status.reason === 'version_conflict';
  elements.persistenceAlertTitle.textContent = recovered
    ? '已隔離損壞卷宗並建立新存檔'
    : conflict ? '偵測到較新的冒險卷宗' : '本機卷宗未能保存';
  elements.persistenceAlertMessage.textContent = recovered
    ? '原始內容已保留為復原備份；請立即匯出目前可讀資料，再檢查瀏覽器儲存空間。'
    : conflict
      ? '目前操作已取消，畫面已回到較新的存檔版本，避免覆蓋其他分頁的進度。'
      : '這次操作沒有寫入存檔，畫面已回到上一次成功保存的狀態。';
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function stripPictographs(value) {
  return String(value).replace(/[\p{Extended_Pictographic}\uFE0F]/gu, '').replace(/\s+/g, ' ').trim();
}

document.addEventListener('DOMContentLoaded', async () => {
  await gameApplicationReady;
  state = gameApplication.getState();
  showPersistenceWarning(initialStorageStatus);
  initializeRpgInformationArchitecture();
  bindUIEvents();
  const authResult = await initializeMemberAuth();
  if (authResult?.session) {
    restoreMemberGameplayWorkspace(authResult);
    return;
  }
  applyPendingMainQuest();
  checkOnboarding();
  updateStatusDuration();
  evaluateAchievements();
  const restoredBoss = evaluateHabitBossCandidates(getTodayDateString());
  await saveState();
  renderAll();
  setCampStage('quest');
  initAllCharts();
  if (!restoredBoss.summoned) triggerAICoach(true);
});

function applyPendingMainQuest() {
  const result = MainQuestEngine.applyPending({
    currentGoal: state.character.goal,
    pending: state.mainQuest?.pending,
    today: getTodayDateString()
  });
  state.character.goal = result.currentGoal;
  state.mainQuest = state.mainQuest || {};
  state.mainQuest.pending = result.pending;
  if (result.changed) addLog(`📜 新的主線契約「${getGoalName(result.currentGoal)}」今日正式生效。`);
}

function initializeRpgInformationArchitecture() {
  const moveTo = (selector, slotId) => {
    const node = document.querySelector(selector);
    const slot = document.getElementById(slotId);
    if (node && slot) slot.appendChild(node);
  };

  const characterPanel = document.querySelector('.character-panel');
  const campHudSlot = document.getElementById('camp-hud-slot');
  const attributePanel = document.querySelector('.char-attributes-rpg');
  const analyticsStatusSlot = document.getElementById('analytics-status-slot');

  if (attributePanel && analyticsStatusSlot) analyticsStatusSlot.appendChild(attributePanel);
  if (characterPanel && campHudSlot) campHudSlot.prepend(characterPanel);

  moveTo('.daily-log-panel', 'camp-log-slot');
  moveTo('#col-auto-quests', 'camp-quest-list-slot');
  moveTo('#col-habits', 'training-content-slot');
  moveTo('#col-shop', 'supply-content-slot');
  moveTo('.dashboard-insights-widget', 'insights-overview-slot');
  moveTo('.ai-coach-dashboard', 'insights-advisor-slot');
  moveTo('.effects-panel', 'analytics-status-slot');
  moveTo('#col-recovery', 'boss-recovery-slot');

  const legacyDashboard = document.getElementById('legacy-dashboard-grid');
  if (legacyDashboard) legacyDashboard.remove();
  document.querySelector('.savings-panel.locked-vault-panel')?.remove();
}

function checkOnboarding() {
  if (activeMember) {
    const member = activeMember.state?.member;
    const onboardingCompleted = member?.onboardingCompleted === true
      && ['sleep', 'spending', 'exercise', 'learning'].includes(member?.mainQuestId);
    elements.authOverlay.classList.toggle('active', onboardingCompleted);
    elements.onboardingOverlay.classList.toggle('active', !onboardingCompleted);
    if (elements.memberOnboardingControls) elements.memberOnboardingControls.hidden = onboardingCompleted;
    syncGuestModeUi();
    return;
  }
  const goalSelected = Boolean(state.character.goal);
  const guestModeActive = guestModeController.isGuest();

  elements.authOverlay.classList.toggle('active', !guestModeActive);
  elements.onboardingOverlay.classList.toggle('active', guestModeActive && !goalSelected);
  syncGuestModeUi();
}

function syncGuestModeUi() {
  if (!elements.guestExitButton) return;
  elements.guestExitButton.hidden = Boolean(activeMember)
    || !guestModeController.isGuest()
    || !state.character.goal;
}

function setAuthEntranceView(view) {
  if (!elements.authHomeView || !elements.authLoginView || !elements.authRegisterView) return;

  const showLogin = view === 'login';
  const showRegister = view === 'register';
  const showMember = view === 'member';
  elements.authHomeView.hidden = showLogin || showRegister || showMember;
  elements.authLoginView.hidden = !showLogin;
  elements.authRegisterView.hidden = !showRegister;
  if (elements.authMemberView) elements.authMemberView.hidden = !showMember;

  window.requestAnimationFrame(() => {
    if (showLogin) {
      elements.authAccount?.focus();
    } else if (showRegister) {
      elements.authRegisterName?.focus();
    } else if (!showMember) {
      elements.authOpenLogin?.focus();
    }
  });
}

window.showAuthLoginPage = function() {
  setAuthEntranceView('login');
};

window.showAuthRegisterPage = function() {
  setAuthEntranceView('register');
};

window.showAuthEntrancePage = function() {
  resetAuthPasswordVisibility('auth-password', 'auth-password-toggle');
  resetAuthPasswordVisibility('auth-register-password', 'auth-register-password-toggle');
  resetAuthPasswordVisibility('auth-register-confirm', 'auth-register-confirm-toggle');
  setAuthEntranceView('home');
};

function resetAuthPasswordVisibility(inputId, toggleId) {
  const input = document.getElementById(inputId);
  const toggle = document.getElementById(toggleId);
  if (input) input.type = 'password';
  toggle?.setAttribute('aria-pressed', 'false');
  toggle?.setAttribute('aria-label', inputId.includes('confirm') ? '顯示確認密碼' : '顯示密碼');
}

window.toggleAuthPasswordVisibility = function(inputId = 'auth-password', toggleId = 'auth-password-toggle') {
  const input = document.getElementById(inputId);
  const toggle = document.getElementById(toggleId);
  if (!input || !toggle) return;

  const shouldShow = input.type === 'password';
  const isConfirmation = inputId.includes('confirm');
  input.type = shouldShow ? 'text' : 'password';
  toggle.setAttribute('aria-pressed', String(shouldShow));
  toggle.setAttribute('aria-label', shouldShow
    ? (isConfirmation ? '隱藏確認密碼' : '隱藏密碼')
    : (isConfirmation ? '顯示確認密碼' : '顯示密碼'));
  input.focus();
};

window.selectAuthMethod = async function(method) {
  if (method !== 'guest') return;
  if (activeMember) return;

  guestModeController.enterGuest();
  state = await gameApplication.initialize();
  rulesState.rules = state.rules || [];
  renderAll();
  checkOnboarding();
};

window.requestGuestExit = function() {
  if (activeMember || !guestModeController.isGuest()) return;
  showModal(
    '離開訪客模式？',
    '確定要離開訪客模式嗎？你的訪客冒險紀錄會保留。',
    'log-out',
    {
      iconType: 'lucide',
      confirmLabel: '離開訪客模式',
      cancelLabel: '繼續冒險',
      onConfirm: () => {
        guestModeController.exitGuest();
        setAuthEntranceView('home');
        elements.authOverlay.classList.add('active');
        elements.onboardingOverlay.classList.remove('active');
        syncGuestModeUi();
      }
    }
  );
};

function getAuthMethodLabel(method) {
  const labels = {
    guest: '訪客身分'
  };
  return labels[method] || '未知方式';
}

window.selectOnboardingGoal = async function(goal) {
  if (activeMember) {
    if (!memberAuthCoordinator) return;
    const isCurrent = memberAuthCoordinator.captureRuntime?.() || (() => true);
    const buttons = [...document.querySelectorAll('.goal-select-card')];
    buttons.forEach(button => {
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
    });
    setAuthStatus(elements.memberOnboardingStatus, `正在由公會保存「${getGoalName(goal)}」主線契約…`);
    try {
      const result = await memberAuthCoordinator.selectMainQuest({ questId: goal });
      if (result?.cancelled || !isCurrent()) return;
      if (!result.ok) {
        await handleMemberCommandFailure(result, '主線契約');
        setAuthStatus(
          elements.memberOnboardingStatus,
          result.message || '主線契約未能保存；會員資料沒有變更，請稍後重試。',
          { error: true }
        );
      }
    } catch (_error) {
      if (!isCurrent()) return;
      setAuthStatus(
        elements.memberOnboardingStatus,
        '主線契約未能保存；會員資料沒有變更，請檢查連線後重試。',
        { error: true }
      );
    } finally {
      if (isCurrent()) buttons.forEach(button => {
        button.disabled = false;
        button.removeAttribute('aria-busy');
      });
    }
    return;
  }
  state.character.goal = goal;
  addLog(`📜 已接受主線契約：${getGoalChinese(goal)}！`);
  elements.onboardingOverlay.classList.remove('active');
  const saveResult = await saveState();
  if (!saveResult.ok) return;
  renderAll();
  triggerAICoach(true);
  const goalName = getGoalName(goal);
  showModal(
    '主線契約已登錄',
    '從今天起，公會將優先標示與這項目標相關的每日任務。完成任務，開始累積你的冒險進度。',
    'shield-check',
    { variant: 'contract', goalName }
  );
};

function getGoalName(goal) {
  switch(goal) {
    case 'sleep': return '改善睡眠';
    case 'spending': return '控制衝動消費';
    case 'exercise': return '建立運動習慣';
    case 'learning': return '培養學習習慣';
    default: return '未設定';
  }
}

function getGoalChinese(goal) {
  switch(goal) {
    case 'sleep': return `💤 ${getGoalName(goal)}`;
    case 'spending': return `🛍️ ${getGoalName(goal)}`;
    case 'exercise': return `🏋️ ${getGoalName(goal)}`;
    case 'learning': return `📖 ${getGoalName(goal)}`;
    default: return '未設定';
  }
}

function getAuthRegistrationError(input) {
  const value = String(input?.value || '').trim();
  switch (input?.id) {
    case 'auth-register-name':
      if (!value) return '請填寫冒險者名稱';
      if (value.length < 2) return '冒險者名稱至少需要 2 個字元';
      if (!/^[\p{L}\p{N}]+$/u.test(value)) return '冒險者名稱只可使用中英文字與數字';
      return '';
    case 'auth-register-email':
      if (!value) return '請填寫 Email';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return 'Email 格式不正確';
      return '';
    case 'auth-register-password':
      if (!value) return '請設定密碼';
      if (value.length < 12) return '密碼至少需要 12 個字元';
      return '';
    case 'auth-register-confirm':
      if (!value) return '請再次輸入密碼';
      if (value !== String(elements.authRegisterPassword?.value || '')) return '兩次輸入的密碼不一致';
      return '';
    default:
      return '';
  }
}

function renderAuthRegistrationError(input, { force = false } = {}) {
  if (!input) return false;
  const errorElement = document.getElementById(`${input.id}-error`);
  const shouldShow = force || input.dataset.touched === 'true';
  const message = getAuthRegistrationError(input);
  input.setAttribute('aria-invalid', String(Boolean(message) && shouldShow));
  input.closest('.auth-input-shell')?.classList.toggle('auth-input-error', Boolean(message) && shouldShow);
  if (errorElement) {
    errorElement.textContent = shouldShow ? message : '';
    errorElement.hidden = !shouldShow || !message;
  }
  return !message;
}

function refreshAuthRegistrationState() {
  const inputs = [
    elements.authRegisterName,
    elements.authRegisterEmail,
    elements.authRegisterPassword,
    elements.authRegisterConfirm
  ];
  const fieldsValid = inputs.every(input => !getAuthRegistrationError(input));
  const termsAccepted = Boolean(elements.authRegisterTerms?.checked);
  const ready = fieldsValid && termsAccepted;
  if (elements.authRegisterSubmit) {
    elements.authRegisterSubmit.dataset.formReady = String(ready);
    elements.authRegisterSubmit.disabled = !ready;
    elements.authRegisterSubmit.setAttribute('aria-label', ready
      ? '建立冒險者帳號'
      : '請先完成所有欄位並同意條款');
  }
  return ready;
}

function bindAuthRegistrationForm() {
  if (!elements.authRegisterForm) return;
  const inputs = [
    elements.authRegisterName,
    elements.authRegisterEmail,
    elements.authRegisterPassword,
    elements.authRegisterConfirm
  ].filter(Boolean);

  inputs.forEach(input => {
    input.addEventListener('blur', () => {
      input.dataset.touched = 'true';
      renderAuthRegistrationError(input, { force: true });
      refreshAuthRegistrationState();
    });
    input.addEventListener('input', () => {
      renderAuthRegistrationError(input);
      if (input === elements.authRegisterPassword && elements.authRegisterConfirm?.dataset.touched === 'true') {
        renderAuthRegistrationError(elements.authRegisterConfirm, { force: true });
      }
      refreshAuthRegistrationState();
    });
  });

  elements.authRegisterTerms?.addEventListener('change', () => {
    elements.authRegisterTerms.dataset.touched = 'true';
    const errorElement = document.getElementById('auth-register-terms-error');
    const hasError = !elements.authRegisterTerms.checked;
    elements.authRegisterTerms.setAttribute('aria-invalid', String(hasError));
    if (errorElement) {
      errorElement.textContent = hasError ? '請先閱讀並同意使用條款與隱私權政策' : '';
      errorElement.hidden = !hasError;
    }
    refreshAuthRegistrationState();
  });

  refreshAuthRegistrationState();
}

function setAuthStatus(element, message, { error = false } = {}) {
  if (!element) return;
  element.textContent = message;
  element.dataset.status = error ? 'error' : 'info';
}

function setAuthButtonBusy(button, busy, busyLabel) {
  if (!button) return;
  button.disabled = Boolean(busy);
  button.setAttribute('aria-busy', String(Boolean(busy)));
  const label = button.querySelector('strong');
  if (!label) return;
  if (!button.dataset.idleLabel) button.dataset.idleLabel = label.textContent;
  label.textContent = busy ? busyLabel : button.dataset.idleLabel;
}

function showMemberBootstrap({ user = null, state: memberState = null, loading = false, error = '' } = {}) {
  if (user && !loading) memberLogoutUi?.markMemberReady();
  activeMember = user ? { id: user.id, state: memberState } : { id: null, state: memberState };
  syncGuestModeUi();
  const member = memberState?.member;
  const onboardingCompleted = member?.onboardingCompleted === true
    && ['sleep', 'spending', 'exercise', 'learning'].includes(member?.mainQuestId);
  const gameplayStateMissing = !loading && onboardingCompleted && !memberState?.player;
  const effectiveError = error || (gameplayStateMissing
    ? '公會尚未載入角色資源正本；為避免顯示本機預設值，會員遊戲暫不開放。請重新讀取卷宗。'
    : '');
  const showMemberView = loading || Boolean(effectiveError) || onboardingCompleted;
  const workspaceActive = document.body.classList.contains('member-gameplay-mode');
  if (elements.authMemberPhase3Actions) {
    elements.authMemberPhase3Actions.hidden = loading || Boolean(effectiveError)
      || !onboardingCompleted || !MEMBER_GAMEPLAY_ENABLED;
  }
  elements.authOverlay.classList.toggle('active', showMemberView);
  elements.onboardingOverlay.classList.toggle('active', !showMemberView);
  if (elements.memberOnboardingControls) elements.memberOnboardingControls.hidden = showMemberView;
  if (!showMemberView) {
    setAuthEntranceView('home');
    setAuthStatus(elements.memberOnboardingStatus, '請選擇一份主線契約；選擇後將由公會雲端保存。');
    return;
  }
  setAuthEntranceView('member');
  if (elements.authMemberName) {
    elements.authMemberName.textContent = loading
      ? '讀取中…'
      : String(memberState?.member?.adventurerName || '未命名冒險者');
  }
  if (elements.authMemberMainQuest) {
    elements.authMemberMainQuest.textContent = loading
      ? '核對中…'
      : onboardingCompleted ? getGoalName(member.mainQuestId) : '尚未選擇';
  }
  if (elements.authMemberRetry) elements.authMemberRetry.hidden = !effectiveError;
  setAuthStatus(
    elements.authMemberStatus,
    effectiveError || (loading
      ? '正在向公會檔案庫核對會員卷宗…'
      : '會員卷宗、角色資源、每日結算與習慣事件均由公會伺服器核定；補給與裝備交易仍未開放。'),
    { error: Boolean(effectiveError) }
  );
  if (workspaceActive && user && !loading && !effectiveError) {
    applyMemberGameplayProjection(memberState);
    elements.authOverlay.classList.remove('active');
    elements.onboardingOverlay.classList.remove('active');
  }
}

function createMemberGameplayProjection(memberState = {}) {
  if (!memberState?.player) return null;
  const projection = JSON.parse(JSON.stringify(DEFAULT_STATE));
  const member = memberState.member || {};
  const player = memberState.player || {};
  const customHabits = Array.isArray(memberState.customHabits) ? memberState.customHabits : [];
  const activeCustomHabits = customHabits.filter(habit => !habit.deletedAt).map(habit => ({
    id: habit.id,
    title: habit.title,
    type: 'habit',
    direction: habit.direction === 'bad' ? 'bad' : 'good',
    count: 0,
    dailyCounts: {},
    stat: 'growth',
    isSystem: false,
    systemKey: null,
    dailyInput: null,
    rewardPolicy: habit.direction === 'bad'
      ? { maxDailyReports: 10, maxDailyRewards: 0 }
      : { maxDailyReports: 10, maxDailyRewards: 1 }
  }));
  const removed = customHabits.filter(habit => habit.deletedAt)
    .sort((a, b) => String(b.deletedAt).localeCompare(String(a.deletedAt)))[0] || null;
  projection.character.name = member.adventurerName || projection.character.name;
  projection.character.goal = member.mainQuestId || null;
  if (memberState.player) {
    const level = Math.max(1, Number(player.level) || 1);
    const totalXp = Math.max(0, Number(player.totalXp) || 0);
    const levelThreshold = 25 * (level - 1) * level;
    projection.character.level = level;
    projection.character.hp = Math.max(0, Number(player.hp) || 0);
    projection.character.maxHp = Math.max(1, Number(player.maxHp) || 50);
    projection.character.xp = Math.max(0, totalXp - levelThreshold);
    projection.character.maxXp = 50 * level;
    projection.character.gold = Math.max(0, Number(player.gold) || 0);
    projection.character.gems = Math.max(0, Number(player.gems) || 0);
    projection.character.attributes = {
      health: Math.max(1, Number(player.baseStats?.health) || 1),
      energy: Math.max(1, Number(player.baseStats?.energy) || 1),
      wealth: Math.max(1, Number(player.baseStats?.wealth) || 1),
      growth: Math.max(1, Number(player.baseStats?.growth) || 1)
    };
  }
  projection.settings.dailyBudget = Number(member.dailyBudget) || projection.settings.dailyBudget;
  projection.settings.timeZone = member.timeZone || BackendContract.DEFAULT_TIME_ZONE;
  projection.dailyDrafts = JSON.parse(JSON.stringify(memberState.dailyDrafts || {}));
  projection.tasks = [...JSON.parse(JSON.stringify(DEFAULT_STATE.tasks)), ...activeCustomHabits];
  projection.habitEvents = (memberState.habitEvents || []).map(event => ({
    id: event.id,
    date: event.businessDate,
    habitId: event.customHabitId || event.systemKey,
    habitKey: event.systemKey || event.customHabitId,
    title: event.title || '未命名委託',
    direction: event.direction === 'bad' ? 'bad' : 'good',
    rewardGranted: event.policy?.rewardGranted === true,
    effect: event.policy?.effects || {},
    occurredAt: event.occurredAt,
    reversedAt: event.reversedAt || null
  }));
  projection.tasks.forEach(task => {
    const taskKey = task.systemKey || task.id;
    const matching = projection.habitEvents.filter(event => event.habitKey === taskKey && !event.reversedAt);
    task.count = matching.length;
    task.dailyCounts = matching.reduce((counts, event) => {
      counts[event.date] = (counts[event.date] || 0) + 1;
      return counts;
    }, {});
  });
  projection.rules = JSON.parse(JSON.stringify(window.RULES_MOCK_DATA.presetRules)).map(rule => ({
    ...rule,
    enabled: Object.prototype.hasOwnProperty.call(memberState.rulePreferences || {}, rule.id)
      ? Boolean(memberState.rulePreferences[rule.id])
      : rule.enabled
  }));
  projection.meta.repositoryVersion = Number(memberState.meta?.repositoryVersion) || 0;
  projection.dailyLogHistory = (memberState.dailyEntries || []).map(entry => {
    const settlement = entry.settlement || {};
    const deltas = settlement.resource?.deltas || {};
    const rewards = settlement.reward || {};
    return {
      id: entry.id,
      date: entry.businessDate,
      revision: entry.currentRevision,
      sleep: Number(entry.effectiveInput?.sleep ?? entry.sleep) || 0,
      water: Number(entry.effectiveInput?.water ?? entry.water) || 0,
      exercise: Number(entry.effectiveInput?.exercise ?? entry.exercise) || 0,
      study: Number(entry.effectiveInput?.study ?? entry.study) || 0,
      expense: Number(entry.effectiveInput?.expense ?? entry.expense) || 0,
      impulse: Number(entry.effectiveInput?.impulse ?? entry.impulse) || 0,
      sugaryDrinks: Number(entry.effectiveInput?.sugaryDrinks ?? entry.sugaryDrinks) || 0,
      completedRuleIds: Array.isArray(settlement.completedRuleIds) ? settlement.completedRuleIds : [],
      failedRuleIds: Array.isArray(settlement.failedRuleIds) ? settlement.failedRuleIds : [],
      completedCount: Array.isArray(settlement.completedRuleIds) ? settlement.completedRuleIds.length : 0,
      totalRuleCount: (settlement.completedRuleIds?.length || 0) + (settlement.failedRuleIds?.length || 0),
      expGained: Math.max(0, Number(deltas.xp ?? rewards.xp) || 0),
      goldGained: Number(deltas.gold ?? rewards.gold) || 0,
      damageTaken: Math.max(0, -(Number(deltas.hp) || 0)),
      levelUpTo: Number(settlement.resource?.levelsGained) > 0 ? Number(settlement.resource?.after?.level) : null,
      perfectDayGemAwarded: Number(settlement.rewardBreakdown?.daily?.gems) > 0,
      triggeredBossRuleIds: settlement.boss ? [settlement.boss.bossKey || settlement.boss.action] : [],
      critical: settlement.critical === true,
      settledAt: entry.settledAt,
      authoritative: true
    };
  }).sort((a, b) => a.date.localeCompare(b.date));
  projection.meta.lastSettlementDate = projection.dailyLogHistory.at(-1)?.date || null;

  const today = BackendContract.getBusinessDate({ timeZone: projection.settings.timeZone });
  const activeStatuses = (memberState.statusEffects || []).filter(effect =>
    effect.state === 'active' && String(effect.expiresOn || '') > today
  );
  projection.buffs = activeStatuses.filter(effect => effect.type === 'buff').map(effect => ({
    id: effect.id, title: effect.title, expiresOn: effect.expiresOn,
    remainingDays: Math.max(0, Math.ceil((new Date(`${effect.expiresOn}T00:00:00Z`) - new Date(`${today}T00:00:00Z`)) / 86400000)),
    attributes: effect.modifiers || {}
  }));
  projection.debuffs = activeStatuses.filter(effect => effect.type === 'debuff').map(effect => ({
    id: effect.id, title: effect.title, expiresOn: effect.expiresOn,
    remainingDays: Math.max(0, Math.ceil((new Date(`${effect.expiresOn}T00:00:00Z`) - new Date(`${today}T00:00:00Z`)) / 86400000)),
    attributes: effect.modifiers || {}
  }));
  projection.statusHistory = (memberState.statusEffects || []).map(effect => ({
    id: effect.id, title: effect.title, type: effect.type, state: effect.state,
    appliedOn: effect.appliedOn, expiresOn: effect.expiresOn, attributes: effect.modifiers || {}
  }));

  const activeBoss = memberState.activeBoss;
  if (activeBoss) {
    const definition = BOSS_DEFINITIONS.find(item => item.id === (activeBoss.bossKey || activeBoss.boss_key));
    projection.boss = {
      id: activeBoss.bossKey || activeBoss.boss_key,
      encounterId: activeBoss.id,
      name: activeBoss.name || activeBoss.name_snapshot || definition?.name || '未知習慣魔獸',
      icon: definition?.icon || '',
      description: definition?.description || '此魔獸由伺服器依真實紀錄召喚。',
      hp: Math.max(0, Number(activeBoss.hp) || 0),
      maxHp: Math.max(1, Number(activeBoss.maxHp || activeBoss.max_hp) || 1),
      active: activeBoss.state === 'active',
      type: definition?.type || null,
      rewards: activeBoss.reward_snapshot || definition?.rewards || {},
      challenge: definition?.challenge
        ? { ...JSON.parse(JSON.stringify(definition.challenge)), progress: 0, lastProgressDate: null }
        : { title: '依公會核定的生活改善條件推進', progress: 0, target: 3 }
    };
  }
  const unlocked = new Map((memberState.achievements || []).map(item => [item.code, item]));
  const achievementProgress = memberState.achievementProgress || {};
  projection.achievements = projection.achievements.map(item => {
    const record = unlocked.get(item.id);
    return record
      ? { ...item, unlocked: true, progress: item.target, unlockedAt: record.unlockedAt }
      : { ...item, progress: Math.min(item.target, Math.max(0, Number(achievementProgress[item.id]) || 0)) };
  });
  projection.logs = [
    `會員卷宗已由公會伺服器核定，版本 ${projection.meta.repositoryVersion}。`,
    ...projection.habitEvents.slice(0, 5).reverse().map(event => `${event.date} · ${event.title}${event.reversedAt ? '（已復原）' : ''}`),
    ...projection.dailyLogHistory.slice(-5).map(entry => `${entry.date} · 公會任務結算完成`)
  ];
  projection.meta.lastRemovedHabit = removed
    ? { habit: { ...removed, type: 'habit', isSystem: false }, index: projection.tasks.length, removedAt: removed.deletedAt }
    : null;
  projection.memberEconomy = window.LifeQuestMemberEconomyUi?.createMemberEconomyViewModel
    ? window.LifeQuestMemberEconomyUi.createMemberEconomyViewModel(memberState)
    : null;
  return projection;
}

function applyMemberGameplayProjection(memberState = {}) {
  if (!activeMember) return;
  if (!memberState || Number(memberState.meta?.repositoryVersion) < Number(activeMember.state?.meta?.repositoryVersion)) return;
  activeMember.state = memberState;
  const projection = createMemberGameplayProjection(memberState);
  if (!projection) return;
  state = projection;
  rulesState.rules = state.rules;
  renderAll();
}

function normalizeMemberView(view) {
  return MEMBER_RESTORABLE_VIEWS.has(view) ? view : 'dashboard';
}

function readStoredMemberView() {
  try {
    return normalizeMemberView(sessionStorage.getItem(MEMBER_VIEW_STORAGE_KEY));
  } catch (_error) {
    return 'dashboard';
  }
}

function saveCurrentMemberView(view) {
  if (!MEMBER_RESTORABLE_VIEWS.has(view)) return;
  try {
    sessionStorage.setItem(MEMBER_VIEW_STORAGE_KEY, view);
  } catch (_error) {
    // Navigation remains usable when sessionStorage is unavailable.
  }
}

function clearCurrentMemberView() {
  try {
    sessionStorage.removeItem(MEMBER_VIEW_STORAGE_KEY);
  } catch (_error) {
    // Logout must continue even when sessionStorage is unavailable.
  }
}

function enterMemberGameplayWorkspace(area) {
  if (!MEMBER_GAMEPLAY_ENABLED || !activeMember?.state?.member?.onboardingCompleted || !activeMember?.state?.player) return;
  document.body.classList.add('member-gameplay-mode');
  if (elements.memberWorkspaceReturn) elements.memberWorkspaceReturn.hidden = false;
  syncGuestModeUi();
  applyMemberGameplayProjection(activeMember.state);
  elements.authOverlay.classList.remove('active');
  elements.onboardingOverlay.classList.remove('active');
  const requestedView = area === 'habits'
    ? 'training'
    : area === 'draft' ? 'dashboard' : area;
  const memberView = normalizeMemberView(requestedView);
  switchToTab(memberView);
  if (memberView === 'dashboard') {
    setCampStage('log');
    populateDailyLogForDate(getSelectedRecordDate());
  }
}

function restoreMemberGameplayWorkspace(authResult) {
  const memberState = authResult?.state;
  const canRestoreGameplay = Boolean(
    authResult?.ok !== false && !authResult?.cancelled && authResult?.session?.user?.id
    && MEMBER_GAMEPLAY_ENABLED
    && memberState?.member?.onboardingCompleted === true
    && memberState?.player
  );
  if (!canRestoreGameplay) return false;

  activeMember = { id: authResult.session.user.id, state: memberState };
  const restoredView = readStoredMemberView();
  enterMemberGameplayWorkspace(restoredView);
  return true;
}

function returnToMemberBootstrap() {
  if (!activeMember) return;
  document.body.classList.remove('member-gameplay-mode');
  if (elements.memberWorkspaceReturn) elements.memberWorkspaceReturn.hidden = true;
  showMemberBootstrap({ user: { id: activeMember.id }, state: activeMember.state });
}

async function restoreGuestEntranceAfterLogout({ reason = 'logout', remoteFailed = false } = {}) {
  if (reason === 'session-expired' || remoteFailed) {
    clearMemberRuntimeForLogin();
    return;
  }
  clearCurrentMemberView();
  guestModeController.exitGuest();
  activeMember = null;
  document.body.classList.remove('member-gameplay-mode');
  if (elements.memberWorkspaceReturn) elements.memberWorkspaceReturn.hidden = true;
  const guestState = await gameApplication.initialize();
  if (memberAuthCoordinator?.getSession?.()?.user) return;
  state = guestState;
  rulesState.rules = state.rules || [];
  renderAll();
  setAuthEntranceView('home');
  elements.authOverlay.classList.add('active');
  elements.onboardingOverlay.classList.remove('active');
}

function clearMemberRuntimeForLogin() {
  activeMember = null;
  memberEconomyActionPending = false;
  state = {};
  rulesState.rules = [];
  rulesState.aiRecs = [];
  editingHabitId = null;
  pendingModalAction = null;
  habitActionLocks.clear();
  ruleToggleLocks.clear();
  document.querySelectorAll('[aria-busy="true"]').forEach(button => {
    if (button.dataset.memberIdleLabel) {
      const label = button.querySelector('strong') || button.querySelector('span:last-child') || button;
      label.textContent = button.dataset.memberIdleLabel;
    }
    button.disabled = false;
    button.removeAttribute('aria-busy');
  });
  clearCurrentMemberView();
  document.body.classList.remove('member-gameplay-mode');
  elements.panes.forEach(pane => pane.classList.remove('active'));
  if (elements.memberWorkspaceReturn) elements.memberWorkspaceReturn.hidden = true;
  if (elements.guestExitButton) elements.guestExitButton.hidden = true;
  if (elements.listShopRewards) elements.listShopRewards.innerHTML = '';
  if (elements.achievementsGrid) elements.achievementsGrid.innerHTML = '';
  for (const key of ['charName', 'charClass', 'gemCount', 'goldCount',
    'authMemberName', 'authMemberMainQuest']) {
    if (elements[key]) elements[key].textContent = '';
  }
  setAuthEntranceView('login');
  elements.authOverlay.classList.add('active');
  elements.onboardingOverlay.classList.remove('active');
}

async function initializeMemberAuth() {
  let supabaseClient;
  try {
    const config = window.LIFEQUEST_SUPABASE_CONFIG;
    supabaseClient = window.LifeQuestSupabase.getSupabaseClient({
      config,
      library: window.supabase
    });
    memberAuthCoordinator = window.LifeQuestMemberAuth.createMemberAuthCoordinator({
      supabaseClient,
      projectUrl: config.url,
      publishableKey: config.publishableKey,
      storage: localStorage,
      pendingOperationKey: PENDING_OPERATION_STORAGE_KEY,
      contract: BackendContract,
      application: window.LifeQuestApplication,
      requireCompleteBootstrap: true,
      onMemberLoading: (user, memberState) => showMemberBootstrap({ user, state: memberState, loading: true }),
      onMemberReady: ({ user, state: memberState }) => showMemberBootstrap({ user, state: memberState }),
      onSignedOut: restoreGuestEntranceAfterLogout
    });
  } catch (_error) {
    memberAuthCoordinator = null;
    setAuthStatus(elements.authLoginStatus, '會員服務目前無法使用；訪客模式仍可正常進入。', { error: true });
    return { ok: false, errorCode: 'MEMBER_SERVICE_UNAVAILABLE', session: null };
  }

  try {
    const result = await memberAuthCoordinator.start();
    if (!result.ok) {
      setAuthStatus(elements.authLoginStatus, result.message || '無法恢復會員登入狀態。', { error: true });
    }
    return result;
  } catch (error) {
    const session = memberAuthCoordinator.getSession();
    if (session?.user) {
      showMemberBootstrap({
        user: session.user,
        state: activeMember?.id === session.user.id ? activeMember.state : null,
        loading: false,
        error: window.LifeQuestMemberAuth.safeMemberReloadMessage(error)
      });
      return { ok: false, errorCode: error?.code || 'MEMBER_BOOTSTRAP_FAILED', session, state: null };
    }
    setAuthStatus(elements.authLoginStatus, '會員服務目前無法使用；訪客模式仍可正常進入。', { error: true });
    return { ok: false, errorCode: error?.code || 'MEMBER_SERVICE_UNAVAILABLE', session: null };
  }
}

function bindMemberAuthForms() {
  memberLogoutUi = window.LifeQuestMemberLogoutUi.createMemberLogoutUi({
    buttons: [elements.authLogoutSubmit, elements.memberOnboardingLogout]
  });

  elements.authLoginForm?.addEventListener('submit', async event => {
    event.preventDefault();
    if (!memberAuthCoordinator) {
      setAuthStatus(elements.authLoginStatus, '會員服務尚未完成初始化。', { error: true });
      return;
    }
    const email = String(elements.authAccount?.value || '').trim();
    const password = String(elements.authPassword?.value || '');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !password) {
      setAuthStatus(elements.authLoginStatus, '請輸入有效的 Email 與密碼。', { error: true });
      return;
    }
    setAuthButtonBusy(elements.authLoginSubmit, true, '核對卷宗中…');
    setAuthStatus(elements.authLoginStatus, '正在核對公會會員身分…');
    try {
      const result = await memberAuthCoordinator.login({ email, password });
      if (!result.ok) setAuthStatus(elements.authLoginStatus, result.message || '登入失敗。', { error: true });
      else if (!result.cancelled && result.session?.user?.id === activeMember?.id
        && result.state?.member?.onboardingCompleted === true && result.state?.player) {
        enterMemberGameplayWorkspace('dashboard');
        setCampStage('quest');
      }
    } catch (_error) {
      setAuthStatus(elements.authLoginStatus, '會員服務暫時無法完成登入。', { error: true });
    } finally {
      setAuthButtonBusy(elements.authLoginSubmit, false, '核對卷宗中…');
    }
  });

  elements.authRegisterForm?.addEventListener('submit', async event => {
    event.preventDefault();
    const inputs = [
      elements.authRegisterName,
      elements.authRegisterEmail,
      elements.authRegisterPassword,
      elements.authRegisterConfirm
    ].filter(Boolean);
    inputs.forEach(input => {
      input.dataset.touched = 'true';
      renderAuthRegistrationError(input, { force: true });
    });
    if (!refreshAuthRegistrationState() || !memberAuthCoordinator) {
      setAuthStatus(elements.authRegisterStatus, '請先完成所有欄位並同意條款。', { error: true });
      return;
    }

    setAuthButtonBusy(elements.authRegisterSubmit, true, '建立卷宗中…');
    setAuthStatus(elements.authRegisterStatus, '正在建立公會帳號與會員卷宗…');
    try {
      const result = await memberAuthCoordinator.register({
        adventurerName: elements.authRegisterName.value.trim(),
        email: elements.authRegisterEmail.value.trim(),
        password: elements.authRegisterPassword.value
      });
      if (!result.ok || result.verificationRequired) {
        setAuthStatus(elements.authRegisterStatus, result.message || '帳號建立失敗。', { error: !result.ok });
      }
    } catch (_error) {
      setAuthStatus(elements.authRegisterStatus, '會員服務暫時無法建立帳號。', { error: true });
    } finally {
      setAuthButtonBusy(elements.authRegisterSubmit, false, '建立卷宗中…');
      refreshAuthRegistrationState();
    }
  });

  async function logoutMember() {
    if (!memberAuthCoordinator) return;
    setAuthStatus(elements.authMemberStatus, '正在關閉會員卷宗並恢復本機訪客資料…');
    setAuthStatus(elements.memberOnboardingStatus, '正在關閉會員卷宗並恢復本機訪客資料…');
    let result;
    try {
      result = await memberLogoutUi.run(() => memberAuthCoordinator.logout());
    } catch (_error) {
      result = { ok: false, message: '會員服務暫時無法完成登出。' };
    }
    if (!result.ok) {
      setAuthStatus(elements.authMemberStatus, result.message || '登出失敗。', { error: true });
      setAuthStatus(elements.memberOnboardingStatus, result.message || '登出失敗。', { error: true });
    }
  }

  elements.authLogoutSubmit?.addEventListener('click', logoutMember);
  elements.memberOnboardingLogout?.addEventListener('click', logoutMember);
  elements.authMemberRetry?.addEventListener('click', async () => {
    if (!memberAuthCoordinator) return;
    setAuthButtonBusy(elements.authMemberRetry, true, '重試中…');
    const pending = memberAuthCoordinator.reloadMember();
    const isCurrent = memberAuthCoordinator.captureRuntime?.({ includeBootstrap: true }) || (() => true);
    try {
      await pending;
    } catch (error) {
      if (!isCurrent()) return;
      const session = memberAuthCoordinator.getSession();
      showMemberBootstrap({
        user: session?.user || null,
        state: activeMember?.state || null,
        error: window.LifeQuestMemberAuth.safeMemberReloadMessage(error)
      });
    } finally {
      if (isCurrent()) setAuthButtonBusy(elements.authMemberRetry, false, '重試中…');
    }
  });
}

function bindUIEvents() {
  bindAuthRegistrationForm();
  bindMemberAuthForms();
  document.querySelectorAll('[data-member-workspace]').forEach(button => {
    button.addEventListener('click', () => enterMemberGameplayWorkspace(button.dataset.memberWorkspace));
  });
  elements.memberWorkspaceReturn?.addEventListener('click', returnToMemberBootstrap);
  if (window.ModalFocusManager && elements.modalOverlay) {
    modalFocusManager = window.ModalFocusManager.createModalFocusManager({
      overlay: elements.modalOverlay,
      dialog: elements.modalOverlay.querySelector('[role="dialog"]'),
      documentRef: document,
      backgroundElements: [
        document.querySelector('.app-header'),
        document.querySelector('.app-content')
      ]
    });
  }

  document.addEventListener('click', event => {
    const trigger = event.target.closest('[data-lifequest-action]');
    if (!trigger || trigger.matches('input[type="checkbox"]')) return;
    const id = trigger.dataset.entityId || '';
    const action = trigger.dataset.lifequestAction;
    const actions = {
      'habit-report': () => window.handleHabitNew(id),
      'habit-edit': () => window.editHabit(id),
      'habit-delete': () => window.deleteTask(id),
      'habit-undo': () => window.undoLastHabitEvent(id),
      'equipment-trade': () => window.requestEquipmentTrade(id),
      'ticket-request': () => window.requestRewardTicket(id),
      'ticket-use': () => window.useRewardTicket(id),
      'ticket-reverse': () => window.reverseRewardTicket(id),
      'member-item-purchase': () => window.requestMemberItemPurchase(id),
      'member-item-use': () => window.requestMemberItemUse(id),
      'member-item-equip': () => window.requestMemberItemEquip(id),
      'member-item-unequip': () => window.requestMemberItemUnequip(id),
      'member-ticket-redeem': () => window.requestMemberTicketRedemption(id),
      'member-ticket-use': () => window.requestMemberTicketUse(id),
      'member-ticket-reverse': () => window.requestMemberTicketReverse(id),
      'supply-correct': () => window.requestSupplyCorrection(id),
      'recommendation-accept': () => window.acceptAiRecommendation(id),
      'recommendation-ignore': () => window.ignoreAiRecommendation(id),
      'rule-delete': () => window.deleteRule(id)
    };
    if (!actions[action]) return;
    event.preventDefault();
    actions[action]();
  });

  document.addEventListener('change', event => {
    const trigger = event.target.closest('[data-lifequest-action="rule-toggle"]');
    if (!trigger) return;
    window.toggleRuleEnabled(trigger.dataset.entityId || '');
  });

  // 導覽頁籤切換
  elements.navTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      switchToTab(tab.dataset.tab);
    });
  });

  // 新增或編輯訓練任務／負面事件
  if (elements.btnAddHabit && elements.inputHabit) {
    elements.btnAddHabit.addEventListener('click', saveHabitFromEditor);
    elements.inputHabit.addEventListener('keydown', event => {
      if (event.key === 'Enter') saveHabitFromEditor();
    });
    elements.btnCancelHabitEdit?.addEventListener('click', resetHabitEditor);
  }

  // 新增自訂獎勵
  if (elements.btnAddReward && elements.inputReward && elements.inputRewardCost) {
    elements.btnAddReward.addEventListener('click', async () => {
      const title = elements.inputReward.value.trim();
      const cost = parseInt(elements.inputRewardCost.value) || 10;
      if (!title) return;
      state.customRewards.push({
        id: createOperationId('reward'),
        title: title,
        cost: cost,
        type: 'custom'
      });
      elements.inputReward.value = '';
      elements.inputRewardCost.value = '';
      const saveResult = await saveState();
      if (!saveResult.ok) return;
      renderAll();
    });
  }

  elements.btnStartAdventure?.addEventListener('click', () => {
    const todayEntry = getTodayEntry();
    if (todayEntry) {
      renderCampSettlementFromEntry(todayEntry);
      setCampStage('settlement');
      return;
    }
    configureDailyRecordDate(getTodayDateString());
    populateDailyLogForDate(getTodayDateString());
    setCampStage('log');
    document.getElementById('log-sleep')?.focus();
  });

  elements.btnEditTodayLog?.addEventListener('click', () => {
    configureDailyRecordDate(getTodayDateString());
    populateDailyLogForDate(getTodayDateString());
    resetDailyLogValidation();
    setCampStage('log');
    document.getElementById('log-sleep')?.focus();
  });

  elements.btnReturnQuest?.addEventListener('click', () => {
    resetDailyLogValidation();
    setCampStage('quest');
  });
  elements.btnReturnCamp?.addEventListener('click', () => setCampStage('quest'));
  elements.settlementBossBtn?.addEventListener('click', () => switchToTab('boss-battle'));

  const dailyLogForm = document.getElementById('daily-log-form');
  if (dailyLogForm) {
    DailyFormSubmission.bind(dailyLogForm, ({ input }) => window.submitDailyLog(input));
  }
  dailyLogForm?.addEventListener('input', event => {
    const input = event.target.closest('input');
    if (!input) return;
    clearDailyLogFieldError(input);
    refreshDailyLogValidationNotice();
  });

  elements.logDate?.addEventListener('change', () => {
    const date = getSelectedRecordDate();
    const policy = getDailyRecordPolicy(date);
    if (!policy.allowed) {
      configureDailyRecordDate(getTodayDateString());
      showModal('紀錄日期不在開放範圍', `公會目前只接受 ${policy.minDate} 至 ${policy.maxDate} 的紀錄。`, 'calendar-x', { iconType: 'lucide' });
      return;
    }
    populateDailyLogForDate(date);
    resetDailyLogValidation();
  });

  elements.btnSaveDraft?.addEventListener('click', async () => {
    const date = getSelectedRecordDate();
    const policy = getDailyRecordPolicy(date);
    if (!policy.allowed) return;
    const draft = readDailyLogFormDraft(date);
    if (activeMember) {
      const isCurrent = memberAuthCoordinator.captureRuntime?.() || (() => true);
      elements.btnSaveDraft.disabled = true;
      elements.btnSaveDraft.setAttribute('aria-busy', 'true');
      try {
        const saveResult = await memberAuthCoordinator?.saveDailyDraft({ date, draft });
        if (saveResult?.cancelled || !isCurrent()) return;
        if (!saveResult?.ok) {
          await handleMemberCommandFailure(saveResult, '草稿保存');
          return;
        }
      } catch (_error) {
        if (isCurrent()) await handleMemberCommandFailure({ errorCode: 'NETWORK_ERROR', retryable: true }, '草稿保存');
        return;
      } finally {
        if (isCurrent()) {
          elements.btnSaveDraft.disabled = false;
          elements.btnSaveDraft.removeAttribute('aria-busy');
        }
      }
    } else {
      saveRecordDraft(draft);
      const saveResult = await saveState();
      if (!saveResult.ok) return;
    }
    showModal(
      policy.isBackfill ? '補記草稿已暫存' : '今日手稿已暫存',
      `公會書記已保存 ${date} 的未結算內容；本次沒有發放任何獎勵。`,
      'save',
      { iconType: 'lucide' }
    );
  });

  // 系統公文：確認才執行操作；取消與 Esc 僅關閉並回到原觸發按鈕。
  elements.modalCloseBtn.addEventListener('click', () => closeSystemModal({ confirmed: true }));
  elements.modalCancelBtn?.addEventListener('click', () => closeSystemModal({ confirmed: false }));
}

function closeSystemModal({ confirmed = false } = {}) {
  const shouldReturnToEntrance = confirmed && elements.modalCloseBtn.dataset.action === 'return-to-entrance';
  const action = confirmed ? pendingModalAction : null;
  pendingModalAction = null;
  if (modalFocusManager?.isOpen()) modalFocusManager.close();
  else {
    elements.modalOverlay.classList.remove('active');
    elements.modalOverlay.setAttribute('aria-hidden', 'true');
  }
  elements.modalOverlay.dataset.variant = 'default';
  elements.modalCloseBtn.dataset.action = '';
  elements.modalCloseBtn.textContent = '確定';
  if (elements.modalCancelBtn) elements.modalCancelBtn.hidden = true;
  if (typeof action === 'function') action();
  if (shouldReturnToEntrance) window.location.reload();
}

function getTodayEntry() {
  return getEntryForDate(getTodayDateString());
}

function getEntryForDate(date) {
  return state.dailyLogHistory.find(entry => entry.date === date) || null;
}

function getSelectedRecordDate() {
  return elements.logDate?.value || getTodayDateString();
}

function getRecordDraft(date = getSelectedRecordDate()) {
  return DailyDataEngine.createDraft({
    date,
    entry: getEntryForDate(date),
    draft: state.dailyDrafts?.[date]
  });
}

function getDailyRecordPolicy(date = getSelectedRecordDate()) {
  const context = BusinessDatePolicy.resolve({
    timeZone: state.settings?.timeZone || BackendContract.DEFAULT_TIME_ZONE,
    recordDate: date,
    maxBackfillDays: state.settings?.maxBackfillDays ?? BackendContract.DEFAULT_MAX_BACKFILL_DAYS
  });
  return DailyRecordPolicy.validate({
    date: context.recordDate,
    today: context.today,
    maxBackfillDays: state.settings?.maxBackfillDays ?? BackendContract.DEFAULT_MAX_BACKFILL_DAYS
  });
}

function saveRecordDraft(draft) {
  state.dailyDrafts = DailyDataEngine.storeDraft({
    drafts: state.dailyDrafts,
    draft
  });
}

function configureDailyRecordDate(date = getTodayDateString()) {
  if (!elements.logDate) return;
  const policy = getDailyRecordPolicy(date);
  elements.logDate.min = policy.minDate || date;
  elements.logDate.max = policy.maxDate || date;
  elements.logDate.value = policy.allowed ? date : getTodayDateString();
}

function populateDailyLogForDate(date = getSelectedRecordDate()) {
  configureDailyRecordDate(date);
  populateDailyLogForm(getRecordDraft(date));
  renderDailyDraftSources();
  const policy = getDailyRecordPolicy(date);
  if (elements.logbookDate) {
    elements.logbookDate.textContent = policy.isBackfill ? `補記 ${date}` : '今日';
  }
}

function renderDailyDraftSources() {
  const notice = document.getElementById('daily-log-source-notice');
  if (!notice) return;
  const draft = getRecordDraft();
  const parts = [];
  if (Number(draft.water) > 0) parts.push(`飲水 ${Number(draft.water)} ml`);
  if (Number(draft.exercise) > 0) parts.push(`運動 ${Number(draft.exercise)} 分鐘`);
  if (Number(draft.study) > 0) parts.push(`研習 ${Number(draft.study)} 分鐘`);
  if (Number(draft.impulse) > 0) parts.push(`衝動購物 ${Number(draft.impulse)} 次`);
  if (Number(draft.sugaryDrinks) > 0) parts.push(`含糖飲料 ${Number(draft.sugaryDrinks)} 次`);
  
  if (parts.length === 0) {
    notice.hidden = true;
    notice.style.display = 'none';
  } else {
    notice.hidden = false;
    notice.style.display = 'flex';
    const copy = notice.querySelector('[data-draft-source-copy]');
    if (copy) {
      copy.textContent = `已從今日訓練／警戒事件帶入：${parts.join('、')}。送交前仍可依實際情況修正。`;
    }
  }
}

function setCampStage(stageName) {
  elements.campStages.forEach(stage => {
    const isActive = stage.dataset.campStage === stageName;
    stage.hidden = !isActive;
    stage.classList.toggle('active', isActive);
  });
}

function populateDailyLogForm(entry) {
  const values = {
    'log-sleep': entry.sleep,
    'log-water': entry.water,
    'log-exercise': entry.exercise,
    'log-study': entry.study,
    'log-expense': entry.expense,
    'log-impulse': entry.impulse,
    'log-sugary-drinks': entry.sugaryDrinks
  };
  Object.entries(values).forEach(([id, value]) => {
    const input = document.getElementById(id);
    if (input && value !== undefined) input.value = value;
  });
}

function syncCampQuestControls(todayEntry, completedCount, totalCount) {
  if (elements.campQuestProgress) {
    elements.campQuestProgress.textContent = `今日進度 ${completedCount} / ${totalCount}`;
    elements.campQuestProgress.classList.toggle('completed', Boolean(todayEntry));
  }
  if (elements.startAdventureLabel) {
    elements.startAdventureLabel.textContent = todayEntry
      ? '查看今日公會結算'
      : '開始今天的冒險紀錄';
  }
  if (elements.campQuestState) {
    elements.campQuestState.textContent = todayEntry
      ? '今日任務已完成結算'
      : '任務尚未結算';
  }
  if (elements.btnEditTodayLog) elements.btnEditTodayLog.hidden = !todayEntry;
}

function renderCampSettlementFromEntry(entry, options = {}) {
  if (!entry || !elements.settlementRuleResults) return;
  const dailyRules = rulesState.rules.filter(rule => rule.enabled !== false && rule.type === 'daily');
  const completedIds = new Set(entry.completedRuleIds || []);
  const failedIds = new Set(entry.failedRuleIds || []);

  elements.settlementRuleResults.innerHTML = '';
  dailyRules.forEach(rule => {
    const completed = completedIds.has(rule.id);
    const failed = failedIds.has(rule.id) || !completed;
    const row = document.createElement('div');
    row.className = `settlement-rule-row ${completed ? 'completed' : 'failed'}`;
    row.innerHTML = `
      <i data-lucide="${completed ? 'badge-check' : 'circle-x'}"></i>
      <span>${escapeHtml(rule.name)}</span>
      <strong>${completed ? '達成' : (failed ? '未達成' : '未判定')}</strong>
    `;
    elements.settlementRuleResults.appendChild(row);
  });

  const completedCount = completedIds.size;
  const totalCount = Number(entry.totalRuleCount) || dailyRules.length;
  elements.settlementMessage.textContent = options.isRevision
    ? '今日紀錄已重新核定；舊結算已撤銷並依新數值重算'
    : options.isDuplicate
    ? '今日紀錄已更新；這份舊存檔沒有可逆明細，因此不重複結算'
    : '今日冒險已完成';
  elements.settlementProgress.textContent = `任務完成 ${completedCount} / ${totalCount}`;
  elements.settlementExp.textContent = options.isDuplicate && !options.isRevision
    ? '+0（不重複）'
    : `+${Number(entry.expGained) || 0}`;
  elements.settlementGold.textContent = options.isDuplicate && !options.isRevision
    ? '+0（不重複）'
    : `+${Number(entry.goldGained) || 0}`;

  const damageTaken = Number(entry.damageTaken) || 0;
  elements.settlementHp.textContent = options.isDuplicate && !options.isRevision
    ? '不重複扣除'
    : (damageTaken > 0 ? `-${damageTaken}` : '無變化');
  elements.settlementHp.classList.toggle('damage', damageTaken > 0);

  const statusMessages = [];
  if (Number(entry.perfectDayGemAwarded) > 0) statusMessages.push('完美結算：寶石 +1');
  if (entry.levelUpTo) statusMessages.push(`等級提升至 ${entry.levelUpTo}`);
  if (state.debuffs.length > 0) {
    statusMessages.push(`目前詛咒：${state.debuffs.map(item => item.title).join('、')}`);
  } else if (state.buffs.length > 0) {
    statusMessages.push(`目前祝福：${state.buffs.map(item => item.title).join('、')}`);
  } else {
    statusMessages.push('角色狀態穩定');
  }
  elements.settlementStatusText.textContent = statusMessages.join(' · ');

  const bossTriggeredToday = Array.isArray(entry.triggeredBossRuleIds) && entry.triggeredBossRuleIds.length > 0;
  elements.settlementBossText.textContent = bossTriggeredToday
    ? `習慣魔獸「${state.boss.name || '未知魔獸'}」已現身`
    : '今日未觸發習慣魔獸';
  elements.settlementBossBtn.hidden = !(bossTriggeredToday && state.boss.active);

  lucide.createIcons();
}

// 跨頁籤切換 Helper
window.switchToTab = function(tabName) {
  if (activeMember && MEMBER_PHASE5_TABS.has(tabName)) {
    showModal(
      '公會設施尚未對會員開放',
      '完整遊戲選單尚未對會員開放；目前不會以訪客資料代替會員雲端資料。',
      'lock-keyhole',
      { iconType: 'lucide' }
    );
    return;
  }
  elements.navTabs.forEach(t => {
    if (t.dataset.tab === tabName) t.classList.add('active');
    else t.classList.remove('active');
  });
  elements.panes.forEach(p => {
    if (p.id === `pane-${tabName}`) p.classList.add('active');
    else p.classList.remove('active');
  });

  document.querySelectorAll('.town-map-menu[open]').forEach(menu => menu.removeAttribute('open'));
  window.scrollTo({ top: 0, behavior: 'auto' });

  if (activeMember && document.body.classList.contains('member-gameplay-mode')) {
    saveCurrentMemberView(tabName);
  }

  if (tabName === 'analytics') {
    updateCharts();
  } else if (tabName === 'insights') {
    renderInsightsPage();
  } else if (tabName === 'rules') {
    renderRulesPage();
  }
};

// ==========================================
// 4. 全域 UI 渲染器 (Render Functions)
// ==========================================
function renderAll() {
  syncGuestModeUi();
  elements.gemCount.textContent = state.character.gems;
  elements.goldCount.textContent = state.character.gold;
  elements.headerGoal.innerHTML = `<i data-lucide="scroll-text" aria-hidden="true"></i><span>主線契約：${escapeHtml(getGoalName(state.character.goal))}</span>`;
  if (elements.logbookDate) {
    elements.logbookDate.textContent = new Intl.DateTimeFormat('zh-TW', {
      year: 'numeric', month: 'long', day: 'numeric', weekday: 'short'
    }).format(new Date(`${getTodayDateString()}T12:00:00`));
  }
  if (elements.campGoalName) elements.campGoalName.textContent = getGoalName(state.character.goal);
  
  elements.charName.textContent = state.character.name;
  elements.charClass.textContent = `等級 ${state.character.level} ${state.character.class}`;
  const archiveCharacterName = document.getElementById('archive-character-name');
  const archiveCharacterRank = document.getElementById('archive-character-rank');
  const archiveSilhouette = document.getElementById('archive-character-silhouette');
  if (archiveCharacterName) archiveCharacterName.textContent = state.character.name;
  if (archiveCharacterRank) archiveCharacterRank.textContent = `等級 ${state.character.level} ${state.character.class}`;
  if (archiveSilhouette) {
    archiveSilhouette.dataset.characterClass = state.character.class;
    archiveSilhouette.setAttribute('aria-label', `${state.character.name}，等級 ${state.character.level} ${state.character.class}公會肖像`);
  }
  
  const avatarIconByClass = {
    '戰士': 'shield',
    '法師': 'wand-sparkles',
    '盜賊': 'swords',
    '牧師': 'cross'
  };
  const classIconByClass = {
    '戰士': '戰',
    '法師': '法',
    '盜賊': '影',
    '牧師': '聖'
  };
  const avatarIcon = avatarIconByClass[state.character.class] || 'shield';
  const pet = state.character.equipped.pet
    ? SHOP_ITEMS.find(item => item.id === state.character.equipped.pet)
    : null;

  elements.avatarMini.innerHTML = `<i data-lucide="${avatarIcon}" aria-hidden="true"></i>`;
  elements.avatarLarge.innerHTML = `<i data-lucide="${avatarIcon}" aria-hidden="true"></i>`;
  elements.avatarLarge.dataset.classIcon = classIconByClass[state.character.class] || '戰';
  elements.avatarLarge.dataset.petIcon = pet?.icon || '';
  
  elements.hpText.textContent = `${state.character.hp} / ${state.character.maxHp}`;
  elements.hpBar.style.width = `${(state.character.hp / state.character.maxHp) * 100}%`;
  
  elements.xpText.textContent = `${state.character.xp} / ${state.character.maxXp}`;
  elements.xpBar.style.width = `${(state.character.xp / state.character.maxXp) * 100}%`;
  
  elements.attrHealth.textContent = state.character.attributes.health;
  elements.attrEnergy.textContent = state.character.attributes.energy;
  elements.attrWealth.textContent = state.character.attributes.wealth;
  elements.attrGrowth.textContent = state.character.attributes.growth;
  
  elements.savingsAmount.textContent = state.character.savings;
  
  elements.settingsName.value = state.character.name;
  if (elements.settingsGoal) elements.settingsGoal.value = state.mainQuest?.pending?.goal || state.character.goal || 'sleep';
  if (elements.settingsGoalStatus) {
    elements.settingsGoalStatus.textContent = state.mainQuest?.pending
      ? `已排定「${getGoalName(state.mainQuest.pending.goal)}」，將於 ${state.mainQuest.pending.effectiveOn} 生效。`
      : `目前主線：${getGoalName(state.character.goal)}`;
  }
  elements.settingsBudget.value = state.settings.dailyBudget;
  const restoreBackupButton = document.getElementById('restore-pre-import-btn');
  if (restoreBackupButton) restoreBackupButton.disabled = !localStorage.getItem(PRE_IMPORT_BACKUP_KEY);
  
  renderStatusEffects();
  renderRecoveryTasks();
  renderAutoDailies();
  renderHabits();
  renderShopRewards();
  renderBossBattle();
  renderAchievements();

  // 更新 Dashboard 首頁 Insights 摘要 Widget
  renderDashboardInsightsWidget();
  
  lucide.createIcons();
}

function renderStatusEffects() {
  elements.dashboardBuffs.innerHTML = '';
  elements.dashboardDebuffs.innerHTML = '';
  
  if (state.buffs.length === 0) {
    elements.dashboardBuffs.innerHTML = '<span style="font-size:0.75rem; color:rgba(255,255,255,0.3)">目前沒有角色祝福</span>';
  } else {
    state.buffs.forEach(buff => {
      const b = document.createElement('span');
      b.className = 'effect-badge buff';
      b.textContent = `${buff.title} (剩 ${buff.remainingDays} 天)`;
      elements.dashboardBuffs.appendChild(b);
    });
  }
  
  if (state.debuffs.length === 0) {
    elements.dashboardDebuffs.innerHTML = '<span style="font-size:0.75rem; color:rgba(255,255,255,0.3)">目前沒有角色詛咒</span>';
  } else {
    state.debuffs.forEach(debuff => {
      const d = document.createElement('span');
      d.className = 'effect-badge debuff';
      d.textContent = `${debuff.title} (剩 ${debuff.remainingDays} 天)`;
      elements.dashboardDebuffs.appendChild(d);
    });
  }

  if (elements.campBuffSummary) {
    elements.campBuffSummary.querySelector('.camp-effect-copy').textContent = state.buffs.length > 0
      ? ` ${state.buffs.length} 項角色祝福生效中`
      : ' 目前沒有角色祝福';
  }
  if (elements.campDebuffSummary) {
    elements.campDebuffSummary.querySelector('.camp-effect-copy').textContent = state.debuffs.length > 0
      ? ` ${state.debuffs.length} 項角色詛咒生效中`
      : ' 目前沒有角色詛咒';
  }
}

function renderRecoveryTasks() {
  elements.listRecovery.innerHTML = '';
  const activeDebuffs = Array.isArray(state.debuffs) ? state.debuffs : [];
  
  if (activeDebuffs.length === 0) {
    elements.listRecovery.innerHTML = '<div style="font-size:0.75rem; color:rgba(255,255,255,0.35); text-align:center; padding:1rem;">角色狀態良好，目前沒有生效中的詛咒</div>';
    return;
  }
  
  activeDebuffs.forEach(debuff => {
    const card = document.createElement('div');
    card.className = 'task-card-new';
    const expiry = debuff.expiresOn || '下一次正式日期判定';
    card.innerHTML = `
      <i data-lucide="hourglass" style="width:16px; height:16px; color:var(--parchment-gold);"></i>
      <div style="flex:1;">
        <span class="task-title-new">${escapeHtml(stripPictographs(debuff.title || debuff.id))}</span>
        <span class="task-detail-new">依正式日期自動判定；預計於 ${escapeHtml(expiry)} 解除</span>
      </div>
      <span class="status-duration-mark">尚餘 ${Math.max(1, Number(debuff.remainingDays) || 1)} 天</span>
    `;
    elements.listRecovery.appendChild(card);
  });
}

function getDailyQuestIcon(rule) {
  if (rule.metric === 'sleep') return 'bed';
  if (rule.metric === 'water') return 'droplets';
  if (rule.metric === 'exercise') return 'dumbbell';
  if (rule.category === 'wealth' || rule.metric === 'expense') return 'coins';
  if (rule.category === 'growth') return 'book-open';
  return 'scroll-text';
}

function renderAutoDailies() {
  elements.listAutoQuests.innerHTML = '';
  const todayEntry = getTodayEntry();
  const completedIds = new Set(todayEntry?.completedRuleIds || []);
  const mainQuestFocus = MainQuestEngine.getFocus({
    goal: state.character.goal,
    rules: rulesState.rules,
    tasks: state.tasks
  });
  const dailyQuests = rulesState.rules
    .filter(rule => rule.enabled !== false && rule.type === 'daily')
    .map(rule => ({
      id: rule.id,
      title: rule.name,
      desc: todayEntry
        ? `今日結果：${rule.conditionText}`
        : `尚未結算：${rule.conditionText}`,
      completed: completedIds.has(rule.id),
      icon: getDailyQuestIcon(rule),
      isTarget: rule.id === mainQuestFocus.ruleId
    }));
  
  dailyQuests.forEach(q => {
    const card = document.createElement('div');
    card.className = `task-card-new ${q.completed ? 'completed' : ''} ${q.isTarget ? 'target-highlight' : ''}`;

    card.innerHTML = `
      <span class="quest-leading-icon" aria-hidden="true">
        <i data-lucide="${q.icon}"></i>
      </span>
      <div class="quest-row-copy">
        <span class="task-title-new">${escapeHtml(q.title)}</span>
        <span class="task-detail-new">${escapeHtml(q.desc)}</span>
      </div>
      ${q.isTarget ? '<span class="quest-wax-seal" aria-label="主線契約"><i data-lucide="shield"></i></span>' : ''}
      <span class="quest-completion-slot ${q.completed ? 'completed' : ''}" aria-label="${q.completed ? '已達成' : '尚未達成'}">
        ${q.completed ? '<i data-lucide="check"></i>' : ''}
      </span>
    `;
    elements.listAutoQuests.appendChild(card);
  });

  syncCampQuestControls(todayEntry, completedIds.size, dailyQuests.length);
}

function renderHabits() {
  const today = getTodayDateString();
  const habits = state.tasks.filter(task => task.type === 'habit');
  const mainQuestFocus = MainQuestEngine.getFocus({
    goal: state.character.goal,
    rules: rulesState.rules,
    tasks: state.tasks
  });
  const goodReports = habits
    .filter(task => task.direction !== 'bad')
    .reduce((total, task) => total + (Number(task.dailyCounts?.[today]) || 0), 0);
  const warningReports = habits
    .filter(task => task.direction === 'bad')
    .reduce((total, task) => total + (Number(task.dailyCounts?.[today]) || 0), 0);

  elements.listHabits.innerHTML = `
    <section class="training-record-strip" aria-label="今日訓練紀錄">
      <div><small>今日訓練回報</small><strong>${goodReports} 次</strong></div>
      <span class="record-divider" aria-hidden="true"></span>
      <div class="warning"><small>今日警戒事件</small><strong>${warningReports} 次</strong></div>
      <p>紀錄日期：${escapeHtml(today)} · 每次回報都會留下可復原的公會紀錄</p>
    </section>
    <div class="training-boards">
      <section class="commission-board good-board">
        <header><span class="board-emblem"><i data-lucide="badge-check"></i></span><div><strong>今日訓練委託</strong><small>完成後向教官回報，領取 EXP 與金幣</small></div></header>
        <div class="commission-sheet-list" data-good-habits></div>
      </section>
      <section class="commission-board warning-board">
        <header><span class="board-emblem"><i data-lucide="skull"></i></span><div><strong>警戒事件紀錄</strong><small>事件確實發生時才登記，角色將損失生命值</small></div></header>
        <div class="commission-sheet-list" data-bad-habits></div>
      </section>
    </div>
  `;
  const goodHabitList = elements.listHabits.querySelector('[data-good-habits]');
  const badHabitList = elements.listHabits.querySelector('[data-bad-habits]');

  habits.forEach((habit, index) => {
    const isTarget = Boolean(mainQuestFocus.habitKey) &&
      (habit.systemKey || habit.id) === mainQuestFocus.habitKey;
    const isBadHabit = habit.direction === 'bad';
    const todayCount = Number(habit.dailyCounts?.[today]) || 0;
    const typeLabel = isBadHabit ? '警戒事件' : '訓練委託';
    const dailyRewardLimit = Math.max(0, Number(habit.rewardPolicy?.maxDailyRewards) || 0);
    const rewardedToday = (state.habitEvents || []).filter(event =>
      !event.reversedAt && event.date === today &&
      (event.habitKey || event.habitId) === (habit.systemKey || habit.id) &&
      event.rewardGranted
    ).length;
    const detailLabel = isBadHabit
      ? '登記後依規則扣除生命值'
      : `今日獎勵 ${rewardedToday}/${dailyRewardLimit} 次；達上限後仍保留紀錄`;
    const countLabel = isBadHabit ? `今日發生 ${todayCount} 次` : `今日完成 ${todayCount} 次`;
    const actionLabel = isBadHabit ? '登記事件' : '回報完成';
    const actionIcon = isBadHabit ? 'triangle-alert' : 'check';

    const card = document.createElement('article');
    card.className = `commission-sheet ${isBadHabit ? 'bad-habit' : 'good-habit'} ${isTarget ? 'target-highlight' : ''}`;
    card.style.setProperty('--notice-tilt', `${((index % 3) - 1) * 0.35}deg`);
    
    card.innerHTML = `
      <span class="commission-pin" aria-hidden="true"></span>
      <header><span><i data-lucide="${isBadHabit ? 'triangle-alert' : 'badge-check'}"></i>${typeLabel}</span>${isTarget ? '<b>主線</b>' : ''}</header>
      <h4>${escapeHtml(stripPictographs(habit.title))}</h4>
      <p>${detailLabel}</p>
      <div class="commission-report-row"><span>${countLabel}</span>
      <button class="habit-action-btn ${isBadHabit ? 'penalty' : 'reward'}" data-lifequest-action="habit-report" data-entity-id="${escapeHtml(habit.id)}">
        <i data-lucide="${actionIcon}"></i>
        <span>${actionLabel}</span>
      </button></div>
      <div class="commission-clerk-tools" aria-label="書記管理工具">
        ${activeMember && habit.isSystem
          ? '<button type="button" disabled aria-label="會員系統委託由公會原典管理"><i data-lucide="lock-keyhole"></i>公會原典</button>'
          : `<button data-lifequest-action="habit-edit" data-entity-id="${escapeHtml(habit.id)}" aria-label="修改${escapeHtml(habit.title)}"><i data-lucide="pencil"></i>修改委託</button>`}
        ${habit.isSystem
          ? '<button type="button" disabled aria-label="系統委託不可撤下"><i data-lucide="lock-keyhole"></i>系統委託</button>'
          : `<button data-lifequest-action="habit-delete" data-entity-id="${escapeHtml(habit.id)}" aria-label="撤下${escapeHtml(habit.title)}"><i data-lucide="x"></i>撤下</button>`}
      </div>
    `;
    (isBadHabit ? badHabitList : goodHabitList).appendChild(card);
  });

  if (!goodHabitList.children.length) goodHabitList.innerHTML = '<p class="ledger-empty">委託板目前空白，請書記張貼第一份訓練。</p>';
  if (!badHabitList.children.length) badHabitList.innerHTML = '<p class="ledger-empty">今日沒有需要警戒的負面事件。</p>';
  renderHabitUndoBar();
}

function renderHabitUndoBar() {
  if (!elements.habitUndoBar) return;
  const latest = window.LifeQuestMemberAuth.selectLatestHabitEvent(state.habitEvents);
  const removed = state.meta?.lastRemovedHabit;
  if (!latest && !removed) {
    elements.habitUndoBar.hidden = true;
    elements.habitUndoBar.innerHTML = '';
    return;
  }
  const effectLabel = latest?.direction === 'bad' ? '扣血紀錄' : '獎勵紀錄';
  elements.habitUndoBar.hidden = false;
  elements.habitUndoBar.innerHTML = `
    ${latest ? `<span>上一筆：${escapeHtml(latest.title)}（${effectLabel}）</span>
    <button type="button" data-lifequest-action="habit-undo" data-entity-id="${escapeHtml(latest.id)}"><i data-lucide="undo-2"></i>復原這筆回報</button>` : ''}
    ${removed ? `<span>已撤下：${escapeHtml(removed.habit.title)}</span>
    <button type="button" onclick="restoreLastRemovedHabit()"><i data-lucide="archive-restore"></i>恢復委託</button>` : ''}
  `;
}

async function saveHabitFromEditor() {
  const title = elements.inputHabit.value.trim();
  const direction = elements.inputHabitDirection?.value === 'bad' ? 'bad' : 'good';
  if (!title) {
    elements.inputHabit.focus();
    return;
  }

  if (activeMember) {
    const isCurrent = memberAuthCoordinator.captureRuntime?.() || (() => true);
    const existingHabit = editingHabitId
      ? state.tasks.find(item => item.id === editingHabitId && item.type === 'habit')
      : null;
    if (existingHabit?.isSystem) {
      showModal('公會原典受保護', '會員的系統委託由公會原典管理，不能修改名稱或好／壞性質。', 'lock-keyhole', { iconType: 'lucide' });
      return;
    }

    const actionButton = elements.btnAddHabit;
    if (actionButton) {
      actionButton.disabled = true;
      actionButton.setAttribute('aria-busy', 'true');
    }
    try {
      const result = existingHabit
        ? await memberAuthCoordinator.updateCustomHabit({ habitId: existingHabit.id, title, direction })
        : await memberAuthCoordinator.createCustomHabit({ title, direction });
      if (result?.cancelled || !isCurrent()) return;
      if (!result.ok) {
        await handleMemberCommandFailure(result, '委託保存');
        return;
      }
      addLog(`${existingHabit ? '✏️ 已更新' : '📝 已新增'}${direction === 'bad' ? '負面事件' : '訓練任務'}「${title}」。`);
      resetHabitEditor();
      return;
    } catch (_error) {
      if (isCurrent()) await handleMemberCommandFailure({ errorCode: 'NETWORK_ERROR', retryable: true }, '委託保存');
      return;
    } finally {
      if (actionButton && isCurrent()) {
        actionButton.disabled = false;
        actionButton.removeAttribute('aria-busy');
      }
    }
  }

  if (editingHabitId) {
    const habit = state.tasks.find(item => item.id === editingHabitId && item.type === 'habit');
    if (habit) {
      habit.title = title;
      if (!habit.isSystem) {
        habit.direction = direction;
        habit.rewardPolicy = {
          ...(habit.rewardPolicy || {}),
          maxDailyReports: Math.max(1, Number(habit.rewardPolicy?.maxDailyReports) || 10),
          maxDailyRewards: direction === 'bad' ? 0 : 1
        };
      }
      addLog(`✏️ 已更新任務／事件「${title}」。`);
    }
  } else {
    state.tasks.push({
      id: createOperationId('habit'),
      title,
      type: 'habit',
      direction,
      count: 0,
      dailyCounts: {},
      stat: 'growth',
      isSystem: false,
      systemKey: null,
      dailyInput: null,
      rewardPolicy: { maxDailyReports: 10, maxDailyRewards: direction === 'bad' ? 0 : 1 }
    });
    addLog(`📝 已新增${direction === 'bad' ? '負面事件' : '訓練任務'}「${title}」。`);
  }
  resetHabitEditor();
  const saveResult = await saveState();
  if (!saveResult.ok) return;
  renderAll();
}

function resetHabitEditor() {
  editingHabitId = null;
  if (elements.inputHabit) elements.inputHabit.value = '';
  if (elements.inputHabitDirection) elements.inputHabitDirection.value = 'good';
  if (elements.inputHabitDirection) elements.inputHabitDirection.disabled = false;
  if (elements.btnAddHabit) elements.btnAddHabit.textContent = '蓋章張貼';
  if (elements.btnCancelHabitEdit) elements.btnCancelHabitEdit.hidden = true;
}

window.editHabit = function(id) {
  const habit = state.tasks.find(item => item.id === id && item.type === 'habit');
  if (!habit) return;
  if (activeMember && habit.isSystem) {
    showModal('公會原典受保護', '會員的系統委託只能閱讀，不能修改名稱或好／壞性質。', 'lock-keyhole', { iconType: 'lucide' });
    return;
  }
  editingHabitId = id;
  elements.inputHabit.value = habit.title;
  elements.inputHabitDirection.value = habit.direction === 'bad' ? 'bad' : 'good';
  elements.inputHabitDirection.disabled = Boolean(habit.isSystem);
  document.getElementById('training-scribe-desk')?.setAttribute('open', '');
  elements.btnAddHabit.textContent = '蓋章更新';
  elements.btnCancelHabitEdit.hidden = false;
  elements.inputHabit.focus();
};

function renderAchievements() {
  if (!elements.achievementsGrid) return;
  elements.achievementsGrid.innerHTML = '';

  state.achievements.forEach(achievement => {
    const target = Math.max(1, Number(achievement.target) || 1);
    const progress = Math.min(target, Number(achievement.progress) || 0);
    const percent = Math.round((progress / target) * 100);
    const display = document.createElement('article');
    display.className = `medal-display ${achievement.unlocked ? 'unlocked' : 'locked'}`;
    display.dataset.medal = achievement.id;
    display.setAttribute('aria-label', `${stripPictographs(achievement.title)}，${achievement.unlocked ? '已授勳' : `尚未授勳，進度 ${progress}/${target}`}`);
    display.innerHTML = `
      <div class="medal-hook" aria-hidden="true">
        <span class="medal-ribbon left"></span><span class="medal-ribbon right"></span>
        <span class="medal-disc"></span>
        <span class="medal-state-tag">${achievement.unlocked ? '授' : '封'}</span>
      </div>
      <div class="medal-plaque">
        <div><h4>${escapeHtml(stripPictographs(achievement.title))}</h4><span>${achievement.unlocked ? '公會正式授勳' : `鑄造進度 ${progress} / ${target}`}</span></div>
        <p>${escapeHtml(achievement.desc)}</p>
        <div class="medal-engraving-progress" role="progressbar" aria-label="${escapeHtml(achievement.title)}進度" aria-valuemin="0" aria-valuemax="${target}" aria-valuenow="${progress}">
          <span style="width:${percent}%"></span>
        </div>
      </div>
    `;
    elements.achievementsGrid.appendChild(display);
  });
}

function getShopItemArtwork(itemId) {
  const artworks = {
    potion_red: `<svg viewBox="0 0 96 96" aria-hidden="true"><path class="art-outline" d="M37 10h22M40 10v20L23 57c-8 18 4 29 25 29s33-11 25-29L56 30V10"/><path class="art-fill potion-liquid" d="M28 61c7-7 14-4 21-1 8 3 14 3 20-2 5 15-4 21-21 21-16 0-24-6-20-18z"/><path class="art-detail" d="M31 50h34M40 24h16"/><circle class="art-spark" cx="42" cy="66" r="3"/><circle class="art-spark" cx="57" cy="71" r="2"/></svg>`,
    weapon_sword: `<svg viewBox="0 0 96 96" aria-hidden="true"><path class="art-fill metal" d="M69 9l10 10-42 48-12 4 4-13z"/><path class="art-outline" d="M69 9l10 10-42 48-12 4 4-13zM35 58l10 10M25 71L14 82M18 70l9 9"/><path class="art-detail" d="M66 19L34 57"/></svg>`,
    armor_shield: `<svg viewBox="0 0 96 96" aria-hidden="true"><path class="art-fill metal" d="M48 9l31 12-5 39C68 74 59 83 48 88 37 83 28 74 22 60l-5-39z"/><path class="art-outline" d="M48 9l31 12-5 39C68 74 59 83 48 88 37 83 28 74 22 60l-5-39zM48 19v58M28 32h40"/><path class="art-detail" d="M29 59c13 7 25 7 38 0"/></svg>`,
    pet_cactus: `<svg viewBox="0 0 96 96" aria-hidden="true"><path class="art-fill cactus" d="M37 69V28c0-13 22-13 22 0v11c3 5 8 2 8-3v-8c0-8 12-8 12 0v12c0 12-8 20-20 19v10z"/><path class="art-fill pot" d="M29 68h39l-5 19H34z"/><path class="art-outline" d="M37 69V28c0-13 22-13 22 0v11c3 5 8 2 8-3v-8c0-8 12-8 12 0v12c0 12-8 20-20 19v10M29 68h39l-5 19H34z"/><path class="art-detail" d="M43 27h8M43 41h8M43 55h8"/></svg>`,
    pet_dragon: `<svg viewBox="0 0 96 96" aria-hidden="true"><path class="art-fill dragon" d="M22 68c1-25 15-44 35-47l-5-12c18 7 29 20 27 38 8 6 8 17 2 26-8-10-17-12-27-8 7 8 6 16-1 22-4-9-14-13-31-19z"/><path class="art-outline" d="M22 68c1-25 15-44 35-47l-5-12c18 7 29 20 27 38 8 6 8 17 2 26-8-10-17-12-27-8 7 8 6 16-1 22-4-9-14-13-31-19zM41 42c8 0 15 4 21 11"/><circle class="art-eye" cx="61" cy="34" r="3"/></svg>`
  };
  return `<span class="stock-item-art" aria-hidden="true">${artworks[itemId] || '<i data-lucide="package"></i>'}</span>`;
}

function formatMemberEconomyDelta(value = 0) {
  const amount = Number(value) || 0;
  return `${amount > 0 ? '+' : ''}${amount}`;
}

function memberEconomyButton(action, entityId, label, icon, disabled = false) {
  const isDisabled = disabled || memberEconomyActionPending;
  return `<button class="counter-trade-btn" type="button" data-lifequest-action="${action}" data-entity-id="${escapeHtml(entityId)}" ${isDisabled ? 'disabled aria-busy="true"' : ''}><i data-lucide="${icon}"></i>${memberEconomyActionPending ? '公會核對中…' : label}</button>`;
}

function renderMemberShopRewards() {
  const economy = state.memberEconomy;
  if (!economy || economy.source !== 'member-cloud-authoritative') {
    elements.listShopRewards.innerHTML = '<p class="stock-empty">會員補給卷宗尚未由公會伺服器載入，請稍後重新讀取會員卷宗。</p>';
    renderEquipmentLoadout();
    return;
  }

  elements.listShopRewards.innerHTML = `
    <section class="merchant-counter-section equipment-inventory">
      <header><span class="counter-mark"><i data-lucide="warehouse"></i></span><div><small>會員軍需處 · 雲端核定</small><strong>公會補給目錄</strong><p>購買前請確認目錄價格；公會核定成功後才扣款並收入背包</p></div></header>
      <div class="merchant-stock-list" data-member-catalog></div>
    </section>
    <section class="merchant-counter-section equipment-inventory">
      <header><span class="counter-mark"><i data-lucide="backpack"></i></span><div><small>會員持有物 · 雲端核定</small><strong>冒險者背包</strong><p>消耗品顯示數量，裝備顯示持有與裝備狀態</p></div></header>
      <div class="merchant-stock-list" data-member-inventory></div>
    </section>
    <section class="merchant-counter-section equipment-inventory">
      <header><span class="counter-mark"><i data-lucide="chart-no-axes-combined"></i></span><div><small>能力核算 · Base + Equipment + Status</small><strong>最終能力值</strong><p>裝備與狀態只影響推導值，不會改寫基礎能力</p></div></header>
      <div class="merchant-stock-list" data-member-stats></div>
    </section>
    <section class="merchant-counter-section reward-ticket-ledger">
      <header><span class="counter-mark"><i data-lucide="gem"></i></span><div><small>寶石 ${economy.resources.gems} 顆 · 公會犒賞處</small><strong>犒賞券目錄</strong><p>以寶石兌換；未使用的犒賞券可依原始成本取消兌換</p></div></header>
      <div class="merchant-stock-list" data-member-ticket-catalog></div>
    </section>
    <section class="merchant-counter-section owned-ticket-ledger">
      <header><span class="counter-mark"><i data-lucide="ticket-check"></i></span><div><small>會員持有簿 · 雲端核定</small><strong>我的犒賞券</strong><p>顯示尚未使用、已使用與已取消的正式狀態</p></div></header>
      <div class="merchant-stock-list" data-member-tickets></div>
    </section>
    <section class="merchant-counter-section supply-transaction-ledger">
      <header><span class="counter-mark"><i data-lucide="scroll-text"></i></span><div><small>軍需處 · 最近 10 筆</small><strong>會員經濟紀錄</strong><p>歷史金額使用交易憑據快照，不以目前目錄重新推算</p></div></header>
      <div class="merchant-stock-list" data-member-transactions></div>
    </section>
  `;

  const catalogRack = elements.listShopRewards.querySelector('[data-member-catalog]');
  const inventoryRack = elements.listShopRewards.querySelector('[data-member-inventory]');
  const statsRack = elements.listShopRewards.querySelector('[data-member-stats]');
  const ticketCatalogRack = elements.listShopRewards.querySelector('[data-member-ticket-catalog]');
  const ticketsRack = elements.listShopRewards.querySelector('[data-member-tickets]');
  const transactionsRack = elements.listShopRewards.querySelector('[data-member-transactions]');

  economy.supplyCatalog.forEach(item => {
    const row = document.createElement('article');
    row.className = `merchant-stock-row shelf-stock-card ${item.equipped ? 'equipped-item' : ''}`;
    row.innerHTML = `
      ${getShopItemArtwork(item.itemKey)}
      <div class="stock-item-copy"><small>${escapeHtml(item.rarity || 'common')} · ${escapeHtml(item.itemType || 'item')} · v${Number(item.catalogVersion) || 0}</small><h4>${escapeHtml(item.displayName || item.itemKey)}</h4><p>${escapeHtml(item.description || '')}</p></div>
      <span class="stock-price"><i data-lucide="coins"></i>${item.currency === 'gold' ? `${item.estimatedPrice}<small>（原價 ${item.basePrice}）</small>` : item.basePrice}</span>
      <div class="counter-actions">${memberEconomyButton('member-item-purchase', item.itemKey, '確認購買', 'shopping-cart', item.itemType !== 'potion' && item.owned)}</div>
    `;
    catalogRack.appendChild(row);
  });
  if (!catalogRack.children.length) catalogRack.innerHTML = '<p class="stock-empty">公會伺服器目前沒有可顯示的補給品。</p>';

  economy.inventory.forEach(item => {
    const equipped = economy.equipment.some(entry => entry.itemKey === item.itemKey);
    const row = document.createElement('article');
    row.className = `merchant-stock-row shelf-stock-card ${equipped ? 'equipped-item' : ''}`;
    row.innerHTML = `
      ${getShopItemArtwork(item.itemKey)}
      <div class="stock-item-copy"><small>${escapeHtml(item.itemType || 'item')} · ${equipped ? '裝備中' : '已持有'}</small><h4>${escapeHtml(item.displayName || item.itemKey)}</h4><p>${item.itemType === 'potion' ? `目前數量 ${Number(item.quantity) || 0}` : '唯一裝備已收入會員背包'}</p></div>
      <span class="stock-price">${item.itemType === 'potion' ? `× ${Number(item.quantity) || 0}` : equipped ? '裝備中' : '已持有'}</span>
      <div class="counter-actions">${item.itemType === 'potion'
        ? memberEconomyButton('member-item-use', item.itemKey, '使用藥水', 'flask-conical')
        : equipped
          ? memberEconomyButton('member-item-unequip', economy.equipment.find(entry => entry.itemKey === item.itemKey)?.slot || '', '卸下裝備', 'shield-off')
          : memberEconomyButton('member-item-equip', item.itemKey, '裝備', 'shield-check')}</div>
    `;
    inventoryRack.appendChild(row);
  });
  if (!inventoryRack.children.length) inventoryRack.innerHTML = '<p class="stock-empty">會員背包目前沒有物品。</p>';

  const statLabels = { health: '健康', energy: '精力', wealth: '財富', growth: '成長' };
  Object.keys(statLabels).forEach(key => {
    const row = document.createElement('article');
    row.className = 'merchant-stock-row shelf-stock-card';
    row.innerHTML = `
      <span class="stock-item-art transaction-art" aria-hidden="true"><i data-lucide="sparkles"></i></span>
      <div class="stock-item-copy"><small>${statLabels[key]}能力核算</small><h4>${economy.stats.base[key]} ${formatMemberEconomyDelta(economy.stats.equipment[key])} ${formatMemberEconomyDelta(economy.stats.status[key])}</h4><p>基礎 ${economy.stats.base[key]} + 裝備 ${formatMemberEconomyDelta(economy.stats.equipment[key])} + 狀態 ${formatMemberEconomyDelta(economy.stats.status[key])}</p></div>
      <span class="stock-price">最終 ${economy.stats.final[key]}</span>
    `;
    statsRack.appendChild(row);
  });

  economy.ticketCatalog.forEach(ticket => {
    const row = document.createElement('article');
    row.className = 'merchant-stock-row shelf-stock-card reward-slip';
    row.innerHTML = `
      <span class="stock-item-art reward-ticket-art" aria-hidden="true"><i data-lucide="ticket-check"></i><span>犒賞券</span></span>
      <div class="stock-item-copy"><small>${escapeHtml(ticket.rarity || 'common')} · v${Number(ticket.catalogVersion) || 0}</small><h4>${escapeHtml(ticket.displayName || ticket.itemKey)}</h4><p>${escapeHtml(ticket.description || '')}</p></div>
      <span class="stock-price gem-price"><i data-lucide="gem"></i>${Number(ticket.basePrice) || 0}</span>
      <div class="counter-actions">${memberEconomyButton('member-ticket-redeem', ticket.itemKey, '兌換犒賞券', 'gem')}</div>
    `;
    ticketCatalogRack.appendChild(row);
  });
  if (!ticketCatalogRack.children.length) ticketCatalogRack.innerHTML = '<p class="stock-empty">公會伺服器目前沒有可顯示的犒賞券。</p>';

  const ticketLabels = { unused: '尚未使用', used: '已使用', reversed: '已取消' };
  economy.rewardTickets.forEach(ticket => {
    const row = document.createElement('article');
    row.className = `merchant-stock-row shelf-stock-card owned-reward-ticket status-${ticket.status}`;
    row.innerHTML = `
      <span class="stock-item-art reward-ticket-art" aria-hidden="true"><i data-lucide="ticket"></i><span>${ticketLabels[ticket.status] || '狀態未知'}</span></span>
      <div class="stock-item-copy"><small>${escapeHtml(String(ticket.issuedAt || '').slice(0, 10))}</small><h4>${escapeHtml(ticket.name || ticket.ticketKey)}</h4><p>取得時寶石成本 ${Number(ticket.gemCost) || 0} · 目錄版本 ${Number(ticket.catalogVersion) || 0}</p></div>
      <span class="ticket-status-label">${ticketLabels[ticket.status] || '狀態未知'}</span>
      <div class="counter-actions">${ticket.status === 'unused'
        ? `${memberEconomyButton('member-ticket-use', ticket.id, '標記使用', 'badge-check')}${memberEconomyButton('member-ticket-reverse', ticket.id, '取消兌換', 'undo-2')}`
        : '<span class="ticket-status-label">不可再操作</span>'}</div>
    `;
    ticketsRack.appendChild(row);
  });
  if (!ticketsRack.children.length) ticketsRack.innerHTML = '<p class="stock-empty">目前沒有會員犒賞券紀錄。</p>';

  economy.recentTransactions.forEach(transaction => {
    const hpDelta = Number(transaction.detail?.healAmount ?? transaction.detail?.hpDelta ?? transaction.detail?.hp_delta) || 0;
    const row = document.createElement('article');
    row.className = 'merchant-stock-row shelf-stock-card transaction-slip';
    row.innerHTML = `
      <span class="stock-item-art transaction-art" aria-hidden="true"><i data-lucide="receipt-text"></i></span>
      <div class="stock-item-copy"><small>${escapeHtml(String(transaction.createdAt || '').slice(0, 16).replace('T', ' '))} · 公會已核定</small><h4>${escapeHtml(transaction.label)}</h4><p>${escapeHtml(transaction.itemLabel)} · 憑據金額 ${Number(transaction.paidAmount ?? transaction.basePrice) || 0}</p></div>
      <span class="stock-price">${transaction.currency ? `${escapeHtml(transaction.currency)} ${formatMemberEconomyDelta(transaction.currencyDelta)}` : '資源異動'}${hpDelta ? ` · HP ${formatMemberEconomyDelta(hpDelta)}` : ''}</span>
    `;
    transactionsRack.appendChild(row);
  });
  if (!transactionsRack.children.length) transactionsRack.innerHTML = '<p class="stock-empty">目前尚無會員經濟交易。</p>';
  renderEquipmentLoadout();
}

function renderShopRewards() {
  if (activeMember) {
    renderMemberShopRewards();
    return;
  }
  elements.listShopRewards.innerHTML = `
    <section class="merchant-counter-section equipment-inventory">
      <header><span class="counter-mark"><i data-lucide="warehouse"></i></span><div><small>軍需處 · 裝備帳</small><strong>軍需官現有庫存</strong><p>已擁有的裝備可免費重新裝備；購買前會先確認交易</p></div></header>
      <div class="merchant-stock-list" data-supply-equipment></div>
    </section>
    <section class="merchant-counter-section reward-ticket-ledger">
      <header><span class="counter-mark"><i data-lucide="gem"></i></span><div><small>公會犒賞處 · 寶石 ${Number(state.character.gems) || 0} 顆</small><strong>生活犒賞券</strong><p>完成整日主線取得寶石，再兌換現實生活的小獎勵</p></div></header>
      <div class="merchant-stock-list" data-reward-catalog></div>
    </section>
    <section class="merchant-counter-section owned-ticket-ledger">
      <header><span class="counter-mark"><i data-lucide="ticket-check"></i></span><div><small>冒險者持有簿</small><strong>我的犒賞券</strong><p>未使用的券可以使用或取消兌換；使用後不能退回寶石</p></div></header>
      <div class="merchant-stock-list" data-owned-tickets></div>
    </section>
    <section class="merchant-counter-section supply-transaction-ledger">
      <header><span class="counter-mark"><i data-lucide="scroll-text"></i></span><div><small>軍需處 · 可追溯交易簿</small><strong>最近補給交易</strong><p>裝備仍在背包時可更正購買；已使用的消耗品不可復原</p></div></header>
      <div class="merchant-stock-list" data-supply-transactions></div>
    </section>
  `;
  const equipmentRack = elements.listShopRewards.querySelector('[data-supply-equipment]');
  const rewardCatalogRack = elements.listShopRewards.querySelector('[data-reward-catalog]');
  const ownedTicketRack = elements.listShopRewards.querySelector('[data-owned-tickets]');
  const transactionRack = elements.listShopRewards.querySelector('[data-supply-transactions]');

  SHOP_ITEMS.forEach(item => {
    const isOwned = state.inventory.includes(item.id);
    const isEquipped = state.character.equipped.weapon === item.id ||
                       state.character.equipped.armor === item.id ||
                       state.character.equipped.pet === item.id;
    const discount = Math.min(0.2, state.character.attributes.wealth * 0.01);
    const finalCost = Math.round(item.cost * (1 - discount));
    const row = document.createElement('article');
    row.className = `merchant-stock-row shelf-stock-card ${isEquipped ? 'equipped-item' : ''}`;
    row.dataset.stockItem = item.id;
    row.innerHTML = `
      ${getShopItemArtwork(item.id)}
      <div class="stock-item-copy">
        <small>${isEquipped ? '目前裝備中' : isOwned ? '已收進背包' : '軍需官庫存'}</small>
        <h4>${escapeHtml(stripPictographs(item.title))}</h4>
        <p>${escapeHtml(item.effect)}</p>
      </div>
      <span class="stock-price"><i data-lucide="coins"></i>${isOwned ? '已擁有' : finalCost}</span>
      <div class="counter-actions"><button class="counter-trade-btn" data-lifequest-action="equipment-trade" data-entity-id="${escapeHtml(item.id)}" data-cost="${finalCost}" ${isEquipped ? 'disabled' : ''}><i data-lucide="${isEquipped ? 'shield-check' : isOwned ? 'shirt' : 'hand-coins'}"></i>${isEquipped ? '裝備中' : isOwned ? '重新裝備' : '購買'}</button></div>
    `;
    equipmentRack.appendChild(row);
  });

  REWARD_TICKET_CATALOG.forEach(ticket => {
    const row = document.createElement('article');
    row.className = 'merchant-stock-row shelf-stock-card reward-slip';
    row.innerHTML = `
      <span class="stock-item-art reward-ticket-art" aria-hidden="true"><i data-lucide="ticket-check"></i><span>犒賞券</span></span>
      <div class="stock-item-copy">
        <small>寶石兌換</small>
        <h4>${escapeHtml(ticket.title)}</h4>
        <p>${escapeHtml(ticket.description)}</p>
      </div>
      <span class="stock-price gem-price"><i data-lucide="gem"></i>${ticket.cost}</span>
      <div class="counter-actions"><button class="counter-trade-btn" data-lifequest-action="ticket-request" data-entity-id="${escapeHtml(ticket.id)}" ${state.character.gems < ticket.cost ? 'disabled' : ''}><i data-lucide="stamp"></i>${state.character.gems < ticket.cost ? '寶石不足' : '兌換'}</button></div>
    `;
    rewardCatalogRack.appendChild(row);
  });

  state.rewardTickets.slice().reverse().forEach(ticket => {
    const row = document.createElement('article');
    row.className = `merchant-stock-row shelf-stock-card owned-reward-ticket status-${ticket.status}`;
    const statusLabel = ticket.status === 'unused' ? '尚未使用' : ticket.status === 'used' ? '已使用' : '已取消';
    row.innerHTML = `
      <span class="stock-item-art reward-ticket-art" aria-hidden="true"><i data-lucide="ticket"></i><span>${statusLabel}</span></span>
      <div class="stock-item-copy"><small>${escapeHtml(ticket.redeemedAt?.slice(0, 10) || '')}</small><h4>${escapeHtml(ticket.nameSnapshot)}</h4><p>${escapeHtml(ticket.descriptionSnapshot || '')}</p></div>
      <span class="stock-price gem-price"><i data-lucide="gem"></i>${Number(ticket.costSnapshot) || 0}</span>
      <div class="counter-actions">
        ${ticket.status === 'unused' ? `<button class="counter-trade-btn" data-lifequest-action="ticket-use" data-entity-id="${escapeHtml(ticket.id)}"><i data-lucide="badge-check"></i>標記使用</button><button class="counter-remove-btn" data-lifequest-action="ticket-reverse" data-entity-id="${escapeHtml(ticket.id)}" aria-label="取消${escapeHtml(ticket.nameSnapshot)}兌換"><i data-lucide="undo-2"></i></button>` : `<span class="ticket-status-label">${statusLabel}</span>`}
      </div>
    `;
    ownedTicketRack.appendChild(row);
  });

  if (!ownedTicketRack.children.length) ownedTicketRack.innerHTML = '<p class="stock-empty">目前尚未兌換犒賞券。</p>';

  const correctedPurchaseIds = new Set(state.supplyTransactions
    .filter(transaction => transaction.type === 'equipment_purchase_correction')
    .map(transaction => transaction.correctsTransactionId));
  state.supplyTransactions.slice(-8).reverse().forEach(transaction => {
    const isPurchase = transaction.type === 'equipment_purchase';
    const isCorrection = transaction.type === 'equipment_purchase_correction';
    const canCorrect = isPurchase && !correctedPurchaseIds.has(transaction.id) && state.inventory.includes(transaction.itemId);
    const row = document.createElement('article');
    row.className = `merchant-stock-row shelf-stock-card transaction-slip ${isCorrection ? 'is-correction' : ''}`;
    row.innerHTML = `
      <span class="stock-item-art transaction-art" aria-hidden="true"><i data-lucide="${isCorrection ? 'undo-2' : isPurchase ? 'package-check' : 'flask-conical'}"></i></span>
      <div class="stock-item-copy"><small>${escapeHtml(transaction.occurredAt?.slice(0, 10) || '')}</small><h4>${escapeHtml(stripPictographs(transaction.itemName || '補給交易'))}</h4><p>${isCorrection ? '更正憑證：已退回金幣' : isPurchase ? '裝備購買並登錄背包' : '消耗品已立即使用'}</p></div>
      <span class="stock-price"><i data-lucide="coins"></i>${isCorrection ? '+' : '-'}${Math.abs(Number(transaction.amount ?? transaction.cost) || 0)}</span>
      <div class="counter-actions">${canCorrect ? `<button class="counter-remove-btn transaction-correct-btn" data-lifequest-action="supply-correct" data-entity-id="${escapeHtml(transaction.id)}"><i data-lucide="history"></i>更正</button>` : `<span class="ticket-status-label">${correctedPurchaseIds.has(transaction.id) ? '已更正' : isPurchase ? '不可更正' : '已使用'}</span>`}</div>
    `;
    transactionRack.appendChild(row);
  });
  if (!transactionRack.children.length) transactionRack.innerHTML = '<p class="stock-empty">目前尚無補給交易。</p>';
  renderEquipmentLoadout();
}

function renderEquipmentLoadout() {
  const slotLabels = { weapon: '武器', armor: '護甲', pet: '旅伴' };
  const slotIcons = { weapon: 'sword', armor: 'shield', pet: 'paw-print' };
  const memberEquipment = activeMember ? (state.memberEconomy?.equipmentBySlot || {}) : null;
  Object.keys(slotLabels).forEach(slot => {
    const container = document.getElementById(`equipped-${slot}-slot`);
    if (!container) return;
    if (activeMember) {
      const item = memberEquipment?.[slot] || null;
      container.classList.toggle('filled', Boolean(item));
      container.innerHTML = `
        <span class="slot-socket" aria-hidden="true"><i data-lucide="${slotIcons[slot]}"></i></span>
        <div><small>${slotLabels[slot]} · 雲端核定</small><strong>${item ? escapeHtml(item.displayName || item.itemKey) : '尚未裝備'}</strong><span>${item ? '會員正式裝備' : '此欄位目前為空'}</span></div>
      `;
      return;
    }
    const itemId = state.character.equipped[slot];
    const item = itemId ? SHOP_ITEMS.find(candidate => candidate.id === itemId) : null;
    container.classList.toggle('filled', Boolean(item));
    container.innerHTML = `
      <span class="slot-socket" aria-hidden="true"><i data-lucide="${slotIcons[slot]}"></i></span>
      <div><small>${slotLabels[slot]}</small><strong>${item ? escapeHtml(stripPictographs(item.title)) : '尚未裝備'}</strong><span>${item ? escapeHtml(item.effect) : '等待軍需官配置'}</span></div>
    `;
  });
  const merchantGold = document.getElementById('merchant-gold-count');
  if (merchantGold) merchantGold.textContent = activeMember
    ? (state.memberEconomy?.resources.gold ?? state.character.gold)
    : state.character.gold;
}

function renderDashboardInsightsWidget() {
  const summary = Insights.calculate(
    state.dailyLogHistory,
    'weekly',
    getTodayDateString(),
    { dailyBudget: state.settings.dailyBudget, statusHistory: state.statusHistory }
  ).summaryWidget;
  if (elements.dashBestHabit) elements.dashBestHabit.textContent = stripPictographs(summary.bestHabit);
  if (elements.dashBiggestWeakness) elements.dashBiggestWeakness.textContent = stripPictographs(summary.biggestWeakness);
  if (elements.dashTaskCompletionPercent) {
    elements.dashTaskCompletionPercent.textContent = summary.taskCompletionPercent;
  }
}

// ==========================================
// 5. 冒險者紀錄書引擎 (Insights Engine)
// ==========================================
window.setInsightsTimeframe = function(timeframe) {
  insightsTimeframe = timeframe;
  elements.insightsTimeBtns.forEach(btn => {
    if (btn.dataset.timeframe === timeframe) btn.classList.add('active');
    else btn.classList.remove('active');
  });
  renderInsightsPage();
};

window.setJournalFolio = function(folio) {
  const allowedFolios = ['summary', 'trail', 'status'];
  journalFolio = allowedFolios.includes(folio) ? folio : 'summary';
  elements.journalFolioBtns.forEach(button => {
    const isActive = button.dataset.journalFolio === journalFolio;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-current', isActive ? 'page' : 'false');
  });
  elements.journalFolios.forEach(page => {
    const isActive = page.dataset.journalPage === journalFolio;
    page.hidden = !isActive;
    page.classList.toggle('active', isActive);
  });

  if (journalFolio === 'trail') {
    requestAnimationFrame(() => {
      insightsSleepChart?.resize();
      insightsExerciseChart?.resize();
    });
  }
  if (window.lucide) lucide.createIcons();
};

function renderInsightsPage() {
  const data = Insights.calculate(
    state.dailyLogHistory,
    insightsTimeframe,
    getTodayDateString(),
    { dailyBudget: state.settings.dailyBudget, statusHistory: state.statusHistory }
  );

  // 1. 4 大洞察卡片
  if (elements.insightCardBestHabit) elements.insightCardBestHabit.textContent = stripPictographs(data.insightCards.bestHabit);
  if (elements.insightCardBiggestImprovement) elements.insightCardBiggestImprovement.textContent = stripPictographs(data.insightCards.biggestImprovement);
  if (elements.insightCardMostBadHabit) elements.insightCardMostBadHabit.textContent = stripPictographs(data.insightCards.mostFrequentBadHabit);
  if (elements.insightCardPriorityImprovement) elements.insightCardPriorityImprovement.textContent = stripPictographs(data.insightCards.priorityImprovement);

  // 2. 熱力圖渲染（僅使用真實日誌）
  if (elements.insightsHeatmapGrid) {
    elements.insightsHeatmapGrid.innerHTML = '';
    data.heatmap.forEach(day => {
      const cell = document.createElement('div');
      cell.className = `heatmap-cell level-${day.level}`;
      cell.title = `${day.date}：完成強度 ${day.level}/4`;
      elements.insightsHeatmapGrid.appendChild(cell);
    });
  }

  // 3. 祝福／詛咒圖鑑（保留真實統計，改以狀態刻印呈現）
  if (elements.insightsTopBuffs) {
    elements.insightsTopBuffs.innerHTML = data.topBuffs.length ? data.topBuffs.map(b => `
      <article class="status-ledger-entry blessing-entry">
        <span class="status-entry-mark" aria-hidden="true">祝</span>
        <div><strong>${escapeHtml(stripPictographs(b.name))}</strong><small>曾生效 ${b.count} 次</small></div>
        <span class="status-entry-tally">${b.count}</span>
      </article>
    `).join('') : `
      <div class="status-ledger-empty">
        <span aria-hidden="true">祝</span><strong>尚未留下祝福刻印</strong>
        <p>完成冒險紀錄後，曾生效的正面狀態會收錄在此。</p>
      </div>`;
  }

  if (elements.insightsTopDebuffs) {
    elements.insightsTopDebuffs.innerHTML = data.topDebuffs.length ? data.topDebuffs.map(d => `
      <article class="status-ledger-entry curse-entry">
        <span class="status-entry-mark" aria-hidden="true">咒</span>
        <div><strong>${escapeHtml(stripPictographs(d.name))}</strong><small>曾生效 ${d.count} 次</small></div>
        <span class="status-entry-tally">${d.count}</span>
      </article>
    `).join('') : `
      <div class="status-ledger-empty">
        <span aria-hidden="true">咒</span><strong>尚未留下詛咒刻印</strong>
        <p>旅途中曾出現的負面狀態會由公會書記收錄在此。</p>
      </div>`;
  }

  // 4. 公會導師紀錄評析
  if (elements.insightsAiAnalysisText) {
    const review = buildAdvisorReview();
    const completionLabel = review.evidence.taskCompletionPossible
      ? `${review.evidence.taskCompletionPercent}%`
      : '尚無可計算資料';
    elements.insightsAiAnalysisText.textContent = review.periodStart && review.periodEnd
      ? `${review.periodStart} 至 ${review.periodEnd}：有效紀錄 ${review.sampleDays}/7 天，公會任務完成率 ${completionLabel}。`
      : '目前沒有可核對的分析期間。';
  }

  // 5. 更新紀錄書保留的兩張生活軌跡圖
  updateInsightsCharts(data);
  if (window.lucide) lucide.createIcons();
}

// ==========================================
// 6. 命運法典引擎 (Rules Engine)
// ==========================================
window.filterRulesCategory = function(category) {
  rulesState.activeCategory = category;
  elements.ruleCatTabs.forEach(tab => {
    if (tab.dataset.ruleCat === category) tab.classList.add('active');
    else tab.classList.remove('active');
  });
  renderRulesPage();
};

function renderRulesPage() {
  // 1. 公會導師手記：以頁邊批註呈現待收錄草案
  if (elements.aiRulesRecsContainer) {
    elements.aiRulesRecsContainer.innerHTML = '';
    if (rulesState.aiRecs.length === 0) {
      elements.aiRulesRecsContainer.innerHTML = '<div class="codex-empty">導師評析只會引用冒險者紀錄書中的真實資料，不會自動新增或虛構法典條文。</div>';
    } else {
      rulesState.aiRecs.forEach((rec, index) => {
        const note = document.createElement('aside');
        note.className = 'codex-marginal-note';
        note.innerHTML = `
          <header>
            <span>導師邊註 ${String(index + 1).padStart(2, '0')}</span>
            <small>${escapeHtml(rec.categoryName)}</small>
          </header>
          <h4>${escapeHtml(rec.name)}</h4>
          <p class="codex-note-reason"><i data-lucide="feather"></i>${escapeHtml(rec.reason)}</p>
          <blockquote><span>建議條文</span>${escapeHtml(rec.conditionText)}</blockquote>
          <dl class="codex-note-rewards">
            <div><dt>經驗</dt><dd>+${Number(rec.exp) || 0}</dd></div>
            <div><dt>金幣</dt><dd>+${Number(rec.gold) || 0}</dd></div>
            ${rec.attrName ? `<div><dt>${escapeHtml(rec.attrName)}</dt><dd>+${Number(rec.attrVal) || 0}</dd></div>` : ''}
          </dl>
          <footer>
            <button class="codex-action accept" data-lifequest-action="recommendation-accept" data-entity-id="${escapeHtml(rec.id)}"><i data-lucide="stamp"></i>蓋章收錄</button>
            <button class="codex-action decline" data-lifequest-action="recommendation-ignore" data-entity-id="${escapeHtml(rec.id)}">擱置此註</button>
          </footer>
        `;
        elements.aiRulesRecsContainer.appendChild(note);
      });
    }
  }

  // 2. 法典正文：以條文與封印呈現啟用狀態
  if (elements.activeRulesContainer) {
    elements.activeRulesContainer.innerHTML = '';
    const filteredRules = rulesState.activeCategory === 'all' 
      ? rulesState.rules 
      : rulesState.rules.filter(r => r.type === rulesState.activeCategory);

    if (filteredRules.length === 0) {
      elements.activeRulesContainer.innerHTML = '<div class="codex-empty">這一卷尚未記載任何法典條目。</div>';
      return;
    }

    filteredRules.forEach((rule, index) => {
      const togglePending = ruleToggleLocks.has(rule.id);
      const entry = document.createElement('article');
      entry.className = `codex-entry ${rule.enabled ? 'is-bound' : 'is-dormant'}`;
      entry.innerHTML = `
        <header class="codex-entry-heading">
          <span class="codex-article-number">第 ${String(index + 1).padStart(2, '0')} 條</span>
          <div>
            <small>${escapeHtml(rule.typeName || rule.type)} · ${escapeHtml(rule.categoryName || rule.category)}</small>
            <h4>${escapeHtml(rule.name)}</h4>
          </div>
          <label class="codex-seal-toggle" title="${rule.enabled ? '解除封印並暫停條文' : '重新封印並啟用條文'}">
            <input type="checkbox" aria-label="${escapeHtml(rule.name)}啟用狀態" ${rule.enabled ? 'checked' : ''} ${togglePending ? 'disabled aria-busy="true"' : ''} data-lifequest-action="rule-toggle" data-entity-id="${escapeHtml(rule.id)}">
            <span class="codex-seal-face">
              <span class="codex-wax-disc"><i data-lucide="${rule.enabled ? 'stamp' : 'circle-off'}"></i></span>
              <b>${togglePending ? '核對條文中' : rule.enabled ? '封印生效' : '條文休止'}</b>
              <small>${togglePending ? '請稍候' : rule.enabled ? '點擊解除' : '點擊重封'}</small>
            </span>
          </label>
        </header>
        <p class="codex-clause"><span>裁定</span>${escapeHtml(rule.conditionText)}</p>
        <footer class="codex-entry-footer">
          <dl class="codex-entry-rewards">
            ${rule.exp > 0 ? `<div><dt>EXP</dt><dd>+${rule.exp}</dd></div>` : ''}
            ${rule.gold > 0 ? `<div><dt>Gold</dt><dd>+${rule.gold}</dd></div>` : ''}
            ${rule.attrName && rule.attrVal !== 0 ? `<div><dt>${escapeHtml(rule.attrName)}</dt><dd>${rule.attrVal > 0 ? '+' + rule.attrVal : rule.attrVal}</dd></div>` : ''}
            ${rule.buffName ? `<div><dt>狀態</dt><dd>${escapeHtml(stripPictographs(rule.buffName))} · ${rule.duration}天</dd></div>` : ''}
          </dl>
          ${rule.isSystem
            ? '<button class="codex-delete-btn is-protected" type="button" disabled><i data-lucide="lock-keyhole"></i>公會原典</button>'
            : `<button class="codex-delete-btn" data-lifequest-action="rule-delete" data-entity-id="${escapeHtml(rule.id)}"><i data-lucide="eraser"></i>抹除此條</button>`}
        </footer>
      `;
      elements.activeRulesContainer.appendChild(entry);
    });
  }
  if (window.lucide) lucide.createIcons();
}

// 採用公會推薦法則
window.acceptAiRecommendation = async function(id) {
  const recIndex = rulesState.aiRecs.findIndex(r => r.id === id);
  if (recIndex === -1) return;

  const rec = rulesState.aiRecs[recIndex];
  if (
    StateStore.hasEquivalentRule(rulesState.rules, rec) ||
    StateStore.hasEquivalentTrigger(rulesState.rules, rec)
  ) {
    rulesState.aiRecs.splice(recIndex, 1);
    if (!state.ignoredRuleIds.includes(rec.id)) state.ignoredRuleIds.push(rec.id);
    const saveResult = await saveState();
    if (!saveResult.ok) return;
    renderRulesPage();
    showModal('條文已存在', `「${rec.name}」與法典中的既有條文相同，因此沒有重複收錄。`, 'book-check', { iconType: 'lucide' });
    return;
  }
  rulesState.rules.push(RecommendationEngine.createRule({
    recommendation: rec,
    id: createOperationId('rule-ai')
  }));

  rulesState.aiRecs.splice(recIndex, 1);
  const saveResult = await saveState();
  if (!saveResult.ok) return;
  renderRulesPage();
  showModal('法典已完成收錄', `公會導師草案「${rec.name}」已由你親自蓋章，正式寫入命運法典。`, 'stamp', { iconType: 'lucide' });
};

// 忽略公會推薦法則
window.ignoreAiRecommendation = async function(id) {
  rulesState.aiRecs = rulesState.aiRecs.filter(r => r.id !== id);
  if (!state.ignoredRuleIds.includes(id)) state.ignoredRuleIds.push(id);
  const saveResult = await saveState();
  if (!saveResult.ok) return;
  renderRulesPage();
};

// 切換規則啟用狀態
window.toggleRuleEnabled = async function(id) {
  const rule = rulesState.rules.find(r => r.id === id);
  if (rule && !ruleToggleLocks.has(id)) {
    const memberAction = Boolean(activeMember);
    const isCurrent = memberAction ? (memberAuthCoordinator.captureRuntime?.() || (() => true)) : (() => true);
    const enabled = !rule.enabled;
    ruleToggleLocks.add(id);
    renderRulesPage();
    let result;
    try {
      result = memberAction
        ? await memberAuthCoordinator.setRuleEnabled({ ruleId: id, enabled })
        : await executeGameCommand({
          type: 'SET_RULE_ENABLED',
          operationId: createOperationId('rule-toggle'),
          payload: { ruleId: id, enabled }
        });
      if (memberAction && (result?.cancelled || !isCurrent())) return result;
      if (!result.ok) {
        if (memberAction) await handleMemberCommandFailure(result, '條文狀態保存');
        else showModal('條文狀態未保存', '公會未能保存這次封印狀態，條文仍維持原狀。', 'file-warning', { iconType: 'lucide' });
      }
      return result;
    } finally {
      if (isCurrent()) {
        ruleToggleLocks.delete(id);
        renderRulesPage();
      }
    }
  }
};

// 刪除規則
window.deleteRule = function(id) {
  const rule = rulesState.rules.find(item => item.id === id);
  if (!rule) return;
  if (rule.isSystem) {
    showModal('公會原典受保護', '系統法則不能刪除；若暫時不需要，請解除封印將條文設為休止。', 'lock-keyhole', { iconType: 'lucide' });
    return;
  }
  showModal(
    '抹除自訂條文？',
    `確定刪除「${stripPictographs(rule.name)}」？公會會保留一份可復原的撤除紀錄。`,
    'file-warning',
    {
      iconType: 'lucide',
      confirmLabel: '確認抹除',
      cancelLabel: '保留條文',
      onConfirm: async () => {
        const result = RulePolicy.remove({
          rules: rulesState.rules,
          deletedRules: state.deletedRules,
          ruleId: id
        });
        if (!result.ok) return;
        rulesState.rules = result.rules;
        state.deletedRules = result.deletedRules;
        const saveResult = await saveState();
        if (!saveResult.ok) return;
        renderRulesPage();
        showModal(
          '自訂條文已撤除',
          `「${stripPictographs(result.rule.name)}」已移出法典；若為誤操作，可立即恢復。`,
          'archive-restore',
          {
            iconType: 'lucide',
            confirmLabel: '立即恢復',
            cancelLabel: '保留撤除',
            onConfirm: () => restoreLastDeletedRule()
          }
        );
      }
    }
  );
};

window.restoreLastDeletedRule = async function() {
  const result = RulePolicy.restoreLast({ rules: rulesState.rules, deletedRules: state.deletedRules });
  if (!result.ok) {
    showModal('沒有可恢復的條文', '公會檔案中目前沒有最近撤除的自訂條文。', 'archive', { iconType: 'lucide' });
    return;
  }
  rulesState.rules = result.rules;
  state.deletedRules = result.deletedRules;
  const saveResult = await saveState();
  if (!saveResult.ok) return;
  renderRulesPage();
  showModal('條文已恢復', `「${stripPictographs(result.rule.name)}」已回到命運法典。`, 'book-check', { iconType: 'lucide' });
};

window.restoreDefaultRules = function() {
  showModal(
    '恢復公會原典？',
    '系統法則會恢復成公會正式版本，既有啟用／休止狀態與自訂條文仍會保留。',
    'book-copy',
    {
      iconType: 'lucide',
      confirmLabel: '恢復原典',
      cancelLabel: '取消',
      onConfirm: async () => {
        rulesState.rules = RulePolicy.restoreDefaults({
          rules: rulesState.rules,
          defaultRules: window.RULES_MOCK_DATA.presetRules
        }).rules;
        const saveResult = await saveState();
        if (!saveResult.ok) return;
        renderRulesPage();
        showModal('公會原典已恢復', '所有系統法則已重新核對；自訂條文與原本的休止狀態均已保留。', 'book-check', { iconType: 'lucide' });
      }
    }
  );
};

// ==========================================
// 7. 今日冒險紀錄與公會任務結算 (Daily Log Submit)
// ==========================================
const DAILY_LOG_FIELD_LABELS = {
  'log-sleep': '睡眠時數',
  'log-water': '飲水總量',
  'log-exercise': '運動時間',
  'log-study': '研習時間',
  'log-expense': '本日支出',
  'log-impulse': '衝動購物',
  'log-sugary-drinks': '含糖飲料'
};

function getInvalidDailyLogFields() {
  return Object.entries(DAILY_LOG_FIELD_LABELS)
    .map(([id, label]) => ({ input: document.getElementById(id), label }))
    .filter(field => field.input && !field.input.validity.valid);
}

function clearDailyLogFieldError(input) {
  if (!input.validity.valid) return;
  input.removeAttribute('aria-invalid');
  input.closest('.form-input-group')?.classList.remove('is-invalid');
}

function refreshDailyLogValidationNotice() {
  const notice = document.getElementById('daily-log-validation');
  if (!notice || notice.hidden) return;
  const invalidFields = getInvalidDailyLogFields();
  if (invalidFields.length === 0) {
    resetDailyLogValidation();
    return;
  }
  renderDailyLogValidationNotice(invalidFields);
}

function resetDailyLogValidation() {
  const notice = document.getElementById('daily-log-validation');
  if (notice) notice.hidden = true;
  document.querySelectorAll('#daily-log-form [aria-invalid="true"]').forEach(input => {
    input.removeAttribute('aria-invalid');
    input.closest('.form-input-group')?.classList.remove('is-invalid');
  });
}

function renderDailyLogValidationNotice(invalidFields) {
  const notice = document.getElementById('daily-log-validation');
  const summary = document.getElementById('daily-log-validation-summary');
  const list = document.getElementById('daily-log-validation-list');

  if (summary) {
    summary.textContent = `還有 ${invalidFields.length} 項紀錄缺漏或超出允許範圍，請補寫後再次送交。`;
  }
  if (list) {
    const items = invalidFields.map(({ input, label }) => {
      const item = document.createElement('li');
      item.textContent = input.value.trim() === '' ? `${label}尚未填寫` : `${label}的數值不符合紀錄範圍`;
      return item;
    });
    list.replaceChildren(...items);
  }
  if (notice) notice.hidden = false;
}

function validateDailyLogForm() {
  const invalidFields = getInvalidDailyLogFields();

  if (invalidFields.length === 0) {
    resetDailyLogValidation();
    return true;
  }

  invalidFields.forEach(({ input }) => {
    input.setAttribute('aria-invalid', 'true');
    input.closest('.form-input-group')?.classList.add('is-invalid');
  });

  renderDailyLogValidationNotice(invalidFields);
  invalidFields[0].input.focus();
  return false;
}

function readDailyLogFormInput(form = document.getElementById('daily-log-form')) {
  return DailyFormSubmission.read(form);
}

function readDailyLogFormDraft(date = getSelectedRecordDate()) {
  return DailyDataEngine.createDraft({ date, draft: readDailyLogFormInput() });
}

function setMemberActionBusy(button, busy, busyLabel = '送交中…') {
  if (!button) return;
  const label = button.querySelector('strong') || button.querySelector('span:last-child') || button;
  if (!button.dataset.memberIdleLabel) button.dataset.memberIdleLabel = label.textContent;
  button.disabled = Boolean(busy);
  button.setAttribute('aria-busy', String(Boolean(busy)));
  label.textContent = busy ? busyLabel : button.dataset.memberIdleLabel;
}

function getMemberHabitActionButton(action, entityId) {
  return [...document.querySelectorAll(`[data-lifequest-action="${action}"]`)]
    .find(button => button.dataset.entityId === String(entityId)) || null;
}

async function handleMemberCommandFailure(result, actionLabel = '操作') {
  if (result?.cancelled || result?.localCleanupComplete) return;
  const errorCode = String(result?.errorCode || result?.reason || 'INTERNAL_ERROR');
  const isCurrent = memberAuthCoordinator?.captureRuntime?.() || (() => true);
  if (errorCode === 'AUTH_REQUIRED' || errorCode === 'SESSION_EXPIRED') {
    await cleanupInvalidMemberSession(result);
    return;
  }
  if (result?.state && activeMember) applyMemberGameplayProjection(result.state);

  if (errorCode === 'VERSION_CONFLICT') {
    const refreshed = await memberAuthCoordinator?.reloadMember();
    if (!isCurrent() || refreshed?.cancelled) return;
    showModal(
      '會員卷宗已在其他裝置更新',
      refreshed?.ok
        ? `公會已重新讀取最新卷宗。請確認畫面後，再手動重試「${actionLabel}」。`
        : '目前無法重新讀取最新卷宗，請檢查網路後再試；公會沒有套用這次操作。',
      'refresh-cw',
      { iconType: 'lucide' }
    );
    return;
  }

  const messages = {
    AUTH_REQUIRED: '會員登入已失效，請重新登入後再操作。',
    SESSION_EXPIRED: '會員登入已逾時，請重新登入後再操作。',
    AUTH_UNAVAILABLE: '會員驗證服務暫時無法連線，請稍後重試；尚未送出這次操作。',
    MEMBER_NOT_READY: '會員卷宗尚未完整載入，請先重新讀取卷宗。',
    MALFORMED_RESPONSE: '無法確認操作結果，請稍後安全重試。系統會沿用同一操作識別碼。',
    NETWORK_ERROR: '目前無法連線至公會伺服器。請保持本頁開啟並手動重試；系統會沿用同一操作識別碼。',
    OPERATION_IN_PROGRESS: '同一操作仍由公會處理中，請稍候再手動重試。',
    DAILY_LIMIT_REACHED: '今日回報已達公會規定上限，沒有新增紀錄或發放資源。',
    HABIT_EVENT_NOT_TODAY: '會員習慣事件只允許回報當日，公會沒有保存這次操作。',
    HABIT_NOT_FOUND: '找不到這份委託，請重新讀取會員卷宗後再試。',
    HABIT_EVENT_NOT_FOUND: '找不到這筆可復原的回報，請重新讀取會員卷宗後再試。',
    LIMIT_REACHED: '這項操作已達公會規定上限，沒有新增紀錄或變更資源。',
    FORBIDDEN: '目前會員無權執行這項操作。',
    REVERSAL_BLOCKED: '這筆回報已有後續依賴，為避免資源錯亂，公會拒絕復原。',
    DAILY_REVISION_BLOCKED: '這份結算已有後續依賴，公會無法安全撤銷並重新核定。',
    INVALID_BUSINESS_DATE: '紀錄日期不符合公會規則，請確認日期後再試。',
    BACKFILL_NOT_ALLOWED: '這個日期已超過會員可補記的期限。',
    INVALID_PAYLOAD: '送交內容不完整或格式不正確，請檢查後再試。',
    INSUFFICIENT_RESOURCE: '金幣或寶石不足，公會沒有完成這筆交易。',
    INSUFFICIENT_GOLD: '金幣不足，公會沒有完成這筆交易。',
    INSUFFICIENT_GEMS: '寶石不足，公會沒有完成這筆兌換。',
    INVENTORY_LIMIT_REACHED: '該消耗品已達持有上限，公會沒有扣除資源。',
    ITEM_ALREADY_OWNED: '這件唯一裝備已在背包中，不會重複購買。',
    INVENTORY_FULL: '該消耗品已達持有上限，公會沒有扣除金幣。',
    ITEM_NOT_AVAILABLE: '這項補給目前不在公會目錄中，請重新載入後再確認。',
    ITEM_NOT_OWNED: '會員背包中找不到這件物品。',
    ITEM_NOT_USABLE: '這件物品目前不能使用。',
    ITEM_NOT_EQUIPPABLE: '這件物品不能裝入裝備欄。',
    INVALID_EQUIPMENT_SLOT: '裝備欄位不正確，公會沒有變更目前裝備。',
    HP_ALREADY_FULL: '生命值已滿，藥水沒有被消耗。',
    TICKET_NOT_FOUND: '找不到這張犒賞券，請重新讀取會員卷宗。',
    TICKET_ALREADY_USED: '這張犒賞券已經使用，不能再次操作。',
    TICKET_ALREADY_REVERSED: '這張犒賞券已取消，不能再次操作。',
    TICKET_REVERSAL_BLOCKED: '這張犒賞券已有後續狀態，無法安全復原。',
    CATALOG_CHANGED: '補給目錄已更新，公會沒有成交。請重新確認最新價格。'
  };
  showModal(
    `${actionLabel}未完成`,
    messages[errorCode] || '公會伺服器未確認成功，因此畫面沒有套用任何獎勵、扣血或結算結果。請稍後再試。',
    result?.retryable ? 'wifi-off' : 'shield-alert',
    { iconType: 'lucide' }
  );
}

async function handleMemberEconomyFailure(result, actionLabel) {
  if (result?.cancelled || result?.localCleanupComplete) return;
  const errorCode = String(result?.errorCode || result?.reason || 'INTERNAL_ERROR');
  if (errorCode === 'CATALOG_CHANGED') {
    const isCurrent = memberAuthCoordinator?.captureRuntime?.() || (() => true);
    const refreshed = await memberAuthCoordinator?.reloadMember();
    if (!isCurrent() || refreshed?.cancelled) return;
    if (refreshed?.ok) applyMemberGameplayProjection(refreshed.state);
    showModal(
      '補給目錄已更新',
      refreshed?.ok
        ? '公會沒有完成交易，已重新載入最新目錄與價格。請重新確認後再操作。'
        : '公會沒有完成交易，目前也無法重新載入目錄；請稍後再試。',
      'refresh-cw',
      { iconType: 'lucide' }
    );
    return;
  }

  await handleMemberCommandFailure(result, actionLabel);
}

async function cleanupInvalidMemberSession(result) {
  const code = result?.errorCode || result?.reason;
  if (result?.cancelled || !['AUTH_REQUIRED', 'SESSION_EXPIRED'].includes(code)) return;
  try {
    if (!result.localCleanupComplete) await memberAuthCoordinator?.logout({ reason: 'session-expired' });
  } finally {
    if (!memberAuthCoordinator?.getSession?.()?.user) {
      clearMemberRuntimeForLogin();
      setAuthEntranceView('login');
      setAuthStatus(elements.authLoginStatus, '會員登入已失效，請重新登入後再操作。', { error: true });
    }
  }
}

async function runMemberEconomyAction({ actionLabel, execute, successTitle, successMessage, successIcon = 'receipt-text' }) {
  if (!activeMember || !memberAuthCoordinator || memberEconomyActionPending) return;
  const isCurrent = memberAuthCoordinator.captureRuntime?.() || (() => true);
  memberEconomyActionPending = true;
  renderMemberShopRewards();
  let cancelled = false;
  try {
    const result = await execute();
    cancelled = result?.cancelled === true || !isCurrent();
    if (cancelled) return; // This response belongs to a runtime already cleared by logout.
    if (!result?.ok) {
      await handleMemberEconomyFailure(result, actionLabel);
      cancelled = !isCurrent();
      return;
    }
    const authoritativeState = result.state || memberAuthCoordinator.getMemberState();
    applyMemberGameplayProjection(authoritativeState);
    showModal(
      successTitle,
      result.duplicate === true
        ? '公會已核對既有操作憑據，沒有再次扣除或發放任何資源。'
        : successMessage(result),
      successIcon,
      { iconType: 'lucide' }
    );
  } catch (_error) {
    cancelled = !isCurrent();
    if (cancelled) return;
    await handleMemberEconomyFailure({ errorCode: 'NETWORK_ERROR', retryable: true }, actionLabel);
    cancelled = !isCurrent();
  } finally {
    if (!cancelled) {
      memberEconomyActionPending = false;
      if (activeMember) renderMemberShopRewards();
    }
  }
}

window.requestMemberItemPurchase = function(itemKey) {
  const isCurrent = memberAuthCoordinator?.captureRuntime?.() || (() => Boolean(activeMember));
  const item = state.memberEconomy?.catalog?.find(candidate => candidate.itemKey === itemKey);
  if (!item || item.itemType === 'reward_ticket') return;
  showModal(
    `確認購買${item.displayName}`,
    `公會目錄顯示價格 ${item.estimatedPrice} ${item.currency === 'gold' ? '金幣' : item.currency}（目錄版本 ${item.catalogVersion}）。成交仍以伺服器最終核定為準。`,
    'hand-coins',
    {
      iconType: 'lucide',
      confirmLabel: '確認購買',
      cancelLabel: '取消交易',
      onConfirm: () => isCurrent() && runMemberEconomyAction({
        actionLabel: '購買補給',
        execute: () => memberAuthCoordinator.purchaseItem({
          itemKey: item.itemKey,
          seenCatalogVersion: item.catalogVersion
        }),
        successTitle: '補給交易完成',
        successMessage: () => `「${item.displayName}」已由公會伺服器登錄至會員背包。`,
        successIcon: 'receipt-text'
      })
    }
  );
};

window.requestMemberItemUse = function(itemKey) {
  const isCurrent = memberAuthCoordinator?.captureRuntime?.() || (() => Boolean(activeMember));
  const item = state.memberEconomy?.inventoryByKey?.[itemKey];
  if (!item) return;
  showModal('確認使用補給品', `使用「${item.displayName || item.itemKey}」？公會伺服器核定成功後才會扣除數量與恢復生命值。`, 'flask-conical', {
    iconType: 'lucide',
    confirmLabel: '確認使用',
    cancelLabel: '暫不使用',
    onConfirm: () => isCurrent() && runMemberEconomyAction({
      actionLabel: '使用補給品',
      execute: () => memberAuthCoordinator.useItem({ itemKey }),
      successTitle: '補給品使用完成',
      successMessage: result => `公會已核定使用「${item.displayName || item.itemKey}」${Number(result?.healAmount) > 0 ? `，恢復 ${Number(result.healAmount)} 點生命值` : ''}。`,
      successIcon: 'flask-conical'
    })
  });
};

window.requestMemberItemEquip = function(itemKey) {
  const item = state.memberEconomy?.inventoryByKey?.[itemKey];
  if (!item) return;
  return runMemberEconomyAction({
    actionLabel: '裝備物品',
    execute: () => memberAuthCoordinator.equipItem({ itemKey }),
    successTitle: '裝備登錄完成',
    successMessage: () => `「${item.displayName || item.itemKey}」已裝備；能力值以伺服器回傳的最終核算為準。`,
    successIcon: 'shield-check'
  });
};

window.requestMemberItemUnequip = function(slot) {
  const item = state.memberEconomy?.equipmentBySlot?.[slot];
  if (!item) return;
  return runMemberEconomyAction({
    actionLabel: '卸下裝備',
    execute: () => memberAuthCoordinator.unequipItem({ slot }),
    successTitle: '裝備已卸下',
    successMessage: () => `「${item.displayName || item.itemKey}」已回到背包；能力值已依雲端正本重新核算。`,
    successIcon: 'shield-off'
  });
};

window.requestMemberTicketRedemption = function(ticketKey) {
  const isCurrent = memberAuthCoordinator?.captureRuntime?.() || (() => Boolean(activeMember));
  const ticket = state.memberEconomy?.ticketCatalog?.find(candidate => candidate.itemKey === ticketKey);
  if (!ticket) return;
  showModal(`確認兌換${ticket.displayName}`, `需要 ${ticket.basePrice} 顆寶石（目錄版本 ${ticket.catalogVersion}）。兌換成功後會加入會員犒賞券持有簿。`, 'gem', {
    iconType: 'lucide',
    confirmLabel: '確認兌換',
    cancelLabel: '暫不兌換',
    onConfirm: () => isCurrent() && runMemberEconomyAction({
      actionLabel: '兌換犒賞券',
      execute: () => memberAuthCoordinator.redeemRewardTicket({
        ticketKey,
        seenCatalogVersion: ticket.catalogVersion
      }),
      successTitle: '犒賞券兌換完成',
      successMessage: () => `「${ticket.displayName}」已收入會員持有簿。`,
      successIcon: 'ticket-check'
    })
  });
};

window.requestMemberTicketUse = function(ticketInstanceId) {
  const isCurrent = memberAuthCoordinator?.captureRuntime?.() || (() => Boolean(activeMember));
  const ticket = state.memberEconomy?.rewardTickets?.find(candidate => candidate.id === ticketInstanceId);
  if (!ticket || ticket.status !== 'unused') return;
  showModal('確認使用犒賞券', `使用「${ticket.name || ticket.ticketKey}」後不能取消或退回寶石。`, 'badge-check', {
    iconType: 'lucide',
    confirmLabel: '確認使用',
    cancelLabel: '尚未使用',
    onConfirm: () => isCurrent() && runMemberEconomyAction({
      actionLabel: '使用犒賞券',
      execute: () => memberAuthCoordinator.useRewardTicket({ ticketInstanceId }),
      successTitle: '犒賞券已標記使用',
      successMessage: () => `「${ticket.name || ticket.ticketKey}」已由公會伺服器登錄為已使用。`,
      successIcon: 'badge-check'
    })
  });
};

window.requestMemberTicketReverse = function(ticketInstanceId) {
  const isCurrent = memberAuthCoordinator?.captureRuntime?.() || (() => Boolean(activeMember));
  const ticket = state.memberEconomy?.rewardTickets?.find(candidate => candidate.id === ticketInstanceId);
  if (!ticket || ticket.status !== 'unused') return;
  showModal('取消犒賞券兌換', '退回此犒賞券並退回原 Gems？只有未使用的犒賞券可以安全復原。', 'undo-2', {
    iconType: 'lucide',
    confirmLabel: '退回犒賞券',
    cancelLabel: '保留犒賞券',
    onConfirm: () => isCurrent() && runMemberEconomyAction({
      actionLabel: '取消犒賞券',
      execute: () => memberAuthCoordinator.reverseRewardTicket({ ticketInstanceId }),
      successTitle: '犒賞券已退回',
      successMessage: () => `「${ticket.name || ticket.ticketKey}」已取消，原始寶石成本由伺服器憑據退回。`,
      successIcon: 'undo-2'
    })
  });
};

async function submitMemberDailyEntry({ businessDate, input }) {
  const isCurrent = memberAuthCoordinator.captureRuntime?.() || (() => true);
  const datePolicy = getDailyRecordPolicy(businessDate);
  if (!datePolicy.allowed) {
    showModal('紀錄日期不在開放範圍', `公會目前只接受 ${datePolicy.minDate} 至 ${datePolicy.maxDate} 的紀錄。`, 'calendar-x', { iconType: 'lucide' });
    return;
  }

  const button = document.getElementById('btn-submit-log');
  if (button?.getAttribute('aria-busy') === 'true') return;
  setMemberActionBusy(button, true, '公會核定中…');
  try {
    const result = await memberAuthCoordinator.submitDailyEntry({
      businessDate,
      input
    });
    if (result?.cancelled || !isCurrent()) return;
    if (!result?.ok) {
      await handleMemberCommandFailure(result, '公會任務結算');
      return;
    }

    const authoritativeState = result.state || memberAuthCoordinator.getMemberState();
    applyMemberGameplayProjection(authoritativeState);
    const entry = state.dailyLogHistory.find(item => item.date === businessDate);
    if (!entry) {
      showModal('結算已核定但明細尚未載入', '公會已接受操作，請重新讀取會員卷宗；請勿立即重複送出。', 'refresh-cw', { iconType: 'lucide' });
      return;
    }
    renderCampSettlementFromEntry(entry, {
      isDuplicate: result.duplicate === true,
      isRevision: Number(entry.revision) > 1
    });
    setCampStage('settlement');
  } catch (_error) {
    if (!isCurrent()) return;
    await handleMemberCommandFailure({ errorCode: 'NETWORK_ERROR', retryable: true }, '公會任務結算');
  } finally {
    if (isCurrent()) setMemberActionBusy(button, false);
  }
}

window.submitDailyLog = async function(submittedInput = null) {
  if (!validateDailyLogForm()) return;
  const date = getSelectedRecordDate();
  const currentFormInput = submittedInput || readDailyLogFormInput();
  if (activeMember) {
    return submitMemberDailyEntry({ businessDate: date, input: currentFormInput });
  }

  const datePolicy = getDailyRecordPolicy(date);
  if (!datePolicy.allowed) {
    showModal('紀錄日期不在開放範圍', `公會目前只接受 ${datePolicy.minDate} 至 ${datePolicy.maxDate} 的紀錄。`, 'calendar-x', { iconType: 'lucide' });
    return;
  }
  const habitAudit = HabitEngine.auditDaily({
    events: state.habitEvents,
    tasks: state.tasks,
    date
  });
  if (!habitAudit.valid) {
    showModal(
      '習慣獎勵核對未通過',
      '公會發現重複操作或超出獎勵上限的紀錄，因此暫停結算，避免再次發放資源。請先復原最近的異常回報。',
      'shield-alert',
      { iconType: 'lucide' }
    );
    return;
  }
  const reconciled = DailyDataEngine.reconcile({
    date,
    draft: currentFormInput,
    tasks: state.tasks,
    habitEvents: state.habitEvents
  });
  const sleep = Number(reconciled.draft.sleep);
  const water = Number(reconciled.draft.water);
  const exercise = Number(reconciled.draft.exercise);
  const study = Number(reconciled.draft.study);
  const expense = Number(reconciled.draft.expense);
  const impulse = Number(reconciled.draft.impulse);
  const sugaryDrinks = Number(reconciled.draft.sugaryDrinks);
  reconciled.adjustments.forEach(adjustment => {
    const fieldId = {
      water: 'log-water',
      exercise: 'log-exercise',
      study: 'log-study',
      impulse: 'log-impulse',
      sugaryDrinks: 'log-sugary-drinks'
    }[adjustment.metric];
    const input = fieldId ? document.getElementById(fieldId) : null;
    if (input) input.value = adjustment.to;
  });
  let previousEntry = state.dailyLogHistory.find(entry => entry.date === date);
  let isRevision = false;
  if (previousEntry?.settlementTransaction) {
    const rollback = SettlementRevisionEngine.rollback(state, previousEntry.settlementTransaction);
    if (!rollback.ok) {
      const reason = rollback.reason === 'state_changed'
        ? '上一份結算後已有新的習慣回報、購買或戰鬥行動。為避免覆蓋後續進度，公會暫停重新核定；請先復原後續行動。'
        : '公會找不到上一份可逆結算明細。今日紀錄仍會保留，但暫時無法安全重新結算。';
      showModal('重新核定暫停', reason, 'file-warning', { iconType: 'lucide' });
      return;
    }
    state = rollback.state;
    rulesState.rules = state.rules;
    previousEntry = state.dailyLogHistory.find(entry => entry.date === date);
    isRevision = true;
  }
  const historyBeforeToday = state.dailyLogHistory.filter(entry => entry.date !== date);
  const rulesForEvaluation = rulesState.rules.map(rule => {
    let evaluatedRule = rule;
    if (rule.id === 'rule_2' && Array.isArray(rule.conditions)) {
      evaluatedRule = {
        ...evaluatedRule,
        conditionText: `支出 <= ${state.settings.dailyBudget} 且無衝動消費`,
        conditions: rule.conditions.map(condition =>
          condition.metric === 'expense'
            ? { ...condition, targetValue: state.settings.dailyBudget }
            : condition
        )
      };
    }
    return evaluatedRule;
  });
  const draft = {
    date,
    sleep,
    water,
    exercise,
    study,
    expense,
    impulse,
    sugaryDrinks,
    budgetLimitAtSettlement: state.settings.dailyBudget,
    budgetSnapshotEstimated: false,
    isBackfill: datePolicy.isBackfill,
    settledAt: new Date().toISOString(),
    habitDataVerifiedAt: reconciled.draft.habitDataVerifiedAt,
    habitEventAudit: {
      activeEventCount: habitAudit.activeEventCount,
      summary: habitAudit.summary
    },
    habitDataAdjustments: reconciled.adjustments
  };
  const settlement = SettlementEngine.calculate({
    entry: draft,
    rules: rulesForEvaluation,
    history: historyBeforeToday,
    habitEvents: state.habitEvents,
    dailyBudget: state.settings.dailyBudget,
    previousEntry: isRevision ? null : previousEntry,
    lastSettlementDate: isRevision ? null : state.meta.lastSettlementDate,
    character: state.character
  });
  const evaluation = settlement.evaluation;
  const settlementBeforeSnapshot = SettlementRevisionEngine.capture(state);
  const dailyRules = rulesForEvaluation.filter(rule => rule.enabled !== false && rule.type === 'daily');
  const upsert = StateStore.upsertDailyEntry(state, {
    ...draft,
    completedCount: evaluation.completedRuleIds.length,
    totalRuleCount: dailyRules.length,
    completedRuleIds: evaluation.completedRuleIds,
    failedRuleIds: evaluation.failedRuleIds,
    expGained: previousEntry?.expGained || 0,
    goldGained: previousEntry?.goldGained || 0,
    damageTaken: previousEntry?.damageTaken || 0,
    levelUpTo: previousEntry?.levelUpTo || null,
    triggeredBossRuleIds: !isRevision && Array.isArray(previousEntry?.triggeredBossRuleIds)
      ? previousEntry.triggeredBossRuleIds
      : []
  });

  if (settlement.isDuplicate && !isRevision) {
    const newBossCandidates = evaluation.triggeredBosses.filter(candidate =>
      settlement.newTriggeredBossRuleIds.includes(candidate.ruleId)
    );
    const bossTrigger = triggerBossCandidates(newBossCandidates, date, { announce: false });
    upsert.entry.triggeredBossRuleIds = [
      ...new Set([
        ...upsert.entry.triggeredBossRuleIds,
        ...settlement.newTriggeredBossRuleIds
      ])
    ];
    addLog(`📝 已更新 ${date} 的今日冒險紀錄；公會不會重複發放獎勵。`);
    const saveResult = await saveState();
    if (!saveResult.ok) return;
    renderAll();
    renderCampSettlementFromEntry(upsert.entry, {
      isDuplicate: true,
      bossSummoned: bossTrigger.summoned
    });
    setCampStage('settlement');
    return;
  }

  updateStatusDuration();
  addLog("=== 📜 今日冒險紀錄已送交公會，開始任務結算 ===");
  if (reconciled.changed) {
    addLog(`🔎 結算前已依 ${reconciled.activeEventCount} 筆習慣事件重新核對每日數據。`);
  }

  evaluation.completedRuleIds.forEach(id => {
    const rule = rulesForEvaluation.find(item => item.id === id);
    if (rule) addLog(`✓ 達成法則：${rule.name}`);
  });
  evaluation.failedRuleIds.forEach(id => {
    const rule = rulesForEvaluation.find(item => item.id === id);
    if (rule) addLog(`✗ 未達法則：${rule.name}`);
  });

  let finalExpGained = settlement.rewards.xp;
  let finalGoldGained = settlement.rewards.gold;
  if (settlement.critical) {
    addLog(`⚡ 觸發精力暴擊，法則獎勵加倍！`);
  }

  for (const [attribute, amount] of Object.entries(settlement.rewards.attributes)) {
    if (attribute in state.character.attributes) {
      state.character.attributes[attribute] = Math.max(
        1,
        state.character.attributes[attribute] + amount
      );
    }
  }
  const levelBeforeSettlement = state.character.level;
  addXp(finalExpGained, { announce: false });
  addGold(finalGoldGained);
  upsert.entry.expGained = finalExpGained;
  upsert.entry.goldGained = finalGoldGained;
  upsert.entry.levelUpTo = state.character.level > levelBeforeSettlement
    ? state.character.level
    : null;
  addLog(`🎉 達成 ${evaluation.completedRuleIds.length}/${dailyRules.length} 項公會任務法則，獲得 ${finalExpGained} EXP、${finalGoldGained} 金幣。`);

  const gemResult = DailyGemEngine.grantPerfectDay({
    character: state.character,
    transactions: state.gemTransactions,
    date,
    completedCount: evaluation.completedRuleIds.length,
    totalRuleCount: dailyRules.length,
    transactionId: `daily-perfect-${date}`,
    grantedAt: draft.settledAt
  });
  state.character = gemResult.character;
  state.gemTransactions = gemResult.transactions;
  upsert.entry.perfectDayGemAwarded = gemResult.granted;
  if (gemResult.granted) addLog(`💎 ${date} 的主線任務全數達成，獲得完美結算寶石 ×1。`);

  evaluation.triggeredEffectRuleIds.forEach(id => {
    const rule = rulesForEvaluation.find(item => item.id === id);
    if (!rule) return;
    if (rule.type === 'debuff') {
      const attribute = String(rule.attrName || 'energy').toLowerCase();
      const debuffResult = triggerDebuff(
        rule.id,
        `⚠️ ${rule.buffName || rule.name}`,
        { [attribute]: Number(rule.attrVal) || -1 },
        rule.duration || 1,
        date
      );
    } else if (rule.buffName) {
      const effectResult = StatusEffectEngine.apply({
        character: state.character,
        buffs: state.buffs,
        debuffs: state.debuffs,
        today: date,
        asOfDate: getTodayDateString(),
        effect: {
          id: rule.id,
          sourceRuleId: rule.id,
          type: 'buff',
          title: rule.buffName,
          duration: rule.duration || 1
        }
      });
      state.character = effectResult.character;
      state.buffs = effectResult.buffs;
      state.debuffs = effectResult.debuffs;
      if (Array.isArray(effectResult.statusEvents)) state.statusHistory.push(...effectResult.statusEvents);
    }
  });
  if (datePolicy.isBackfill) updateStatusDuration();

  const newBossCandidates = evaluation.triggeredBosses.filter(candidate =>
    settlement.newTriggeredBossRuleIds.includes(candidate.ruleId)
  );
  const bossTrigger = triggerBossCandidates(newBossCandidates, date, { announce: false });
  upsert.entry.triggeredBossRuleIds = [
    ...new Set([
      ...upsert.entry.triggeredBossRuleIds,
      ...settlement.newTriggeredBossRuleIds
    ])
  ];

  const failCount = evaluation.failedRuleIds.length;
  upsert.entry.damageTaken = failCount > 0 ? settlement.damage : 0;
  if (failCount > 0) {
    takeDamage(settlement.damage);
    addLog(`💔 未達 ${failCount} 項公會任務法則，受到 ${settlement.damage} 點生命傷害。`);
  }

  evaluateAchievements();
  advanceActiveBossChallenge(draft);

  state.meta.lastSettlementDate = !state.meta.lastSettlementDate || date > state.meta.lastSettlementDate
    ? date
    : state.meta.lastSettlementDate;
  upsert.entry.settlementTransaction = SettlementRevisionEngine.createTransaction(
    settlementBeforeSnapshot,
    SettlementRevisionEngine.capture(state)
  );
  delete state.dailyDrafts?.[date];
  const saveResult = await saveState();
  if (!saveResult.ok) return;
  renderAll();
  renderCampSettlementFromEntry(upsert.entry, {
    bossSummoned: bossTrigger.summoned,
    isRevision
  });
  setCampStage('settlement');
  triggerAICoach(true);
};

function updateStatusDuration() {
  const debuffTitles = new Map(state.debuffs.map(debuff => [debuff.id, debuff.title]));
  const result = StatusEffectEngine.tick({
    character: state.character,
    buffs: state.buffs,
    debuffs: state.debuffs,
    today: getTodayDateString()
  });
  state.character = result.character;
  state.buffs = result.buffs;
  state.debuffs = result.debuffs;
  if (Array.isArray(result.statusEvents)) state.statusHistory.push(...result.statusEvents);
  result.expiredDebuffIds.forEach(id => {
    addLog(`✨ 角色詛咒「${debuffTitles.get(id) || id}」已自然消除。`);
  });
}

function getTodayDateString() {
  return BusinessDatePolicy.today({
    timeZone: state.settings?.timeZone || BackendContract.DEFAULT_TIME_ZONE
  });
}

function triggerDebuff(id, title, effect, duration, recordDate = getTodayDateString()) {
  const result = StatusEffectEngine.apply({
    character: state.character,
    buffs: state.buffs,
    debuffs: state.debuffs,
    today: recordDate,
    asOfDate: getTodayDateString(),
    effect: { id, sourceRuleId: id, type: 'debuff', title, duration, attributes: effect }
  });
  state.character = result.character;
  state.buffs = result.buffs;
  state.debuffs = result.debuffs;
  if (Array.isArray(result.statusEvents)) state.statusHistory.push(...result.statusEvents);
  if (result.applied) addLog(`🚨 角色受到詛咒：${title}！`);
  if (result.historicalOnly) addLog(`📜 ${recordDate} 曾觸發「${title}」，但依真實日期計算已自然失效，不影響目前能力值。`);
  return result;
}

function takeDamage(amount) {
  state.character.hp = Math.max(0, state.character.hp - amount);
  const avatarEl = elements.avatarLarge;
  if (avatarEl) {
    avatarEl.classList.add('shake', 'hit-flash');
    setTimeout(() => avatarEl.classList.remove('shake', 'hit-flash'), 400);
  }
  if (state.character.hp <= 0) handleDeath();
}

function handleDeath() {
  const result = DeathEngine.resolve({
    state,
    items: SHOP_ITEMS,
    today: getTodayDateString()
  });
  state = result.state;
  state.statusHistory = Array.isArray(state.statusHistory) ? state.statusHistory : [];
  state.statusHistory.push(...result.statusEvents);
  rulesState.rules = state.rules;
  const equipmentNote = result.unequippedItemIds.length > 0
    ? `已解除 ${result.unequippedItemIds.length} 件裝備加成${result.destroyedItemIds.length ? '，裝配中的武器已損毀' : ''}`
    : '當時沒有裝備需要解除';
  const statusNote = result.clearedBuffIds.length + result.clearedDebuffIds.length > 0
    ? `並清除 ${result.clearedBuffIds.length + result.clearedDebuffIds.length} 項祝福／詛咒效果`
    : '且沒有殘留角色狀態';
  addLog(`💀 生命值歸零；扣除 ${result.loss} 金幣，${equipmentNote}，${statusNote}。`);
  showModal(
    '冒險者於神殿復甦',
    `扣除 ${result.loss} 金幣。${equipmentNote}，${statusNote}；所有相關能力值已完成核對。`,
    'skull',
    { iconType: 'lucide' }
  );
}

function addXp(amount, options = {}) {
  state.character.xp += amount;
  if (state.character.xp >= state.character.maxXp) {
    state.character.level++;
    state.character.xp -= state.character.maxXp;
    state.character.maxXp = state.character.level * 50;
    state.character.maxHp += 5;
    state.character.hp = state.character.maxHp;
    state.character.attributes.health += 1;
    state.character.attributes.energy += 1;
    state.character.attributes.wealth += 1;
    state.character.attributes.growth += 1;
    addLog(`🌟 恭喜升級至 等級 ${state.character.level}！全能力點數 +1！`);
    if (options.announce !== false) {
      showModal('🌟 等級提升！', `恭喜您升到了等級 ${state.character.level}！全能力值 +1，HP 已恢復全滿。`);
    }
  }
}

function addGold(amount) {
  state.character.gold += amount;
}

window.handleDeposit = async function() {
  const amt = parseInt(elements.inputSavings.value);
  if (isNaN(amt) || amt <= 0) return;
  if (state.character.gold < amt) {
    showModal('🏦 存入失敗', '您的背包中沒有足夠的金幣。');
    return;
  }
  state.character.gold -= amt;
  state.character.savings += amt;
  elements.inputSavings.value = '';
  addLog(`🏦 將 ${amt} 金幣存入儲蓄罐。`);
  evaluateAchievements();
  const saveResult = await saveState();
  if (!saveResult.ok) return;
  renderAll();
};

window.handleWithdraw = async function() {
  const amt = parseInt(elements.inputSavings.value);
  if (isNaN(amt) || amt <= 0) return;
  if (state.character.savings < amt) {
    showModal('🏦 領取失敗', '儲蓄罐內金幣餘額不足。');
    return;
  }
  state.character.savings -= amt;
  state.character.gold += amt;
  elements.inputSavings.value = '';
  addLog(`🏦 從儲蓄罐中領取了 ${amt} 金幣。`);
  const saveResult = await saveState();
  if (!saveResult.ok) return;
  renderAll();
};

window.handleHabitNew = function(id) {
  const habit = state.tasks.find(t => t.id === id);
  if (!habit) return;

  if (habit.direction === 'bad') {
    const warning = activeMember
      ? '公會伺服器將依正式規則核定生命傷害與習慣魔獸進度；瀏覽器不會自行扣血。'
      : `這會扣除 ${state.character.equipped.armor === 'armor_shield' ? 3 : 5} 點生命值，並計入習慣魔獸召喚進度。`;
    showModal(
      '警戒事件待確認',
      `確定登記「${stripPictographs(habit.title)}」？${warning}`,
      'triangle-alert',
      {
        iconType: 'lucide',
        confirmLabel: '確認登記事件',
        cancelLabel: '取消',
        onConfirm: () => commitHabitReport(id)
      }
    );
    return;
  }
  commitHabitReport(id);
};

async function commitHabitReport(id) {
  if (activeMember) return commitMemberHabitReport(id);
  const habit = state.tasks.find(t => t.id === id);
  if (!habit) return;
  if (habitActionLocks.has(id)) return;
  habitActionLocks.add(id);
  setTimeout(() => habitActionLocks.delete(id), 800);

  const today = getTodayDateString();
  const eventId = createOperationId('habit-event');
  const prepared = HabitEngine.prepareEvent({
    id: eventId,
    habit,
    date: today,
    character: state.character,
    boss: state.boss,
    existingEvents: state.habitEvents,
    operationKey: `habit-report-${eventId}`
  });
  if (!prepared.ok) {
    const message = prepared.reason === 'daily_report_limit'
      ? `「${stripPictographs(habit.title)}」今天已達 ${prepared.maxDailyReports} 次回報上限；公會沒有新增紀錄或變更資源。`
      : '這次操作已經處理過，公會沒有重複登記或發放獎勵。';
    showModal('回報未重複受理', message, 'shield-check', { iconType: 'lucide' });
    return;
  }
  const event = prepared.event;
  event.dailyDraftBefore = state.dailyDrafts?.[today]
    ? JSON.parse(JSON.stringify(state.dailyDrafts[today]))
    : null;
  event.beforeSnapshot = HabitEngine.captureSnapshot(state);
  habit.dailyCounts = habit.dailyCounts || {};
  habit.dailyCounts[today] = (Number(habit.dailyCounts[today]) || 0) + 1;
  habit.count = (Number(habit.count) || 0) + 1;

  const draftResult = DailyDataEngine.applyHabitReport({
    draft: getRecordDraft(today),
    habit,
    date: today
  });
  if (draftResult.changed) saveRecordDraft(draftResult.draft);
  event.dailyDraftAfter = draftResult.changed
    ? JSON.parse(JSON.stringify(draftResult.draft))
    : event.dailyDraftBefore;

  if (event.direction === 'good' && event.rewardGranted) {
    addXp(event.effect.xp);
    addGold(event.effect.gold);
    addLog(`完成訓練任務『${habit.title}』，獲得 ${event.effect.xp} EXP 與 ${event.effect.gold} 金幣！`);
  } else if (event.direction === 'good') {
    addLog(`完成訓練任務『${habit.title}』；今日獎勵已達上限，本次只保留真實回報。`);
  } else {
    const damage = Math.abs(event.effect.hp);
    takeDamage(damage);
    addLog(`記錄負面事件『${habit.title}』，扣除 ${damage} HP。`);
  }
  state.habitEvents.push(event);
  if (event.direction === 'bad') {
    evaluateHabitBossCandidates(today);
  }
  evaluateAchievements();
  event.afterSnapshot = HabitEngine.captureSnapshot(state);
  const saveResult = await saveState();
  if (!saveResult.ok) return;
  renderAll();
}

async function commitMemberHabitReport(id) {
  const isCurrent = memberAuthCoordinator.captureRuntime?.() || (() => true);
  const habit = state.tasks.find(task => task.id === id);
  if (!habit || habitActionLocks.has(id)) return;
  habitActionLocks.add(id);
  const button = getMemberHabitActionButton('habit-report', id);
  setMemberActionBusy(button, true, '核定中…');
  try {
    const habitId = habit.isSystem ? (habit.systemKey || habit.id) : habit.id;
    const result = await memberAuthCoordinator.reportHabitEvent({
      habitId,
      businessDate: getTodayDateString()
    });
    if (result?.cancelled || !isCurrent()) return;
    if (!result?.ok) {
      await handleMemberCommandFailure(result, '習慣回報');
      return;
    }
    applyMemberGameplayProjection(result.state || memberAuthCoordinator.getMemberState());
    const event = state.habitEvents.find(item => item.id === result.eventId)
      || window.LifeQuestMemberAuth.selectLatestHabitEvent(state.habitEvents);
    const note = result.duplicate === true
      ? '公會辨識到相同操作，已顯示最新卷宗，沒有重複發放獎勵或扣血。'
      : event?.rewardGranted === false
      ? '回報已保存；今日獎勵已達上限，本次沒有重複發放資源。'
      : '回報已由公會伺服器核定，角色資源與事件進度已更新。';
    showModal('習慣回報已核定', note, 'badge-check', { iconType: 'lucide' });
  } catch (_error) {
    if (!isCurrent()) return;
    await handleMemberCommandFailure({ errorCode: 'NETWORK_ERROR', retryable: true }, '習慣回報');
  } finally {
    if (isCurrent()) {
      habitActionLocks.delete(id);
      setMemberActionBusy(button, false);
    }
  }
}

window.undoLastHabitEvent = async function(eventId = null) {
  const latest = eventId
    ? (state.habitEvents || []).find(event => event.id === eventId && !event.reversedAt)
    : window.LifeQuestMemberAuth.selectLatestHabitEvent(state.habitEvents);
  if (!latest) return;
  if (activeMember) {
    const lockKey = `reverse:${latest.id}`;
    const isCurrent = memberAuthCoordinator.captureRuntime?.() || (() => true);
    if (habitActionLocks.has(lockKey)) return;
    habitActionLocks.add(lockKey);
    const button = getMemberHabitActionButton('habit-undo', latest.id);
    setMemberActionBusy(button, true, '復原中…');
    try {
      const commandResult = await memberAuthCoordinator.reverseHabitEvent({
        eventId: latest.id,
        businessDate: getTodayDateString()
      });
      if (commandResult?.cancelled || !isCurrent()) return;
      if (!commandResult?.ok) {
        await handleMemberCommandFailure(commandResult, '復原習慣回報');
        return;
      }
      applyMemberGameplayProjection(commandResult.state || memberAuthCoordinator.getMemberState());
      showModal(
        '習慣回報已復原',
        commandResult.duplicate === true
          ? '公會已顯示最新卷宗；相同復原操作沒有再次變更資源。'
          : '公會已安全撤銷該事件及其可逆資源影響。',
        'undo-2',
        { iconType: 'lucide' }
      );
    } catch (_error) {
      if (!isCurrent()) return;
      await handleMemberCommandFailure({ errorCode: 'NETWORK_ERROR', retryable: true }, '復原習慣回報');
    } finally {
      if (isCurrent()) {
        habitActionLocks.delete(lockKey);
        setMemberActionBusy(button, false);
      }
    }
    return;
  }
  const result = HabitEngine.undo({ state, eventId: latest.id });
  if (!result.ok) {
    const message = result.reason === 'state_changed'
      ? '這筆紀錄之後角色資源已變動，為避免覆蓋後續資料，無法自動復原。'
      : '目前找不到可安全復原的上一筆任務／事件紀錄。';
    showModal('↩️ 無法復原', message, '↩️');
    return;
  }
  state = result.state;
  state.dailyDrafts = state.dailyDrafts || {};
  if (latest.dailyDraftBefore) state.dailyDrafts[latest.date] = latest.dailyDraftBefore;
  else delete state.dailyDrafts[latest.date];
  rulesState.rules = state.rules;
  addLog(`↩️ 已復原任務／事件紀錄「${latest.title}」，並還原該次行動造成的獎勵或扣血。`);
  const saveResult = await saveState();
  if (!saveResult.ok) return;
  renderAll();
};

function unlockAchievement(id) {
  const ach = state.achievements.find(a => a.id === id);
  if (ach && !ach.unlocked) {
    ach.unlocked = true;
    ach.progress = Math.max(1, Number(ach.target) || 1);
    ach.unlockedAt = getTodayDateString();
    state.character.gems += 5;
    addLog(`🏆 解鎖冒險者勳章：${ach.title}！獲得 💎 x 5`);
    showModal('🏆 勳章解鎖！', `您解鎖了勳章【${ach.title}】！獲得獎勵 💎 x 5`);
  }
}

function evaluateAchievements(flags = {}) {
  const result = AchievementRewardEngine.evaluateAndGrant({
    achievements: state.achievements,
    history: state.dailyLogHistory,
    habitEvents: state.habitEvents || [],
    character: state.character,
    flags,
    today: getTodayDateString()
  });
  state.achievements = result.achievements;
  state.character = result.character;
  result.newlyUnlockedIds.forEach(id => {
    const achievement = state.achievements.find(item => item.id === id);
    if (!achievement) return;
    addLog(`🏆 解鎖冒險者勳章：${achievement.title}！獲得 💎 x 5`);
    showModal('🏆 勳章解鎖！', `您解鎖了勳章【${achievement.title}】！獲得獎勵 💎 x 5`);
  });
}

window.requestEquipmentTrade = function(id) {
  const item = SHOP_ITEMS.find(candidate => candidate.id === id);
  if (!item) return;
  const discount = Math.min(0.2, Math.max(0, Number(state.character.attributes?.wealth) || 0) * 0.01);
  const cost = Math.floor(Math.max(0, Number(item.cost) || 0) * (1 - discount));
  const owned = state.inventory.includes(id);
  if (!owned && state.character.gold < cost) {
    showModal('金幣不足', `需要 ${cost} 金幣，目前只有 ${state.character.gold} 金幣。`, 'coins', { iconType: 'lucide' });
    return;
  }
  const before = state.character.gold;
  const after = owned ? before : before - cost;
  const operationId = createOperationId('supply');
  showModal(
    owned ? '確認重新裝備' : `確認購買${stripPictographs(item.title)}`,
    owned
      ? `這件裝備已在背包內，不會再次扣款。公會將替換同欄位目前裝備。`
      : `價格 ${cost} 金幣；目前持有 ${before} 金幣，成交後剩餘 ${after} 金幣。`,
    owned ? 'shirt' : 'hand-coins',
    {
      iconType: 'lucide',
      confirmLabel: owned ? '確認重新裝備' : '確認購買',
      cancelLabel: '取消交易',
      onConfirm: () => completeEquipmentTrade(item.id, operationId)
    }
  );
};

async function completeEquipmentTrade(itemId, operationId) {
  const item = SHOP_ITEMS.find(candidate => candidate.id === itemId);
  if (!item) return;
  const result = await executeGameCommand({
    type: 'PURCHASE_SUPPLY',
    operationId,
    payload: { itemId }
  });
  if (!result.ok) {
    if (result.reason === 'already_equipped') return;
    showModal(
      '交易未完成',
      result.reason === 'insufficient_gold' ? '目前金幣不足。' : '公會無法核對或保存這筆交易，資源沒有被扣除。',
      'circle-alert',
      { iconType: 'lucide' }
    );
    return;
  }
  if (result.reason === 'purchased_and_used') {
    addLog(`🧪 購買並使用「${item.title}」，恢復 ${result.restoredHp} 點生命值。`);
    renderAll();
    showModal('補給品已使用', `交易完成，恢復 ${result.restoredHp} 點生命值。`, 'flask-conical', { iconType: 'lucide' });
    return;
  }
  addLog(result.reason === 'equipped_owned'
    ? `🛡️ 已重新裝備「${item.title}」，沒有扣除金幣。`
    : `⚔️ 已購買並裝備「${item.title}」，扣除 ${result.cost} 金幣。`);
  renderAll();
  showModal(result.reason === 'equipped_owned' ? '重新裝備完成' : '裝備交易完成', `「${stripPictographs(item.title)}」目前已在裝備欄生效。`, 'shield-check', { iconType: 'lucide' });
}

window.requestSupplyCorrection = function(transactionId) {
  const transaction = state.supplyTransactions.find(item => item.id === transactionId);
  if (!transaction || transaction.type !== 'equipment_purchase') return;
  const operationId = createOperationId('supply-correction');
  showModal(
    '更正裝備交易？',
    `公會將收回「${stripPictographs(transaction.itemName || transaction.itemId)}」並退回 ${Number(transaction.cost) || 0} 金幣。原交易不會刪除，會新增一張更正憑證。`,
    'history',
    {
      iconType: 'lucide',
      confirmLabel: '收回裝備並更正',
      cancelLabel: '保留交易',
      onConfirm: async () => {
        const result = await executeGameCommand({
          type: 'REVERSE_SUPPLY_PURCHASE',
          operationId,
          payload: { transactionId }
        });
        if (!result.ok) {
          const messages = {
            already_corrected: '這筆交易已經完成更正，不能再次退款。',
            item_unavailable: '裝備已不在背包中，可能已因角色死亡損毀，無法安全更正。'
          };
          showModal('交易更正暫停', messages[result.reason] || '這筆補給交易無法安全更正。', 'file-warning', { iconType: 'lucide' });
          return;
        }
        addLog(`↩️ 已更正裝備交易「${transaction.itemName}」，退回 ${result.refund} 金幣並保留更正憑證。`);
        renderAll();
        showModal('補給交易已更正', `裝備已收回，${result.refund} 金幣已退還。原交易與更正憑證均保留在交易簿。`, 'scroll-check', { iconType: 'lucide' });
      }
    }
  );
};

window.requestRewardTicket = function(ticketId) {
  const ticket = REWARD_TICKET_CATALOG.find(item => item.id === ticketId);
  if (!ticket) return;
  if (state.character.gems < ticket.cost) {
    showModal('寶石不足', `需要 ${ticket.cost} 顆寶石，目前只有 ${state.character.gems} 顆。`, 'gem', { iconType: 'lucide' });
    return;
  }
  const operationId = createOperationId('reward-ticket');
  showModal(
    `兌換${ticket.title}`,
    `需要 ${ticket.cost} 顆寶石；目前持有 ${state.character.gems} 顆，兌換後剩餘 ${state.character.gems - ticket.cost} 顆。`,
    'ticket-check',
    {
      iconType: 'lucide',
      confirmLabel: '確認兌換',
      cancelLabel: '暫不兌換',
      onConfirm: () => completeRewardTicketRedemption(ticket.id, operationId)
    }
  );
};

async function completeRewardTicketRedemption(ticketId, operationId) {
  const result = await executeGameCommand({
    type: 'REDEEM_REWARD_TICKET',
    operationId,
    payload: { ticketId }
  });
  if (!result.ok) {
    showModal('兌換未完成', result.reason === 'insufficient_gems' ? '寶石數量不足。' : '這筆兌換已處理或資料不完整。', 'circle-alert', { iconType: 'lucide' });
    return;
  }
  addLog(`🎟️ 已兌換「${result.ticket.nameSnapshot}」，消耗 ${result.ticket.costSnapshot} 顆寶石。`);
  renderAll();
  showModal('犒賞券已登錄', `「${result.ticket.nameSnapshot}」已收進持有簿，使用後請記得標記。`, 'ticket-check', { iconType: 'lucide' });
}

window.useRewardTicket = function(ownedTicketId) {
  const ticket = state.rewardTickets.find(item => item.id === ownedTicketId);
  if (!ticket || ticket.status !== 'unused') return;
  const operationId = createOperationId('reward-ticket-use');
  showModal('確認使用犒賞券', `使用「${ticket.nameSnapshot}」後便不能取消兌換或退回寶石。`, 'badge-check', {
    iconType: 'lucide',
    confirmLabel: '確認已使用',
    cancelLabel: '尚未使用',
    onConfirm: async () => {
      const result = await executeGameCommand({
        type: 'USE_REWARD_TICKET',
        operationId,
        payload: { ownedTicketId }
      });
      if (!result.ok) return;
      addLog(`✅ 犒賞券「${result.ticket.nameSnapshot}」已標記使用。`);
      renderAll();
    }
  });
};

window.reverseRewardTicket = function(ownedTicketId) {
  const ticket = state.rewardTickets.find(item => item.id === ownedTicketId);
  if (!ticket || ticket.status !== 'unused') return;
  const operationId = createOperationId('reward-ticket-reverse');
  showModal('取消犒賞券兌換', `取消後會退回 ${ticket.costSnapshot} 顆寶石；只有未使用的券可以復原。`, 'undo-2', {
    iconType: 'lucide',
    confirmLabel: '取消並退回寶石',
    cancelLabel: '保留犒賞券',
    onConfirm: async () => {
      const result = await executeGameCommand({
        type: 'REVERSE_REWARD_TICKET',
        operationId,
        payload: { ownedTicketId }
      });
      if (!result.ok) return;
      addLog(`↩️ 已取消「${result.ticket.nameSnapshot}」，退回 ${result.ticket.costSnapshot} 顆寶石。`);
      renderAll();
    }
  });
};

function equipItemSlot(id) {
  const result = EquipmentEngine.equip({
    character: state.character,
    items: SHOP_ITEMS,
    itemId: id
  });
  state.character = result.character;
}

window.deleteCustomReward = async function(id) {
  state.customRewards = state.customRewards.filter(r => r.id !== id);
  const saveResult = await saveState();
  if (!saveResult.ok) return;
  renderAll();
};

window.deleteTask = function(id) {
  const memberAction = Boolean(activeMember);
  const isCurrentIntent = memberAction ? (memberAuthCoordinator.captureRuntime?.() || (() => true)) : (() => true);
  const habit = state.tasks.find(item => item.id === id);
  if (!habit) return;
  if (habit.isSystem) {
    showModal(
      '系統委託受保護',
      '這份委託提供每日數據與規則的固定語意，不能撤下或改變好／壞性質；你仍可修改顯示名稱。',
      'lock-keyhole',
      { iconType: 'lucide' }
    );
    return;
  }
  showModal(
    '撤下委託確認',
    `確定從委託板撤下「${stripPictographs(habit.title)}」？既有回報歷史會保留，撤下後可立即復原。`,
    'archive-x',
    {
      iconType: 'lucide',
      confirmLabel: '確認撤下',
      cancelLabel: '保留委託',
      onConfirm: async () => {
        if (!isCurrentIntent()) return;
        if (activeMember) {
          const isCurrent = memberAuthCoordinator.captureRuntime?.() || (() => true);
          const result = await memberAuthCoordinator.removeCustomHabit({ habitId: id });
          if (result?.cancelled || !isCurrent()) return;
          if (!result.ok) {
            await handleMemberCommandFailure(result, '撤下委託');
            return;
          }
          if (editingHabitId === id) resetHabitEditor();
          addLog(`📌 已撤下委託／事件「${habit.title}」，可從撤除紀錄恢復。`);
          return;
        }
        if (editingHabitId === id) resetHabitEditor();
        const index = state.tasks.findIndex(item => item.id === id);
        const removed = state.tasks.splice(index, 1)[0];
        state.meta.lastRemovedHabit = { habit: removed, index, removedAt: new Date().toISOString() };
        addLog(`📌 已撤下委託／事件「${removed.title}」，歷史紀錄仍然保留。`);
        const saveResult = await saveState();
        if (!saveResult.ok) return;
        renderAll();
      }
    }
  );
};

window.restoreLastRemovedHabit = async function() {
  const record = state.meta?.lastRemovedHabit;
  if (!record?.habit || state.tasks.some(item => item.id === record.habit.id)) return;
  if (activeMember) {
    const isCurrent = memberAuthCoordinator.captureRuntime?.() || (() => true);
    const result = await memberAuthCoordinator.restoreCustomHabit({ habitId: record.habit.id });
    if (result?.cancelled || !isCurrent()) return;
    if (!result.ok) {
      await handleMemberCommandFailure(result, '恢復委託');
      return;
    }
    addLog(`↩️ 已恢復委託／事件「${record.habit.title}」。`);
    return;
  }
  const index = Math.min(Math.max(0, Number(record.index) || 0), state.tasks.length);
  state.tasks.splice(index, 0, record.habit);
  state.meta.lastRemovedHabit = null;
  addLog(`↩️ 已恢復委託／事件「${record.habit.title}」。`);
  const saveResult = await saveState();
  if (!saveResult.ok) return;
  renderAll();
};

// ==========================================
// 8. 習慣魔獸戰役 (Boss Engine)
// ==========================================
function captureBossCorrectionState() {
  return {
    boss: JSON.parse(JSON.stringify(state.boss)),
    character: JSON.parse(JSON.stringify(state.character)),
    bossHistory: JSON.parse(JSON.stringify(state.bossHistory)),
    achievements: JSON.parse(JSON.stringify(state.achievements)),
    processedIncidentKeys: JSON.parse(JSON.stringify(state.meta.processedBossIncidentKeys))
  };
}

function recordBossAction(actionType, actionDate, beforeSnapshot) {
  const result = BossEngine.recordAction({
    transactions: state.bossTransactions,
    id: createOperationId(`boss-${actionType}`),
    actionType,
    incidentKey: state.boss.incidentKey || beforeSnapshot.boss?.incidentKey || null,
    actionDate,
    before: beforeSnapshot,
    after: captureBossCorrectionState(),
    occurredAt: new Date().toISOString()
  });
  if (result.ok) state.bossTransactions = result.transactions;
}

function evaluateHabitBossCandidates(date = getTodayDateString()) {
  const habitBossRules = rulesState.rules.filter(rule =>
    rule.enabled !== false && rule.type === 'boss' && rule.source === 'habitEvents'
  );
  const evaluation = RuleEngine.evaluate(
    { date },
    habitBossRules,
    [],
    { habitEvents: state.habitEvents }
  );
  return triggerBossCandidates(evaluation.triggeredBosses, date);
}

function triggerBossCandidates(candidates = [], date = getTodayDateString(), options = {}) {
  const beforeSnapshot = captureBossCorrectionState();
  const result = BossEngine.summon({
    boss: state.boss,
    definitions: BOSS_DEFINITIONS,
    candidates,
    today: date,
    processedIncidentKeys: state.meta.processedBossIncidentKeys
  });
  state.meta.processedBossIncidentKeys = result.processedIncidentKeys;
  if (!result.summoned) return result;

  state.boss = result.boss;
  state.bossHistory.push({
    incidentKey: state.boss.incidentKey,
    bossId: state.boss.id,
    summonedAt: date,
    defeatedAt: null,
    rewardGranted: false
  });
  recordBossAction('summon', date, beforeSnapshot);
  addLog(`🚨 公會警報！習慣魔獸【${state.boss.name}】被召喚了！`);
  if (options.announce !== false) {
    showModal(
      '🚨 習慣魔獸現身！',
      `【${state.boss.name}】出現了。召喚原因：${state.boss.description} 討伐契約：${state.boss.challenge.title}`,
      state.boss.icon
    );
  }
  return result;
}

function advanceActiveBossChallenge(entry) {
  if (!state.boss.active || !state.boss.challenge) return;
  const beforeSnapshot = captureBossCorrectionState();
  const challengeTitle = state.boss.challenge.title;
  const result = BossEngine.advanceChallenge({
    boss: state.boss,
    character: state.character,
    entry,
    habitEvents: state.habitEvents,
    settings: state.settings
  });
  state.boss = result.boss;
  state.character = result.character;

  if (result.advanced) {
    if (result.defeated) {
      addLog(`⚔️ 完成討伐契約「${challengeTitle}」，造成 ${result.damage} 點傷害並擊敗習慣魔獸！`);
      completeBossDefeat(result.rewards, entry.date);
    } else {
      addLog(`⚔️ 討伐契約進度 ${state.boss.challenge.progress}/${state.boss.challenge.target}，造成 ${result.damage} 點傷害。`);
    }
  } else if (result.reset) {
    addLog(`💔 討伐契約「${challengeTitle}」進度中斷，重新從 0 開始。`);
  }
  if (result.advanced || result.reason === 'condition_failed') {
    recordBossAction('challenge_progress', entry.date, beforeSnapshot);
  } else if (result.reason === 'before_summon') {
    addLog(`📜 ${entry.date} 早於魔獸召喚日 ${state.boss.summonedOn || state.boss.summonedAt}，本次補記不計入討伐進度。`);
  }
}

function completeBossDefeat(rewards = { gold: 0, gems: 0 }, actionDate = getTodayDateString()) {
  const incident = state.bossHistory.find(item =>
    item.incidentKey === state.boss.incidentKey
  );
  if (incident && !incident.rewardGranted) {
    incident.defeatedAt = actionDate;
    incident.rewardGranted = true;
  }
  evaluateAchievements({ bossDefeated: true });
  addLog(`🏆 成功擊倒習慣魔獸！獲得獎勵 🪙 x ${rewards.gold}，💎 x ${rewards.gems}`);
  showModal('🏆 戰役凱旋', '恭喜！您完成討伐契約並擊敗了習慣魔獸，這項生活習慣已獲得改善。');
}

window.correctLatestBossAction = function() {
  const correctedIds = new Set(state.bossTransactions
    .filter(transaction => transaction.type === 'boss_correction')
    .map(transaction => transaction.correctsTransactionId));
  const latest = [...state.bossTransactions].reverse().find(transaction =>
    transaction.type === 'boss_action' && !correctedIds.has(transaction.id)
  );
  if (!latest) {
    showModal('沒有可更正的戰役操作', '公會戰役簿目前沒有尚未更正的召喚或討伐紀錄。', 'scroll', { iconType: 'lucide' });
    return;
  }
  const label = latest.actionType === 'summon' ? '召喚事件' : '討伐進度';
  showModal(
    `更正最近${label}？`,
    `將回復 ${latest.actionDate || '最近一次'} 操作前的 Boss、獎勵與勳章狀態，並保留一筆更正紀錄。只有在戰役後沒有其他相關變動時才會執行。`,
    'history',
    {
      iconType: 'lucide',
      confirmLabel: '確認更正',
      cancelLabel: '保留紀錄',
      onConfirm: async () => {
        const result = BossEngine.correctLatest({
          boss: state.boss,
          character: state.character,
          bossHistory: state.bossHistory,
          achievements: state.achievements,
          processedIncidentKeys: state.meta.processedBossIncidentKeys,
          transactions: state.bossTransactions,
          correctionId: createOperationId('boss-correction'),
          correctedAt: new Date().toISOString()
        });
        if (!result.ok) {
          const message = result.reason === 'state_changed'
            ? '戰役後已有新的角色、獎勵或 Boss 變動。為避免覆蓋後續資料，這筆操作不能直接更正。'
            : '公會無法找到可安全更正的戰役紀錄。';
          showModal('戰役更正暫停', message, 'file-warning', { iconType: 'lucide' });
          return;
        }
        state.boss = result.boss;
        state.character = result.character;
        state.bossHistory = result.bossHistory;
        state.achievements = result.achievements;
        state.meta.processedBossIncidentKeys = result.processedIncidentKeys;
        state.bossTransactions = result.transactions;
        addLog(`↩️ 已更正 ${result.correctedTransaction.actionDate || '最近一次'} 的 Boss ${label}，原紀錄與更正憑證均已保留。`);
        const saveResult = await saveState();
        if (!saveResult.ok) return;
        renderAll();
      }
    }
  );
};

function getBossTriggerProgress(rule, today = getTodayDateString()) {
  if (!rule) return { current: 0, target: 1, reason: '找不到對應法典條文' };
  const start = new Date(`${today}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - 6);
  const periodEntries = state.dailyLogHistory
    .filter(entry => new Date(`${entry.date}T00:00:00Z`) >= start && entry.date <= today);
  const configuredTarget = Number(rule.consecutive) > 1
    ? Number(rule.consecutive)
    : rule.dynamicTarget === 'weeklyBudget'
    ? periodEntries.reduce(
        (sum, entry) => sum + (
          Number(entry.budgetLimitAtSettlement) > 0
            ? Number(entry.budgetLimitAtSettlement)
            : Number(state.settings.dailyBudget)
        ),
        0
      ) + Math.max(0, 7 - new Set(periodEntries.map(entry => entry.date)).size) * Number(state.settings.dailyBudget)
    : Number(rule.targetValue) || Number(rule.consecutive) || 1;
  const target = Math.max(1, configuredTarget);
  if (rule.enabled === false) return { current: 0, target, reason: '法典條文目前休止' };
  let current = 0;
  if (rule.source === 'habitEvents') {
    current = state.habitEvents.filter(event => {
      const matchesHabit = rule.habitKey
        ? (event?.habitKey || event?.habitId) === rule.habitKey
        : event?.habitId === rule.habitId;
      if (!event || event.reversedAt || !matchesHabit) return false;
      const date = new Date(`${event.date}T00:00:00Z`);
      return date >= start && event.date <= today;
    }).length;
  } else if (rule.aggregate === 'sum') {
    current = periodEntries
      .reduce((sum, entry) => sum + (Number(entry[rule.metric]) || 0), 0);
  } else if (rule.consecutive) {
    const entries = state.dailyLogHistory
      .filter(entry => entry.date <= today)
      .sort((a, b) => b.date.localeCompare(a.date));
    let expectedDate = today;
    for (const entry of entries) {
      if (entry.date !== expectedDate) break;
      const actual = Number(entry[rule.metric]);
      const matched = rule.operator === '<' ? actual < Number(rule.targetValue)
        : rule.operator === '<=' ? actual <= Number(rule.targetValue)
        : rule.operator === '>' ? actual > Number(rule.targetValue)
        : rule.operator === '>=' ? actual >= Number(rule.targetValue)
        : actual === Number(rule.targetValue);
      if (!matched) break;
      current += 1;
      const cursor = new Date(`${expectedDate}T00:00:00Z`);
      cursor.setUTCDate(cursor.getUTCDate() - 1);
      expectedDate = cursor.toISOString().slice(0, 10);
    }
  }
  const incidentKey = `${rule.id}:${today}`;
  let reason = current >= target ? '條件已達成，等待公會召喚判定' : `尚差 ${Math.max(0, target - current)} 個進度`;
  if (state.meta.processedBossIncidentKeys.includes(incidentKey)) reason = '本次召喚事件已處理';
  if (state.boss.active && state.boss.triggerRuleId !== rule.id) reason = `目前由「${stripPictographs(state.boss.name)}」佔據戰場`;
  return { current, target, reason };
}

function renderBossIntelligence() {
  if (state && Array.isArray(state.rules) && state.rules.length > 0) {
    rulesState.rules = state.rules;
  }
  let rules = (rulesState.rules || []).filter(rule => rule.type === 'boss' && rule.bossId);
  if (rules.length === 0 && DEFAULT_STATE && Array.isArray(DEFAULT_STATE.rules)) {
    rules = DEFAULT_STATE.rules.filter(rule => rule.type === 'boss' && rule.bossId);
  }
  return `
    <section class="boss-intelligence-ledger" aria-label="習慣魔獸召喚情報">
      <header><i data-lucide="scan-search"></i><div><strong>公會討伐情報</strong><span>公開目前觸發條件、進度與未召喚原因</span></div></header>
      <div class="boss-intelligence-list">
        ${rules.map(rule => {
          const definition = (BOSS_DEFINITIONS || []).find(item => item.id === rule.bossId);
          const intel = getBossTriggerProgress(rule);
          return `<article>
            <div><small>${escapeHtml(definition ? stripPictographs(definition.name) : rule.bossId)}</small><strong>${escapeHtml(rule.conditionText)}</strong></div>
            <span class="boss-trigger-progress">${intel.current} / ${intel.target}</span>
            <p>${escapeHtml(intel.reason)}</p>
          </article>`;
        }).join('')}
      </div>
    </section>`;
}

function renderBossCorrectionControl() {
  const correctedIds = new Set(state.bossTransactions
    .filter(transaction => transaction.type === 'boss_correction')
    .map(transaction => transaction.correctsTransactionId));
  const latest = [...state.bossTransactions].reverse().find(transaction =>
    transaction.type === 'boss_action' && !correctedIds.has(transaction.id)
  );
  if (!latest) return '';
  const label = latest.actionType === 'summon' ? '召喚事件' : '討伐進度';
  return `<aside class="boss-correction-notice"><div><i data-lucide="history"></i><span><strong>最近戰役憑證：${label}</strong><small>${escapeHtml(latest.actionDate || '')} · 僅能依序更正最近一筆</small></span></div><button type="button" onclick="correctLatestBossAction()"><i data-lucide="undo-2"></i>更正最近操作</button></aside>`;
}

function renderBossBattle() {
  document.getElementById('pane-boss-battle').style.removeProperty('display');
  const bossArtworkById = {
    'sleep-nightmare': 'assets/art/boss-sleep-nightmare.png',
    'budget-vampire': 'assets/art/boss-budget-vampire.png',
    'fried-food-beast': 'assets/art/boss-fried-food-beast.png',
    'laziness-beast': 'assets/art/boss-laziness-beast.png',
    'sugar-monster': 'assets/art/boss-sugar-monster.png'
  };
  elements.arenaPlayer.dataset.characterClass = state.character.class;
  elements.arenaPlayer.innerHTML = '<img src="assets/art/guild-adventurer.png" alt="" aria-hidden="true">';
  if (elements.arenaPlayerName) elements.arenaPlayerName.textContent = state.character.name;

  if (state.boss.active && state.boss.challenge) {
    elements.bossAlertBadge.style.display = 'flex';
    const bossDisplayName = stripPictographs(state.boss.name);
    elements.bossName.textContent = bossDisplayName;
    elements.bossHpText.textContent = `${state.boss.hp} / ${state.boss.maxHp}`;
    elements.bossHpBar.style.width = `${(state.boss.hp / state.boss.maxHp) * 100}%`;
    elements.bossDesc.textContent = state.boss.description;
    elements.arenaBoss.classList.remove('is-calm');
    elements.arenaBoss.dataset.bossId = state.boss.id;
    elements.arenaBoss.innerHTML = `<img src="${bossArtworkById[state.boss.id] || bossArtworkById['sleep-nightmare']}" alt="${escapeHtml(bossDisplayName)}肖像">`;
    if (elements.arenaBossName) elements.arenaBossName.textContent = bossDisplayName;
    
    elements.bossChallengeContainer.innerHTML = `
      <div class="boss-challenge-card">
        <span class="boss-challenge-title">討伐契約：${escapeHtml(state.boss.challenge.title)}</span>
        <span class="boss-challenge-progress">連續完成進度：${state.boss.challenge.progress} / ${state.boss.challenge.target}</span>
        <span class="boss-challenge-progress">送交今日冒險紀錄並達成契約才會造成傷害；同一日期最多判定一次。</span>
      </div>
      ${renderBossIntelligence()}
      ${renderBossCorrectionControl()}
    `;
  } else {
    elements.bossAlertBadge.style.display = 'none';
    elements.bossName.textContent = '森林安寧無恙';
    elements.bossHpText.textContent = "0 / 0";
    elements.bossHpBar.style.width = '0%';
    elements.bossDesc.textContent = '目前沒有需要討伐的習慣魔獸，持續累積真實冒險紀錄。';
    elements.arenaBoss.classList.add('is-calm');
    elements.arenaBoss.removeAttribute('data-boss-id');
    elements.arenaBoss.innerHTML = '<span class="calm-forest-emblem" aria-hidden="true"><i data-lucide="trees"></i></span>';
    if (elements.arenaBossName) elements.arenaBossName.textContent = '寧靜森林';
    elements.bossChallengeContainer.innerHTML = `
      <p class="boss-calm-message">目前沒有現身的習慣魔獸；下方會說明每一項召喚判定。</p>
      ${renderBossIntelligence()}
      ${renderBossCorrectionControl()}
    `;
  }

  elements.battleLogs.innerHTML = '';
  state.logs.slice(-10).forEach(log => {
    const el = document.createElement('p');
    el.className = 'log-entry system';
    if (log.includes('造成')) el.className = 'log-entry player';
    if (log.includes('受傷') || log.includes('懲罰')) el.className = 'log-entry boss';
    el.textContent = stripPictographs(log);
    elements.battleLogs.appendChild(el);
  });
  elements.battleLogs.scrollTop = elements.battleLogs.scrollHeight;
  if (window.lucide) lucide.createIcons();
}

// ==========================================
// 9. 公會導師紀錄評析 (AI Coach)
// ==========================================
function buildAdvisorReview() {
  return AdvisorEngine.analyze({
    history: state.dailyLogHistory,
    today: getTodayDateString(),
    goal: state.character.goal,
    dailyBudget: state.settings.dailyBudget,
    statusHistory: state.statusHistory,
    habitEvents: state.habitEvents,
    character: state.character,
    debuffs: state.debuffs,
    rules: rulesState.rules
  });
}

window.triggerAICoach = function(isQuiet = false) {
  const review = buildAdvisorReview();
  const cleanAdvice = stripPictographs(review.advice);
  elements.aiCoachText.textContent = cleanAdvice;
  if (elements.settlementAdvisorText) elements.settlementAdvisorText.textContent = cleanAdvice;
  if (elements.advisorReviewPeriod) {
    const reliabilityLabel = review.reliability === 'reliable'
      ? '資料完整'
      : review.reliability === 'provisional' ? '暫時評析' : '資料不足';
    elements.advisorReviewPeriod.textContent = review.periodStart && review.periodEnd
      ? `${review.periodStart} 至 ${review.periodEnd} · ${review.sampleDays}/7 天 · ${reliabilityLabel}`
      : '無法判定分析期間';
  }
  if (!isQuiet) {
    showModal('導師批註・待續', cleanAdvice, 'feather', {
      iconType: 'lucide',
      variant: 'mentor-note',
      closeLabel: '收進紀錄書'
    });
  }
};

// ==========================================
// 10. 設定與隱私管理 (Settings & Privacy)
// ==========================================
window.saveSettings = async function() {
  const newName = elements.settingsName.value.trim();
  const newGoal = elements.settingsGoal?.value || state.character.goal;
  const newBudget = parseInt(elements.settingsBudget.value);
  if (newName) state.character.name = newName;

  let goalMessage = '';
  if (newGoal === state.character.goal) {
    if (state.mainQuest?.pending) goalMessage = '原本排定的主線切換已取消。';
    state.mainQuest.pending = null;
  } else {
    const questResult = MainQuestEngine.switchGoal({
      currentGoal: state.character.goal,
      nextGoal: newGoal,
      today: getTodayDateString(),
      settledDates: state.dailyLogHistory.map(entry => entry.date)
    });
    if (questResult.ok) {
      state.character.goal = questResult.currentGoal;
      state.mainQuest.pending = questResult.pending;
      goalMessage = questResult.pending
        ? `主線將於 ${questResult.effectiveOn} 切換為「${getGoalName(newGoal)}」，今天已結算的紀錄不會被改寫。`
        : `主線已切換為「${getGoalName(newGoal)}」。`;
    }
  }
  if (!isNaN(newBudget) && newBudget > 0) {
    state.settings.dailyBudget = newBudget;
    const spendingRule = rulesState.rules.find(rule => rule.id === 'rule_2');
    if (spendingRule && Array.isArray(spendingRule.conditions)) {
      spendingRule.conditionText = `支出 <= ${newBudget} 且無衝動消費`;
      spendingRule.conditions = spendingRule.conditions.map(condition =>
        condition.metric === 'expense'
          ? { ...condition, targetValue: newBudget }
          : condition
      );
    }
  }
  const saveResult = await saveState();
  if (!saveResult.ok) return;
  renderAll();
  showModal(
    '冒險者資料已儲存',
    `資料已保存於這台裝置。${goalMessage ? ` ${goalMessage}` : ''}`,
    'stamp',
    { iconType: 'lucide' }
  );
};

window.exportSaveArchive = async function() {
  const saveResult = await saveState();
  if (!saveResult.ok) return;
  const archive = SaveArchiveEngine.create({ state, exportedAt: new Date().toISOString() });
  const blob = new Blob([JSON.stringify(archive, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `lifequest-save-${getTodayDateString()}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  addLog(`📦 已匯出 ${getTodayDateString()} 的存檔卷宗。`);
  await saveState();
  showModal('存檔卷宗已匯出', '下載檔包含目前角色、生活紀錄、交易與戰役歷程，並附有校驗碼供匯入時核對。', 'download', { iconType: 'lucide' });
};

window.handleSaveArchiveFile = function(event) {
  const input = event?.target;
  const file = input?.files?.[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) {
    input.value = '';
    showModal('存檔檔案過大', '公會只接受 5 MB 以下的 LifeQuest JSON 存檔。', 'file-warning', { iconType: 'lucide' });
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    input.value = '';
    let archive;
    try {
      archive = JSON.parse(String(reader.result || ''));
    } catch (_error) {
      showModal('無法讀取存檔', '這不是有效的 JSON 卷宗；目前資料沒有被變更。', 'file-x', { iconType: 'lucide' });
      return;
    }
    const validation = SaveArchiveEngine.validate({
      archive,
      defaults: DEFAULT_STATE,
      defaultRules: window.RULES_MOCK_DATA.presetRules
    });
    if (!validation.ok) {
      const reasons = {
        checksum_mismatch: '校驗碼不一致，檔案可能曾被修改或已損壞。',
        unsupported_version: '這份存檔格式版本目前不支援。',
        migration_failed: '存檔無法安全升級到目前資料版本。',
        invalid_state: '存檔包含不安全或不符合資料契約的識別欄位。'
      };
      showModal('存檔驗證未通過', reasons[validation.reason] || '這不是 LifeQuest 可識別的存檔格式；目前資料沒有被變更。', 'shield-x', { iconType: 'lucide' });
      return;
    }
    const cloudImport = SaveArchiveEngine.prepareCloudImport({
      importedState: validation.state,
      currentState: state,
      defaults: DEFAULT_STATE,
      defaultRules: window.RULES_MOCK_DATA.presetRules
    });
    if (!cloudImport.ok) {
      showModal('存檔無法安全匯入', '公會無法從這份卷宗建立可信的生活紀錄；目前資料沒有被變更。', 'shield-x', { iconType: 'lucide' });
      return;
    }
    pendingImportedState = cloudImport.state;
    const summary = cloudImport.summary;
    showModal(
      '核對安全匯入',
      `將匯入每日紀錄 ${summary.dailyEntryCount} 筆、草稿 ${summary.dailyDraftCount} 筆、習慣事件 ${summary.habitEventCount} 筆及自訂習慣 ${summary.customHabitCount} 項。金幣、寶石、裝備、成就、Boss、狀態與交易資料不受匯入檔影響，也不會因匯入重新發獎。確認後會先保存一份匯入前備份。`,
      'file-check-2',
      {
        iconType: 'lucide',
        confirmLabel: '備份並安全匯入',
        cancelLabel: '取消匯入',
        onConfirm: confirmPendingSaveImport
      }
    );
  };
  reader.onerror = () => {
    input.value = '';
    showModal('無法讀取存檔', '瀏覽器未能讀取這份檔案；目前資料沒有被變更。', 'file-x', { iconType: 'lucide' });
  };
  reader.readAsText(file, 'utf-8');
};

async function confirmPendingSaveImport() {
  if (!pendingImportedState) return;
  const backup = SaveArchiveEngine.create({ state, exportedAt: new Date().toISOString() });
  const backupResult = StateStore.writeRaw(localStorage, PRE_IMPORT_BACKUP_KEY, JSON.stringify(backup));
  if (!backupResult.ok) {
    showPersistenceWarning(backupResult);
    showModal('無法建立安全備份', '瀏覽器未能保存匯入前備份，因此本次匯入已取消，目前資料沒有被覆蓋。', 'archive-x', { iconType: 'lucide' });
    return;
  }
  state = pendingImportedState;
  pendingImportedState = null;
  rulesState.rules = state.rules;
  const saveResult = await saveState();
  if (!saveResult.ok) return;
  window.location.reload();
}

window.restorePreImportBackup = function() {
  const rawBackup = localStorage.getItem(PRE_IMPORT_BACKUP_KEY);
  if (!rawBackup) {
    showModal('沒有匯入前備份', '只有成功匯入存檔後，公會才會保留一份覆蓋前的本機備份。', 'archive', { iconType: 'lucide' });
    return;
  }
  let archive;
  try {
    archive = JSON.parse(rawBackup);
  } catch (_error) {
    showModal('備份已損壞', '匯入前備份無法解析，公會不會覆蓋目前存檔。', 'archive-x', { iconType: 'lucide' });
    return;
  }
  const validation = SaveArchiveEngine.validate({ archive, defaults: DEFAULT_STATE, defaultRules: window.RULES_MOCK_DATA.presetRules });
  if (!validation.ok) {
    showModal('備份驗證未通過', '備份校驗失敗，為避免資料遺失，公會不會覆蓋目前存檔。', 'shield-x', { iconType: 'lucide' });
    return;
  }
  showModal(
    '還原匯入前備份？',
    `將回到冒險者「${validation.summary.adventurerName}」匯入前的狀態；目前存檔會先另存為安全副本。`,
    'history',
    {
      iconType: 'lucide',
      confirmLabel: '確認還原',
      cancelLabel: '保留目前存檔',
      onConfirm: async () => {
        const currentArchive = SaveArchiveEngine.create({ state, exportedAt: new Date().toISOString() });
        const backupResult = StateStore.writeRaw(localStorage, 'lifequest_state_backup_before_restore', JSON.stringify(currentArchive));
        if (!backupResult.ok) {
          showPersistenceWarning(backupResult);
          showModal('無法建立安全副本', '目前存檔未能備份，因此還原程序已取消。', 'archive-x', { iconType: 'lucide' });
          return;
        }
        state = validation.state;
        rulesState.rules = state.rules;
        const saveResult = await saveState();
        if (!saveResult.ok) return;
        window.location.reload();
      }
    }
  );
};

window.confirmResetAll = function() {
  showModal(
    '永久銷毀冒險者檔案？',
    '這將清除本機的角色資料、生活紀錄與遊戲進度，且無法復原。請只在已匯出需要保留的存檔後繼續。',
    'file-warning',
    {
      iconType: 'lucide',
      variant: 'data-erased',
      confirmLabel: '確認永久銷毀',
      cancelLabel: '保留冒險資料',
      onConfirm: async () => {
        const result = await gameApplication.clear();
        if (!result.ok) {
          showPersistenceWarning(result);
          return;
        }
        state = gameApplication.getState();
        rulesState.rules = state.rules || [];
        showModal(
          '冒險者檔案已銷毀',
          '公會已完成本機資料銷毀程序。這份回執只確認清除結果，不保留任何可復原的冒險資料。',
          'file-x-2',
          {
            iconType: 'lucide',
            variant: 'data-erased',
            closeLabel: '返回公會入口',
            closeAction: 'return-to-entrance'
          }
        );
      }
    }
  );
};

function addLog(msg) {
  state.logs.push(msg);
  if (state.logs.length > 50) state.logs.shift();
}

function resolveGuildDocument(title, desc, variant) {
  if (variant !== 'default') return variant;
  const content = `${title} ${desc}`;
  if (/勳章|等級提升|戰役凱旋|解鎖/.test(content)) return 'award';
  if (/金幣|裝備|藥水|兌換|存入|領取/.test(content)) return 'quartermaster';
  if (/無法|失敗|倒下|現身|警報|已存在/.test(content)) return 'warning';
  return 'guild-record';
}

function showModal(title, desc, icon = '🏆', options = {}) {
  const variant = options.variant || 'default';
  const documentType = resolveGuildDocument(title, desc, variant);
  elements.modalOverlay.dataset.variant = variant;
  elements.modalOverlay.dataset.document = documentType;
  elements.modalKicker.textContent = variant === 'data-erased'
    ? '公會檔案管理處 · 銷毀回執'
    : variant === 'mentor-note'
      ? '公會紀錄署 · 私人批註'
      : documentType === 'award'
        ? '公會榮譽署 · 授勳狀'
        : documentType === 'quartermaster'
          ? '公會軍需處 · 交易憑據'
          : documentType === 'warning'
            ? '公會值勤室 · 緊急告示'
            : '公會紀錄署 · 登錄回執';
  elements.modalErasureReceipt.hidden = variant !== 'data-erased';
  elements.modalCloseBtn.dataset.action = options.closeAction || '';
  pendingModalAction = typeof options.onConfirm === 'function' ? options.onConfirm : null;
  if (elements.modalCancelBtn) {
    elements.modalCancelBtn.hidden = !pendingModalAction;
    elements.modalCancelBtn.textContent = options.cancelLabel || '取消';
  }

  if (variant === 'contract') {
    elements.modalIcon.innerHTML = `<i data-lucide="${icon}" aria-hidden="true"></i>`;
    elements.modalGoalName.textContent = options.goalName || '';
    elements.modalCloseBtn.textContent = '進入冒險者營地';
  } else if (options.iconType === 'lucide') {
    elements.modalIcon.innerHTML = `<i data-lucide="${icon}" aria-hidden="true"></i>`;
    elements.modalGoalName.textContent = '';
    elements.modalCloseBtn.textContent = options.confirmLabel || options.closeLabel || (
      documentType === 'award' ? '收下公會授予' :
        documentType === 'quartermaster' ? '收妥憑據' :
          documentType === 'warning' ? '知道了' : '確認登錄'
    );
  } else {
    elements.modalIcon.textContent = icon;
    elements.modalGoalName.textContent = '';
    elements.modalCloseBtn.textContent = options.confirmLabel || options.closeLabel || (
      documentType === 'award' ? '收下公會授予' :
        documentType === 'quartermaster' ? '收妥憑據' :
          documentType === 'warning' ? '知道了' : '確認登錄'
    );
  }

  elements.modalTitle.textContent = title;
  elements.modalDesc.textContent = desc;
  const saferInitialFocus = pendingModalAction && elements.modalCancelBtn && !elements.modalCancelBtn.hidden
    ? elements.modalCancelBtn
    : elements.modalCloseBtn;
  if (modalFocusManager) {
    modalFocusManager.open({
      initialFocus: saferInitialFocus,
      onDismiss: () => closeSystemModal({ confirmed: false })
    });
  } else {
    elements.modalOverlay.classList.add('active');
    elements.modalOverlay.setAttribute('aria-hidden', 'false');
    saferInitialFocus.focus();
  }

  if ((variant === 'contract' || options.iconType === 'lucide') && window.lucide) {
    lucide.createIcons();
  }
}

// ==========================================
// 11. 圖表初始化與動態更新 (Chart.js Engine)
// ==========================================
let attributesChart = null;
let trendChart = null;

// 紀錄書只保留最能反映日常節奏的兩張軌跡圖
let insightsSleepChart = null;
let insightsExerciseChart = null;

function initAllCharts() {
  initAnalyticsCharts();
  initInsightsCharts();
}

function initAnalyticsCharts() {
  const ctxAttr = document.getElementById('attributesChart');
  const ctxTrend = document.getElementById('trendChart');
  if (!ctxAttr || !ctxTrend) return;
  if (typeof window.Chart !== 'function') {
    console.warn('Chart.js is unavailable; analytics charts were skipped without interrupting LifeQuest.');
    return;
  }
  
  attributesChart = new Chart(ctxAttr, {
    type: 'radar',
    data: {
      labels: ['健康', '精力', '財富', '成長'],
      datasets: [{
        label: '當前能力值',
        data: [state.character.attributes.health, state.character.attributes.energy, state.character.attributes.wealth, state.character.attributes.growth],
        backgroundColor: 'rgba(118, 75, 31, 0.16)',
        borderColor: '#76502c',
        pointBackgroundColor: '#9a6c34',
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        r: {
          grid: { color: 'rgba(75, 45, 21, 0.18)' },
          angleLines: { color: 'rgba(75, 45, 21, 0.18)' },
          pointLabels: { color: '#4a301c', font: { family: 'Noto Serif TC', size: 12, weight: '700' } },
          ticks: { backdropColor: 'transparent', color: '#76502c', stepSize: 2 },
          suggestedMin: 0, suggestedMax: 20
        }
      },
      plugins: { legend: { display: false } }
    }
  });

  const data = Insights.calculate(
    state.dailyLogHistory,
    'weekly',
    getTodayDateString(),
    { dailyBudget: state.settings.dailyBudget, statusHistory: state.statusHistory }
  );
  trendChart = new Chart(ctxTrend, {
    type: 'line',
    data: {
      labels: data.expLine.labels,
      datasets: [
        { label: '每日 EXP', data: data.expLine.data, borderColor: '#76502c', backgroundColor: 'rgba(118, 80, 44, 0.1)', fill: true, tension: 0.25 },
        { label: '每日金幣', data: data.goldLine.data, borderColor: '#8b6b31', backgroundColor: 'rgba(139, 107, 49, 0.1)', fill: true, tension: 0.25 }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { grid: { color: 'rgba(75, 45, 21, 0.12)' }, ticks: { color: '#5e4229' } },
        y: { grid: { color: 'rgba(75, 45, 21, 0.12)' }, ticks: { color: '#5e4229' } }
      },
      plugins: { legend: { labels: { color: '#4a301c', font: { family: 'Noto Serif TC' } } } }
    }
  });
}

function initInsightsCharts() {
  const data = Insights.calculate(
    state.dailyLogHistory,
    insightsTimeframe,
    getTodayDateString(),
    { dailyBudget: state.settings.dailyBudget, statusHistory: state.statusHistory }
  );

  renderJourneyCharts(data);
}

function updateInsightsCharts(data) {
  renderJourneyCharts(data);
}

function getJourneySeries(labels = [], values = []) {
  return labels.map((label, index) => ({
    label: String(label ?? ''),
    value: Number(values[index])
  })).filter(point => Number.isFinite(point.value));
}

function renderJourneyEmpty(container, subject) {
  container.innerHTML = `
    <div class="journey-empty-page">
      <span class="empty-quill" aria-hidden="true"><i data-lucide="feather"></i></span>
      <strong>尚待公會書記落筆</strong>
      <p>再完成冒險紀錄後，將在此繪製${subject}。</p>
    </div>
  `;
}

function renderJourneySparse(container, kind, point, unit, note) {
  container.innerHTML = `
    <div class="journey-sparse-entry ${kind}">
      <span class="journey-sparse-stamp" aria-hidden="true">${kind === 'sleep' ? '月' : '鍛'}</span>
      <div>
        <small>${escapeHtml(point.label)}</small>
        <strong>${point.value.toFixed(kind === 'sleep' ? 1 : 0)} ${unit}</strong>
        <p>${note}</p>
      </div>
    </div>
  `;
}

function renderSleepChronicle(container, labels, values) {
  const series = getJourneySeries(labels, values);
  if (!series.length) return renderJourneyEmpty(container, '睡眠月印軌跡');
  if (series.length === 1) {
    return renderJourneySparse(container, 'sleep', series[0], '小時', '再完成一筆日誌，公會書記便能連起睡眠軌跡。');
  }
  const width = 600;
  const height = 230;
  const left = 42;
  const right = 20;
  const top = 28;
  const bottom = 42;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const maxY = Math.max(10, Math.ceil(Math.max(...series.map(point => point.value)) + 1));
  const xAt = index => left + (series.length === 1 ? plotWidth / 2 : (index / (series.length - 1)) * plotWidth);
  const yAt = value => top + plotHeight - (Math.max(0, value) / maxY) * plotHeight;
  const points = series.map((point, index) => `${xAt(index)},${yAt(point.value)}`).join(' ');
  const labelStep = series.length > 10 ? Math.ceil(series.length / 6) : 1;
  const targetY = yAt(7);
  const stamps = series.map((point, index) => {
    const x = xAt(index);
    const y = yAt(point.value);
    const showLabel = index % labelStep === 0 || index === series.length - 1;
    return `<g class="moon-ink-stamp" transform="translate(${x} ${y})"><circle r="8"></circle><path d="M2-5a6 6 0 1 0 0 10 5 5 0 1 1 0-10z"></path><text y="-13">${point.value.toFixed(1)}h</text></g>${showLabel ? `<text class="journey-date" x="${x}" y="214">${escapeHtml(point.label)}</text>` : ''}`;
  }).join('');
  container.innerHTML = `
    <svg class="journey-ink-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="睡眠時數墨水軌跡">
      <path class="paper-rule" d="M${left} ${yAt(5)}H${width-right}M${left} ${targetY}H${width-right}M${left} ${yAt(9)}H${width-right}"></path>
      <text class="journey-scale" x="5" y="${yAt(5)+4}">5h</text><text class="journey-scale target" x="5" y="${targetY+4}">7h</text><text class="journey-scale" x="5" y="${yAt(9)+4}">9h</text>
      <path class="guild-target-line" d="M${left} ${targetY}H${width-right}"></path><text class="guild-target-label" x="${width-right-4}" y="${targetY-7}">契約基準</text>
      <polyline class="sleep-ink-line" points="${points}"></polyline>${stamps}
    </svg>
  `;
}

function renderExerciseChronicle(container, labels, values) {
  const series = getJourneySeries(labels, values);
  if (!series.length) return renderJourneyEmpty(container, '訓練刻痕');
  if (series.length === 1) {
    return renderJourneySparse(container, 'training', series[0], '分鐘', '再完成一筆日誌，公會書記便能比較訓練節奏。');
  }
  const width = 600;
  const height = 230;
  const left = 28;
  const right = 18;
  const top = 28;
  const base = 186;
  const plotWidth = width - left - right;
  const maxY = Math.max(30, Math.ceil(Math.max(...series.map(point => point.value)) / 10) * 10);
  const xAt = index => left + ((index + 0.5) / series.length) * plotWidth;
  const yAt = value => base - (Math.max(0, value) / maxY) * (base - top);
  const labelStep = series.length > 10 ? Math.ceil(series.length / 6) : 1;
  const targetY = yAt(30);
  const marks = series.map((point, index) => {
    const x = xAt(index);
    const y = yAt(point.value);
    const showLabel = index % labelStep === 0 || index === series.length - 1;
    return `<g class="training-ink-mark ${point.value >= 30 ? 'completed' : ''}"><path d="M${x} ${base}V${y}"></path><path class="shield-stamp" d="M${x-8} ${y-5}L${x} ${y-10}L${x+8} ${y-5}L${x+6} ${y+5}L${x} ${y+11}L${x-6} ${y+5}Z"></path><text x="${x}" y="${Math.max(16,y-15)}">${Math.round(point.value)}m</text></g>${showLabel ? `<text class="journey-date" x="${x}" y="214">${escapeHtml(point.label)}</text>` : ''}`;
  }).join('');
  container.innerHTML = `
    <svg class="journey-ink-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="每日運動分鐘訓練刻痕">
      <path class="paper-rule" d="M${left} ${base}H${width-right}M${left} ${targetY}H${width-right}"></path>
      <path class="guild-target-line" d="M${left} ${targetY}H${width-right}"></path><text class="guild-target-label" x="${width-right-4}" y="${targetY-7}">30 分鐘達標</text>${marks}
    </svg>
  `;
}

function renderJourneyCharts(data) {
  const sleepContainer = document.getElementById('insightsSleepChart');
  const exerciseContainer = document.getElementById('insightsExerciseChart');
  if (sleepContainer) renderSleepChronicle(sleepContainer, data.sleepLine.labels, data.sleepLine.data);
  if (exerciseContainer) renderExerciseChronicle(exerciseContainer, data.exerciseBar.labels, data.exerciseBar.data);
  if (window.lucide) window.lucide.createIcons();
}

function updateCharts() {
  if (!attributesChart || !trendChart) return;
  attributesChart.data.datasets[0].data = [
    state.character.attributes.health,
    state.character.attributes.energy,
    state.character.attributes.wealth,
    state.character.attributes.growth
  ];
  attributesChart.update();
  
  const data = Insights.calculate(
    state.dailyLogHistory,
    'weekly',
    getTodayDateString(),
    { dailyBudget: state.settings.dailyBudget, statusHistory: state.statusHistory }
  );
  trendChart.data.labels = data.expLine.labels;
  trendChart.data.datasets[0].data = data.expLine.data;
  trendChart.data.datasets[1].data = data.goldLine.data;
  trendChart.update();
}
