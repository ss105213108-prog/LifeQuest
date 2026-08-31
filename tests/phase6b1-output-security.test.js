const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

// Evaluate the actual reporting boundary, NOT main(): no users or network I/O.
function verificationReporter(file) {
  const filePath = path.join(__dirname, file);
  const source = fs.readFileSync(filePath, 'utf8');
  const output = [];
  const context = vm.createContext({ require: createRequire(filePath), __dirname, URL,
    process: { env: {}, argv: [], stdout: { write: line => output.push(line) } },
    console: { log: line => output.push(line) },
    fetch() { throw new Error('Live network is forbidden in this regression test'); }
  });
  assert.ok(source.includes('main().catch(error => {'));
  vm.runInContext(source.replace('main().catch(error => {', 'globalThis.failureHandler = (error => {'), context);
  return { source, context, output };
}

for (const file of ['phase2-live-verification.cjs', 'phase4b-live-verification.cjs',
  'phase5a-live-verification.cjs', 'phase5b-live-verification.cjs', 'phase5c3-live-verification.cjs']) {
  test(`${file} failure output never includes raw error text or attached credentials`, () => {
    const h = verificationReporter(file);
    h.context.failureHandler(Object.assign(new Error('SELECT sensitive_sql; test-secret-value'), {
      access_token: 'test-access-credential', refresh_token: 'test-refresh-credential', status: 503
    }));
    assert.equal(h.output.length, 1);
    assert.ok(!/sensitive_sql|test-secret-value|test-access-credential|test-refresh-credential/.test(h.output[0]));
    assert.match(h.output[0], /failure|FAILURE/);
  });
}
test('live progress output drops sensitive fields while keeping exact temporary cleanup IDs', () => {
  const h = verificationReporter('phase5c3-live-verification.cjs');
  h.context.data = { users: [{ label: 'a', id: '00000000-0000-4000-8000-000000000001',
    email: 'lifequest-test-a@example.com', password: 'test-password-value', access_token: 'test-token-value' }],
    hash: 'test-hash-value', secret: 'test-secret-value', message: 'test-raw-error-value' };
  vm.runInContext("report('AUTH_DELETE_REQUIRED', data)", h.context);
  assert.ok(!/test-(password|token|hash|secret|raw-error)-value/.test(h.output[0]));
  assert.match(h.output[0], /00000000-0000-4000-8000-000000000001/);
});
test('legacy temporary-password hash output is absent from live scripts', () => {
  const source = fs.readFileSync(path.join(__dirname, 'phase5c3-live-verification.cjs'), 'utf8');
  assert.equal(/report\(['"]TEMP_PASSWORD_HASH/.test(source), false, 'credential hashes must not be printed');
});

test('project secret guard finds no forbidden credential constants or publishable env files', () => {
  const { scanProject } = require('./helpers/secret-scan.cjs');
  assert.deepEqual(scanProject(path.join(__dirname, '..')), []);
});
test('secret guard detects positive fixtures without mistaking publishable or anon keys for secrets', () => {
  const { scanText } = require('./helpers/secret-scan.cjs');
  const jwt = role => [Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url'),
    Buffer.from(JSON.stringify({ role })).toString('base64url'), 'testSignatureOnly'].join('.');
  const cases = [
    ['sb_' + 'secret_' + 'a'.repeat(24), 'secret_key'],
    ['sbp_' + 'a'.repeat(24), 'management_token'],
    ['postgres' + '://test:fake-password@localhost/db', 'database_password_url'],
    ['-----BEGIN ' + 'PRIVATE KEY-----', 'private_key'],
    [jwt('service_role'), 'service_role_jwt'], [jwt('authenticated'), 'sensitive_jwt_constant'],
    ['report(' + JSON.stringify(['TEMP', 'PASSWORD', 'HASH'].join('_')) + ', data)', 'password_hash_output'],
    ['<script src="/' + '.env"></script>', 'env_publish_reference']
  ];
  for (const [text, rule] of cases) assert.ok(scanText(text).some(finding => finding.rule === rule), rule);
  assert.deepEqual(scanText('sb_' + 'publishable_' + 'a'.repeat(24)), []);
  assert.deepEqual(scanText(jwt('anon')), []);
  assert.ok(scanText('', '.env.production').some(f => f.rule === 'env_file_in_project'));
  assert.deepEqual(scanText('', '.env.example'), []);
});

test('temporary resume fails closed without fetching a hashing module or emitting credentials', async () => {
  const h = verificationReporter('phase5c3-live-verification.cjs');
  await assert.rejects(vm.runInContext('prepareTemporaryResume()', h.context));
  assert.match(h.output.join(''), /RESUME_DISABLED/);
  assert.ok(!/PASSWORD_HASH|hashSync/.test(h.output.join('')));
});
