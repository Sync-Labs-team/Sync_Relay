# FAQ

## The hooks are slow on Windows. Why, and how do I fix it?

The hooks call `python3`. On Windows that name is often the Microsoft Store shortcut, which adds start-up time to every call. Measured: a median of 196 ms per `PreToolUse` call with the shortcut, and 115.6 ms against 25.5 ms for the interpreter alone with real Python from python.org. Install Python 3.9 or newer from python.org and make sure `python3` on the PATH resolves to it, not to the shortcut. Check with `python3 --version` and `where python3`. On Windows, Claude Code runs the hooks through Git Bash.

If there is no `python3` at all, the hooks fail on every event with a non-blocking error and the plugin does nothing. The CLI keeps working (the hooks fail open).

## Why is the command `/relay`?

`/relay` is the band's command: it exists only on Claude Code with the band installed, and it carries the plugin's name so it does not clash with the commands you already have. Without the band, and on Codex, type the word `relay` as the whole message: it does the same (then `/clear` on Claude Code or `/new` on Codex).

## Does it work on Codex?

The plugin installs on Codex 0.170.0 and its hook was run directly, without a model, and denied a tool as expected. It was not tested in a real Codex session: the lock, the context warning and the handoff have not been seen working there. Codex also skips a plugin hook until you approve it: open the TUI, run `/hooks` and approve the Sync_Relay hooks. Until then nothing happens, and in `codex exec` the hooks are skipped silently.

## How do I turn it off?

- One session: start the CLI with `SYNCLABS_RELAY_MODE=off`.
- For good: `"mode": "off"` (or `"remind"`) in the config file.
- Remove it. Claude Code: `claude plugin uninstall synclabs-relay@synclabs-relay`. Codex: `codex plugin remove synclabs-relay@synclabs-relay`.

If you installed the band, remove or disable the band first (`claude plugin uninstall synclabs-relay-band@synclabs-relay`), then the core. The band depends on the core, so the core command fails with "still required by synclabs-relay-band" otherwise.

## How do I upgrade from 0.1.0?

Update both plugins. What changed for you is in [CHANGELOG.md](../CHANGELOG.md), section "Upgrading from 0.1.0": `/handoff`, `handoff` and `passagem` stop working (use the word `relay`, or `/relay` if you have the band), and the old `threshold`, `limiar`, `botao` and `padrao` subcommands are gone (`/relay button` still exists).

## A tool was denied in my main session. Is that a bug?

No. The main session only orchestrates, and the denial text says so. Ask the model to delegate, add the tool to `allowed_tools` if you want it always allowed, or set `mode` to `remind`.

## Where do my handoffs live, and can I delete them?

In a folder under your user profile ([configuration.md](configuration.md) has the path). You can delete the files; the plugin removes its own old ones after 7 days. Nothing goes to your repository.

## How do I ask something or report a problem?

Open an issue with the form that fits. See [CONTRIBUTING.md](../CONTRIBUTING.md).
