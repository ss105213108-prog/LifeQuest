const fs = require('node:fs');
const path = require('node:path');

const PUBLIC_FILES = Object.freeze([
  '_headers',
  'index.html',
  'app.js',
  'backendContract.js',
  'dailyFormSubmission.js',
  'gameApplication.js',
  'guestMode.js',
  'lifequestCore.js',
  'memberAuth.js',
  'memberEconomyUi.js',
  'memberLogoutUi.js',
  'mockData.js',
  'modalFocusManager.js',
  'rpg-pages.css',
  'style.css',
  'supabaseClient.js',
  'supabaseConfig.js',
  'assets/auth-guild-night.png',
  'assets/art/boss-budget-vampire.png',
  'assets/art/boss-fried-food-beast.png',
  'assets/art/boss-laziness-beast.png',
  'assets/art/boss-sleep-nightmare.png',
  'assets/art/boss-sugar-monster.png',
  'assets/art/guild-adventurer.png',
  'assets/art/guild-medals-atlas.png',
  'assets/art/guild-quartermaster.png',
  'vendor/chart.js/chart.umd.min.js',
  'vendor/lucide/lucide.min.js',
  'vendor/supabase/supabase.js'
].sort());

const HOSTING_HEADERS = Object.freeze({
  'Content-Security-Policy': [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "img-src 'self' data:",
    "font-src 'self' https://fonts.gstatic.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "script-src 'self' 'unsafe-inline'",
    "connect-src 'self' https://jwpbwlrdzmfzjlbrktlc.supabase.co wss://jwpbwlrdzmfzjlbrktlc.supabase.co"
  ].join('; '),
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'X-Frame-Options': 'DENY'
});

const CACHE_POLICY = Object.freeze({
  index: 'no-cache, max-age=0, must-revalidate',
  scriptsAndStyles: 'no-cache, must-revalidate',
  assets: 'public, max-age=86400'
});

// Use exact asset paths so overlapping Netlify rules cannot concatenate
// contradictory Cache-Control directives. Keep the checked-in source in sync.
function renderNetlifyHeaders() {
  const lines = [
    '# LifeQuest Netlify release headers. Source: scripts/release-files.cjs.',
    '# Inline scripts/styles remain allowed for the existing Vanilla runtime.',
    '/*',
    ...Object.entries(HOSTING_HEADERS).map(([name, value]) => `  ${name}: ${value}`),
    '', '/', `  Cache-Control: ${CACHE_POLICY.index}`
  ];
  for (const file of PUBLIC_FILES.filter(file => file !== '_headers')) {
    const cache = file === 'index.html' ? CACHE_POLICY.index
      : /\.(?:js|css)$/.test(file) ? CACHE_POLICY.scriptsAndStyles : CACHE_POLICY.assets;
    lines.push('', `/${file}`, `  Cache-Control: ${cache}`);
  }
  return `${lines.join('\n')}\n`;
}

function normalizeRelative(file) {
  return file.split(path.sep).join('/');
}

function listFiles(root) {
  const files = [];
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Release output cannot contain symlinks: ${absolute}`);
      if (entry.isDirectory()) walk(absolute);
      else files.push(normalizeRelative(path.relative(root, absolute)));
    }
  }
  walk(root);
  return files.sort();
}

function extractLocalReferences(html, cssTexts = []) {
  const references = new Set();
  for (const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
    const reference = match[1];
    if (!/^(?:https?:|data:|#|mailto:|tel:)/i.test(reference)) references.add(reference.split(/[?#]/)[0]);
  }
  for (const css of cssTexts) {
    for (const match of css.matchAll(/url\(["']?([^"')]+)["']?\)/g)) {
      const reference = match[1];
      if (!/^(?:https?:|data:|#)/i.test(reference)) references.add(reference.split(/[?#]/)[0]);
    }
  }
  return [...references].filter(Boolean).sort();
}

module.exports = {
  PUBLIC_FILES,
  HOSTING_HEADERS,
  CACHE_POLICY,
  renderNetlifyHeaders,
  listFiles,
  extractLocalReferences
};
