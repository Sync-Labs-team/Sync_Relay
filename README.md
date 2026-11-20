# Sync_Relay by Sync_Labs

[Português (pt-BR)](README.pt-BR.md)

Sync_Relay is a plugin for Claude Code and Codex. It does three things:

1. It keeps the main interactive session from doing tool work itself. Reads, searches, shell commands, writes, web and MCP calls go to a subagent, picked from a delegation table you can edit. Subagents and automation (`claude -p`, `codex exec`) are never blocked.
2. It hands a session over. Type `handoff` (or `passagem`): the model writes the state of the work to a file, and the next session in the same directory, in either CLI, starts with that file.
3. It warns you when the context has grown past a limit, so you know it is time to hand over.

Everything runs locally. The plugin makes no network calls. License: MIT.

There are two plugins in this repository:

| Plugin | CLI | What it is |
|---|---|---|
| `synclabs-relay` | Claude Code, Codex | The core: hooks, delegation table, handoff, context warning. |
| `synclabs-relay-band` | Claude Code only | Optional. A button and a `/handoff` command that trigger the switch for you. It needs the core. |

## Requirements

- Python 3.9 or newer, reachable as `python3` on the PATH. The hooks call `python3` and nothing else.
- Claude Code 2.1.323 or newer. Tested on 2.1.328 and 2.1.329.
- Codex CLI. Tested on 0.170.0.
- Tests ran on Windows. macOS and Linux were not tested.

On Windows, Claude Code runs the hooks through Git Bash. Older python.org installers do not create `python3`; without it the hooks fail on every event with a non-blocking error and the plugin does nothing. The Microsoft Store alias answers to `python3`. The hooks fail open: with no Python, the CLI keeps working.

## Install

Claude Code:

```
claude plugin marketplace add Sync-Labs-team/Sync_Relay
claude plugin install synclabs-relay@synclabs-relay
```

The one-step form also works: `claude plugin install synclabs-relay --marketplace Sync-Labs-team/Sync_Relay`.

For the optional band (Claude Code only):

```
claude plugin install synclabs-relay-band@synclabs-relay
```

The band declares the core as a dependency, and Claude Code refuses to disable the core while the band is installed. The band uses the Claude Code mods API, which is in early access and can change.

Codex:

```
codex plugin marketplace add Sync-Labs-team/Sync_Relay
codex plugin add synclabs-relay@synclabs-relay
codex plugin list
```

`codex plugin list` should show `synclabs-relay@synclabs-relay` as `installed, enabled`.

To install from a local clone, pass the folder instead of `Sync-Labs-team/Sync_Relay` in the `marketplace add` commands. The `--marketplace` one-step form takes a folder too.

### Approve the hooks in Codex

Codex skips a plugin hook until you trust it. Open the Codex TUI and run `/hooks`, then approve the Sync_Relay hooks. Until you do, nothing happens, and in `codex exec` the hooks are skipped with no message, so silence means an unapproved hook. Every time the hook definition changes, Codex asks again. For that reason the hook files in this plugin are fixed and the logic lives in the script.

Claude Code needs no approval step.

## How it works

### The lock

On `PreToolUse`, the main interactive session is denied any tool that is not on the free list. The free list holds the orchestration tools: `Agent`, `SendMessage`, `AskUserQuestion`, `ToolSearch`, `Skill`, the task tools, plan mode, and on Codex `spawn_agent`, `wait`, `send_input`, `update_plan` and similar. Add more with `allowed_tools`.

What counts as the main interactive session:

- Claude Code: the process was not started by `claude -p` or the SDK (`CLAUDE_CODE_ENTRYPOINT` does not start with `sdk`), and the call carries no `agent_id`.
- Codex: the rollout header names an interactive originator (`codex-tui`, `codex_work_desktop` by default; change with `codex_interactive_originators`) and the session is not a subagent.

If the plugin cannot tell, it does not block. It prints one message per session and carries on (fail open).

The denial text says how to turn the lock off.

### The delegation table

When a main session starts, resumes, clears or compacts, the plugin injects a table of five layers, rendered from the config: look up, technical judgment, build, hard debugging, plan. Each layer names the agent type, model and effort per CLI. With `"model": null` no model is passed and the subagent inherits the session's. Defaults:

| Layer | Claude Code | Codex |
|---|---|---|
| `lookup` | `Explore`, haiku, low | `explorer`, low |
| `judgment` | `general-purpose`, sonnet, medium | `explorer`, medium |
| `build` | `general-purpose`, sonnet, medium | `worker`, medium |
| `hard` | `general-purpose`, opus, high | `worker`, high |
| `plan` | `general-purpose`, opus, xhigh | `worker`, high |

The table also asks subagents for a short report. When a subagent's final report is longer than `report_max_chars` (4000), the `SubagentStop` hook sends it back once and asks for a shorter one. Set `report_max_chars` to `0` to turn both off. A short reminder is added to each message you send.

### Handoff

1. Type `handoff` or `passagem` (with or without a leading `/`) in the prompt.
2. The hook tells the model to wait until no agent is running and then write the state to a Markdown file of at most 8,000 characters, in your language: your request, state, decisions, where everything is, numbered next steps, risks. On Claude Code the model writes it itself, and the core pre-approves that one `Write` (see Permission for the handoff write, below). On Codex it delegates the write to a subagent that inherits the context.
3. The model replies `handoff ready`. Start the new session: `/clear` in Claude Code, `/new` in Codex.
4. The `SessionStart` hook of the new session puts the file in its context.

The core is the only part that delivers the handoff, in both CLIs. Which file a session takes:

- Claude Code after `/clear`: the file named in the marker `_req-<PID>.txt` of this same process (`<PID>` is `CLAUDE_PID`), otherwise the one Codex wrote for the same directory. The marker holds a file name, `<slug of the cwd>-<8hex>.md`. An empty marker means the switch was canceled (the band writes it when you press Cancel). With an empty marker or an invalid name, nothing is delivered by PID and the fallback below does not run.
- Claude Code after `/clear`, with no `CLAUDE_PID`: the only `<slug>-<8hex>.md` of the directory that is under 30 minutes old. With two or more, nothing is delivered.
- A new Claude Code window: only a Codex handoff for the same directory.
- Codex: the newest handoff for the same directory, including those written by Claude Code (see Known limits).
- A handoff older than 30 minutes is ignored. Each file is taken once. If an error happens after a session took a file and before the text is printed, the file is renamed back, so it is not lost.
- Text over 9,000 characters is cut, with a note and the file path. Claude Code turns anything over 10,000 characters of hook context into a path and a short preview, so the whole context stays under 9,000 characters. The handoff goes in first and is never cut for anything else. The routing table gets what is left: if it does not fit it is cut and ends with a one-line note, and if there is no room even for the note it is left out.

Where the files live, by default:

- Windows: `%LOCALAPPDATA%\synclabs-relay\handoffs`
- macOS and Linux: `$XDG_STATE_HOME/synclabs-relay/handoffs`, or `~/.local/state/synclabs-relay/handoffs`

File names are `<readable part>-<h8>`, plus `-<first 8 characters of the session id>` on Claude Code. The readable part is the working directory in lowercase with every run of other characters turned into `-`, the last 60 characters. `h8` is the FNV-1a 32-bit hash (8 lowercase hex digits) of the UTF-8 bytes of the directory, so `my_app`, `my-app` and `My App` get different files. On Windows the directory is lowercased, `/` becomes `\`, and a trailing separator is dropped before hashing. Example: `/home/alice/app` becomes `home-alice-app-a172203a.md` on Codex.

### Permission for the handoff write

On Claude Code, the core pre-approves (`permissionDecision: "allow"`) one tool call: the `Write` of the session's own handoff file. All of these must hold:

- the main session, not a subagent;
- a valid `CLAUDE_PID`, and a `_req-<PID>.txt` marker that is at most 10 minutes old;
- the path equals `<folder>/<name in the marker>`, with no `..` and no NTFS alternate stream (`:`);
- the handoff folder is safe, and the target is not a link;
- the content is at most 8,000 characters.

It applies in every mode, `off` included. Your `deny` and `ask` rules still apply: the Claude Code documentation says "Deny and ask rules are still evaluated regardless of what the hook returns". For any other write, the normal permission flow decides. If `CLAUDE_PID` is missing, or the working directory changes before the `Write`, Claude Code may ask you to confirm it.

### Context warning

At the end of a turn (`Stop`), if the context has grown by `threshold_tokens` (150,000 by default) over where the session started, a message tells you to type `handoff`. The count is growth over the session's own start, not an absolute size. On Claude Code the plugin sums the input, cache creation and cache read tokens of the last main-session response. On Codex it uses the last token count in the rollout. Set `stop_warning` to `false` on Claude Code if the band is installed, since the band shows its own banner.

The measurements behind 150,000 are in the next section.

## Configuration

One file for both CLIs. The plugin looks for it here, first match wins:

1. the path in `SYNCLABS_RELAY_CONFIG`
2. `$XDG_CONFIG_HOME/synclabs-relay/config.json`
3. Windows: `%APPDATA%\synclabs-relay\config.json`
4. `~/.config/synclabs-relay/config.json`

A missing file, invalid JSON, a wrong type or an unknown key is ignored and the default applies, with no error. A UTF-8 BOM is fine. Your values override the defaults key by key; inside `routing`, layer by layer and CLI by CLI.

| Key | Default | What it does |
|---|---|---|
| `mode` | `"enforce"` | `enforce` denies work tools in the main session. `remind` only reminds. `off` turns off the lock and the reminders; handoff still works. |
| `lang` | `"auto"` | `auto`, `en` or `pt-BR`. Case does not matter: `pt`, `pt-BR`, `pt_BR` and `pt-*` mean pt-BR; `en`, `en-*` and `en_*` mean English. `SYNCLABS_RELAY_LANG` wins only when it is one of these; anything else falls to the next source. `auto` reads `LC_ALL`, `LC_MESSAGES`, `LANG`, then the system locale (the band reads only the system locale): `pt` is pt-BR, everything else is English. |
| `threshold_tokens` | `150000` | Growth over the session start that triggers the warning. Must be above 0. The band accepts 5,000 to 900,000. |
| `stop_warning` | `true` | The Claude Code `Stop` warning. |
| `report_max_chars` | `4000` | Longest subagent report; `0` turns the limit off. |
| `handoff_dir` | `""` | Absolute folder for handoffs. Empty means the default above. `~` at the start means your home folder. Windows needs a drive (`C:\` or `C:/`) or a network path (`\\server\share`); macOS and Linux need a leading `/`. A relative path, a path with a `..` segment, or a folder the plugin cannot use falls back to the default. The core and the band apply the same rule. On macOS and Linux, the plugin does not change the permissions of a folder you configure; protecting it is up to you. |
| `allowed_tools` | `[]` | Extra tools the main session may use, for example `"mcp__server__tool"`. Added to the built-in list. |
| `codex_interactive_originators` | `["codex-tui", "codex_work_desktop"]` | Codex originators counted as interactive. |
| `routing` | see the table above | `routing.<layer>.<claude or codex>` with `agent`, `model`, `effort`. |

Environment variables, which win over the file:

| Variable | Values |
|---|---|
| `SYNCLABS_RELAY_MODE` | `off`, `remind`, `enforce`, `force`. `force` treats every session as interactive. For testing. |
| `SYNCLABS_RELAY_LANG` | `auto`, `en`, `pt-BR` |
| `SYNCLABS_RELAY_CONFIG` | path of another config file |

Example, with a fictional user:

```json
{
  "lang": "en",
  "threshold_tokens": 120000,
  "stop_warning": false,
  "allowed_tools": ["mcp__notes__search"],
  "routing": {
    "build": {
      "claude": { "agent": "general-purpose", "model": "haiku", "effort": "medium" },
      "codex": { "agent": "worker", "model": "my-model-id", "effort": "medium" }
    }
  }
}
```

Saved as `C:\Users\alice\AppData\Roaming\synclabs-relay\config.json` on Windows or `~/.config/synclabs-relay/config.json` elsewhere. Model ids on the Codex side are yours; the plugin ships none.

### The band

Install `synclabs-relay-band` and a banner appears when the limit is reached, with a Switch session button. The switch waits for the main session to be idle and for no agent to be running, asks for the handoff, then runs `/clear`. The new session gets the handoff from the core. When it is done the band shows "Handoff saved; new session opened." It does not say the handoff was delivered: the core does that, and only if the files match (see Handoff). Cancel withdraws the request: the band empties the marker, so nothing is delivered by PID.

- `/handoff`: switch now.
- `/handoff auto`: turn the automatic mode on or off. Off by default. When on, it switches by itself after a 15 s countdown that you can cancel.
- `/handoff button`: hide or show the button above the input.
- `/handoff threshold [Nk|default]`: show or set the limit.

The band reads `threshold_tokens`, `lang` and `handoff_dir` from the same config file. For one session, `SYNCLABS_RELAY_BAND_THRESHOLD` and `SYNCLABS_RELAY_BAND_AUTO` (`1` or `0`) override them.

## Turning it off

- One session: start the CLI with `SYNCLABS_RELAY_MODE=off`.
- For good: set `"mode": "off"` (or `"remind"`) in the config file.
- Claude Code: `claude plugin disable synclabs-relay@synclabs-relay`, and `claude plugin uninstall synclabs-relay@synclabs-relay` to remove it.
- Codex: `codex plugin remove synclabs-relay@synclabs-relay`.
- With the band installed, turn off or remove the band first (`claude plugin disable synclabs-relay-band@synclabs-relay` or `claude plugin uninstall synclabs-relay-band@synclabs-relay`), then the core. Otherwise the core command fails with "still required by synclabs-relay-band".

If your Claude Code version stops sending `agent_id` to subagents, every subagent would be denied. Set `SYNCLABS_RELAY_MODE=off` until the plugin is updated.

## Privacy

- No network calls, in any hook or script.
- The hooks read the transcript (Claude Code) or the rollout (Codex) of the current session. They look only at token counts and, on Codex, at `originator` and `source` in the first line. They never print or store the rest of the header.
- The handoff file holds what the model wrote about your work, which may include client or project details. It stays in a folder under your own user profile, never in your repository. On macOS and Linux the plugin keeps the default folder at mode `0700` (it creates it that way and tightens an existing one that you own). A folder you set in `handoff_dir` keeps the permissions it has, so protect it yourself. In both cases the plugin refuses a folder that is a symlink or belongs to another user.
- A handoff a session has taken is renamed to `*.usada.md`.
- Files older than 7 days are deleted when a session starts, only files with names the plugin writes. In any folder, default or configured: `_req-N.txt`, `_detect-*.flag` and `_trace-<8hex>.md`. Only in the default folder: the handoff `.md` files (`<slug>[-<8hex>].md` and `.usada.md`). A folder you set with `handoff_dir` never loses a note of yours.
- The band keeps a small trace file per session in the handoff folder (`_trace-<id8>.md`: events and timing, the last 200 lines, never the handoff text).

## Does the switch pay off?

The one measurement we ran is below. The savings figures that follow it are estimates.

Measured (Claude Code 2.1.328, `claude -p`, 7 runs, haiku and opus): a new session does not start from zero. A prefix of about 70,000 tokens (system prompt, tools, CLAUDE.md, memory) came mostly from cache, but irregularly: between 0 and about 68,000 tokens were written to cache on the first message. The write was 0 tokens in 2 of the 7 runs, about 31,000 in 2 (30,920 and 31,399) and between 48,000 and 68,000 in the other 3. We did not find out why it varies.

Estimated, on assumed prices (cache read 0.1x, cache write 1 hour 2x, output 5x; we did not check them against the price list): with the switch at 150,000 tokens, the cost of the handoff and of opening the new session is paid back in about 10 turns when the cache is warm and about 27 when it is cold. At a 100,000 limit the same estimate gives about 24 to about 70 turns, which is why the default is 150,000 and why we do not recommend a limit under about 100,000. The estimate does not count the other reason to hand over, which is that very long contexts get worse; we did not measure that.

Hook cost, measured: 50 `PreToolUse` calls through Git Bash on Windows, with `python3` being Python 3.14 (the shortcut the hooks call), took a median of 196 ms and a 90th percentile of 225 ms each. Other systems and Python versions were not measured.

## Known limits

- The lock depends on signals the CLIs do not document: `CLAUDE_CODE_ENTRYPOINT`, `agent_id` in the Claude Code `PreToolUse` input, and `originator` and `source` in the Codex rollout. A CLI update can change them. If the plugin cannot read the signal it turns the lock off for that session and says so once. If `agent_id` disappears, subagents get denied; see Turning it off.
- Codex runs plugin hooks only after you approve them in `/hooks`. Unapproved hooks fail silently.
- On Codex the lock and the context warning were not tested in a real session yet. See the changelog. The Codex hook command reads `PLUGIN_ROOT`, the variable a Codex 0.170 plugin hook was measured to receive, and falls back to `CLAUDE_PLUGIN_ROOT`; a real session has not confirmed it yet.
- The handoff write sits outside your project folder. On Claude Code the core pre-approves it under the conditions in Permission for the handoff write. If `CLAUDE_PID` is missing or the working directory changes before the `Write`, Claude Code may ask you to confirm. Your `deny` and `ask` rules still win.
- Claude Code handoffs in a directory can be read by Codex for 30 minutes. A Codex session opened in the same directory between the write and the `/clear` takes the handoff.
- Without `CLAUDE_PID`, `/clear` delivers only when exactly one fresh handoff of the directory exists.
- A session start receives at most 9,000 characters of context: a handoff that long is cut, and the routing table may be cut or left out.
- A `handoff_dir` that passes the rule but cannot be used, such as a link or a junction, is not noticed by the band: the core falls back to the default folder and the two look at different folders. Use a plain folder of your own.
- The band depends on the early-access mods API.
- Only Windows was tested.
- Other tools do similar things. We have not run any of them, so there is no comparison here.

## Tests

The core has 76 tests (one is skipped on Windows because it checks POSIX folder modes) and the band 161.

```
python -I tests/test_core.py
claude plugin test plugins/synclabs-relay-band
claude plugin validate --strict plugins/synclabs-relay
```

## Security and releases

See [SECURITY.md](SECURITY.md). Release notes are in [CHANGELOG.md](CHANGELOG.md).
