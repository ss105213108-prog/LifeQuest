const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const Core = require('../lifequestCore.js');
const { createHarness, app } = require('./helpers/member-economy-ui-harness.cjs');

function production(start, end) {
  const a = app.indexOf(start), b = app.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a);
  return app.slice(a, b);
}
// DOM sinks capture exactly the markup emitted by production renderHabits.
// Assertions inspect encoded text/attribute boundaries, not a fake alert stub.
class Sink {
  constructor() { this.children = []; this.parts = new Map(); this.style = { setProperty() {} }; }
  set innerHTML(value) { this.html = value; this.children = []; this.parts.clear(); }
  get innerHTML() { return this.html || ''; }
  querySelector(selector) { if (!this.parts.has(selector)) this.parts.set(selector, new Sink()); return this.parts.get(selector); }
  appendChild(child) { this.children.push(child); }
  markup() { return this.innerHTML + [...this.children, ...this.parts.values()].map(x => x.markup()).join(''); }
}
function wireHabitRenderer(h) {
  const createElement = h.context.document.createElement;
  h.context.document.createElement = (...args) => {
    const node = createElement(...args);
    node.style = { setProperty() {} };
    return node;
  };
  h.elements.listHabits = new Sink();
  h.context.MainQuestEngine = Core.MainQuestEngine;
  h.context.getTodayDateString = () => '2026-08-28';
  vm.runInContext(production('function escapeHtml(', 'function stripPictographs')
    + production('function renderHabits()', 'async function saveHabitFromEditor'), h.context);
}

for (const [title, escaped] of [
  ['<img src=x onerror=alert(1)>', '&lt;img src=x onerror=alert(1)&gt;'],
  ['<script>alert(1)</script>', '&lt;script&gt;alert(1)&lt;/script&gt;'],
  ['"</div><script>alert(1)</script>', '&quot;&lt;/div&gt;&lt;script&gt;alert(1)&lt;/script&gt;'],
  ['"\'& onmouseover="alert(1)', '&quot;&#039;&amp; onmouseover=&quot;alert(1)']
]) test('saved custom habit survives reload as escaped text and quoted attributes: ' + title.slice(0, 12), async t => {
  const h = await createHarness({ gameplayProjection: true });
  t.after(() => h.coordinator.stop());
  wireHabitRenderer(h);
  const id = '00000000-0000-4000-8000-000000000001';
  h.success((state, command) => {
    assert.equal(command.type, 'CREATE_CUSTOM_HABIT');
    state.customHabits.push({ id, title: command.payload.title, direction: 'good', deletedAt: null });
  });
  const saved = await h.coordinator.createCustomHabit({ title, direction: 'good' });
  assert.equal(saved.ok, true);
  assert.equal(h.requests[0].command.payload.title, title);
  assert.equal((await h.coordinator.reloadMember()).ok, true);
  h.context.renderHabits();
  const html = h.elements.listHabits.markup();
  assert.ok(html.includes(`<h4>${escaped}</h4>`));
  assert.ok(html.includes(`aria-label="修改${escaped}"`));
  assert.ok(html.includes(`data-entity-id="${id}"`));
  assert.ok(!/<\s*(script|img|svg)\b/i.test(html));
  // A fresh runtime also renders the saved Cloud title, not the old DOM.
  const restored = await createHarness({ gameplayProjection: true, server: h.server });
  t.after(() => restored.coordinator.stop());
  wireHabitRenderer(restored); restored.context.renderHabits();
  assert.ok(restored.elements.listHabits.markup().includes(`<h4>${escaped}</h4>`));
});

test('habit entity IDs are escaped in data attributes even for malformed historical read data', async t => {
  const h = await createHarness({ gameplayProjection: true });
  t.after(() => h.coordinator.stop()); wireHabitRenderer(h);
  h.context.state.tasks = [{ type: 'habit', id: '" onmouseover="alert(1)', title: '文字', direction: 'good' }];
  h.context.renderHabits();
  const html = h.elements.listHabits.markup();
  assert.ok(html.includes('data-entity-id="&quot; onmouseover=&quot;alert(1)"'));
  assert.ok(!html.includes('data-entity-id="" onmouseover="'));
});

test('Auth and modal error text never reaches an HTML sink', () => {
  const element = () => ({ dataset: {}, classList: { add() {}, remove() {} },
    set innerHTML(_value) { throw new Error('untrusted error used an HTML sink'); } });
  const context = vm.createContext({});
  vm.runInContext(production('function setAuthStatus(', 'function setAuthButtonBusy('), context);
  const status = element(), text = '<svg onload=alert(1)>SQL error</svg>';
  context.setAuthStatus(status, text, { error: true });
  assert.equal(status.textContent, text);
  assert.equal(status.dataset.status, 'error');
  // The actual modal writes only title/description through textContent.
  const modal = production('function showModal(', '// ==========================================');
  context.elements = new Proxy({}, { get(target, key) { return target[key] ||= element(); } });
  context.resolveGuildDocument = () => 'warning';
  context.modalFocusManager = { open() {} };
  context.window = {};
  vm.runInContext(modal, context);
  context.showModal('錯誤', text);
  assert.equal(context.elements.modalDesc.textContent, text);
  assert.equal(context.elements.modalTitle.textContent, '錯誤');
});
