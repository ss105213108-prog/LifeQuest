const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PUBLIC_FILES, renderNetlifyHeaders } = require('../scripts/release-files.cjs');
const root = path.resolve(__dirname, '..');
const { parseHeaders, headersFor, createReleasePreview } = require('./helpers/release-header-preview.cjs');
const { scanText } = require('./helpers/secret-scan.cjs');
const readRules = () => parseHeaders(fs.readFileSync(path.join(root, '_headers'), 'utf8'));

test('Netlify headers are a reproducible allowlisted release source, not a dist-only edit', () => {
  assert.ok(PUBLIC_FILES.includes('_headers'));
  assert.equal(fs.readFileSync(path.join(root, '_headers'), 'utf8'), renderNetlifyHeaders());
});

test('every public response has nosniff, referrer, permission and frame protection', () => {
  const rules = readRules();
  for (const pathname of ['/', ...PUBLIC_FILES.filter(file => file !== '_headers').map(file => `/${file}`)]) {
    const headers = headersFor(rules, pathname);
    assert.equal(headers['x-content-type-options'], 'nosniff');
    assert.equal(headers['referrer-policy'], 'strict-origin-when-cross-origin');
    assert.equal(headers['x-frame-options'], 'DENY');
    assert.equal(headers['permissions-policy'], 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
    assert.match(headers['content-security-policy'], /frame-ancestors 'none'/);
  }
});

test('compatibility CSP permits current inline handlers/styles, local runtime and required service origins', () => {
  const csp = headersFor(readRules(), '/')['content-security-policy'];
  const directives = Object.fromEntries(csp.split('; ').map(part => { const [name, ...values] = part.split(' '); return [name, values]; }));
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(html, /<script>\s*[\s\S]+?<\/script>/);
  assert.match(html, /\sonclick=/);
  assert.match(html, /\sstyle=/);
  assert.deepEqual(directives['script-src'], ["'self'", "'unsafe-inline'"]);
  assert.deepEqual(directives['style-src'], ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com']);
  assert.deepEqual(directives['connect-src'], ["'self'", 'https://jwpbwlrdzmfzjlbrktlc.supabase.co', 'wss://jwpbwlrdzmfzjlbrktlc.supabase.co']);
  assert.deepEqual(directives['font-src'], ["'self'", 'https://fonts.gstatic.com']);
  assert.deepEqual(directives['img-src'], ["'self'", 'data:']);
  assert.deepEqual(directives['object-src'], ["'none'"]);
  assert.doesNotMatch(csp, /unsafe-eval|strict-dynamic|nonce-|sha256-|sandbox/);
  for (const [, src] of html.matchAll(/<script[^>]+src="([^"]+)"/g)) {
    assert.ok(!/^(?:[a-z]+:|\/\/)/i.test(src), 'runtime scripts must remain local');
  }
});

test('unhashed runtime revalidates and image cache never overlaps a contradictory global cache rule', () => {
  const rules = readRules();
  for (const pathname of ['/', ...PUBLIC_FILES.filter(file => file !== '_headers').map(file => `/${file}`)]) {
    const matches = rules.filter(rule => (rule.path === '/*' || rule.path === pathname) && rule.headers['cache-control']);
    assert.equal(matches.length, 1, pathname);
    const cache = headersFor(rules, pathname)['cache-control'];
    assert.doesNotMatch(cache, /immutable/);
    if (pathname === '/' || pathname === '/index.html') assert.equal(cache, 'no-cache, max-age=0, must-revalidate');
    else if (/\.(js|css)$/.test(pathname)) assert.equal(cache, 'no-cache, must-revalidate');
    else assert.equal(cache, 'public, max-age=86400');
  }
});

test('extensionless Netlify source has no credential findings and does not contain internal publish routes', () => {
  const text = fs.readFileSync(path.join(root, '_headers'), 'utf8');
  assert.deepEqual(scanText(text, '_headers'), []);
  assert.ok(readRules().every(rule => !/^\/(?:tests|supabase|node_modules|\.env)(?:\/|$)/.test(rule.path)));
});

test('local release-header HTTP smoke serves runtime MIME types, security and cache headers without exposing internals', async () => {
  // Source and dist equality is independently covered by the existing release
  // suite; serving source here avoids racing that suite's dist rebuild hook.
  const server = createReleasePreview(root);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    for (const pathname of ['/', '/index.html', '/app.js', '/rpg-pages.css', '/vendor/supabase/supabase.js', '/assets/auth-guild-night.png']) {
      const response = await fetch(`${base}${pathname}?release=check`);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(response.headers.get('content-security-policy'), headersFor(readRules(), pathname)['content-security-policy']);
      assert.equal(response.headers.get('cache-control'), headersFor(readRules(), pathname)['cache-control']);
      assert.match(response.headers.get('content-type'), /text\/html|javascript|text\/css|image\/png/);
      await response.arrayBuffer();
    }
    for (const pathname of ['/_headers', '/tests/final-release-headers.test.js', '/.env', '/supabase/functions/lifequest-command/index.ts']) {
      assert.equal((await fetch(`${base}${pathname}`)).status, 404);
    }
  } finally { await new Promise(resolve => server.close(resolve)); }
});
