# dsh-quick-replies

Context-aware quick reply suggestions for [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness).

## Overview

`dsh-quick-replies` is a DSH plugin that displays **0 to 3 dynamic quick-response suggestions** directly above the message composer as soon as an assistant response completes.

- **Dynamic Suggestion Count (0 to 3):** The background summarizer generates relevant follow-up options based on the last response. If the conversation has concluded or requires no follow-up, it automatically collapses without cluttering the interface.
- **Immediate Prompt Dispatch:** Clicking any suggestion immediately sends it to the agent as your next prompt.
- **Keyboard Shortcuts:** Trigger suggestions instantly using `⌥1`, `⌥2`, `⌥3` (macOS) or `Alt+1`, `Alt+2`, `Alt+3` (Linux/Windows).
- **Composer Typing Safety:** Shortcuts only trigger when the composer input is empty, ensuring they never disrupt manual typing.
- **Native DSH Aesthetic:** Blends seamlessly into DSH's design system using the host's CSS variables and themes.
- **Lightweight & Fast:** Runs background summarization using the session's active model with token restrictions (`maxTokens: 60`, reasoning disabled) and automatic background cancellation when new activity starts.

## Installation

Install into your DSH profile via the Plugin Manager or bundle CLI:

```bash
dsh plugin install @local/dsh-quick-replies
```

## Shortcuts

| Shortcut (macOS) | Shortcut (Linux/Win) | Action |
|---|---|---|
| `⌥1` | `Alt+1` | Send suggestion 1 |
| `⌥2` | `Alt+2` | Send suggestion 2 |
| `⌥3` | `Alt+3` | Send suggestion 3 |

*Note: Shortcuts are active only when the composer textarea has no typed text.*

## License

MIT
