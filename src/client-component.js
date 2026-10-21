/**
 * @file client-component.js
 * Helpers, shortcut guard, and component logic for quick replies UI.
 */

/**
 * Safely extract text string from DSH Chat node.
 * DSH assistant-step nodes hold text in node.data.blocks array of { kind: 'text', text: string }
 * or node.data.content array of { type: 'text', text: string }.
 * @param {any} node
 * @returns {string}
 */
export function extractTextFromNode(node) {
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
 * Extract contextual suggestions from assistant text when host LLM is not yet ready or offline.
 * Supports:
 * - Numbered options ("1. ...", "2. ...")
 * - Bullet list options ("- Opção A", "* Opção B")
 * - Decision questions ("Deseja que eu...?", "Quer que eu...?", "Como gostaria de prosseguir?")
 * @param {string} text
 * @returns {string[]}
 */
export function extractFallbackSuggestions(text) {
  if (!text || typeof text !== 'string') return [];
  const cleanText = text.replace(/```[\s\S]*?```/g, '').trim();
  const lines = cleanText.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];

  const candidates = [];

  for (const line of lines) {
    // Ignore markdown headings (###, ##, #)
    if (line.startsWith('#')) continue;

    // Match explicit numbered choices like "1. Deploy", "2) Run tests" or "- Opção A: Deploy"
    const match = line.match(/^(?:[1-3][\.\)]|[\*\-]\s+(?:Opção|Alternativa|Option)\s*[A-C]?[:\-])\s*(.+)$/i);
    if (match && match[1]) {
      const item = match[1].replace(/[\*\_\`]/g, '').trim();
      if (item.length > 2 && item.length <= 45 && !item.endsWith(':')) {
        candidates.push(item);
      }
    }
    if (candidates.length >= 3) break;
  }

  if (candidates.length >= 2) return candidates;

  // Question patterns strictly at the end of the response (must end with ?)
  const tail = lines.slice(-2).join(' ');
  if (/\?/.test(tail)) {
    if (/deseja que eu|quer que eu|posso avançar|podemos|deseja/i.test(tail)) {
      return ['Sim, pode prosseguir', 'Não agora'];
    }
    if (/como deseja|como gostaria|como prefere|qual prefere/i.test(tail)) {
      return ['Prosseguir com o próximo passo', 'Detalhar mais informações'];
    }
    if (/funciona|testar|deu certo/i.test(tail)) {
      return ['Sim, funcionou!', 'Ainda não funcionou'];
    }
  }

  return [];
}

/**
 * Maps keyboard event key/code to a zero-based suggestion index (0..2).
 * Handles macOS Option-key dead characters (e.g. '¡', '™', '£' on US, '¹', '²', '³' on ABNT2)
 * as well as standard physical Digit1..Digit3 codes.
 *
 * @param {string} [key]
 * @param {string} [code]
 * @returns {number} 0, 1, 2 or -1 if invalid
 */
export function getShortcutIndex(key, code) {
  if (key === '1' || code === 'Digit1' || key === '¡' || key === '¹') return 0;
  if (key === '2' || code === 'Digit2' || key === '™' || key === '²') return 1;
  if (key === '3' || code === 'Digit3' || key === '£' || key === '³') return 2;
  return -1;
}

/**
 * Determines whether a keyboard event should trigger a quick reply shortcut.
 * Ensures typing in the composer is uninterrupted if draft text exists,
 * checking both hook state and raw DOM input value to prevent desync.
 *
 * @param {{ altKey?: boolean, key?: string, code?: string }} event
 * @param {{
 *   isComposerFocused?: boolean,
 *   draftText?: string | null,
 *   domValue?: string | null,
 *   availableCount?: number
 * }} context
 * @returns {boolean}
 */
export function shouldHandleShortcut(event, context = {}) {
  if (!event || !event.altKey) {
    return false;
  }

  const index = getShortcutIndex(event.key, event.code);
  if (index === -1) {
    return false;
  }

  // If available count is specified, ensure index is within range
  if (typeof context.availableCount === 'number') {
    if (index >= context.availableCount) {
      return false;
    }
  }

  // If composer input is actively focused, verify both hook draft and raw DOM value
  if (context.isComposerFocused) {
    const text = context.draftText;
    if (typeof text === 'string' && text.trim().length > 0) {
      return false;
    }

    const domVal = context.domValue;
    if (typeof domVal === 'string' && domVal.trim().length > 0) {
      return false;
    }
  }

  return true;
}
