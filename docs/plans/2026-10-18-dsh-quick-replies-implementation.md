# dsh-quick-replies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a complete, publishable DeepSeek Harness (DSH) plugin that dynamically displays 0 to 3 contextual quick-reply buttons above the composer after an assistant response, with keyboard shortcuts (`⌥1`, `⌥2`, `⌥3` / `Alt+1..3`) and immediate prompt dispatch.

**Architecture:** A dual-half Cordis plugin. The Host half (`index.js`) listens to session completion events, sanitizes turn context, calls the host `llm` with a lightweight extraction prompt (max 60 tokens, no reasoning), and manages background cancellation. The Client half (`client.js`) registers into `conversation.input.dock`, rendering native DSH styled chips with keyboard shortcuts that dispatch immediately when the composer draft is empty.

**Tech Stack:** JavaScript (ESM, Node.js test runner `node --test`), `@deepseek-ai/cordis`, React (`React.createElement` via DSH `__ModuleLoader__`), CSS themed via DSH CSS variables.

**Spec:** `/Users/medeiroshudson/Documents/Development/dsh-quick-replies/docs/specs/2026-10-18-dsh-quick-replies-design.md`

## Global Constraints

- **Language & Runtime:** Pure JavaScript ECMAScript Modules (`"type": "module"`), Node 20+, no complex build steps required for the plugin distribution.
- **DSH Client Integration:** Uses standard `window.__ModuleLoader__.load({ id, factory })` and `ctx.slots.inject('conversation.input.dock')`.
- **Shortcut Guard:** `⌥1`, `⌥2`, `⌥3` (macOS) / `Alt+1`, `Alt+2`, `Alt+3` (Linux/Windows) must dispatch ONLY if the composer draft is empty or focus is outside an input element.
- **Model Efficiency:** Summarizer reuses active session credentials/model with `maxTokens: 60` and reasoning disabled; aborts gracefully via `AbortController` if user types or new turn begins.
- **Dynamic Count (0..3):** When 0 suggestions exist or are generated, container collapses completely (`null` rendering).

## Review Focus

1. **Empty / Concluding Turns:** Assistant turn ends with a pure statement or goodbye -> Summarizer returns 0 suggestions (`[]`) and UI collapses without flicker.
2. **Rapid User Interruption:** User starts typing and submits a prompt while background summarizer is in flight -> `AbortController` terminates LLM call, in-flight results discarded, no ghost suggestions render.
3. **Draft Safety:** User has already typed text into the composer textarea and presses `⌥1` -> Shortcut is ignored, draft text remains intact, no prompt dispatched.
4. **Tool-Heavy Turns:** Turn with multiple tool executions (e.g. bash commands, file diffs) with minimal final text -> Context sanitization prevents token explosion while correctly extracting the outcome.
5. **Session Switching:** Switching between different active sessions -> Quick replies update to reflect the selected session's cached suggestions.

---

### Task 1: Package Scaffolding & Manifests

**Files:**
- Create: `package.json`
- Create: `cordis.patch.yml`
- Create: `icon.svg`
- Create: `locale/en.json`
- Create: `locale/pt.json`
- Create: `.gitignore`
- Create: `README.md`

**Interfaces:**
- Consumes: Spec requirements for package name (`dsh-quick-replies`), bundle patch, locales, and client manifest injection.
- Produces: Base files and metadata required by Cordis loader and DSH Plugin Manager.

- [ ] **Step 1: Create `.gitignore`**
  Add `node_modules/`, `.DS_Store`, `coverage/`, and build artifacts.

- [ ] **Step 2: Create `package.json`**
  Declare `"name": "dsh-quick-replies"`, `"version": "1.0.0"`, `"type": "module"`, exports (`.`, `./client`, `./locale/*.json`, `./icon`), `dsh.bundle.patch: "./cordis.patch.yml"`, `dsh.client: { "platform": "web", "immediately": true, "inject": ["@deepseek-ai/dsh-client-ui-conversation"] }`.

- [ ] **Step 3: Create `cordis.patch.yml`**
  Insert entry `id: dsh-quick-replies`, `name: 'dsh-quick-replies'`.

- [ ] **Step 4: Create `locale/en.json` and `locale/pt.json`**
  Define `meta.title`, `meta.description`, and UI labels (`headerTitle`, `shortcutHint`, `emptyDraftHint`).

- [ ] **Step 5: Create `icon.svg`**
  Design an original SVG icon (24x24 viewBox) representing fast responses/quick replies.

- [ ] **Step 6: Create initial `README.md`**
  Document project overview, installation in DSH, features, and keyboard shortcuts.

- [ ] **Step 7: Verify package structure**
  Run: `node -e 'const pkg = JSON.parse(require("fs").readFileSync("package.json", "utf8")); console.log(pkg.name, pkg.dsh);'`
  Expected: Outputs `dsh-quick-replies` and valid `dsh` configuration object.

---

### Task 2: Summarizer Context Sanitizer & Response Parser

**Files:**
- Create: `src/summarizer.js`
- Test: `tests/summarizer.test.js`

**Interfaces:**
- Consumes: Raw turn events or messages from session history.
- Produces:
  - `buildSummarizerPrompt(messages: Array<{ role: string, content: string | Array }>): { system: string, userPrompt: string }`
  - `parseSummarizerResponse(rawText: string): string[]` (guaranteed 0 to 3 items, string length <= 50, trimmed).

- [ ] **Step 1: Write tests for `parseSummarizerResponse` and `buildSummarizerPrompt`**
  Cover:
  - Valid JSON with 1..3 suggestions -> Returns array of strings.
  - JSON with > 3 suggestions -> Truncates to max 3 items.
  - Non-JSON or markdown codeblock wrapped JSON (` ```json { ... } ``` `) -> Parses cleanly.
  - Invalid format or empty suggestions -> Returns `[]`.
  - Tool-heavy messages -> Sanitizes into compact text representation.

- [ ] **Step 2: Run tests to verify failure**
  Run: `node --test tests/summarizer.test.js`
  Expected: FAIL (module `src/summarizer.js` not found).

- [ ] **Step 3: Implement `src/summarizer.js`**
  Implement `buildSummarizerPrompt` and `parseSummarizerResponse` with resilient JSON extraction and 0..3 bounds.

- [ ] **Step 4: Run tests to verify pass**
  Run: `node --test tests/summarizer.test.js`
  Expected: PASS all tests.

---

### Task 3: Host Half Plugin (Lifecycle, LLM Invocation & RPC)

**Files:**
- Create: `index.js`
- Create: `src/host-service.js`
- Test: `tests/host-service.test.js`

**Interfaces:**
- Consumes: `src/summarizer.js`, Cordis Context (`ctx.on`, `ctx.get('llm')`, `ctx.get('sessionController')`).
- Produces:
  - Host plugin entry `export function apply(ctx)`.
  - RPC handler `getQuickReplies(sessionId): Promise<{ suggestions: string[] }>`.
  - Event triggers to notify Client when suggestions change.

- [ ] **Step 1: Write tests for `HostQuickReplyService`**
  Test lifecycle management:
  - Generates suggestions on turn end.
  - In-memory cache stores suggestions per `sessionId`.
  - Active request is aborted (`abortController.abort()`) if session becomes running or new turn starts.
  - Clear suggestions when a prompt is submitted.

- [ ] **Step 2: Run tests to verify failure**
  Run: `node --test tests/host-service.test.js`
  Expected: FAIL.

- [ ] **Step 3: Implement `src/host-service.js` and `index.js`**
  - Implement `apply(ctx)` registering event listeners on `agent/status` and `agent/turn-stopping`.
  - Trigger background async summarization using `ctx.get('llm')` with `maxTokens: 60`.
  - Expose RPC endpoint for the Client half.

- [ ] **Step 4: Run tests to verify pass**
  Run: `node --test tests/host-service.test.js`
  Expected: PASS all tests.

---

### Task 4: Client Half UI Component & Keyboard Shortcut Guard

**Files:**
- Create: `client.js`
- Create: `src/client-component.js`
- Test: `tests/client-component.test.js`

**Interfaces:**
- Consumes: Host RPC (`host.call` / DSH remotes), DSH slots (`conversation.input.dock`).
- Produces: Client entry registering `QuickRepliesDock` in `conversation.input.dock`.

- [ ] **Step 1: Write unit tests for shortcut guard logic**
  Test helper `shouldHandleShortcut({ altKey, key, isComposerFocused, draftText })`:
  - `altKey` + `'1'` with empty draft -> `true`.
  - `altKey` + `'1'` with non-empty draft (`"hello"`) -> `false`.
  - Non-alt key or other number -> `false`.

- [ ] **Step 2: Run tests to verify failure**
  Run: `node --test tests/client-component.test.js`
  Expected: FAIL.

- [ ] **Step 3: Implement shortcut guard in `src/client-component.js`**
  Implement helper and verify test passes.

- [ ] **Step 4: Implement full `client.js` module**
  - Uses `window.__ModuleLoader__.load({ id: 'dsh-quick-replies', factory: (require) => { ... } })`.
  - Registers `conversation.input.dock` slot via `ctx.slots.inject`.
  - Renders responsive grid using `React.createElement`:
    - Renders `<button>` for each suggestion with `<kbd>⌥${index + 1}</kbd>`.
    - Handles click and keyboard shortcut to dispatch prompt via `ctx.remote.session.prompt` or `inputActions`.
    - Returns `null` when count is 0.

- [ ] **Step 5: Run tests to verify pass**
  Run: `node --test tests/client-component.test.js`
  Expected: PASS.

---

### Task 5: Integration, Git Initialization & Final Verification

**Files:**
- Create: `.git/` (git init)
- Verify: Full repository test suite and packaging readiness.

- [ ] **Step 1: Run complete test suite**
  Run: `node --test tests/*.test.js`
  Expected: PASS all test files.

- [ ] **Step 2: Syntax and module check**
  Run: `node -c index.js client.js src/*.js`
  Expected: Zero syntax errors.

- [ ] **Step 3: Initialize Git repository & commit initial release**
  Initialize git in `/Users/medeiroshudson/Documents/Development/dsh-quick-replies`, stage all files, and make initial commit:
  `git init && git add . && git commit -m "feat: initial commit for dsh-quick-replies plugin"`

- [ ] **Step 4: Verify git status is clean**
  Run: `git status`
  Expected: Clean working tree.
