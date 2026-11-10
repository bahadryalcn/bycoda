# Conditional owner decisions

## Native storage compatibility

Apply when changing native canonical migration or owned OpenCode services.
Recorded 2026-11-05 from owner messages in audit Codex thread
`01a1a5a6-d0a0-72d3-9776-38e8b3800c5c`; original message timestamps unavailable.

> then we have no such problem; everyone updates and nobody uses the old version (translated)

Mixed old/new application versions writing the same profile are unsupported after
migration. This does not authorize data deletion, installation or process stops.

> No; I do not use OpenCode, or I only use it from inside Bycoda (translated)

External OpenCode CLI/web use of the same conversation concurrently with Bycoda
is outside this migration's compatibility scope. Preserve provider history,
configuration and authentication; never adopt or stop unrelated external daemons.

## Bundled Host update with running work

Apply when changing how the desktop updates an existing local Host.
Recorded 2026-11-10 from the owner's message in T3 thread
`9ef17bc9-3ac0-46f1-b2ff-fa7d75cb340d`.

> while updating, it should ask "a Host is running, shall I close it?" and close it
> if needed; an update must not work like this (translated)

Unattended maintenance still never interrupts an existing Host. The owner may confirm
the interruption in Settings → Connections; only that confirmation admits replacing a
Host that has running sessions or shells. It grants no other install or stop authority.

> when the app and Host are not the same version, warn the user and have the Host
> force-closed and updated; they must carry the same version (translated)

A version difference prompts the owner app-wide rather than only in Settings. The stop
still follows the owner's confirmation in that prompt.
