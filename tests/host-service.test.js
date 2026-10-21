import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { HostQuickReplyService } from '../src/host-service.js';

describe('HostQuickReplyService', () => {
  let service;
  let mockLlm;
  let mockDefaultModel;

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
    mockDefaultModel = {
      currentSelection() {
        return { provider: 'deepseek-active', model: 'deepseek-chat-v3' };
      }
    };
    service = new HostQuickReplyService({ llm: mockLlm, agentDefaultModel: mockDefaultModel });
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

  test('falls back to agentDefaultModel when provider is default or missing', async () => {
    let capturedOptions;
    const trackingLlm = {
      async *stream(options) {
        capturedOptions = options;
        yield { type: 'text-delta', text: '{"suggestions": ["Fallback test"]}' };
      }
    };

    const s = new HostQuickReplyService({ llm: trackingLlm, agentDefaultModel: mockDefaultModel });
    await s.generateSuggestions('session-fb', [{ role: 'assistant', content: 'Pronto' }], {
      provider: 'default',
      model: 'default'
    });

    assert.equal(capturedOptions.provider, 'deepseek-active');
    assert.equal(capturedOptions.model, 'deepseek-chat-v3');
    assert.deepEqual(s.getSuggestions('session-fb'), ['Fallback test']);
  });

  test('retries with agentDefaultModel if primary provider stream fails', async () => {
    let attempts = 0;
    const failingFirstLlm = {
      async *stream(options) {
        attempts++;
        if (options.provider === 'broken-provider') {
          throw new Error('401 Unauthorized');
        }
        yield { type: 'text-delta', text: '{"suggestions": ["Recuperado com sucesso"]}' };
      }
    };

    const s = new HostQuickReplyService({ llm: failingFirstLlm, agentDefaultModel: mockDefaultModel });
    await s.generateSuggestions('session-retry', [{ role: 'assistant', content: 'Pronto' }], {
      provider: 'broken-provider',
      model: 'broken-model'
    });

    assert.equal(attempts, 2);
    assert.deepEqual(s.getSuggestions('session-retry'), ['Recuperado com sucesso']);
  });

  test('handles HTTP request route (/api/quick-replies)', async () => {
    service.setSuggestions('session-http', ['Opção A', 'Opção B']);

    let statusCode;
    let headers = {};
    let responseBody = '';

    const req = {
      url: '/api/quick-replies?sessionId=session-http',
      method: 'GET'
    };
    const res = {
      writeHead(code, h) {
        statusCode = code;
        headers = h;
      },
      end(data) {
        responseBody = data;
      }
    };

    service.handleHttpRequest(req, res);

    assert.equal(statusCode, 200);
    assert.equal(headers['Content-Type'], 'application/json');
    const parsed = JSON.parse(responseBody);
    assert.deepEqual(parsed.suggestions, ['Opção A', 'Opção B']);
  });

  test('calls onDemandTrigger when cache is empty on HTTP request', () => {
    let triggeredSessionId = null;
    service.setOnDemandTrigger((id) => {
      triggeredSessionId = id;
    });

    const req = {
      url: '/api/quick-replies?sessionId=session-empty-cache',
      method: 'GET'
    };
    const res = {
      writeHead() {},
      end() {}
    };

    service.handleHttpRequest(req, res);
    assert.equal(triggeredSessionId, 'session-empty-cache');
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
        await new Promise(r => setTimeout(r, 50));
        if (options.signal?.aborted) throw new Error('Aborted');
        yield { type: 'text-delta', text: '{"suggestions": ["Opção atrasada"]}' };
      }
    };

    const s = new HostQuickReplyService({ llm: slowLlm, agentDefaultModel: mockDefaultModel });
    const promise = s.generateSuggestions('session-2', [{ role: 'assistant', content: 'msg' }], {
      provider: 'test',
      model: 'test-model'
    });

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

    const s = new HostQuickReplyService({ llm: failingLlm, agentDefaultModel: mockDefaultModel });
    await s.generateSuggestions('session-3', [{ role: 'assistant', content: 'msg' }], {
      provider: 'test',
      model: 'test-model'
    });

    assert.deepEqual(s.getSuggestions('session-3'), []);
  });
});
