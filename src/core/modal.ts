// Shared modal focus management: traps Tab inside an open dialog and restores
// focus to the element that opened it when the dialog closes.

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

let lastTrigger: HTMLElement | null = null;
let activeModal: HTMLElement | null = null;
let observer: MutationObserver | null = null;
let previousOverflow = '';

function focusablesIn(modal: HTMLElement): HTMLElement[] {
  return Array.from(modal.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    el => el.offsetParent !== null || el === document.activeElement
  );
}

/** Remember the element that opened a modal so close can restore focus. */
export function rememberModalTrigger(trigger?: HTMLElement | null): void {
  if (trigger) lastTrigger = trigger;
  else if (document.activeElement instanceof HTMLElement) lastTrigger = document.activeElement;
}

/** Keep Tab/Shift+Tab inside the currently open modal. */
export function trapModalFocus(modal: HTMLElement): void {
  if (modal.dataset.focusTrapped === 'true') return;
  modal.dataset.focusTrapped = 'true';
  activeModal = modal;

  modal.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key !== 'Tab' || activeModal !== modal) return;
    const focusables = focusablesIn(modal);
    if (focusables.length === 0) {
      event.preventDefault();
      modal.focus({ preventScroll: true });
      return;
    }
    const first = focusables[0]!;
    const last = focusables[focusables.length - 1]!;
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !modal.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !modal.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  });
}

/** Open a modal overlay, trap focus inside it and focus its first control. */
export function openModal(overlay: HTMLElement, trigger?: HTMLElement | null): void {
  rememberModalTrigger(trigger);
  if (!overlay.isConnected) document.body.appendChild(overlay);
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  if (!overlay.hasAttribute('tabindex')) overlay.setAttribute('tabindex', '-1');
  previousOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  trapModalFocus(overlay);
  const focusables = focusablesIn(overlay);
  (focusables[0] ?? overlay).focus({ preventScroll: true });
}

/** Restore focus after the active modal has been removed. */
export function restoreFocus(): void {
  const target = lastTrigger?.isConnected ? lastTrigger : document.getElementById('main-content');
  lastTrigger = null;
  activeModal = null;
  if (target instanceof HTMLElement) target.focus({ preventScroll: true });
}

/** Close a single modal (if supplied) and restore the opener's focus. */
export function closeModal(overlay?: HTMLElement | null): void {
  const target = overlay ?? activeModal;
  target?.remove();
  if (target === activeModal || !document.querySelector('.modal-overlay')) {
    document.body.style.overflow = previousOverflow;
    restoreFocus();
  }
}

/** Close every modal overlay; delegates focus restoration to restoreFocus(). */
export function closeAllModals(): void {
  document.querySelectorAll('.modal-overlay').forEach(modal => modal.remove());
  document.body.style.overflow = previousOverflow;
  restoreFocus();
}

/**
 * Observe view-owned modals (views create their own `.modal-overlay` nodes) so
 * the focus trap works even when they do not call openModal() directly.
 */
export function initModalFocusManagement(): void {
  if (observer || typeof MutationObserver === 'undefined') return;
  observer = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      mutation.addedNodes.forEach(node => {
        if (!(node instanceof HTMLElement)) return;
        const overlays = node.classList?.contains('modal-overlay')
          ? [node]
          : Array.from(node.querySelectorAll<HTMLElement>('.modal-overlay'));
        overlays.forEach(overlay => {
          rememberModalTrigger();
          trapModalFocus(overlay);
          document.body.style.overflow = 'hidden';
          (focusablesIn(overlay)[0] ?? overlay).focus({ preventScroll: true });
        });
      });
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}
