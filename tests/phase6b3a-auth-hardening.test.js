const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const MemberAuth = require('../memberAuth.js');
const BackendContract = require('../backendContract.js');
const Application = require('../gameApplication.js');

function registrationErrorFor(id, value, password = '') {
  const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
  const start = source.indexOf('function getAuthRegistrationError');
  const end = source.indexOf('\nfunction renderAuthRegistrationError', start);
  assert.ok(start >= 0 && end > start, 'registration validator must remain available');
  const context = vm.createContext({ elements: { authRegisterPassword: { value: password } } });
  vm.runInContext(`${source.slice(start, end)}\nthis.validate = getAuthRegistrationError;`, context);
  return context.validate({ id, value });
}

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); }
  };
}

function createCoordinator(auth, storage = createStorage()) {
  return MemberAuth.createMemberAuthCoordinator({
    supabaseClient: { auth },
    projectUrl: 'https://isolated.invalid',
    publishableKey: 'test-public',
    storage,
    contract: BackendContract,
    application: Application,
    fetchImpl: async () => { throw new Error('Auth rejection must not call Member transport'); }
  });
}

function loginRejectingAuth(submitted = []) {
  return {
    async signInWithPassword(credentials) {
      submitted.push(credentials);
      return { data: { session: null }, error: { message: 'Invalid login credentials' } };
    },
    async signUp() { throw new Error('not used'); },
    async getSession() { return { data: { session: null }, error: null }; },
    async signOut() { return { error: null }; },
    onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; }
  };
}

function loginAuthError(message) {
  const auth = loginRejectingAuth();
  auth.signInWithPassword = async () => ({ data: { session: null }, error: { message } });
  return auth;
}

const registerFallback = '目前無法完成註冊，請確認資料或稍後再試。';

test('existing Email registration uses a non-enumerating message', () => {
  const message = MemberAuth.safeAuthMessage({
    message: 'User already registered'
  }, registerFallback);
  assert.equal(message, registerFallback);
  assert.doesNotMatch(message, /已建立|已存在|already|exist/iu);
});

test('unknown registration failure has the same semantics as an existing Email', () => {
  const existing = MemberAuth.safeAuthMessage({ message: 'User already registered' }, registerFallback);
  const unknown = MemberAuth.safeAuthMessage({ message: 'Registration rejected' }, registerFallback);
  assert.equal(existing, unknown);
});

test('new Register password shorter than 12 characters is rejected', () => {
  assert.match(registrationErrorFor('auth-register-password', 'abcdefghijk'), /12 個字元/);
});

test('new Register password with exactly 12 characters is accepted', () => {
  assert.equal(registrationErrorFor('auth-register-password', 'abcdefghijkl'), '');
});

test('new Register accepts a long passphrase without digit or symbol requirements', () => {
  assert.equal(registrationErrorFor('auth-register-password', 'correct horse battery staple'), '');
});

test('Register UI explains the 12-character rule without the legacy composition rule', () => {
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  assert.match(html, /至少 12 個字元/);
  assert.doesNotMatch(html, /至少 8 個字元，包含英文字與數字/);
});

test('wrong Email Login uses the generic credential message', async () => {
  const submitted = [];
  const coordinator = createCoordinator(loginRejectingAuth(submitted));
  const result = await coordinator.login({ email: 'missing@example.invalid', password: 'legacy7' });
  assert.equal(result.message, 'Email 或密碼不正確。');
});

test('wrong password Login uses the same generic credential message', async () => {
  const coordinator = createCoordinator(loginRejectingAuth());
  const result = await coordinator.login({ email: 'member@example.invalid', password: 'wrong-password' });
  assert.equal(result.message, 'Email 或密碼不正確。');
});

test('Login does not distinguish provider-specific missing-user and wrong-password diagnostics', async () => {
  const missing = await createCoordinator(loginAuthError('User not found')).login({
    email: 'missing@example.invalid', password: 'candidate-password'
  });
  const wrong = await createCoordinator(loginAuthError('Invalid password')).login({
    email: 'member@example.invalid', password: 'candidate-password'
  });
  assert.equal(missing.message, 'Email 或密碼不正確。');
  assert.equal(wrong.message, missing.message);
});

test('Login forwards an existing short password instead of applying the new Register minimum', async () => {
  const submitted = [];
  const coordinator = createCoordinator(loginRejectingAuth(submitted));
  await coordinator.login({ email: 'member@example.invalid', password: 'legacy7' });
  assert.deepEqual(submitted.map(row => row.password), ['legacy7']);
});

test('WeakPasswordError maps to a safe Chinese requirement message', () => {
  const weak = MemberAuth.safeAuthMessage({
    message: 'WeakPasswordError: password rejected by private provider diagnostic'
  });
  assert.equal(weak, '密碼不符合目前的安全要求。');
  assert.doesNotMatch(weak, /provider diagnostic/iu);
});

test('raw Auth diagnostics never enter the registration UI message', () => {
  const internal = MemberAuth.safeAuthMessage({
    message: 'SQLSTATE 23505 private stack and token detail'
  }, registerFallback);
  assert.equal(internal, registerFallback);
  assert.doesNotMatch(internal, /SQLSTATE|stack|token/iu);
});

test('failed Member Login leaves the Guest LocalStorage save unchanged', async () => {
  const guest = JSON.stringify({ mode: 'guest', player: { xp: 42 } });
  const storage = createStorage({ lifequest_state: guest });
  const coordinator = createCoordinator(loginRejectingAuth(), storage);
  await coordinator.login({ email: 'missing@example.invalid', password: 'legacy7' });
  assert.equal(storage.getItem('lifequest_state'), guest);
});
