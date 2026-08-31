(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LifeQuestGuestMode = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DEFAULT_MODE_KEY = 'lifequest_app_mode';
  const VALID_MODES = new Set(['landing', 'guest']);

  function normalizeMode(value, fallbackMode = 'landing') {
    if (VALID_MODES.has(value)) return value;
    return VALID_MODES.has(fallbackMode) ? fallbackMode : 'landing';
  }

  function createGuestModeController({
    storage,
    modeKey = DEFAULT_MODE_KEY,
    fallbackMode = 'landing'
  } = {}) {
    if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') {
      throw new Error('GuestModeController requires a Storage-compatible adapter');
    }

    let memoryMode = normalizeMode(fallbackMode);

    function readMode() {
      try {
        const storedMode = storage.getItem(modeKey);
        memoryMode = normalizeMode(storedMode, memoryMode);
      } catch (_error) {
        // Mode switching remains available when browser storage is unavailable.
      }
      return memoryMode;
    }

    function writeMode(nextMode) {
      memoryMode = normalizeMode(nextMode, memoryMode);
      try {
        storage.setItem(modeKey, memoryMode);
      } catch (_error) {
        // Keep the mode for this page session without touching the guest save.
      }
      return memoryMode;
    }

    return Object.freeze({
      getMode: readMode,
      isGuest: () => readMode() === 'guest',
      enterGuest: () => writeMode('guest'),
      exitGuest: () => writeMode('landing')
    });
  }

  return Object.freeze({
    DEFAULT_MODE_KEY,
    createGuestModeController
  });
});
