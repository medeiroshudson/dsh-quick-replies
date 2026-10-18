import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { HostQuickReplyService } from '../src/host-service.js';

describe('HostQuickReplyService', () => {
  let service;
  let mockLlm;

  beforeEach(() => {
    mockLlm = {
      async *stream(options) {
        if (options.signal?.aborted) {
          throw new Error('Aborted');
        }
        yield { type: 'text-delta', text: '{"suggestions": ["Deploy staging", "Verificar logs"]}' };
        yield { type: 'finish', reason: { kind: 'stop' } };
      }
    };
    service = new HostQuickReplyService({ llm: mockLlm });
  });

  test('returns empty array when no suggestions cached for session', () => {
    assert.deepEqual(service.getSuggestions('session-1'), []);
  });

  test('generates and caches suggestions on turn end', async () => {
    const messages = [
      { role: 'user', content: 'Fiz a release v1.0.0' },
      { role: 'assistant', content: 'Release v1.0.0 gerada com sucesso. Como deseja proceder?' }
    ];

    await service.generateSuggestions('session-1', messages, {
      provider: 'deepseek',
      model: 'deepseek-chat'
    });

    const suggestions = service.getSuggestions('session-1');
    assert.deepEqual(suggestions, ['Deploy staging', 'Verificar logs']);
  });

  test('clears suggestions when session starts new turn', async () => {
    service.setSuggestions('session-1', ['Opção 1']);
    assert.equal(service.getSuggestions('session-1').length, 1);

    service.onTurnStarting('session-1');
    assert.deepEqual(service.getSuggestions('session-1'), []);
  });

  test('aborts in-flight generation when new turn starts or cancelled', async () => {
    let aborted = false;
    const slowLlm = {
      async *stream(options) {
        options.signal?.addEventListener('abort', () => {
          aborted = true;
        });
        // simulate delay
        await new Promise(r => setTimeout(r, 50));
        if (options.signal?.aborted) throw new Error('Aborted');
        yield { type: 'text-delta', text: '{"suggestions": ["Opção atrasada"]}' };
      }
    };

    const s = new HostQuickReplyService({ llm: slowLlm });
    const promise = s.generateSuggestions('session-2', [{ role: 'assistant', content: 'msg' }], {
      provider: 'test',
      model: 'test-model'
    });

    // Immediately start new turn
    s.onTurnStarting('session-2');
    await promise;

    assert.ok(aborted, 'Expected in-flight LLM call to be aborted');
    assert.deepEqual(s.getSuggestions('session-2'), []);
  });

  test('handles LLM error gracefully and sets empty suggestions', async () => {
    const failingLlm = {
      async *stream() {
        throw new Error('LLM network timeout');
      }
    };

    const s = new HostQuickReplyService({ llm: failingLlm });
    await s.generateSuggestions('session-3', [{ role: 'assistant', content: 'msg' }], {
      provider: 'test',
      model: 'test-model'
    });

    assert.deepEqual(s.getSuggestions('session-3'), []);
  });
});
