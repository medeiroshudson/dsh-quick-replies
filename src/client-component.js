/**
 * @file client-component.js
 * Helpers, shortcut guard, and component logic for quick replies UI.
 */

/**
 * Maps keyboard event key/code to a zero-based suggestion index (0..2).
 * Handles macOS Option-key dead characters (e.g. '¡', '™', '£' on US, '¹', '²', '³' on ABNT2)
 * as well as standard physical Digit1..Digit3 codes.
 *
 * @param {string} [key]
 * @param {string} [code]
 * @returns {number} 0, 1, 2 or -1 if invalid
 */
export function getShortcutIndex(key, code) {
  if (key === '1' || code === 'Digit1' || key === '¡' || key === '¹') return 0;
  if (key === '2' || code === 'Digit2' || key === '™' || key === '²') return 1;
  if (key === '3' || code === 'Digit3' || key === '£' || key === '³') return 2;
  return -1;
}

/**
 * Determines whether a keyboard event should trigger a quick reply shortcut.
 * Ensures typing in the composer is uninterrupted if draft text exists,
 * checking both hook state and raw DOM input value to prevent desync.
 *
 * @param {{ altKey?: boolean, key?: string, code?: string }} event
 * @param {{
 *   isComposerFocused?: boolean,
 *   draftText?: string | null,
 *   domValue?: string | null,
 *   availableCount?: number
 * }} context
 * @returns {boolean}
 */
export function shouldHandleShortcut(event, context = {}) {
  if (!event || !event.altKey) {
    return false;
  }

  const index = getShortcutIndex(event.key, event.code);
  if (index === -1) {
    return false;
  }

  // If available count is specified, ensure index is within range
  if (typeof context.availableCount === 'number') {
    if (index >= context.availableCount) {
      return false;
    }
  }

  // If composer input is actively focused, verify both hook draft and raw DOM value
  if (context.isComposerFocused) {
    const text = context.draftText;
    if (typeof text === 'string' && text.trim().length > 0) {
      return false;
    }

    const domVal = context.domValue;
    if (typeof domVal === 'string' && domVal.trim().length > 0) {
      return false;
    }
  }

  return true;
}
