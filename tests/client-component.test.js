import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { shouldHandleShortcut, getShortcutIndex, extractTextFromNode, extractFallbackSuggestions } from '../src/client-component.js';

describe('Client Shortcut Guard & Utilities', () => {
  describe('extractTextFromNode', () => {
    test('extracts text from node with data.blocks array', () => {
      const node = {
        kind: 'assistant-step',
        data: {
          blocks: [
            { kind: 'reasoning', text: 'pensando...' },
            { kind: 'text', text: 'Aqui está a resposta' }
          ]
        }
      };
      assert.equal(extractTextFromNode(node), 'Aqui está a resposta');
    });

    test('extracts text from node with data.content array', () => {
      const node = {
        kind: 'assistant',
        data: {
          content: [
            { type: 'text', text: 'Texto de conteúdo' }
          ]
        }
      };
      assert.equal(extractTextFromNode(node), 'Texto de conteúdo');
    });

    test('extracts text from node with plain data.text', () => {
      const node = { kind: 'turn-tail', data: { text: 'Texto direto' } };
      assert.equal(extractTextFromNode(node), 'Texto direto');
    });

    test('returns empty string for empty or missing data', () => {
      assert.equal(extractTextFromNode(null), '');
      assert.equal(extractTextFromNode({}), '');
      assert.equal(extractTextFromNode({ data: {} }), '');
    });
  });

  describe('extractFallbackSuggestions', () => {
    test('extracts numbered options', () => {
      const text = 'Como deseja prosseguir?\n1. Rodar os testes\n2. Fazer deploy em staging\n3. Cancelar';
      assert.deepEqual(extractFallbackSuggestions(text), [
        'Rodar os testes',
        'Fazer deploy em staging',
        'Cancelar'
      ]);
    });

    test('extracts bullet options', () => {
      const text = 'Opções disponíveis:\n- Opção A: Iniciar build\n- Opção B: Limpar cache';
      assert.deepEqual(extractFallbackSuggestions(text), [
        'Iniciar build',
        'Limpar cache'
      ]);
    });

    test('extracts binary choices from closing question', () => {
      const text = 'O arquivo foi criado com sucesso.\nDeseja que eu execute os testes agora?';
      assert.deepEqual(extractFallbackSuggestions(text), [
        'Sim, pode prosseguir',
        'Não agora'
      ]);
    });

    test('extracts next-step choices from "como gostaria de prosseguir"', () => {
      const text = 'Arquivos alterados.\nComo gostaria de prosseguir?';
      assert.deepEqual(extractFallbackSuggestions(text), [
        'Prosseguir com o próximo passo',
        'Detalhar mais informações'
      ]);
    });

    test('returns empty array when text has no options or questions', () => {
      assert.deepEqual(extractFallbackSuggestions(''), []);
      assert.deepEqual(extractFallbackSuggestions('Esta é uma resposta simples sem perguntas.'), []);
    });
  });

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
