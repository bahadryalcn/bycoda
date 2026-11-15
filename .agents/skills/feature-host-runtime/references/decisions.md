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
Recorded 2026-11-10 from the owner's message in session
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

## Free rotating Host access

Recorded 2026-11-15 from the owner's machine-discovery implementation brief.

> free Quick Tunnel whose URL changes on every start; logged-in devices learn the new URL from the account automatically. Cost must stay 0.

Automatic public Host access is opt-in and defaults off. Reuse guardian ownership;
unknown retirement never grants replacement authority. Publish credential-free
routes through the existing desktop account publisher. Native route learning
requires the same environmentId over HTTPS before any device credential is sent.
Managed/named tunnels and paid infrastructure remain outside this contract.

## Machine discovery and account pairing

Recorded 2026-11-15 from owner decisions on the machine-discovery plan.

> manuel ekleme özelliğinide bırakalım bunu kapalı gösteririz otomatik taramayıda sunucu üzerinden yaparız

> her seferinde farklı cloudflare adresi olsa ücretisz olsa giriş yapanların adresleri telefondan girince güncellense

Manual add stays but is collapsed under "Advanced" by default. Automatic discovery
comes from the account server first, with Tailscale and ssh-config candidates as
secondary sources; discovery never sends credentials and only proposes. Changing
free Quick Tunnel URLs are published to the account, so signed-in devices follow them
without manual entry. Account pairing requires the other computer to allow it and to
show the matching six-digit code; the account only relays sealed data.
