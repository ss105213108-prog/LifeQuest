const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');

test('daily adventure log exposes the study minutes required by settlement rules', () => {
  const html = fs.readFileSync(path.join(projectRoot, 'index.html'), 'utf8');
  const script = fs.readFileSync(path.join(projectRoot, 'app.js'), 'utf8');
  const dailyForm = require(path.join(projectRoot, 'dailyFormSubmission.js'));

  assert.match(html, /<label\s+for="log-study"/);
  assert.match(html, /id="log-study"[^>]*name="study"/);
  assert.equal(dailyForm.FIELD_NAMES.includes('study'), true);
  assert.match(script, /DailyFormSubmission\.bind\(dailyLogForm/);
});

test('runtime libraries are loaded from pinned local vendor files', () => {
  const html = fs.readFileSync(path.join(projectRoot, 'index.html'), 'utf8');

  assert.doesNotMatch(html, /cdn\.jsdelivr\.net\/npm\/chart\.js/);
  assert.doesNotMatch(html, /unpkg\.com\/lucide/);
  assert.match(html, /vendor\/chart\.js\/chart\.umd\.min\.js\?v=4\.5\.1/);
  assert.match(html, /vendor\/lucide\/lucide\.min\.js\?v=1\.31\.0/);
  assert.equal(fs.existsSync(path.join(projectRoot, 'vendor', 'chart.js', 'chart.umd.min.js')), true);
  assert.equal(fs.existsSync(path.join(projectRoot, 'vendor', 'lucide', 'lucide.min.js')), true);
  const Chart = require(path.join(projectRoot, 'vendor', 'chart.js', 'chart.umd.min.js'));
  const lucide = require(path.join(projectRoot, 'vendor', 'lucide', 'lucide.min.js'));
  assert.equal(Chart.version, '4.5.1');
  assert.equal(typeof lucide.createIcons, 'function');
});

test('system modal declares its hidden state and loads the shared focus manager', () => {
  const html = fs.readFileSync(path.join(projectRoot, 'index.html'), 'utf8');

  assert.match(html, /id="achievement-overlay"[^>]*aria-hidden="true"/);
  assert.match(html, /<script src="modalFocusManager\.js\?v=1"><\/script>/);
});

test('weekly summary labels task completion accurately and has an honest empty state', () => {
  const html = fs.readFileSync(path.join(projectRoot, 'index.html'), 'utf8');
  const script = fs.readFileSync(path.join(projectRoot, 'app.js'), 'utf8');

  assert.match(html, /近 7 日任務完成率/);
  assert.match(html, /id="dash-task-completion-percent">尚無可計算資料</);
  assert.match(script, /summary\.taskCompletionPercent/);
  assert.doesNotMatch(html, /本週成長率|dash-growth-percent|\+24%/);
  assert.doesNotMatch(script, /growthPercent|dashGrowthPercent/);
});

test('boot sequence trusts the repository and loads the backend contract before application code', () => {
  const html = fs.readFileSync(path.join(projectRoot, 'index.html'), 'utf8');
  const script = fs.readFileSync(path.join(projectRoot, 'app.js'), 'utf8');

  const contractIndex = html.indexOf('backendContract.js?v=');
  const applicationIndex = html.indexOf('gameApplication.js?v=');
  const memberAuthIndex = html.indexOf('memberAuth.js?v=');
  const appIndex = html.indexOf('app.js?v=');
  assert.equal(contractIndex >= 0, true);
  assert.equal(contractIndex < applicationIndex, true);
  assert.equal(applicationIndex < memberAuthIndex, true);
  assert.equal(memberAuthIndex < appIndex, true);
  assert.equal(applicationIndex < appIndex, true);
  assert.match(script, /const gameApplicationReady = gameApplication\.initialize\(\)/);
  assert.doesNotMatch(script, /gameApplicationReady[\s\S]{0,200}replaceState\(state\)/);
});

test('adventurer login uses the Phase 1 member boundary and reuses the original guest onboarding action', () => {
  const html = fs.readFileSync(path.join(projectRoot, 'index.html'), 'utf8');
  const script = fs.readFileSync(path.join(projectRoot, 'app.js'), 'utf8');
  const styles = fs.readFileSync(path.join(projectRoot, 'style.css'), 'utf8');

  assert.match(html, /id="auth-open-login"[^>]*onclick="showAuthLoginPage\(\)"/);
  assert.match(html, /id="auth-login-view"[^>]*hidden/);
  assert.match(html, /id="auth-account"[^>]*type="text"/);
  assert.match(html, /id="auth-password"[^>]*type="password"/);
  assert.match(html, /id="auth-password-toggle"[^>]*onclick="toggleAuthPasswordVisibility\(\)"/);
  assert.match(html, /class="auth-back-button"[^>]*onclick="showAuthEntrancePage\(\)"/);
  assert.match(html, /id="auth-login-submit"[^>]*type="submit"/);
  assert.equal((html.match(/onclick="selectAuthMethod\('guest'\)"/g) || []).length, 2);
  assert.match(html, /冒險者卷宗保管說明/);
  assert.match(html, /公會檔案庫 · 私人卷宗/);
  assert.doesNotMatch(html, /<span class="auth-benefit-emblem"|<h2>成為更好的自己<\/h2>/);

  assert.match(script, /window\.showAuthLoginPage\s*=\s*function/);
  assert.match(script, /window\.showAuthEntrancePage\s*=\s*function/);
  assert.match(script, /input\.type\s*=\s*shouldShow\s*\?\s*'text'\s*:\s*'password'/);
  assert.match(script, /window\.selectAuthMethod\s*=\s*async function\(method\)/);
  assert.match(script, /if \(method !== 'guest'\) return/);
  assert.match(script, /memberAuthCoordinator\.login\(\{ email, password \}\)/);
  assert.match(script, /onSignedOut:\s*restoreGuestEntranceAfterLogout/);
  assert.match(script, /if \(authResult\?\.session\) \{[\s\S]{0,180}restoreMemberGameplayWorkspace\(authResult\);[\s\S]{0,80}return;/);
  assert.match(script, /MEMBER_BOOTSTRAP_FAILED/);
  assert.match(script, /memberAuthCoordinator\.getSession\(\)/);
  assert.match(styles, /\.auth-overlay\s*\{[\s\S]*?overflow-x:\s*hidden/);
  assert.match(styles, /@media \(max-width:\s*820px\)[\s\S]*?\.auth-login-layout\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)/);
});

test('adventurer registration connects only Phase 1 Auth and navigates within the existing auth overlay', () => {
  const html = fs.readFileSync(path.join(projectRoot, 'index.html'), 'utf8');
  const script = fs.readFileSync(path.join(projectRoot, 'app.js'), 'utf8');
  const styles = fs.readFileSync(path.join(projectRoot, 'style.css'), 'utf8');
  const registrationStart = html.indexOf('id="auth-register-view"');
  const registrationEnd = html.indexOf('id="onboarding-overlay"');
  const registrationHtml = html.slice(registrationStart, registrationEnd);

  assert.equal(registrationStart >= 0, true);
  assert.match(html, /id="auth-open-register"[^>]*onclick="showAuthRegisterPage\(\)"/);
  assert.match(registrationHtml, /id="auth-register-name"[^>]*maxlength="16"/);
  assert.match(registrationHtml, /id="auth-register-email"[^>]*type="email"/);
  assert.match(registrationHtml, /id="auth-register-password"[^>]*type="password"/);
  assert.match(registrationHtml, /id="auth-register-confirm"[^>]*type="password"/);
  assert.match(registrationHtml, /id="auth-register-terms"[^>]*type="checkbox"/);
  assert.match(registrationHtml, /id="auth-register-submit"[^>]*disabled/);
  assert.match(registrationHtml, /冒險者卷宗登記/);
  assert.match(registrationHtml, /class="auth-register-dossier-meta"/);
  assert.match(registrationHtml, /class="auth-register-seal-group"/);
  assert.match(registrationHtml, /書記官註記/);
  assert.match(registrationHtml, /onclick="showAuthLoginPage\(\)"[^>]*>立即登入/);
  assert.match(registrationHtml, /onclick="showAuthEntrancePage\(\)"/);
  assert.doesNotMatch(registrationHtml, /Firebase|註冊成功/iu);

  assert.match(script, /window\.showAuthRegisterPage\s*=\s*function\(\)\s*\{\s*setAuthEntranceView\('register'\)/);
  assert.match(script, /Email 格式不正確/);
  assert.match(script, /兩次輸入的密碼不一致/);
  assert.match(script, /密碼至少需要 12 個字元/);
  assert.doesNotMatch(script, /密碼至少需要 8 個字元|並包含英文字與數字/);
  assert.match(script, /memberAuthCoordinator\.register\(\{/);
  assert.doesNotMatch(script.slice(script.indexOf('function getAuthRegistrationError'), script.indexOf('window.selectAuthMethod')), /saveState\(|executeGameCommand/);
  assert.match(styles, /@media \(max-width:\s*620px\)[\s\S]*?\.auth-register-label-row\s*\{[\s\S]*?display:\s*grid/);
});
