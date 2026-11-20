# Sync_Relay core (synclabs-relay)

The core plugin, for Claude Code and Codex: keeps the main session delegating, hands a session over to a fresh one, and warns at the switch point.

```sh
claude plugin marketplace add Sync-Labs-team/Sync_Relay
claude plugin install synclabs-relay@synclabs-relay
```

Codex (not tested in a real session):

```sh
codex plugin marketplace add Sync-Labs-team/Sync_Relay
codex plugin add synclabs-relay@synclabs-relay
```

Needs Python 3.9 or newer as `python3`. Codex runs the hooks only after you approve them with `/hooks`.

Type `relay` (the whole message) to write the handoff, then `/clear` (Codex: `/new`). With the optional band you get `/relay`, `/relay auto`, `/relay button` and `/relay status`.

On Claude Code the core pre-approves one `Write`: the session's own handoff file, under strict conditions. Your `deny` and `ask` rules still apply.

Everything else is in the [repository README](../../README.md) ([pt-BR](../../README.pt-BR.md), [es](../../README.es.md)) and in [docs/](../../docs).
