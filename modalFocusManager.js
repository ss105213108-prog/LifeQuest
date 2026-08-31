(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ModalFocusManager = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  const FOCUSABLE_SELECTOR = [
    'button:not([disabled])',
    '[href]',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])'
  ].join(',');

  function isUsable(element) {
    return Boolean(
      element &&
      !element.hidden &&
      !element.disabled &&
      element.getAttribute?.('aria-hidden') !== 'true'
    );
  }

  function createModalFocusManager({
    overlay,
    dialog,
    documentRef,
    backgroundElements = []
  } = {}) {
    if (!overlay || !dialog || !documentRef) {
      throw new Error('Modal focus manager requires overlay, dialog and document');
    }

    let open = false;
    let returnFocus = null;
    let dismissHandler = null;

    function getFocusableElements() {
      return Array.from(dialog.querySelectorAll?.(FOCUSABLE_SELECTOR) || []).filter(isUsable);
    }

    function setBackgroundLocked(locked) {
      backgroundElements.filter(Boolean).forEach(element => {
        element.inert = locked;
        element.toggleAttribute?.('inert', locked);
      });
    }

    function handleKeydown(event) {
      if (!open) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        dismissHandler?.('escape');
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = getFocusableElements();
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus?.();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const current = documentRef.activeElement;
      if (event.shiftKey && (current === first || !focusable.includes(current))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (current === last || !focusable.includes(current))) {
        event.preventDefault();
        first.focus();
      }
    }

    function show({ initialFocus, onDismiss } = {}) {
      if (!open) returnFocus = documentRef.activeElement;
      open = true;
      dismissHandler = typeof onDismiss === 'function' ? onDismiss : null;
      overlay.classList.add('active');
      overlay.setAttribute('aria-hidden', 'false');
      setBackgroundLocked(true);
      documentRef.addEventListener('keydown', handleKeydown);

      const target = isUsable(initialFocus)
        ? initialFocus
        : (getFocusableElements()[0] || dialog);
      target.focus?.();
    }

    function close({ restoreFocus = true } = {}) {
      if (!open) return;
      open = false;
      overlay.classList.remove('active');
      overlay.setAttribute('aria-hidden', 'true');
      setBackgroundLocked(false);
      documentRef.removeEventListener('keydown', handleKeydown);
      dismissHandler = null;

      const target = returnFocus;
      returnFocus = null;
      if (restoreFocus && target?.isConnected !== false) target?.focus?.();
    }

    return {
      open: show,
      close,
      handleKeydown,
      isOpen: () => open
    };
  }

  return { createModalFocusManager, FOCUSABLE_SELECTOR };
});
