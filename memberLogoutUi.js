(function(root, factory) {
  const exported = factory();
  if (typeof module === 'object' && module.exports) module.exports = exported;
  if (root) root.LifeQuestMemberLogoutUi = exported;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  function createMemberLogoutUi({
    buttons = [],
    idleLabel = '登出會員卷宗',
    busyLabel = '登出中…'
  } = {}) {
    const controls = buttons.filter(Boolean);
    let pending = false;

    function render() {
      controls.forEach(button => {
        button.disabled = pending;
        button.setAttribute('aria-busy', String(pending));
        const label = button.querySelector('strong');
        if (label) label.textContent = pending ? busyLabel : idleLabel;
      });
    }

    function setPending(value) {
      pending = Boolean(value);
      render();
    }

    function markMemberReady() {
      setPending(false);
    }

    async function run(action) {
      if (pending) return { ok: false, skipped: true };
      setPending(true);
      try {
        return await action();
      } finally {
        setPending(false);
      }
    }

    render();
    return {
      isPending: () => pending,
      setPending,
      markMemberReady,
      run
    };
  }

  return { createMemberLogoutUi };
});
