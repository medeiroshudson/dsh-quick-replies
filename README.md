---
description: "Context-aware quick reply suggestions with keyboard shortcuts for DeepSeek Harness (DSH): displays 0 to 3 dynamic next-step suggestions above the composer immediately after an assistant response completes."
kind: "package-reference"
---

# @local/dsh-quick-replies

English | [Português](README.pt.md)

Context-aware quick reply suggestions and keyboard-first dispatch for [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness).

## Summary

`dsh-quick-replies` enhances conversational velocity and reduces cognitive fatigue in DSH sessions. Immediately after an assistant turn finishes, a lightweight background summarizer analyzes the closing turn context and derives between **0 and 3 actionable next-step suggestions** displayed directly above the composer in the `conversation.input.dock` slot. 

Suggestions can be clicked or activated with dedicated keyboard shortcuts (`⌥1`, `⌥2`, `⌥3` on macOS / `Alt+1`, `Alt+2`, `Alt+3` on Linux & Windows) to instantly dispatch the selected prompt to the active session. If a turn concludes with no meaningful follow-ups, the container collapses cleanly without cluttering the interface.

## Table of Contents

- [Use this package](#use-this-package)
  - [Installation](#installation)
  - [Keyboard shortcuts](#keyboard-shortcuts)
  - [Composer focus & typing safety](#composer-focus--typing-safety)
- [Understand the implementation](#understand-the-implementation)
  - [Host half (`index.js`)](#host-half-indexjs)
  - [Client half (`client.js`)](#client-half-clientjs)
  - [Concurrency and cancellation](#concurrency-and-cancellation)
- [Model Experience](#model-experience)
  - [Summarizer prompt contract](#summarizer-prompt-contract)
  - [KV cache & token footprint](#kv-cache--token-footprint)
- [Configuration](#configuration)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Development and Tests](#development-and-tests)
- [License](#license)

-----

<a id="use-this-package"></a>
## Use this package

Mount this bundle into your DSH profile. Once active, completing an assistant response triggers the background summarizer to evaluate whether actionable follow-up choices exist. When candidates are detected, interactive chips render above the input bar.

### Installation

Install the package directly into your current DSH profile via the CLI or Plugin Manager:

```bash
dsh plugin install @local/dsh-quick-replies
```

Or add the bundle to your profile's `package.json` and declare it in `cordis.patch.yml`:

```yaml
- insert:
    - id: dsh-quick-replies
      name: '@local/dsh-quick-replies'
      config: {}
```

### Keyboard shortcuts

Quick reply chips are mapped to primary modifier numbers:

| macOS Shortcut | Linux / Windows Shortcut | Action |
|---|---|---|
| `⌥1` | `Alt+1` | Send suggestion 1 immediately |
| `⌥2` | `Alt+2` | Send suggestion 2 immediately |
| `⌥3` | `Alt+3` | Send suggestion 3 immediately |

### Composer focus & typing safety

To ensure keyboard shortcuts never disrupt manual composition:
1. **Empty composer draft:** If the user has not typed into the input textarea, `⌥1..3` immediately captures the keystroke, submits the suggestion, and clears the prompt dock.
2. **Active typing in progress:** If the composer contains typed text or ongoing draft composition, `⌥1..3` is ignored by the shortcut handler and passes through to native typing/OS character composition (such as special symbols on international keyboards).
3. **Dynamic bounds:** If only 2 suggestions are available, `⌥3` is inactive.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Architecture and internals — click to expand</summary>

The bundle is composed of two synchronized halves:

### Host half (`index.js`)
- **Turn monitoring:** Attaches to the Host `agent/status` event. When the status transitions from `running` to `idle`, it inspects recent session events using the host `sessionController` to extract the user's latest prompt and the assistant's final response text.
- **Context sanitization:** Tool-heavy turns (e.g. bash operations, file diffs) are automatically condensed into concise descriptors (e.g. `[Executed tools: bash, edit]`), preventing token window inflation while maintaining contextual relevance.
- **LLM invocation:** Dispatches a minimal streaming call through `ctx.get('llm')` with `maxTokens: 60`, `temperature: 0.3`, and reasoning/thinking tokens suppressed.
- **Session caching:** Caches suggestions per `sessionId` in an in-memory registry, ensuring that switching between tabs or background workspaces preserves each session's active quick-reply state.

### Client half (`client.js`)
- **Slot injection:** Loads through `window.__ModuleLoader__` and injects a React component into `conversation.input.dock` at `order: 5`.
- **DSH Theme integration:** Styled entirely with native DSH design tokens (`--dsw-alias-bg-layer-1`, `--dsw-alias-bg-layer-2`, `--dsw-alias-border-l1`, `--dsw-alias-brand-primary`, etc.), seamlessly adapting to light and dark modes.
- **Immediate dispatch:** Dispatches prompts using `ctx.remote.session.prompt` with `{ mode: 'queue', content: [{ type: 'text', text: suggestion }] }`.
- **Local fallback extraction:** If host RPC is unavailable, the client includes an offline parser that extracts numbered or bulleted options directly from the assistant's rendered chat node.

### Concurrency and cancellation
The Host half maintains an `AbortController` mapped to each session. If the user begins typing, submits their own prompt, or the session transitions back to `running`, any in-flight summarization job is aborted immediately, discarding stale suggestions and preventing ghost UI updates.

</details>

-----

<a id="model-experience"></a>
## Model Experience

### Summarizer prompt contract

The background summarizer executes with a strict extraction system prompt:

```text
You are an intent predictor for an interactive AI assistant.
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
```

### KV cache & token footprint

- **Input tokens:** ~80–180 tokens (last turn user prompt + truncated assistant response + compact system instructions).
- **Output tokens:** Bounded to a maximum of 60 tokens (`maxTokens: 60`).
- **Reasoning effort:** Disabled / bypassed to guarantee sub-second generation without consuming thinking quotas.
- **Agent context impact:** Zero. The summarization runs outside the agent loop and does not write to the session event log or pollute model history.

-----

<a id="configuration"></a>
## Configuration

The bundle accepts configuration in `cordis.patch.yml` or profile overrides:

| Option | Type | Default | Description |
|---|---|---|---|
| `maxSuggestions` | `number` | `3` | Maximum number of suggestions to render (1 to 3). |
| `maxTokens` | `number` | `60` | Maximum token ceiling for the summarizer response. |
| `temperature` | `number` | `0.3` | Model temperature for suggestion generation. |

-----

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- **Streaming turns:** Quick replies only generate after a turn fully settles (`agent/status` idle); suggestions do not stream progressively while tool calls are still resolving.
- **Multi-modal inputs:** Suggestion prompts are strictly text-based; they do not generate attachment drops or file reference bindings.

-----

<a id="development-and-tests"></a>
## Development and Tests

The repository is built with pure ECMAScript Modules and tested via the Node.js native test runner:

```bash
# Run full unit test suite
npm test

# Run tests in watch mode
node --test --watch tests/*.test.js

# Syntax verification
node -c index.js client.js src/*.js
```

### Test Coverage Highlights
- `tests/summarizer.test.js`: Resilient JSON extraction, markdown codeblock unwrapping, 3-item ceiling, string truncation at 50 chars, and tool-heavy turn sanitization.
- `tests/host-service.test.js`: Session cache isolation, `AbortController` cancellation on turn start, and graceful LLM error recovery.
- `tests/client-component.test.js`: Shortcut mapping, focus detection, empty draft guard, and bounds checking.

-----

<a id="license"></a>
## License

MIT © Hudson Medeiros
