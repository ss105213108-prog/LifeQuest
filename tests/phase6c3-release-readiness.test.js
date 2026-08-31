const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { scanProject } = require('./helpers/secret-scan.cjs');
const {
  PUBLIC_FILES,
  HOSTING_HEADERS,
  CACHE_POLICY,
  listFiles,
  extractLocalReferences
} = require('../scripts/release-files.cjs');

const projectRoot = path.resolve(__dirname, '..');
const releaseRoot = path.join(projectRoot, 'dist');

function buildRelease() {
  const result = spawnSync(process.execPath, ['scripts/build-release.cjs'], {
    cwd: projectRoot,
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

function hashRelease() {
  return Object.fromEntries(listFiles(releaseRoot).map(file => [
    file,
    crypto.createHash('sha256').update(fs.readFileSync(path.join(releaseRoot, file))).digest('hex')
  ]));
}

test.before(() => buildRelease());

test('clean release is deterministic and exactly matches the public allowlist', () => {
  const outputHashes = hashRelease();
  const sourceHashes = Object.fromEntries(PUBLIC_FILES.map(file => [
    file,
    crypto.createHash('sha256').update(fs.readFileSync(path.join(projectRoot, file))).digest('hex')
  ]));
  assert.deepEqual(outputHashes, sourceHashes);
  assert.deepEqual(Object.keys(outputHashes).sort(), PUBLIC_FILES);
});

test('public artifact excludes every internal and development artifact class', () => {
  const files = listFiles(releaseRoot);
  const forbidden = /^(?:tests?|supabase|migrations?|node_modules|\.git|\.npm-cache)(\/|$)|(?:^|\/)(?:dev-server\.cjs|package(?:-lock)?\.json|\.env(?:\..*)?|.*\.(?:sql|md|log|toml|ya?ml))$/i;
  assert.deepEqual(files.filter(file => forbidden.test(file)), []);
});

test('public artifact secret scan has zero findings and exposes only browser-safe Supabase config', () => {
  assert.deepEqual(scanProject(releaseRoot), []);
  const config = fs.readFileSync(path.join(releaseRoot, 'supabaseConfig.js'), 'utf8');
  assert.match(config, /https:\/\/jwpbwlrdzmfzjlbrktlc\.supabase\.co/);
  assert.match(config, /sb_publishable_[A-Za-z0-9_-]+/);
  assert.doesNotMatch(config, /sb_secret_|postgres(?:ql)?:\/\/|\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/i);
});

test('release index, styles and local runtime dependencies are self-contained', () => {
  const html = fs.readFileSync(path.join(releaseRoot, 'index.html'), 'utf8');
  const css = ['style.css', 'rpg-pages.css'].map(file => fs.readFileSync(path.join(releaseRoot, file), 'utf8'));
  const references = extractLocalReferences(html, css);
  assert.ok(references.length > 10);
  for (const reference of references) assert.ok(fs.existsSync(path.join(releaseRoot, reference)), reference);
  assert.doesNotMatch(html, /(?:src|href)=["'][^"']*(?:tests|supabase\/functions|migrations|dev-server|node_modules)/i);
});

test('release homepage retains Guest, Login and Register entry surfaces', () => {
  const html = fs.readFileSync(path.join(releaseRoot, 'index.html'), 'utf8');
  assert.match(html, /id="auth-open-login"/);
  assert.match(html, /id="auth-open-register"/);
  assert.match(html, /selectAuthMethod\('guest'\)/);
  assert.match(html, /id="auth-login-view"/);
  assert.match(html, /id="auth-register-view"/);
});

test('provider-neutral security headers and cache policy cover the release boundary', () => {
  assert.match(HOSTING_HEADERS['Content-Security-Policy'], /default-src 'self'/);
  assert.match(HOSTING_HEADERS['Content-Security-Policy'], /frame-ancestors 'none'/);
  assert.equal(HOSTING_HEADERS['X-Content-Type-Options'], 'nosniff');
  assert.equal(HOSTING_HEADERS['Referrer-Policy'], 'strict-origin-when-cross-origin');
  assert.match(HOSTING_HEADERS['Permissions-Policy'], /camera=\(\)/);
  assert.equal(CACHE_POLICY.index, 'no-cache, max-age=0, must-revalidate');
  assert.doesNotMatch(CACHE_POLICY.scriptsAndStyles, /immutable/);
});

test('clean release serves every required runtime file without a 404', async () => {
  const server = http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const file = path.resolve(releaseRoot, relative);
    if (!file.startsWith(`${releaseRoot}${path.sep}`) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      response.writeHead(404).end('Not found');
      return;
    }
    response.writeHead(200).end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const htmlResponse = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(htmlResponse.status, 200);
    const html = await htmlResponse.text();
    const css = ['style.css', 'rpg-pages.css'].map(file => fs.readFileSync(path.join(releaseRoot, file), 'utf8'));
    for (const reference of extractLocalReferences(html, css)) {
      const response = await fetch(`http://127.0.0.1:${port}/${reference}`);
      assert.equal(response.status, 200, reference);
    }
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
