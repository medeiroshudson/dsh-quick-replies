# Design Specification: dsh-quick-replies Plugin

**Date:** 2026-10-18  
**Status:** Approved  
**Target:** DeepSeek Harness (DSH) Web / Desktop Plugin  
**Package:** `dsh-quick-replies` (`@local/dsh-quick-replies`)  
**Repository Directory:** `/Users/medeiroshudson/Documents/Development/dsh-quick-replies`

---

## 1. Intent & Purpose (The "Why")

In conversational agent workflows within DeepSeek Harness (DSH), an assistant response often naturally concludes with decision points or predictable next steps (e.g., "executar deploy em staging", "detalhar plano de refatoração", "verificar logs"). Manually typing these responses or prompts introduces unnecessary cognitive friction and slows down interaction speed.

The purpose of **dsh-quick-replies** is to provide dynamic, context-aware quick response suggestions (0 to 3 options) displayed directly above the composer input area immediately after an assistant response completes. Users can either click a suggestion or press a keyboard shortcut (`⌥1`, `⌥2`, `⌥3` / `Alt+1`, `Alt+2`, `Alt+3`) to instantly dispatch that suggestion as their next prompt to the agent.

---

## 2. Goals, Non-Goals, and Anti-Goals

### Goals
- **Context-Aware Dynamic Count (0 to 3):** Dynamically generate between 0 and 3 suggestions depending on the conversation context. If no follow-up is applicable or if the task is strictly concluded, 0 suggestions are rendered and the dock collapses completely.
- **Native DSH Aesthetic:** Integrate seamlessly into DSH's design system using DSH theme tokens (`--dsw-alias-bg-layer-1`, `--dsw-alias-border-l1`, `--dsw-alias-label-primary`, etc.).
- **Immediate Dispatch:** Clicking a quick-reply chip or pressing its keyboard shortcut immediately sends the prompt to the active session agent via DSH's session prompt mechanism (`mode: 'queue'`).
- **Keyboard-First Shortcuts:** Provide dedicated shortcuts (`⌥1`, `⌥2`, `⌥3` on macOS / `Alt+1`, `Alt+2`, `Alt+3` on Linux/Windows).
- **Composer-Safe Shortcut Guard:** When the composer input is focused, `⌥1..3` triggers immediate dispatch **only if the draft input is currently empty**. If the user has started typing, shortcuts do not intercept keystrokes, preserving uninterrupted typing.
- **Zero Configuration Default:** Reuses the active session's model and credentials with strict token limits (`maxTokens: 60`, reasoning disabled) for fast, lightweight background summarization without extra API keys or setup.
- **Async Non-Blocking Execution:** Runs summarization in the background with automatic cancellation (`AbortController`) if the user submits a message or if a new turn starts before summarization settles.
- **Standalone Publishable Repository:** Self-contained repository in `/Users/medeiroshudson/Documents/Development/dsh-quick-replies` ready to be committed, published to GitHub, and installed via `dsh` / Cordis plugin manager.

### Non-Goals
- Replacing the standard DSH composer or editing drafts the user is already composing.
- Multi-turn conversational tree branching visualization or complex node graphs (strictly an actionable quick reply bar).
- Hardcoding static quick responses.

### Anti-Goals
- Cluttering the chat interface when no action is needed (0 suggestions must collapse cleanly).
- Interfering with normal text input or composition when the user is actively typing.
- Blocking the agent loop or delaying turn finalization.

---

## 3. Platform Architecture & Engineering Decisions

### 3.1 Host Half (`index.js`)
- **Event Hook:** Subscribes to `agent/status` (or `agent/turn-stopping`). When the status shifts to `idle`, triggers an async background summarization task.
- **Model Execution:** Calls Host `llm.stream()` / `llm.prepareCall()` using the active session's call config (`provider`, `model`), overriding `maxTokens: 60` and omitting reasoning/thinking tokens.
- **Context Extraction & Sanitization:**
  - Extracts the last user message and the last assistant message text.
  - For tool-heavy turns, sanitizes tool executions into concise names (e.g., `[Executed tools: bash, edit]`) to keep prompt context minimal and ultra-fast.
- **Lifecycle & Cancellation:**
  - Holds an active `AbortController` per session.
  - Aborts in-flight summarization immediately if a new prompt is submitted or if the session transitions back to `running`.
- **In-Memory Cache:** Maintains active suggestions per `sessionId` so switching between sessions preserves the current suggestions for each session.
- **Communication with Client:** Exposes an RPC method (or event) `getQuickReplies(sessionId)` and dispatches updates when new suggestions are generated or invalidated.

### 3.2 Client Half (`client.js`)
- **Slot Registration:** Injects into `conversation.input.dock` (`order: 5`).
- **Standard Props Consumed:**
  - `useSession`: tracks whether the session is currently `running` or `idle`.
  - `useInput`: inspects whether the composer draft currently has text.
  - `inputActions` / `ctx.remote.session.prompt`: executes prompt submission.
  - `sessionId`: tracks active session identity.
- **UI Rendering:**
  - Uses `React.createElement` (built-in runtime from `__ModuleLoader__`).
  - Renders 0 to 3 chips with `<kbd>` shortcut indicators (`⌥1`, `⌥2`, `⌥3`).
  - Seamlessly returns `null` when count is 0.
- **Keyboard Handling:**
  - Attaches `keydown` event listener to `window`.
  - Checks `(event.altKey) && (key === '1' || key === '2' || key === '3')`.
  - If composer is focused, checks `useInput` draft length; if draft is not empty, does not intercept.
  - If draft is empty (or focus is not in another input), calls `preventDefault()`, `stopPropagation()`, and triggers dispatch of that suggestion.

---

## 4. Summarizer Prompt Contract

```text
You are an intent predictor for an interactive AI assistant.
Analyze the assistant's last message and context:
User: {last_user_message}
Assistant: {last_assistant_message}

Determine if 0, 1, 2, or 3 quick next-step responses or decisions make sense for the user to reply with.
If the response is a concluding statement or needs no immediate reply, return an empty array [].
Return strictly valid JSON:
{
  "suggestions": [
    "Short actionable prompt 1",
    "Short actionable prompt 2"
  ]
}
Max 3 suggestions. Each suggestion must be under 45 characters, written in the user's language, imperative or natural response.
```

---

## 5. What is Left to the Builder

- Localized strings in `locale/pt.json` and `locale/en.json` (titles, tooltips, hints).
- Custom SVG icon in `icon.svg` reflecting quick replies / lightning actions.
- Package manifest (`package.json`), patch configuration (`cordis.patch.yml`), and `.gitignore`.
- Full build and syntax validation.
