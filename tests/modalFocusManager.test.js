const test = require('node:test');
const assert = require('node:assert/strict');

const { createModalFocusManager } = require('../modalFocusManager.js');

function makeClassList() {
  const values = new Set();
  return {
    add: value => values.add(value),
    remove: value => values.delete(value),
    contains: value => values.has(value)
  };
}

function makeElement(documentRef, { hidden = false, disabled = false } = {}) {
  const attributes = new Map();
  return {
    hidden,
    disabled,
    inert: false,
    isConnected: true,
    classList: makeClassList(),
    focus() { documentRef.activeElement = this; },
    getAttribute(name) { return attributes.get(name) ?? null; },
    setAttribute(name, value) { attributes.set(name, String(value)); },
    toggleAttribute(name, force) {
      if (force) attributes.set(name, '');
      else attributes.delete(name);
    }
  };
}

function makeFixture() {
  const listeners = new Map();
  const documentRef = {
    activeElement: null,
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type, listener) {
      if (listeners.get(type) === listener) listeners.delete(type);
    }
  };
  const trigger = makeElement(documentRef);
  const cancel = makeElement(documentRef);
  const confirm = makeElement(documentRef);
  const dialog = makeElement(documentRef);
  dialog.querySelectorAll = () => [cancel, confirm];
  const overlay = makeElement(documentRef);
  const background = makeElement(documentRef);
  documentRef.activeElement = trigger;
  return { listeners, documentRef, trigger, cancel, confirm, dialog, overlay, background };
}

test('modal open locks the background and close restores the invoking control', () => {
  const fixture = makeFixture();
  const manager = createModalFocusManager({
    overlay: fixture.overlay,
    dialog: fixture.dialog,
    documentRef: fixture.documentRef,
    backgroundElements: [fixture.background]
  });

  manager.open({ initialFocus: fixture.cancel });
  assert.equal(fixture.overlay.classList.contains('active'), true);
  assert.equal(fixture.overlay.getAttribute('aria-hidden'), 'false');
  assert.equal(fixture.background.inert, true);
  assert.equal(fixture.documentRef.activeElement, fixture.cancel);

  manager.close();
  assert.equal(fixture.overlay.classList.contains('active'), false);
  assert.equal(fixture.overlay.getAttribute('aria-hidden'), 'true');
  assert.equal(fixture.background.inert, false);
  assert.equal(fixture.documentRef.activeElement, fixture.trigger);
});

test('modal traps Tab in both directions and Escape uses the dismiss path', () => {
  const fixture = makeFixture();
  let dismissed = 0;
  const manager = createModalFocusManager({
    overlay: fixture.overlay,
    dialog: fixture.dialog,
    documentRef: fixture.documentRef
  });
  manager.open({
    initialFocus: fixture.cancel,
    onDismiss: () => {
      dismissed += 1;
      manager.close();
    }
  });

  fixture.documentRef.activeElement = fixture.confirm;
  let prevented = false;
  fixture.listeners.get('keydown')({ key: 'Tab', shiftKey: false, preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(fixture.documentRef.activeElement, fixture.cancel);

  fixture.listeners.get('keydown')({ key: 'Tab', shiftKey: true, preventDefault() {} });
  assert.equal(fixture.documentRef.activeElement, fixture.confirm);

  fixture.listeners.get('keydown')({ key: 'Escape', shiftKey: false, preventDefault() {} });
  assert.equal(dismissed, 1);
  assert.equal(manager.isOpen(), false);
  assert.equal(fixture.documentRef.activeElement, fixture.trigger);
});
