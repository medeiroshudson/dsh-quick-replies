/**
 * @file client-component.js
 * Helpers, shortcut guard, and component logic for quick replies UI.
 */

/**
 * Maps a key character ('1', '2', '3') to a zero-based suggestion index.
 * @param {string} key
 * @returns {number} 0, 1, 2 or -1 if invalid
 */
export function getShortcutIndex(key) {
  if (key === '1') return 0;
  if (key === '2') return 1;
  if (key === '3') return 2;
  return -1;
}

/**
 * Determines whether a keyboard event should trigger a quick reply shortcut.
 * Ensures typing in the composer is uninterrupted if draft text exists.
 *
 * @param {{ altKey?: boolean, key?: string }} event
 * @param {{ isComposerFocused?: boolean, draftText?: string | null, availableCount?: number }} context
 * @returns {boolean}
 */
export function shouldHandleShortcut(event, context = {}) {
  if (!event || !event.altKey) {
    return false;
  }

  const index = getShortcutIndex(event.key);
  if (index === -1) {
    return false;
  }

  // If available count is specified, ensure index is within range
  if (typeof context.availableCount === 'number') {
    if (index >= context.availableCount) {
      return false;
    }
  }

  // If composer input is actively focused, only allow shortcut if draft is empty
  if (context.isComposerFocused) {
    const text = context.draftText;
    if (typeof text === 'string' && text.trim().length > 0) {
      return false;
    }
  }

  return true;
}
