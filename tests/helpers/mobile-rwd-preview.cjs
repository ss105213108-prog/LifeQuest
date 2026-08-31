// Local layout fixtures only. No browser Auth, storage or remote transactions.
// Uses production markup/renderers; never included in the release allowlist.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const http = require('node:http');
const { createHarness, fixture, app } = require('./member-economy-ui-harness.cjs');
const root = path.resolve(__dirname, '../..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const stripScripts = html => html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
function fragment(start, end) {
  const a = index.indexOf(start), b = index.indexOf(end, a);
  if (a < 0 || b < a) throw new Error('RWD fixture source boundary changed');
  return index.slice(a, b);
}
function serialize(element) {
  let html = element.innerHTML;
  for (const [selector, child] of element.parts) {
    const attr = selector.slice(1, -1);
    html = html.replace(` ${attr}></div>`, ` ${attr}>${serialize(child)}</div>`);
  }
  return html + element.children.map(child => `<article class="${child.className}">${serialize(child)}</article>`).join('');
}
async function renderPage(view) {
  const head = stripScripts(fragment('<head>', '</head>')) + '</head>';
  let content;
  if (view === 'conflict' || view === 'confirm') {
    const h = await createHarness();
    try {
      await h.context.handleMemberCommandFailure({ errorCode: 'VERSION_CONFLICT' }, '購買商品');
      const modal = h.modals.at(-1);
      content = fragment('<div class="overlay" id="achievement-overlay"', '\n  <script>')
        .replace('class="overlay"', 'class="overlay active"')
        .replace('aria-hidden="true"', 'aria-hidden="false"')
        .replace(/(<h2 id="modal-title">)[\s\S]*?<\/h2>/, `$1${modal.title}</h2>`)
        .replace(/(<p id="modal-desc">)[\s\S]*?<\/p>/, `$1${modal.message}</p>`);
      // Layout-only counterpart of a dialog with a real cancel action.
      if (view === 'confirm') content = content.replace('type="button" hidden>取消', 'type="button">取消');
    } finally { h.coordinator.stop(); }
  } else if (view === 'inventory') {
    const state = fixture();
    state.inventory = [
      { itemKey: 'potion_red', quantity: 99 },
      { itemKey: 'weapon_sword', quantity: 1 },
      { itemKey: 'armor_shield', quantity: 1 },
      { itemKey: 'pet_cactus', quantity: 1 }
    ];
    state.inventory = state.inventory.map(row => ({ ...state.catalog.find(item => item.itemKey === row.itemKey), ...row }));
    state.equipment = [{ slot: 'weapon', itemKey: 'weapon_sword', displayName: '大劍' }, { slot: 'pet', itemKey: 'pet_cactus', displayName: '仙人掌寵物' }];
    state.rewardTickets = [{ id: 'layout-ticket', ticketKey: 'rest_30', name: '短暫休憩券', status: 'unused', gemCost: 3, catalogVersion: 1 }];
    const h = await createHarness({ server: { state } });
    try {
      const slots = Object.fromEntries(['weapon', 'armor', 'pet'].map(slot => [`equipped-${slot}-slot`, new h.elements.listShopRewards.constructor()]));
      h.context.document.getElementById = id => slots[id] || null;
      vm.runInContext(app.slice(app.indexOf('function getShopItemArtwork('), app.indexOf('function formatMemberEconomyDelta(')), h.context);
      h.context.renderMemberShopRewards();
      const loadout = Object.entries(slots).map(([id, element]) => `<div class="equipment-slot" id="${id}">${serialize(element)}</div>`).join('');
      content = `<main class="app-content"><section id="pane-supply" class="tab-pane active"><div class="location-page supply-location"><div class="quartermaster-counter"><aside class="quartermaster-booth"><h2>會員裝備非空測試</h2><section class="equipped-loadout"><header><h3>目前裝備欄</h3></header>${loadout}</section></aside><div class="merchant-stockroom"><div id="col-shop"><div id="list-shop-rewards">${serialize(h.elements.listShopRewards)}</div></div></div></div></div></section></main>`;
    } finally { h.coordinator.stop(); }
  } else {
    content = fragment('<div class="auth-login-stage" id="auth-member-view"', '</section>') + '</section></div>';
    content = content.replace(/ hidden/g, '')
      .replace('id="auth-member-name">—', 'id="auth-member-name">手機版面驗證冒險者')
      .replace('id="auth-member-main-quest">—', 'id="auth-member-main-quest">改善睡眠');
    const status = view === 'offline' ? '目前無法連線，請檢查網路後再試。'
      : view === 'loading' ? '正在讀取會員卷宗…' : '會員資料已由雲端載入。';
    content = content.replace(/(<p[^>]*id="auth-member-status"[^>]*>)[\s\S]*?<\/p>/, `$1${status}</p>`);
    if (view === 'loading') content = content.replace(/<button /g, '<button disabled ');
    content = `<div id="auth-overlay" class="overlay auth-overlay active">${content}</div>`;
  }
  return `<!DOCTYPE html><html lang="zh-TW">${head}<body>${content}<script src="/vendor/lucide/lucide.min.js"></script><script>lucide.createIcons();</script></body></html>`;
}
module.exports = { renderPage };
if (require.main === module) {
  const allowed = new Set(['member', 'inventory', 'loading', 'offline', 'conflict', 'confirm']);
  http.createServer(async (req, res) => {
    const name = new URL(req.url, 'http://127.0.0.1').pathname.slice(1);
    try {
      if (req.method !== 'GET') return res.writeHead(405).end();
      if (allowed.has(name)) return res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }).end(await renderPage(name));
      const file = path.resolve(root, name);
      if (!file.startsWith(root + path.sep) || !/\.(css|js|png)$/.test(file)) return res.writeHead(404).end();
      const type = file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'text/javascript' : 'image/png';
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' }).end(fs.readFileSync(file));
    } catch { res.writeHead(500).end('Layout fixture failed'); }
  }).listen(4188, '127.0.0.1', () => process.stdout.write('RWD fixtures: http://127.0.0.1:4188/member\n'));
}
