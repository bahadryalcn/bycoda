---
name: feature-mobile
description: "Use when changing mobile pairing, routes and workspace screens. Not for Host execution; see feature-host-runtime."
---

# Mobile

The mobile app is a separate nested repository under mobile/. Inspect its own rules, Git state and dependency links before work. This skill routes platform-wide changes; use the specific domain skill for task, Inbox, settings, voice or Host semantics.

## Source starts

- `mobile/AGENTS.md`
- `mobile/app/`
- `mobile/src/features/workspace/`
- `mobile/src/remote/host-transport.ts`, `mobile/src/remote/ws-connection.ts`
- `mobile/src/state/host-runtime.ts`, `mobile/src/state/queries.ts`

## Workflow

1. Inspect both parent and nested Git identities when a change crosses Host/mobile. Establish the active adapter and capability instead of assuming desktop RPC parity.
2. Enumerate affected Expo routes/layouts, shared PanelUI consumers, state/persistence, exact RPC producers and locale families using the surface map.
3. Implement through existing platform facades and authenticated Host operations. Preserve private visibility, captured target, uncertain delivery and reconnect state.
4. Exercise the changed flow with keyboard/safe areas, one scroll owner, long content, back navigation and pending/error/retry. Verify nested source separately from parent changes.

## Preserve

- Keep project/session/Host identity, pairing credentials and permission gates under existing owners. Phone attachment does not move execution or history authority.
- Preserve drafts, selection, model/settings choices, restored navigation and held uncertain sends. Reconnect does not authorize replay.
- Use mobile PanelUI/shared controls, platform safe-area and keyboard handling; do not invoke Tauri commands from Expo.
- Keep compact workspace changes scoped to the requested Projects, global Sessions, project Sessions and chat surfaces. Reuse row previews and full accessible labels, retain 48dp targets and virtualized lists, and keep all actions, drafts and recovery available. This scope does not authorize redesigning unrelated screens.
- Global and project Sessions share `session-list-row.tsx`; keep project/status, title, branch and provider identity consistent. Idle is Ready, not proof of completed work. Never derive execution duration from creation/update timestamps; keep missing timing data explicitly unavailable.
- Session row swipe and overflow expose the same Archive/Unarchive, Delete and Details actions. A swipe only reveals controls. Retain explicit deletion confirmation, single-flight writes, the reviewed connection epoch, project visibility and displayed session authority/revision checks before and after preflight. Preserve unknown-result holds; metadata/delete RPCs do not inherit command receipt or automatic retry semantics.
- Project Sessions owns its directory and session-read feedback together. Group only matching transient network/timeout failures for the same computer, with recovery for both reads; preserve distinct auth, identity and uncertain failures and their original actions.
- Keep WebSocket RPC rejection separate from malformed protocol data. Preserve the app-scoped reconnect owner, capability validation and blocked recovery; schema incompatibility must not become a silent network retry loop.
- Approval replies retain original occurrence/request identities and capability checks across active/compatibility transports; never mint identity on retry.
- Mobile PTY close errors retain the current lease until exact native process exit is confirmed. Keep process exit, output drain, replay gaps and unknown input distinct; old expired request IDs never start another effect within that runtime.
- Native preview/sandbox/device effects require their own contracts and device checks. Unsupported inline visuals retain ordinary tool/source fallback.
- Backgrounding keeps Host sockets for a five-minute grace owned by the app runtime; the grace compares wall-clock time on return because the OS may freeze timers. App lock closes sockets immediately and never inherits the grace.
- A computer may keep several paired routes (local network, Tailscale). Pairing again adds a route; route selection only switches the active saved route, prefers the local network, and never replays in-flight work. The paired local WSS bootstrap applies only on the local-network route.
- Host compatibility is the shared protocol version, not the provider or capability list. Unknown providers are dropped from the offer, never fatal; a version mismatch names the side to update. Additive Host changes must not bump the version.

## Focused checks

- Use packageManager-pinned pnpm in mobile/; normal pnpm typecheck uses tsc-rs, with pnpm typecheck:fast only when explicitly chosen. Select affected existing mobile tests.
- Run available simulator/device and live-Host checks appropriate to the change; report them separately from source, fixture, APK/IPA packaging, installed and released evidence.

## References

- Read the [surface map](references/surfaces.md) for the affected UI, state, transport and test owners.
- [Host platform contracts](../../../docs/reference/host-runtime.md) when changing the linked contract.
- [Execution identity](../../../docs/reference/managed-workspaces.md) when changing the linked contract.
