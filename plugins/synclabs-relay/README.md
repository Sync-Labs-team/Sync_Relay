# Sync_Relay (synclabs-relay)

The core plugin of Sync_Relay by Sync_Labs, for Claude Code and Codex: keeps the main session delegating, hands a session over to a fresh one, warns when the context grows.

Install in Claude Code:

```
/plugin install synclabs-relay --marketplace Sync-Labs-team/Sync_Relay
```

Install in Codex:

```
codex plugin marketplace add Sync-Labs-team/Sync_Relay
codex plugin add synclabs-relay@synclabs-relay
```

Codex support is untested in v0.1.0: the plugin installs and its hook was checked without a model, but it was not tested in a real Codex session. Tests are planned for the next version.

Codex runs the hooks only after you approve them with `/hooks`. Requires Python 3.9 or newer as `python3`.

On Claude Code the core pre-approves one `Write`: the session's own handoff file, under strict conditions. Your `deny` and `ask` rules still apply. See "Permission for the handoff write" in the repository README.

Configuration, privacy, limits and the optional band are in the [repository README](../../README.md) ([pt-BR](../../README.pt-BR.md)).
