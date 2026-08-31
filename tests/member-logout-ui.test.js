const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const MemberLogoutUi = require('../memberLogoutUi.js');

function createButton(label = '登出會員卷宗') {
  const strong = { textContent: label };
  const attributes = new Map();
  return {
    disabled: false,
    querySelector(selector) { return selector === 'strong' ? strong : null; },
    setAttribute(name, value) { attributes.set(name, String(value)); },
    getAttribute(name) { return attributes.get(name); },
    label: strong
  };
}

function createController() {
  const memberButton = createButton();
  const onboardingButton = createButton();
  return {
    memberButton,
    onboardingButton,
    controller: MemberLogoutUi.createMemberLogoutUi({
      buttons: [memberButton, onboardingButton]
    })
  };
}

test('login completion restores both logout buttons to an enabled idle state', () => {
  const { controller, memberButton, onboardingButton } = createController();
  controller.setPending(true);
  controller.markMemberReady();

  for (const button of [memberButton, onboardingButton]) {
    assert.equal(button.disabled, false);
    assert.equal(button.getAttribute('aria-busy'), 'false');
    assert.equal(button.label.textContent, '登出會員卷宗');
  }
});

test('session restore completion clears stale logout loading state', () => {
  const { controller, memberButton } = createController();
  controller.setPending(true);
  controller.markMemberReady();

  assert.equal(controller.isPending(), false);
  assert.equal(memberButton.disabled, false);
  assert.equal(memberButton.label.textContent, '登出會員卷宗');
});

test('logout buttons show loading only while signOut is executing', async () => {
  const { controller, memberButton } = createController();
  let finishSignOut;
  const signOut = new Promise(resolve => { finishSignOut = resolve; });
  const logoutPromise = controller.run(() => signOut);

  assert.equal(memberButton.disabled, true);
  assert.equal(memberButton.getAttribute('aria-busy'), 'true');
  assert.equal(memberButton.label.textContent, '登出中…');

  finishSignOut({ ok: true });
  await logoutPromise;
  assert.equal(memberButton.disabled, false);
  assert.equal(memberButton.label.textContent, '登出會員卷宗');
});

test('successful signOut always resets logout UI state', async () => {
  const { controller, onboardingButton } = createController();
  const result = await controller.run(async () => ({ ok: true }));

  assert.deepEqual(result, { ok: true });
  assert.equal(controller.isPending(), false);
  assert.equal(onboardingButton.disabled, false);
  assert.equal(onboardingButton.label.textContent, '登出會員卷宗');
});

test('failed signOut also resets logout UI state', async () => {
  const { controller, memberButton } = createController();
  const result = await controller.run(async () => ({
    ok: false,
    errorCode: 'LOGOUT_FAILED'
  }));

  assert.equal(result.ok, false);
  assert.equal(controller.isPending(), false);
  assert.equal(memberButton.disabled, false);
  assert.equal(memberButton.label.textContent, '登出會員卷宗');
});

test('unexpected signOut exceptions also release the logout buttons', async () => {
  const { controller, memberButton } = createController();
  await assert.rejects(
    controller.run(async () => { throw new Error('network failure'); }),
    /network failure/
  );

  assert.equal(controller.isPending(), false);
  assert.equal(memberButton.disabled, false);
  assert.equal(memberButton.label.textContent, '登出會員卷宗');
});

test('app wires member-ready and signOut paths through the shared logout controller', () => {
  const appSource = fs.readFileSync(path.resolve(__dirname, '../app.js'), 'utf8');
  const html = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8');

  assert.match(appSource, /if \(user && !loading\) memberLogoutUi\?\.markMemberReady\(\)/);
  assert.match(appSource, /memberLogoutUi\.run\(\(\) => memberAuthCoordinator\.logout\(\)\)/);
  assert.match(html, /<script src="memberLogoutUi\.js\?v=1"><\/script>/);
});
