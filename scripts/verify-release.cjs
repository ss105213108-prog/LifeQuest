const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { scanProject, scanText } = require('../tests/helpers/secret-scan.cjs');
const {
  PUBLIC_FILES,
  HOSTING_HEADERS,
  CACHE_POLICY,
  renderNetlifyHeaders,
  listFiles,
  extractLocalReferences
} = require('./release-files.cjs');

const projectRoot = path.resolve(__dirname, '..');
const releaseRoot = path.join(projectRoot, 'dist');
assert.ok(fs.existsSync(releaseRoot), 'dist is missing; run npm run release:build first');

assert.deepEqual(listFiles(releaseRoot), PUBLIC_FILES, 'dist must exactly match the publish allowlist');
assert.equal(scanProject(releaseRoot).length, 0, 'release secret scan must have zero findings');
const headers = fs.readFileSync(path.join(releaseRoot, '_headers'), 'utf8');
assert.equal(headers, renderNetlifyHeaders(), 'deployed headers must match the release policy');
assert.equal(headers, fs.readFileSync(path.join(projectRoot, '_headers'), 'utf8'), 'source/dist headers differ');
assert.deepEqual(scanText(headers, '_headers'), [], 'extensionless header file must be secret-free');

const forbidden = /^(?:tests?|supabase|migrations?|node_modules|\.git|\.npm-cache)(\/|$)|(?:^|\/)(?:dev-server\.cjs|package(?:-lock)?\.json|\.env(?:\..*)?|.*\.(?:sql|md|log|toml|ya?ml))$/i;
assert.equal(listFiles(releaseRoot).filter(file => forbidden.test(file)).length, 0, 'dist contains an internal artifact');

const html = fs.readFileSync(path.join(releaseRoot, 'index.html'), 'utf8');
const css = ['style.css', 'rpg-pages.css'].map(file => fs.readFileSync(path.join(releaseRoot, file), 'utf8'));
for (const reference of extractLocalReferences(html, css)) {
  assert.ok(fs.existsSync(path.join(releaseRoot, reference)), `missing runtime reference: ${reference}`);
}

assert.match(html, /id="auth-open-login"/);
assert.match(html, /id="auth-open-register"/);
assert.match(html, /selectAuthMethod\('guest'\)/);

const config = fs.readFileSync(path.join(releaseRoot, 'supabaseConfig.js'), 'utf8');
assert.match(config, /https:\/\/jwpbwlrdzmfzjlbrktlc\.supabase\.co/);
assert.match(config, /sb_publishable_[A-Za-z0-9_-]+/);
assert.doesNotMatch(config, /sb_secret_|postgres(?:ql)?:\/\/|\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/i);

assert.equal(HOSTING_HEADERS['X-Content-Type-Options'], 'nosniff');
assert.match(HOSTING_HEADERS['Content-Security-Policy'], /frame-ancestors 'none'/);
assert.equal(CACHE_POLICY.index, 'no-cache, max-age=0, must-revalidate');
assert.doesNotMatch(CACHE_POLICY.scriptsAndStyles, /immutable/);

process.stdout.write(`LifeQuest release verification passed: ${PUBLIC_FILES.length} public files, 0 secret findings\n`);
