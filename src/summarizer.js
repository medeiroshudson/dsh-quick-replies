/**
 * @file summarizer.js
 * Context sanitizer and structured response parser for quick replies.
 */

const SYSTEM_PROMPT = `You are an intent predictor and quick-reply generator for an AI coding assistant.
Your task is to analyze the assistant's last message and immediate user context, and predict 0 to 3 concise quick responses that the HUMAN USER might want to reply with.

CRITICAL INSTRUCTIONS:
1. USER PERSPECTIVE:
   Every suggestion MUST be phrased from the human user's perspective, speaking directly to the assistant.
   Use the language of the conversation (e.g., if the user and assistant speak Portuguese, output in Portuguese; if English, output in English).
   Keep each suggestion short, punchy, and actionable (under 40 characters).
   Examples of valid user replies:
   - "Yes, run the tests" / "Sim, pode rodar os testes"
   - "Apply the suggested fix" / "Aplicar a correção sugerida"
   - "Deploy to staging" / "Fazer deploy em staging"
   - "Explain line 25" / "Explicar em detalhes"
   - "No, adjust parameters" / "Não, quero ajustar antes"

2. CONTEXTUAL RELEVANCE:
   - If the assistant asked for approval, confirmation, or a choice (e.g., "Should I run tests?", "Option A or Option B?"):
     Generate the natural response choices (e.g., "Yes, run tests", "No, wait", or the option names).
   - If the assistant presented alternatives:
     Generate suggestions corresponding to each choice.
   - If the assistant finished a task or report and there are obvious logical next steps:
     Suggest those next actions (e.g., "Run unit tests", "Commit changes", "Explain implementation").
   - If the assistant's response is a final greeting, terminal statement, or completely self-contained with no logical follow-up needed:
     Return an empty list: {"suggestions": []}

3. STRICT PROHIBITIONS:
   - NEVER copy markdown headings, section numbers, or list bullet points from the assistant's response.
   - NEVER output passive topic titles or section summaries.
   - NEVER output commentary or explanations outside the JSON object.

Output MUST be strictly valid JSON matching this schema:
{
  "suggestions": [
    "User reply 1",
    "User reply 2"
  ]
}`;

const MAX_ASSISTANT_BUDGET = 2000;
const MAX_USER_BUDGET = 500;

function hasRealText(content) {
  if (typeof content === 'string') return content.trim().length > 0;
  if (!Array.isArray(content)) return false;
  return content.some(b => b && (b.type === 'text' || b.kind === 'text') && typeof b.text === 'string' && b.text.trim().length > 0);
}

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
    if ((block.type === 'text' || block.kind === 'text') && typeof block.text === 'string') {
      texts.push(block.text);
    } else if ((block.type === 'tool-call' || block.kind === 'tool-call') && block.name) {
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

  // Find the last assistant message that actually communicated to the user
  let lastAssistant = null;
  let lastUser = null;

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg) continue;
    if (!lastAssistant && msg.role === 'assistant') {
      if (!hasRealText(msg.content)) continue;
      const text = extractTextAndTools(msg.content, MAX_ASSISTANT_BUDGET);
      if (text) {
        lastAssistant = msg;
      }
    } else if (lastAssistant && !lastUser && msg.role === 'user') {
      // Check if message is a non-human metadata injection
      if (msg.source && msg.source.kind && msg.source.kind !== 'user') {
        continue;
      }
      if (!hasRealText(msg.content)) continue;
      const text = extractTextAndTools(msg.content, MAX_USER_BUDGET);
      if (
        text &&
        !text.startsWith('<system-reminder>') &&
        !text.startsWith('<openviking-context>') &&
        !text.startsWith('Time sampled while') &&
        !text.startsWith('[model changed:')
      ) {
        lastUser = msg;
        break;
      }
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
