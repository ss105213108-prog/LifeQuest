const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const css = fs.readFileSync(path.join(__dirname, '../rpg-pages.css'), 'utf8');
const marker = '/* Mobile RWD containment: keep these overrides after the desktop scene rules. */';
const mobile = css.slice(css.indexOf(marker));

// CSS contract guards complement the real-browser width/rect checks. These do
// not claim to emulate a browser layout engine or live Member authentication.
test('mobile overrides follow desktop training columns and remain breakpoint scoped', () => {
  assert.ok(css.indexOf(marker) > css.lastIndexOf('grid-template-columns: 76px minmax(0,1fr)'));
  assert.match(mobile, /@media \(max-width: 820px\)/);
  assert.doesNotMatch(mobile, /@media \(min-width:/);
});
test('mobile training uses the full column and shrinkable form controls', () => {
  assert.match(mobile, /\.training-yard-frame\s*\{[^}]*grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(mobile, /\.commission-scribe-desk\s*\{[^}]*width: 100%/);
  assert.match(mobile, /\.habit-editor :is\(input, select, textarea\)\s*\{[^}]*min-width: 0/);
});
test('training summary cannot retain fixed desktop tracks', () => {
  assert.match(mobile, /\.training-record-strip\s*\{[^}]*grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(mobile, /\.training-record-strip p\s*\{[^}]*overflow-wrap: anywhere/);
});

test('mobile monster challenge does not reserve a desktop log column beside trigger conditions', () => {
  const tablet = mobile.slice(0, mobile.indexOf('@media (max-width: 430px)'));
  assert.match(tablet, /#pane-boss-battle \.boss-arena\s*\{\s*grid-template-columns: minmax\(0, 1fr\);\s*\}/);
  assert.doesNotMatch(tablet, /#pane-boss-battle[^}]*overflow(?:-x)?: hidden/);
});
test('daily root grid and input tracks can shrink without hiding overflow', () => {
  assert.match(mobile, /#pane-dashboard \.camp-world-shell\s*\{[^}]*grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(mobile, /\.camp-stage-frame[^}]*min-width: 0/);
  assert.match(mobile, /\.engraved-input\s*\{[^}]*grid-template-columns: minmax\(0, 1fr\) auto/);
  assert.doesNotMatch(mobile, /overflow(?:-x)?: hidden/);
});
test('mobile dialog buttons wrap without the desktop minimum width', () => {
  assert.match(mobile, /\.modal-action-row\s*\{[^}]*grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(mobile, /\.modal-action-row button\s*\{[^}]*min-width: 0[^}]*min-height: 44px/);
});

test('system dialog hidden actions outrank button display styles at every viewport', () => {
  // Source contract guard; actual computed display is also checked in-browser
  // at 320 / 390 / 430 / 1280px using the real modal markup and stylesheets.
  assert.match(css, /#achievement-overlay \.modal-action-row \[hidden\]\s*\{\s*display: none !important;\s*\}/);
});

test('dialog preview preserves hidden cancellation for notices and visible cancellation for confirms', async () => {
  const { renderPage } = require('./helpers/mobile-rwd-preview.cjs');
  const notice = await renderPage('conflict');
  const confirm = await renderPage('confirm');
  assert.match(notice, /id="modal-cancel-btn"[^>]*\bhidden/);
  assert.doesNotMatch(confirm, /id="modal-cancel-btn"[^>]*\bhidden/);
  assert.match(confirm, /id="modal-cancel-btn"[^>]*>取消<\/button>/);
});

test('mobile daily date control has its own full-width row instead of competing with policy text', () => {
  assert.match(mobile, /\.camp-log-slot \.daily-date-policy\s*\{[^}]*grid-template-columns: auto minmax\(0, 1fr\)/);
  assert.match(mobile, /\.camp-log-slot \.record-date-control\s*\{[^}]*grid-column: 1 \/ -1[^}]*width: 100%/);
});
test('training and economy mobile controls retain 44px touch targets', () => {
  assert.match(mobile, /\.commission-clerk-tools button/);
  assert.match(mobile, /\.counter-actions button/);
  assert.match(mobile, /\.habit-editor button\s*\{[^}]*min-height: 44px/);
});
test('horizontal navigation has a visible scroll affordance on mobile', () => {
  assert.match(mobile, /\.town-gate-nav[^}]*scrollbar-width: thin/);
  assert.match(mobile, /::-webkit-scrollbar\s*\{[^}]*display: block/);
});
test('mobile dialogs retain vh fallback and bounded dynamic viewport scrolling', () => {
  assert.match(mobile, /max-height: calc\(100vh - 2rem\)/);
  assert.match(mobile, /max-height: calc\(100dvh - 2rem\)/);
  assert.match(mobile, /\.system-modal[^}]*overflow-y: auto/);
});

test('Member RWD fixture renders populated inventory and equipment through production renderers', async () => {
  const { renderPage } = require('./helpers/mobile-rwd-preview.cjs');
  const html = await renderPage('inventory');
  assert.match(html, /目前數量 99/);
  assert.match(html, /使用藥水/);
  assert.match(html, /卸下裝備/);
  assert.match(html, /會員正式裝備/);
  assert.match(html, /data-member-inventory>[\s\S]*?<article/);
  assert.doesNotMatch(html, /src="(?:app|memberAuth|supabaseClient)\.js/);
});
test('RWD fixtures cover the real conflict modal and dossier loading/offline states without live Auth', async () => {
  const { renderPage } = require('./helpers/mobile-rwd-preview.cjs');
  const conflict = await renderPage('conflict');
  assert.match(conflict, /會員卷宗已在其他裝置更新/);
  assert.match(conflict, /公會已重新讀取最新卷宗/);
  assert.match(conflict, /modal system-modal/);
  assert.match(await renderPage('loading'), /正在讀取會員卷宗/);
  assert.match(await renderPage('offline'), /目前無法連線，請檢查網路後再試/);
  assert.match(await renderPage('member'), /手機版面驗證冒險者/);
});
