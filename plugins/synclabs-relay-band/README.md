# Sync_Relay band (synclabs-relay-band)

Optional, Claude Code only. A banner with a Switch session button, an automatic mode and a `/handoff` command. The band only triggers the switch; the handoff itself is written and delivered by the core plugin `synclabs-relay`, which this plugin depends on.

```
claude plugin install synclabs-relay-band@synclabs-relay
```

Uses the Claude Code mods API (early access, can change). If you install the band, set `"stop_warning": false` in the config so you do not get two warnings.

When the switch finishes the band shows "Handoff saved; new session opened." Cancel withdraws the request, and nothing is delivered by PID.

Commands: `/handoff` (switch now), `/handoff auto`, `/handoff button`, `/handoff threshold [Nk|default]`. Details in the [repository README](../../README.md) ([pt-BR](../../README.pt-BR.md)).
