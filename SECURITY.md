# Security

Sync_Relay makes no network calls: the hooks and the script read local files and write only to the handoff folder (see "Privacy" in the README).

Report a vulnerability privately to the Sync_Labs team through the repository's security advisories. Please do not open a public issue for it.

In scope: a way around the lock that the README does not list as a known limit, a write outside the handoff folder, a handoff delivered to the wrong session or user, a hook that crashes or blocks a session. Out of scope: turning the lock off on purpose (`SYNCLABS_RELAY_MODE`, config). The lock keeps the model on task; it is not a sandbox.

Known surface: on Claude Code the core answers `PreToolUse` with `permissionDecision: "allow"` for one call, the `Write` of the session's own handoff file. It requires the main session, a valid `CLAUDE_PID`, a `_req-<PID>.txt` marker at most 10 minutes old, a path equal to `<folder>/<name in the marker>` with no `..` and no NTFS alternate stream, a safe folder, a target that is not a link, and at most 8,000 characters of content. It applies in every mode, `off` included. The user's `deny` and `ask` rules still apply. A way to make that pre-approval cover any other write is in scope.

Supported: the latest release.
