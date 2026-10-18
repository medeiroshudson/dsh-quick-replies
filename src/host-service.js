/**
 * @file host-service.js
 * Host-side manager for in-flight generation, caching, and RPC/HTTP endpoints.
 */

import { buildSummarizerPrompt, parseSummarizerResponse } from './summarizer.js';

export class HostQuickReplyService {
  /**
   * @param {{ llm?: any, sessionController?: any, agentDefaultModel?: any }} deps
   */
  constructor({ llm, sessionController, agentDefaultModel } = {}) {
    this.llm = llm;
    this.sessionController = sessionController;
    this.agentDefaultModel = agentDefaultModel;
    /** @type {Map<string, string[]>} */
    this.cache = new Map();
    /** @type {Map<string, AbortController>} */
    this.controllers = new Map();
    /** @type {Set<(sessionId: string, suggestions: string[]) => void>} */
    this.changeListeners = new Set();
  }

  /**
   * Subscribe to suggestion updates.
   * @param {(sessionId: string, suggestions: string[]) => void} listener
   * @returns {() => void} disposer
   */
  onChanged(listener) {
    this.changeListeners.add(listener);
    return () => {
      this.changeListeners.delete(listener);
    };
  }

  /**
   * Notify registered listeners of suggestion updates.
   * @param {string} sessionId
   * @param {string[]} suggestions
   */
  notify(sessionId, suggestions) {
    for (const listener of this.changeListeners) {
      try {
        listener(sessionId, suggestions);
      } catch (err) {
        console.error('[dsh-quick-replies] Error in change listener:', err);
      }
    }
  }

  /**
   * Get cached suggestions for a session.
   * @param {string} sessionId
   * @returns {string[]}
   */
  getSuggestions(sessionId) {
    if (!sessionId) return [];
    return this.cache.get(sessionId) || [];
  }

  /**
   * Alias for RPC caller compatibility.
   * @param {string} sessionId
   * @returns {string[]}
   */
  getQuickReplies(sessionId) {
    return this.getSuggestions(sessionId);
  }

  /**
   * Directly set suggestions for a session.
   * @param {string} sessionId
   * @param {string[]} suggestions
   */
  setSuggestions(sessionId, suggestions) {
    if (!sessionId) return;
    const clean = Array.isArray(suggestions) ? suggestions.slice(0, 3) : [];
    this.cache.set(sessionId, clean);
    this.notify(sessionId, clean);
  }

  /**
   * Clear suggestions and abort any in-flight task for a session.
   * @param {string} sessionId
   */
  clearSuggestions(sessionId) {
    if (!sessionId) return;
    const controller = this.controllers.get(sessionId);
    if (controller) {
      controller.abort();
      this.controllers.delete(sessionId);
    }
    if (this.cache.has(sessionId)) {
      this.cache.delete(sessionId);
      this.notify(sessionId, []);
    }
  }

  /**
   * Called when a turn is starting or a prompt was submitted.
   * @param {string} sessionId
   */
  onTurnStarting(sessionId) {
    this.clearSuggestions(sessionId);
  }

  /**
   * Handle HTTP request for quick replies (e.g. GET /api/quick-replies?sessionId=...).
   * @param {import('http').IncomingMessage} req
   * @param {import('http').ServerResponse} res
   */
  handleHttpRequest(req, res) {
    try {
      const url = new URL(req.url || '/', 'http://localhost');
      const sessionId = url.searchParams.get('sessionId') || '';
      const suggestions = this.getSuggestions(sessionId);

      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store'
      });
      res.end(JSON.stringify({ suggestions }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err?.message || 'Internal server error' }));
    }
  }

  /**
   * Generate suggestions in the background using the active LLM.
   * @param {string} sessionId
   * @param {Array<{ role: string, content: any }>} messages
   * @param {{ provider?: string, model?: string }} llmConfig
   * @returns {Promise<string[]>}
   */
  async generateSuggestions(sessionId, messages, llmConfig = {}) {
    if (!sessionId || !this.llm) {
      return [];
    }

    // Cancel any prior in-flight generation for this session
    const prevController = this.controllers.get(sessionId);
    if (prevController) {
      prevController.abort();
    }

    const controller = new AbortController();
    this.controllers.set(sessionId, controller);

    try {
      const { system, userPrompt } = buildSummarizerPrompt(messages);

      // Safe provider/model resolution with agentDefaultModel fallback
      let provider = llmConfig?.provider;
      let model = llmConfig?.model;

      if (!provider || provider === 'default' || !model || model === 'default') {
        if (this.agentDefaultModel && typeof this.agentDefaultModel.currentSelection === 'function') {
          try {
            const def = this.agentDefaultModel.currentSelection();
            if (def?.provider) provider = def.provider;
            if (def?.model) model = def.model;
          } catch (_) {}
        }
      }

      if (!provider || provider === 'default') {
        provider = 'deepseek';
        model = model || 'deepseek-chat';
      }

      const generateOptions = {
        provider,
        model: model || 'default',
        system,
        messages: [{ role: 'user', content: userPrompt }],
        maxTokens: 60,
        temperature: 0.3,
        signal: controller.signal
      };

      let fullText = '';
      const stream = this.llm.stream(generateOptions);

      for await (const chunk of stream) {
        if (controller.signal.aborted) {
          return [];
        }
        if (chunk.type === 'text-delta' && typeof chunk.text === 'string') {
          fullText += chunk.text;
        }
      }

      if (controller.signal.aborted) {
        return [];
      }

      const suggestions = parseSummarizerResponse(fullText);
      this.cache.set(sessionId, suggestions);
      this.notify(sessionId, suggestions);
      return suggestions;
    } catch (error) {
      if (!controller.signal.aborted) {
        console.warn(`[dsh-quick-replies] Failed to generate suggestions for ${sessionId}:`, error?.message || error);
        this.cache.set(sessionId, []);
        this.notify(sessionId, []);
      }
      return [];
    } finally {
      if (this.controllers.get(sessionId) === controller) {
        this.controllers.delete(sessionId);
      }
    }
  }
}
