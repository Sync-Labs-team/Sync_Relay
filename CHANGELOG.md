# Changelog

## 0.1.0

First release. Both plugins are at 0.1.0.

Core (`synclabs-relay`, Claude Code and Codex)
- Lock: `PreToolUse` denies work tools in the main interactive session; subagents and automation (`claude -p`, `codex exec`) pass. Modes `enforce` (default), `remind`, `off`.
- Delegation table injected at `SessionStart`, built from the config (`routing`), with a report-size request and a `SubagentStop` hook that asks once for a shorter report.
- Handoff: the word `handoff` (or `passagem`, with or without `/`) asks the model to write the state of the work to a file; the next session in the same directory, in either CLI, receives it. The core is the only part that delivers it. Files live in a per-user folder, are taken once and expire after 30 minutes for delivery.
- Claude Code delivery: the marker `_req-<PID>.txt` holds the file name `<slug>-<8hex>.md`; an empty marker means canceled and delivers nothing. Without `CLAUDE_PID`, `/clear` delivers the only `<slug>-<8hex>.md` under 30 minutes old, and nothing when there are two or more. A handoff taken and then hit by an error before printing is renamed back.
- File names: `<readable part>-<h8>` (the last 60 characters of the lowercase path, then the FNV-1a 32-bit hash of the normalized directory), so directories like `my_app` and `my-app` never share a handoff. Claude Code adds `-<8 characters of the session id>`.
- The routing table is cut to fit what the handoff leaves under 9,000 characters; the handoff is never cut for it.
- `handoff_dir` follows one rule in the core and the band: `~` expands, Windows needs a drive or a network path, macOS and Linux a leading `/`, no `..` segment. `lang` is read the same way in both (case-insensitive, `pt`, `pt-*`, `en`, `en-*`).
- On macOS and Linux the default handoff folder is set to `0700` when the plugin uses it; a folder you configure in `handoff_dir` keeps its permissions. A folder of another user is refused.
- The Codex hook command reads `PLUGIN_ROOT` and falls back to `CLAUDE_PLUGIN_ROOT`.
- Cleanup after 7 days: `_req-N.txt`, `_detect-*.flag` and `_trace-<8hex>.md` in any folder; the handoff `.md` files (and `.usada.md`) only in the default folder, so a folder you configured never loses a note of yours.
- Permission: on Claude Code the core pre-approves only the `Write` of the session's own handoff file (main session, valid `CLAUDE_PID`, marker at most 10 minutes old, exact path, safe folder, target not a link, at most 8,000 characters), in every mode. `deny` and `ask` rules still apply.
- Context warning at `Stop`, when the context grew `threshold_tokens` over the session start.
- Config in one JSON file, English and pt-BR messages, no network calls.

Band (`synclabs-relay-band`, Claude Code only, optional)
- Banner and button that trigger the switch, an automatic mode (off by default) with a 15 s countdown, and the `/handoff` command (`auto`, `button`, `threshold`). The button sends `handoff` to the prompt and depends on the core for writing and delivery. Cancel empties the marker and withdraws the request. The success toast is "Handoff saved; new session opened.", which does not claim delivery.

Changed from the earlier local setup
- `/passagem` no longer exists as a command. Typing the word `passagem` still works, with or without `/`. The command is now `/handoff`, registered by the band.

Tests: 76 for the core, 161 for the band.

Not yet confirmed (see the README, Known limits)
- On Codex: that the lock and the context warning work in a real TUI session after you approve the hooks in `/hooks`, and that `handoff` followed by `/new` delivers the file.
- Installing from the GitHub repository. Installing from a local clone was run on Claude Code 2.1.329 and Codex 0.170.0.
