import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildSummarizerPrompt, parseSummarizerResponse } from '../src/summarizer.js';

describe('Summarizer Context Sanitizer & Parser', () => {
  describe('parseSummarizerResponse', () => {
    test('parses pure JSON with 2 suggestions', () => {
      const input = JSON.stringify({
        suggestions: [
          'Executar deploy em staging',
          'Verificar logs de erro'
        ]
      });
      const result = parseSummarizerResponse(input);
      assert.deepEqual(result, [
        'Executar deploy em staging',
        'Verificar logs de erro'
      ]);
    });

    test('truncates suggestions to a maximum of 3', () => {
      const input = JSON.stringify({
        suggestions: ['Opção 1', 'Opção 2', 'Opção 3', 'Opção 4', 'Opção 5']
      });
      const result = parseSummarizerResponse(input);
      assert.equal(result.length, 3);
      assert.deepEqual(result, ['Opção 1', 'Opção 2', 'Opção 3']);
    });

    test('handles markdown codeblock wrapped JSON', () => {
      const input = '```json\n{\n  "suggestions": ["Testar componentes", "Revisar PR"]\n}\n```';
      const result = parseSummarizerResponse(input);
      assert.deepEqual(result, ['Testar componentes', 'Revisar PR']);
    });

    test('returns empty array when JSON is empty or has no suggestions', () => {
      const input = JSON.stringify({ suggestions: [] });
      assert.deepEqual(parseSummarizerResponse(input), []);
      assert.deepEqual(parseSummarizerResponse('{}'), []);
    });

    test('handles malformed string gracefully without throwing', () => {
      assert.deepEqual(parseSummarizerResponse('Invalid non-json output'), []);
      assert.deepEqual(parseSummarizerResponse(''), []);
      assert.deepEqual(parseSummarizerResponse(null), []);
    });

    test('truncates individual suggestion text longer than 50 chars', () => {
      const longText = 'Esta é uma sugestão excessivamente longa que ultrapassa o limite razoável de caracteres';
      const input = JSON.stringify({ suggestions: [longText] });
      const result = parseSummarizerResponse(input);
      assert.equal(result.length, 1);
      assert.ok(result[0].length <= 50);
      assert.ok(result[0].endsWith('...'));
    });
  });

  describe('buildSummarizerPrompt', () => {
    test('builds prompt from simple conversation turn', () => {
      const messages = [
        { role: 'user', content: 'Crie uma função de ordenação' },
        { role: 'assistant', content: 'Criei a função quickSort. Deseja adicionar testes unitários?' }
      ];
      const { system, userPrompt } = buildSummarizerPrompt(messages);
      assert.ok(system.includes('intent predictor'));
      assert.ok(userPrompt.includes('quickSort'));
      assert.ok(userPrompt.includes('ordenação'));
    });

    test('sanitizes tool-heavy turns concisely', () => {
      const messages = [
        { role: 'user', content: 'Rode os testes' },
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Rodando os testes...' },
            { type: 'tool-call', name: 'bash', arguments: '{"command":"npm test"}' },
            { type: 'tool-call', name: 'read', arguments: '{"file_path":"test.js"}' },
            { type: 'text', text: 'Todos os testes passaram com sucesso.' }
          ]
        }
      ];
      const { userPrompt } = buildSummarizerPrompt(messages);
      assert.ok(userPrompt.includes('Todos os testes passaram com sucesso.'));
      assert.ok(userPrompt.includes('bash'));
    });
  });
});
