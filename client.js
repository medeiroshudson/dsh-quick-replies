/**
 * @file client.js
 * Client half of dsh-quick-replies plugin.
 */

window.__ModuleLoader__.load({
  id: 'dsh-quick-replies',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    let clientCtx = null;

    /**
     * Safely extract text string from DSH Chat node.
     * DSH assistant-step nodes hold text in node.data.blocks array of { kind: 'text', text: string }
     * or node.data.content array of { type: 'text', text: string }.
     */
    function extractTextFromNode(node) {
      if (!node || !node.data) return '';
      if (typeof node.data.text === 'string' && node.data.text) return node.data.text;
      if (Array.isArray(node.data.blocks)) {
        return node.data.blocks
          .filter(b => b && (b.kind === 'text' || b.type === 'text') && typeof b.text === 'string')
          .map(b => b.text)
          .join('\n')
          .trim();
      }
      if (Array.isArray(node.data.content)) {
        return node.data.content
          .filter(b => b && (b.kind === 'text' || b.type === 'text') && typeof b.text === 'string')
          .map(b => b.text)
          .join('\n')
          .trim();
      }
      return '';
    }

    /**
     * Map shortcut key/code to index (0..2).
     * Handles macOS Option-key dead characters as well as physical Digit1..Digit3.
     */
    function getShortcutIndex(key, code) {
      if (key === '1' || code === 'Digit1' || key === '¡' || key === '¹') return 0;
      if (key === '2' || code === 'Digit2' || key === '™' || key === '²') return 1;
      if (key === '3' || code === 'Digit3' || key === '£' || key === '³') return 2;
      return -1;
    }

    /**
     * Determine if shortcut should trigger, checking both hook state and raw DOM value.
     */
    function shouldHandleShortcut(event, context) {
      if (!event || !event.altKey) return false;
      const index = getShortcutIndex(event.key, event.code);
      if (index === -1) return false;
      if (typeof context?.availableCount === 'number' && index >= context.availableCount) {
        return false;
      }
      if (context?.isComposerFocused) {
        const text = context?.draftText;
        if (typeof text === 'string' && text.trim().length > 0) {
          return false;
        }
        const domVal = context?.domValue;
        if (typeof domVal === 'string' && domVal.trim().length > 0) {
          return false;
        }
      }
      return true;
    }

    /**
     * Extract fallback suggestions from last assistant message text
     */
    function extractFallbackSuggestions(text) {
      if (!text || typeof text !== 'string') return [];
      const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
      const candidates = [];

      for (const line of lines) {
        const match = line.match(/^(?:[1-3][\.\)]|[\*\-]\s+(?:Opção|Alternativa|Option)\s*[A-C]?[:\-])\s*(.+)$/i);
        if (match && match[1]) {
          const item = match[1].replace(/[\*\_\`]/g, '').trim();
          if (item.length > 0 && item.length <= 48) {
            candidates.push(item);
          }
        }
        if (candidates.length >= 3) break;
      }

      if (candidates.length > 0) return candidates;

      // Question patterns at the end of the response
      const lastLine = lines[lines.length - 1] || '';
      if (/deseja que eu/i.test(lastLine) || /quer que eu/i.test(lastLine) || /posso avançar/i.test(lastLine)) {
        return ['Sim, pode prosseguir', 'Não agora'];
      }
      if (/como deseja/i.test(lastLine) || /como gostaria de prosseguir/i.test(lastLine) || /como prefere/i.test(lastLine)) {
        return ['Prosseguir com o próximo passo', 'Detalhar mais informações'];
      }

      return [];
    }

    /**
     * Quick Replies Component in conversation.input.dock
     */
    function QuickRepliesDock(props) {
      const { sessionId, useSession, useInput, inputActions, useChat } = props;

      const isRunning = useSession ? useSession(s => s?.running ?? false) : false;
      const draft = useInput ? useInput(i => i?.draft ?? i?.text ?? '') : '';

      const [suggestions, setSuggestions] = React.useState([]);
      const [submittingIdx, setSubmittingIdx] = React.useState(null);

      // Inspect chat history to detect last assistant message
      const lastAssistantText = useChat ? useChat(snapshot => {
        if (!snapshot || !snapshot.nodes) return '';
        const nodes = Array.from(snapshot.nodes.values());
        for (let i = nodes.length - 1; i >= 0; i--) {
          const node = nodes[i];
          if (node.kind === 'assistant-step' || node.kind === 'assistant' || node.kind === 'turn-tail') {
            const text = extractTextFromNode(node);
            if (text) return text;
          }
        }
        return '';
      }) : '';

      // Fetch suggestions from Host HTTP endpoint with immediate fallback and active polling
      React.useEffect(() => {
        if (isRunning || !sessionId) {
          setSuggestions([]);
          setSubmittingIdx(null);
          return;
        }

        let isMounted = true;
        let retryTimer = null;
        let attempts = 0;
        const maxAttempts = 6;

        // If we have assistant text, immediately set fallback suggestions to eliminate wait time!
        if (lastAssistantText) {
          const immediateFallback = extractFallbackSuggestions(lastAssistantText);
          if (immediateFallback.length > 0) {
            setSuggestions(immediateFallback);
          }
        }

        async function queryHost() {
          attempts++;
          try {
            const res = await fetch(`/api/quick-replies?sessionId=${encodeURIComponent(sessionId)}`);
            if (res.ok) {
              const data = await res.json();
              if (isMounted && Array.isArray(data?.suggestions) && data.suggestions.length > 0) {
                setSuggestions(data.suggestions.slice(0, 3));
                return;
              }
            }
          } catch (_) {
            // Host endpoint not reachable yet
          }

          if (isMounted && attempts < maxAttempts) {
            retryTimer = setTimeout(queryHost, 500);
          }
        }

        // Start querying host in background for tailored LLM suggestions
        queryHost();

        return () => {
          isMounted = false;
          if (retryTimer) clearTimeout(retryTimer);
        };
      }, [isRunning, sessionId, lastAssistantText]);

      // Dispatch prompt
      const handleSendPrompt = React.useCallback(async (text, index) => {
        if (!text || isRunning) return;
        setSubmittingIdx(index);

        try {
          const remoteSession = clientCtx?.get('remote')?.session || clientCtx?.remote?.session || window.ctx?.remote?.session;
          if (remoteSession && typeof remoteSession.prompt === 'function') {
            await remoteSession.prompt({
              requestId: `qr-${Date.now()}`,
              sessionId,
              mode: 'queue',
              content: [{ type: 'text', text }]
            });
          } else if (inputActions && typeof inputActions.insertText === 'function') {
            inputActions.insertText(text);
          }
          setSuggestions([]);
        } catch (err) {
          console.error('[dsh-quick-replies] Prompt dispatch failed:', err);
        } finally {
          setSubmittingIdx(null);
        }
      }, [sessionId, isRunning, inputActions]);

      // Keyboard shortcut listener
      React.useEffect(() => {
        if (suggestions.length === 0 || isRunning) return;

        function onKeyDown(e) {
          const activeElem = document.activeElement;
          const isComposerFocused = activeElem && (
            activeElem.tagName === 'TEXTAREA' ||
            activeElem.tagName === 'INPUT' ||
            activeElem.getAttribute('contenteditable') === 'true'
          );

          const domValue = (activeElem && typeof activeElem.value === 'string')
            ? activeElem.value
            : (activeElem?.textContent || '');

          const draftText = typeof draft === 'string' ? draft : '';

          if (shouldHandleShortcut(e, {
            isComposerFocused,
            draftText,
            domValue,
            availableCount: suggestions.length
          })) {
            e.preventDefault();
            e.stopPropagation();
            const idx = getShortcutIndex(e.key, e.code);
            if (idx >= 0 && idx < suggestions.length) {
              handleSendPrompt(suggestions[idx], idx);
            }
          }
        }

        window.addEventListener('keydown', onKeyDown, true);
        return () => {
          window.removeEventListener('keydown', onKeyDown, true);
        };
      }, [suggestions, isRunning, draft, handleSendPrompt]);

      // If no suggestions or session is running, collapse completely
      if (suggestions.length === 0 || isRunning) {
        return null;
      }

      // Render native DSH styled chips
      return h('div', {
        className: 'dsh-quick-replies-dock',
        role: 'region',
        'aria-label': 'Respostas Sugeridas',
        style: {
          padding: '8px 12px 10px 12px',
          marginBottom: '6px',
          borderTop: '1px solid var(--dsw-alias-border-l1, rgba(255,255,255,0.08))',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          fontFamily: 'inherit'
        }
      }, [
        // Header row
        h('div', {
          key: 'header',
          style: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: '11px',
            color: 'var(--dsw-alias-label-secondary, #9ca3af)',
            letterSpacing: '0.04em'
          }
        }, [
          h('span', {
            key: 'title',
            style: {
              fontWeight: 600,
              textTransform: 'uppercase',
              display: 'flex',
              alignItems: 'center',
              gap: '5px'
            }
          }, [
            h('svg', {
              key: 'icon',
              width: 12, height: 12, viewBox: '0 0 24 24',
              fill: 'none', stroke: 'currentColor', strokeWidth: 2.2,
              'aria-hidden': 'true'
            }, h('path', { d: 'M13 2L3 14h9l-1 8 10-12h-9l1-8z' })),
            'Respostas Sugeridas'
          ]),
          h('span', {
            key: 'hint',
            style: { opacity: 0.8 }
          }, suggestions.length === 1 ? '⌥1' : (suggestions.length === 2 ? '⌥1 ou ⌥2' : '⌥1, ⌥2 ou ⌥3'))
        ]),

        // Grid of options
        h('div', {
          key: 'grid',
          style: {
            display: 'grid',
            gridTemplateColumns: `repeat(${Math.min(suggestions.length, 3)}, 1fr)`,
            gap: '8px'
          }
        }, suggestions.map((text, idx) => {
          const isSubmitting = submittingIdx === idx;
          return h('button', {
            key: `opt-${idx}`,
            type: 'button',
            'aria-label': `Enviar sugestão: ${text}`,
            disabled: isSubmitting,
            onClick: () => handleSendPrompt(text, idx),
            style: {
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: 'var(--dsw-alias-bg-layer-1, #1a1e27)',
              border: '1px solid var(--dsw-alias-border-l1, #2d3342)',
              borderRadius: '7px',
              padding: '7px 11px',
              color: 'var(--dsw-alias-label-primary, #f3f4f6)',
              fontSize: '12.5px',
              cursor: isSubmitting ? 'wait' : 'pointer',
              textAlign: 'left',
              transition: 'all 0.15s ease',
              opacity: isSubmitting ? 0.6 : 1,
              outline: 'none'
            },
            onMouseOver: (e) => {
              e.currentTarget.style.borderColor = 'var(--dsw-alias-brand-primary, #3b82f6)';
              e.currentTarget.style.background = 'var(--dsw-alias-bg-layer-2, #1f2533)';
            },
            onMouseOut: (e) => {
              e.currentTarget.style.borderColor = 'var(--dsw-alias-border-l1, #2d3342)';
              e.currentTarget.style.background = 'var(--dsw-alias-bg-layer-1, #1a1e27)';
            }
          }, [
            h('div', {
              key: 'left',
              style: {
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                overflow: 'hidden'
              }
            }, [
              h('kbd', {
                key: 'kbd',
                style: {
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  minWidth: '19px',
                  height: '19px',
                  padding: '0 4px',
                  fontSize: '10.5px',
                  fontWeight: 700,
                  fontFamily: 'inherit',
                  background: 'var(--dsw-alias-bg-layer-2, #282f3d)',
                  color: 'var(--dsw-alias-brand-primary, #93c5fd)',
                  border: '1px solid var(--dsw-alias-border-l2, #3b4559)',
                  borderRadius: '4px'
                }
              }, `⌥${idx + 1}`),
              h('span', {
                key: 'text',
                style: {
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis'
                }
              }, text)
            ]),
            h('svg', {
              key: 'arrow',
              width: 12, height: 12, viewBox: '0 0 24 24',
              fill: 'none', stroke: 'currentColor', strokeWidth: 2.2,
              'aria-hidden': 'true',
              style: { opacity: 0.7, flexShrink: 0, marginLeft: '6px' }
            }, [
              h('line', { key: 'l', x1: 5, y1: 12, x2: 19, y2: 12 }),
              h('polyline', { key: 'p', points: '12 5 19 12 12 19' })
            ])
          ]);
        }))
      ]);
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        clientCtx = ctx;
        ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
          name: 'conversation.input.dock',
          id: 'dsh-quick-replies',
          order: 5,
        }, QuickRepliesDock));
      }
    };
  }
});
