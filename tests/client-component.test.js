import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { shouldHandleShortcut, getShortcutIndex } from '../src/client-component.js';

describe('Client Shortcut Guard & Utilities', () => {
  describe('getShortcutIndex', () => {
    test('maps 1, 2, 3 to indices 0, 1, 2 via key', () => {
      assert.equal(getShortcutIndex('1'), 0);
      assert.equal(getShortcutIndex('2'), 1);
      assert.equal(getShortcutIndex('3'), 2);
      assert.equal(getShortcutIndex('4'), -1);
      assert.equal(getShortcutIndex('a'), -1);
    });

    test('maps macOS Option-key characters and Digit codes to indices 0, 1, 2', () => {
      // US layout macOS Option+1 ('¡'), Option+2 ('™'), Option+3 ('£')
      assert.equal(getShortcutIndex('¡', 'Digit1'), 0);
      assert.equal(getShortcutIndex('™', 'Digit2'), 1);
      assert.equal(getShortcutIndex('£', 'Digit3'), 2);

      // ABNT2 layout Option+1 ('¹'), Option+2 ('²'), Option+3 ('³')
      assert.equal(getShortcutIndex('¹', 'Digit1'), 0);
      assert.equal(getShortcutIndex('²', 'Digit2'), 1);
      assert.equal(getShortcutIndex('³', 'Digit3'), 2);

      // Plain event.code fallback
      assert.equal(getShortcutIndex(undefined, 'Digit1'), 0);
      assert.equal(getShortcutIndex(undefined, 'Digit2'), 1);
      assert.equal(getShortcutIndex(undefined, 'Digit3'), 2);
    });
  });

  describe('shouldHandleShortcut', () => {
    test('handles shortcut when altKey is pressed and composer is not focused', () => {
      const event = { altKey: true, key: '1', code: 'Digit1' };
      assert.equal(shouldHandleShortcut(event, { isComposerFocused: false, draftText: '' }), true);
      assert.equal(shouldHandleShortcut(event, { isComposerFocused: false, draftText: 'algum texto' }), true);
    });

    test('handles macOS Option-key event when draft is empty', () => {
      // On macOS US keyboard: Option+1 gives key: '¡' and code: 'Digit1'
      const macEvent = { altKey: true, key: '¡', code: 'Digit1' };
      assert.equal(shouldHandleShortcut(macEvent, { isComposerFocused: true, draftText: '' }), true);
    });

    test('handles shortcut when composer is focused but draft is empty', () => {
      const event = { altKey: true, key: '2', code: 'Digit2' };
      assert.equal(shouldHandleShortcut(event, { isComposerFocused: true, draftText: '' }), true);
      assert.equal(shouldHandleShortcut(event, { isComposerFocused: true, draftText: '   ' }), true);
      assert.equal(shouldHandleShortcut(event, { isComposerFocused: true, draftText: null }), true);
    });

    test('rejects shortcut when composer is focused and draft has text', () => {
      const event = { altKey: true, key: '1', code: 'Digit1' };
      assert.equal(shouldHandleShortcut(event, { isComposerFocused: true, draftText: 'Olá agente' }), false);
    });

    test('rejects shortcut if raw domValue has text even if draftText is empty (desync guard)', () => {
      const event = { altKey: true, key: '1', code: 'Digit1' };
      assert.equal(
        shouldHandleShortcut(event, { isComposerFocused: true, draftText: '', domValue: 'texto no DOM' }),
        false
      );
    });

    test('rejects shortcut when altKey is false', () => {
      const event = { altKey: false, key: '1', code: 'Digit1' };
      assert.equal(shouldHandleShortcut(event, { isComposerFocused: false, draftText: '' }), false);
    });

    test('rejects numbers other than 1, 2, 3', () => {
      assert.equal(shouldHandleShortcut({ altKey: true, key: '4', code: 'Digit4' }, { isComposerFocused: false, draftText: '' }), false);
      assert.equal(shouldHandleShortcut({ altKey: true, key: '0', code: 'Digit0' }, { isComposerFocused: false, draftText: '' }), false);
    });

    test('handles options count boundary', () => {
      assert.equal(
        shouldHandleShortcut({ altKey: true, key: '3', code: 'Digit3' }, { isComposerFocused: false, draftText: '', availableCount: 2 }),
        false
      );
      assert.equal(
        shouldHandleShortcut({ altKey: true, key: '2', code: 'Digit2' }, { isComposerFocused: false, draftText: '', availableCount: 2 }),
        true
      );
    });
  });
});
