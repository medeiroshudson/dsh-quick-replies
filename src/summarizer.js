/**
 * @file summarizer.js
 * Context sanitizer and structured response parser for quick replies.
 */

const SYSTEM_PROMPT = `You are an intent predictor for an interactive AI assistant.
Analyze the assistant's last message and immediate user context.
Determine if 0, 1, 2, or 3 quick next-step responses or decisions make sense for the user to reply with.
If the response is a concluding statement, requires no action, or has no sensible next prompts, return an empty array [].

Return strictly valid JSON matching this schema:
{
  "suggestions": [
    "Short actionable prompt 1",
    "Short actionable prompt 2"
  ]
}

Rules:
- Max 3 suggestions.
- Each suggestion must be concise (under 45 characters).
- Written in the user's language (matching the conversation).
- Actionable, imperative, or a natural short user reply.
- No markdown, explanations, or commentary outside the JSON.`;

const MAX_ASSISTANT_BUDGET = 2000;
const MAX_USER_BUDGET = 500;

/**
 * Extract clean string text from message content with length bounds.
 * @param {string | Array<object>} content
 * @param {number} maxBudget
 * @returns {string}
 */
function extractTextAndTools(content, maxBudget = MAX_ASSISTANT_BUDGET) {
  if (typeof content === 'string') {
    return content.length > maxBudget ? '...' + content.slice(-maxBudget) : content;
  }
  if (!Array.isArray(content)) {
    return '';
  }

  const texts = [];
  const tools = [];

  for (const block of content) {
    if (!block) continue;
    if (block.type === 'text' && typeof block.text === 'string') {
      texts.push(block.text);
    } else if (block.type === 'tool-call' && block.name) {
      tools.push(block.name);
    }
  }

  let result = texts.join('\n').trim();
  if (tools.length > 0) {
    result += `\n[Executed tools: ${tools.join(', ')}]`;
  }

  if (result.length > maxBudget) {
    result = '...' + result.slice(-maxBudget);
  }
  return result;
}

/**
 * Builds the system and user prompt for the summarizer LLM call.
 * @param {Array<{ role: string, content: any }>} messages
 * @returns {{ system: string, userPrompt: string }}
 */
export function buildSummarizerPrompt(messages = []) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return {
      system: SYSTEM_PROMPT,
      userPrompt: 'No prior context.'
    };
  }

  // Find the last assistant message
  let lastAssistant = null;
  let lastUser = null;

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg) continue;
    if (!lastAssistant && msg.role === 'assistant') {
      lastAssistant = msg;
    } else if (lastAssistant && !lastUser && msg.role === 'user') {
      lastUser = msg;
      break;
    }
  }

  const userText = lastUser ? extractTextAndTools(lastUser.content, MAX_USER_BUDGET) : '';
  const assistantText = lastAssistant ? extractTextAndTools(lastAssistant.content, MAX_ASSISTANT_BUDGET) : '';

  const userPrompt = `User: ${userText}\n\nAssistant: ${assistantText}`;

  return {
    system: SYSTEM_PROMPT,
    userPrompt
  };
}

/**
 * Parse and normalize the raw LLM response into an array of 0 to 3 suggestion strings.
 * @param {string} rawText
 * @returns {string[]}
 */
export function parseSummarizerResponse(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    return [];
  }

  let text = rawText.trim();
  // Strip markdown code fences if present
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Attempt regex extraction of suggestions array if wrapped with extra text
    const match = text.match(/"suggestions"\s*:\s*\[([\s\S]*?)\]/);
    if (match) {
      try {
        parsed = JSON.parse(`{${match[0]}}`);
      } catch {
        return [];
      }
    } else {
      return [];
    }
  }

  if (!parsed || !Array.isArray(parsed.suggestions)) {
    return [];
  }

  const cleanList = [];
  for (const item of parsed.suggestions) {
    if (typeof item !== 'string') continue;
    let str = item.trim();
    if (!str) continue;

    // Truncate to maximum 50 characters with ellipsis if exceeded
    if (str.length > 50) {
      str = str.slice(0, 47) + '...';
    }

    cleanList.push(str);
    if (cleanList.length >= 3) break;
  }

  return cleanList;
}
