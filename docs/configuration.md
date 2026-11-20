# Configuration

One JSON file for both CLIs. The plugin looks for it here, first match wins:

1. the path in `SYNCLABS_RELAY_CONFIG`
2. `$XDG_CONFIG_HOME/synclabs-relay/config.json`
3. Windows: `%APPDATA%\synclabs-relay\config.json`
4. `~/.config/synclabs-relay/config.json`

A missing file, invalid JSON, a wrong type or an unknown key is ignored and the default applies, with no error. A UTF-8 BOM is fine. Your values override the defaults key by key; inside `routing`, layer by layer and CLI by CLI.

## Keys

| Key | Default | What it does |
|---|---|---|
| `mode` | `"enforce"` | `enforce` denies work tools in the main session. `remind` only reminds. `off` turns off the lock and the reminders; the handoff still works. |
| `lang` | `"auto"` | `auto`, `en` or `pt-BR`. Case does not matter: `pt`, `pt-BR`, `pt_BR` and `pt-*` mean pt-BR; `en`, `en-*` and `en_*` mean English. `SYNCLABS_RELAY_LANG` wins only when it is one of these. `auto` reads `LC_ALL`, `LC_MESSAGES`, `LANG`, then the system locale (the band reads only the system locale): `pt` is pt-BR, everything else is English. |
| `threshold_tokens` | `150000` (when absent) | The `D` in the switch point rule (see [how-it-works.md](how-it-works.md)). Must be above 0. The band accepts 5,000 to 900,000. |
| `button` | `true` | Show the fixed button `Sync_Relay auto: on/off` (band). `/relay button` changes it and is remembered between sessions; the config value only counts while that choice is not stored. The status line is always shown. |
| `auto` | `false` (when absent) | Optional. Start with the automatic switch on (band). Without it, auto starts off. `/relay auto` is remembered between sessions and wins over this key; the config value only counts while nothing is stored. `SYNCLABS_RELAY_BAND_AUTO` (one session) wins over both. |
| `handoff_dir` | `""` | Absolute folder for handoffs. Empty means the default (below). `~` at the start means your home folder. Windows needs a drive (`C:\` or `C:/`) or a network path (`\\server\share`); macOS and Linux need a leading `/`. A relative path, a path with a `..` segment, or a folder the plugin cannot use falls back to the default. The core and the band apply the same rule. On macOS and Linux the plugin does not change the permissions of a folder you configure. |
| `stop_warning` | `true` | The Claude Code `Stop` warning. Set it to `false` if the band is installed, since the band shows its own status. |
| `report_max_chars` | `4000` | Longest subagent report. Longer ones are sent back once for a shorter version. `0` turns the limit off. |
| `allowed_tools` | `[]` | Extra tools the main session may use, for example `"mcp__server__tool"`. Added to the built-in list of orchestration tools. |
| `codex_interactive_originators` | `["codex-tui", "codex_work_desktop"]` | Codex originators counted as interactive sessions. |
| `routing` | see below | `routing.<layer>.<claude or codex>` with `agent`, `model`, `effort`. `"model": null` passes no model, so the subagent inherits the session's. |

Default folder for handoffs:

- Windows: `%LOCALAPPDATA%\synclabs-relay\handoffs`
- macOS and Linux: `$XDG_STATE_HOME/synclabs-relay/handoffs`, or `~/.local/state/synclabs-relay/handoffs`

## Delegation table

| Layer | Claude Code | Codex |
|---|---|---|
| `lookup` | `Explore`, haiku, low | `explorer`, low |
| `judgment` | `general-purpose`, sonnet, medium | `explorer`, medium |
| `build` | `general-purpose`, sonnet, medium | `worker`, medium |
| `hard` | `general-purpose`, opus, high | `worker`, high |
| `plan` | `general-purpose`, opus, xhigh | `worker`, high |

## Environment variables

They win over the file.

| Variable | Values |
|---|---|
| `SYNCLABS_RELAY_MODE` | `off`, `remind`, `enforce`, `force`. `force` treats every session as interactive; for testing. |
| `SYNCLABS_RELAY_LANG` | `auto`, `en`, `pt-BR` |
| `SYNCLABS_RELAY_CONFIG` | Path of another config file. |
| `SYNCLABS_RELAY_BAND_AUTO` | `1` or `0`. Band only, one session. |
| `SYNCLABS_RELAY_BAND_THRESHOLD` | `150k` or `150000`. Band only, one session. |

The switch point also reads, from Claude Code: `CLAUDE_CODE_AUTO_COMPACT_WINDOW`, `autoCompactWindow` in its settings, `CLAUDE_CODE_DISABLE_1M_CONTEXT` and `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`; from Codex: `model_auto_compact_token_limit` in `config.toml`.

## Example

A fictional user:

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
