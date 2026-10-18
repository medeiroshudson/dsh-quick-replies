import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { shouldHandleShortcut, getShortcutIndex } from '../src/client-component.js';

describe('Client Shortcut Guard & Utilities', () => {
  describe('getShortcutIndex', () => {
    test('maps 1, 2, 3 to indices 0, 1, 2', () => {
      assert.equal(getShortcutIndex('1'), 0);
      assert.equal(getShortcutIndex('2'), 1);
      assert.equal(getShortcutIndex('3'), 2);
      assert.equal(getShortcutIndex('4'), -1);
      assert.equal(getShortcutIndex('a'), -1);
    });
  });

  describe('shouldHandleShortcut', () => {
    test('handles shortcut when altKey is pressed and composer is not focused', () => {
      const event = { altKey: true, key: '1' };
      assert.equal(shouldHandleShortcut(event, { isComposerFocused: false, draftText: '' }), true);
      assert.equal(shouldHandleShortcut(event, { isComposerFocused: false, draftText: 'algum texto' }), true);
    });

    test('handles shortcut when composer is focused but draft is empty', () => {
      const event = { altKey: true, key: '2' };
      assert.equal(shouldHandleShortcut(event, { isComposerFocused: true, draftText: '' }), true);
      assert.equal(shouldHandleShortcut(event, { isComposerFocused: true, draftText: '   ' }), true);
      assert.equal(shouldHandleShortcut(event, { isComposerFocused: true, draftText: null }), true);
    });

    test('rejects shortcut when composer is focused and draft has text', () => {
      const event = { altKey: true, key: '1' };
      assert.equal(shouldHandleShortcut(event, { isComposerFocused: true, draftText: 'Olá agente' }), false);
    });

    test('rejects shortcut when altKey is false', () => {
      const event = { altKey: false, key: '1' };
      assert.equal(shouldHandleShortcut(event, { isComposerFocused: false, draftText: '' }), false);
    });

    test('rejects numbers other than 1, 2, 3', () => {
      assert.equal(shouldHandleShortcut({ altKey: true, key: '4' }, { isComposerFocused: false, draftText: '' }), false);
      assert.equal(shouldHandleShortcut({ altKey: true, key: '0' }, { isComposerFocused: false, draftText: '' }), false);
    });

    test('handles options count boundary', () => {
      // If there are only 2 suggestions, shortcut for 3 should not be handled
      assert.equal(
        shouldHandleShortcut({ altKey: true, key: '3' }, { isComposerFocused: false, draftText: '', availableCount: 2 }),
        false
      );
      assert.equal(
        shouldHandleShortcut({ altKey: true, key: '2' }, { isComposerFocused: false, draftText: '', availableCount: 2 }),
        true
      );
    });
  });
});
