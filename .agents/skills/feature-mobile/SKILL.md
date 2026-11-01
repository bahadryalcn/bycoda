---
name: feature-mobile
description: "Change the bycoda mobile app, pairing, projects/sessions, management, Host tools or a desktop/Host contract consumed by phones."
---

# Mobile

The mobile app is a separate nested repository under mobile/. Inspect its own rules, Git state and dependency links before work. This skill routes platform-wide changes; use the specific domain skill for task, Inbox, settings, voice or Host semantics.

## Source entry points

Code paths below are repository-root relative.

- `mobile/AGENTS.md`
- `mobile/app/`
- `mobile/src/features/workspace/`

## Workflow

1. Inspect both parent and nested Git identities when a change crosses Host/mobile. Establish the active adapter and capability instead of assuming desktop RPC parity.
2. Enumerate affected Expo routes/layouts, shared PanelUI consumers, state/persistence, exact RPC producers and locale families using the surface map.
3. Implement through existing platform facades and authenticated Host operations. Preserve private visibility, captured target, uncertain delivery and reconnect state.
4. Exercise the changed flow with keyboard/safe areas, one scroll owner, long content, back navigation and pending/error/retry. Verify nested source separately from parent changes.

## Preserve

- Keep project/session/Host identity, pairing credentials and permission gates under existing owners. Phone attachment does not move execution or history authority.
- Preserve drafts, selection, model/settings choices, restored navigation and held uncertain sends. Reconnect does not authorize replay.
- Use mobile PanelUI/shared controls, platform safe-area and keyboard handling; do not invoke Tauri commands from Expo.
- Approval replies retain original occurrence/request identities and capability checks across active/compatibility transports; never mint identity on retry.
- Native preview/sandbox/device effects require their own contracts and device checks. Unsupported inline visuals retain ordinary tool/source fallback.

## Verification and references

- Use packageManager-pinned pnpm in mobile/; normal pnpm typecheck uses tsc-rs, with pnpm typecheck:fast only when explicitly chosen. Select affected existing mobile tests.
- Run available simulator/device and live-Host checks appropriate to the change; report them separately from source, fixture, APK/IPA packaging, installed and released evidence.
- Read the [surface map](references/surfaces.md) for the affected UI, state, transport and test owners. Re-search current callers before broad changes.
- [Host platform contracts](../../../docs/reference/host-runtime.md)
- [Execution identity](../../../docs/reference/managed-workspaces.md)
