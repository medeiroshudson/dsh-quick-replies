/**
 * @file index.js
 * Host half of dsh-quick-replies plugin.
 */

import { HostQuickReplyService } from './src/host-service.js';

export const inject = ['llm', 'sessionController', 'agentDefaultModel', 'webServer'];

/**
 * Apply the Host half of the bundle.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {Record<string, unknown>} config
 */
export function apply(ctx, config) {
  const llm = ctx.get('llm');
  const sessionController = ctx.get('sessionController');
  const agentDefaultModel = ctx.get('agentDefaultModel');
  const webServer = ctx.get('webServer');

  const service = new HostQuickReplyService({ llm, sessionController, agentDefaultModel });

  // Expose service on context for package RPC and inspection
  ctx.provide('quickReplies', service);

  // Register HTTP endpoint for Client half retrieval (/api/quick-replies?sessionId=...)
  if (webServer && typeof webServer.register === 'function') {
    ctx.effect(() => {
      return webServer.register({
        kind: 'exact',
        path: '/api/quick-replies',
        handler(req, res) {
          service.handleHttpRequest(req, res);
        }
      });
    });
  }

  // Listen to agent status transitions
  ctx.on('agent/status', async function ({ agent, status }) {
    if (!agent || !agent.id) return;
    const sessionId = agent.id;

    if (status === 'running') {
      service.onTurnStarting(sessionId);
    } else if (status === 'idle') {
      try {
        let messages = [];
        let llmConfig = {};

        if (sessionController && typeof sessionController.inspect === 'function') {
          const inspection = await sessionController.inspect(sessionId);
          if (inspection && Array.isArray(inspection.events)) {
            for (const ev of inspection.events) {
              if (ev.type === 'user/message' && ev.data) {
                messages.push({ role: 'user', content: ev.data.content || ev.data.text || '' });
              } else if (ev.type === 'assistant/message' && ev.data && ev.data.message) {
                messages.push({
                  role: 'assistant',
                  content: ev.data.message.content || ev.data.message.text || ''
                });
              } else if (ev.type === 'request/header' && ev.data?.header?.config) {
                llmConfig = ev.data.header.config;
              }
            }
          }
        }

        // Trigger background generation (non-blocking)
        service.generateSuggestions(sessionId, messages, llmConfig).catch(() => {});
      } catch (err) {
        console.warn(`[dsh-quick-replies] Error inspecting session ${sessionId}:`, err?.message || err);
      }
    }
  });

  // Listen for user message insertions to immediately clear stale suggestions
  ctx.on('agent/inbox/inserted', function ({ agent }) {
    if (agent?.id) {
      service.onTurnStarting(agent.id);
    }
  });
}
