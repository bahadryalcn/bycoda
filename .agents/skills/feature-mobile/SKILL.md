---
name: feature-mobile
description: "bycoda mobile feature map: phone pairing, LAN and private-network access, mobile project identity, PTY control, Jira mobile board and device preview. Read before changing phone access or mobile-facing Host contracts; records the missing mobile app source inventory blocker."
---

# Mobile

Purpose: connect a phone to the selected execution Host and preserve authenticated project/session controls across pairing, networking and recovery. Keywords: mobile, phone, Android, iOS, pairing, QR, LAN, Tailscale, private network, projects, sessions, terminal, PTY, Jira, preview, devices.

## Inventory and concurrency

Inventoried from the committed s0 contract baseline on 2026-10-26. Paths below exist in this worktree; implementation trees include their colocated tests and styles. Re-run the listed searches when the feature changes. This card records scope, not live ownership: consult host-authoritative feature claims for the canonical project and feature key before writing. If that capability is unavailable, report the coordination gap and agree a separate sub-scope; a tracked Active line is not a lock.

## Owner decisions

## Proposals

None recorded. Agent design suggestions belong here, separately from dated owner quotations.

## Surfaces

### Mobile app screens and source availability

No mobile directory is present in this committed worktree: `git ls-tree HEAD mobile` returns no entry and `rg --files` finds no mobile app tree. Although `.artifact` reserves a mobile location, that policy is not evidence of checked-in routes. Do not invent Expo/React Native screen names, mobile translation prefixes or tests. Obtain the maintained mobile source in an authorized checkout, enumerate every route/screen and add them here before claiming complete mobile app coverage.

### Desktop and shared mobile-facing modules

- `src/features/connections/model/phonePairingApi.ts`
- `src/features/connections/model/phonePairingContract.ts`
- `src/features/connections/model/phonePairingCoordinator.ts`
- `src/features/connections/model/phonePairingTypes.ts`
- `src/features/connections/model/sshMobileWorkspaceControl.ts`
- `src/features/connections/model/usePhonePairing.ts`
- `src/features/connections/ui/PhoneConnectionPanel.tsx`
- `src/features/connections/ui/PhonePairingDialog.tsx`
- `src/features/host-tools/mobilePtyTypes.ts`
- `src/features/inbox/model/jiraMobileBridge.ts`
- `src/features/projects/model/mobileProjectDirectory.ts`
- `src/features/projects/model/mobileProjectLogos.ts`
- `src/features/terminal/model/mobilePtyControl.ts`
- `src/integrations/mobile-access.ts`
- `src/integrations/mobile-lan.ts`
- `src/integrations/mobile-pairing.ts`

Pairing is presented by PhoneConnectionPanel and PhonePairingDialog through ConnectionsSettings; model coordinator/API/contracts/types handle machine identity, cancellation and status. Mobile project directory/logo modules, Jira mobile bridge and PTY control are separate surfaces even when no phone app code is available.

### Host services, RPC and tools

- `host/android-device-control.ts`
- `host/device-host.ts`
- `host/device-preview.ts`
- `host/device-process.ts`
- `host/engine.ts`
- `host/mobile-access-config.ts`
- `host/mobile-access-process.ts`
- `host/mobile-access.ts`
- `host/mobile-lan-crypto.ts`
- `host/mobile-lan.ts`
- `host/mobile-pairing.ts`
- `host/server.ts`

Dispatcher identifiers: `devices.preview.mobile.start`, `devices.preview.mobile.status`, `devices.preview.mobile.v1`, `mobile.access`, `mobile.access.disable`, `mobile.access.enable`, `mobile.access.status`, `mobile.pairing`, `mobile.pairing.cancel`, `mobile.pairing.create`, `mobile.pairing.status`. Native mobile-terminal methods in `src-tauri/src/mobile_pty.rs` use `ptyMobile.list`, `ptyMobile.create`, `ptyMobile.attach`, `ptyMobile.close`, `ptyMobile.read`, `ptyMobile.write`, `ptyMobile.resize`, `ptyMobile.status` and `ptyMobile.detach`; Host forwarding binds scope through `host/server.ts` and desktop controls in `src/app/workspace/control/useAppControlRequests.ts`. The exact mobile pairing routes and signed LAN request handling also live inside `host/mobile-pairing.ts`, `host/mobile-lan.ts` and `host/mobile-lan-crypto.ts`; private-network process/configuration state lives in the mobile-access modules. Device preview has mobile-scoped identity and ownership checks in `host/server.ts`. Conversation tools and session operations use the existing authenticated Host surfaces; phone access does not confer publication or credential-change authorization.

### Native bridges

- `src-tauri/src/conversation_tools_bridge.rs`
- `src-tauri/src/jira/mobile_board.rs`
- `src-tauri/src/lib.rs`
- `src-tauri/src/mobile_pty.rs`
- `src-tauri/src/remote.rs`
- `src-tauri/src/ssh_terminal.rs`

### Locale keys

Desktop catalogs: `src/shared/i18n/locales/`, `src/shared/i18n/en-overrides.json`, `src/shared/i18n/tr-overrides.json`; use exact English source messages, not a guessed mobile namespace. Observed component keys include `Connect your phone`, `Pairing target: {p0}. You can choose another computer in the pairing screen.`, `Connection method`, `Local network`, `Tailscale`, `Local network address`, `Copy pairing code`, `Pairing code copied`, `Opening the secure connection…` and `Creating your QR code…`; search their prefixes and exact text. Mobile-app locale files are unavailable on this baseline.

### Browser fixtures/specs

- `tests/browser/connections.e2e.ts`
- `tests/browser/device-panel.e2e.ts`
- `tests/browser/host-tools-mocks.ts`
- `tests/browser/host-tools.e2e.ts`
- `tests/browser/host-tools.html`
- `tests/browser/host-tools.tsx`
- `tests/browser/playwright.connections.config.ts`
- `tests/browser/playwright.device-panel.config.ts`
- `tests/browser/playwright.host-tools.config.ts`
- `tests/browser/playwright.settings.config.ts`
- `tests/browser/serve-host-tools.mjs`
- `tests/browser/serve-settings.mjs`
- `tests/browser/settings.html`
- `tests/browser/settings.tsx`
- `tests/browser/ssh-key-binding.spec.ts`
- `tests/browser/tools-workspace-resize.e2e.ts`
- `tests/browser/vite.connections.config.ts`
- `tests/browser/vite.host-tools.config.ts`
- `tests/browser/vite.settings.config.ts`

Connections config selects connections.e2e.ts through the settings fixture, with a connection-specific Vite port. Device-panel config selects device-panel.e2e.ts through the Host-tools fixture/server; related Host-tools specs/config are listed to make that shared fixture dependency explicit. The connection and device-panel scenarios exercise desktop transport/control surfaces; they are not tests of a mobile app screen. Colocated tests beside the inventoried API/coordinator/project/PTY/Jira modules and Host services cover additional contracts.

## Existing behavior to preserve

- Explicit machine/project identity, authenticated pairing tokens, QR/pairing expiry, cancellation, capability validation and connection recovery. Never log credentials, tokens or raw auth files.
- LAN and private-network modes remain distinct; disabling LAN does not silently change another mode. Unknown delivery remains held until authoritative reconciliation, rather than resending a mutation.
- Preserve phone-visible project identity separately from execution worktree cwd, SSH mobile controls, PTY ownership/queue semantics and device-preview lease/scope checks.
- Do not infer physical-device success from Host mocks, desktop screenshots, an APK filename or source compilation.

## Checks and visual acceptance

- Refresh with `rg --files src host src-tauri/src tests/browser` filtered for mobile, phone, pairing, device and PTY; separately inspect the actual mobile app tree once available.
- Run focused checks with `pnpm vitest run src/features/connections/model/phonePairingContract.test.ts src/features/connections/model/phonePairingCoordinator.test.ts src/features/connections/ui/PhoneConnectionPanel.test.ts src/features/projects/model/mobileProjectDirectory.test.ts src/features/terminal/model/mobilePtyControl.test.ts`; run changed Host services via `pnpm test:host -- host/mobile-pairing.test.ts host/mobile-access.test.ts host/mobile-lan.test.ts`. Use temporary network/service fixtures and fake project data.
- Exercise desktop phone settings/pairing at 1280 and 800 widths in light/dark; open saved screenshots from `temp/verification/<id>/`. Cover machine switching, unsupported older Host, LAN/private-network status, expired/cancelled pairing and retry without duplicate work.
- With mobile source and a test device available, enumerate and exercise each changed screen at native phone widths in both themes, keyboard shown/hidden, long content, reconnect, model/settings changes and state restoration. Report simulator, physical device, live Host, packaged and installed evidence separately. Check build identity before interpreting an owner screenshot.

## Known concrete blockers

The frozen branch does not contain the mobile app source, screen routes, mobile locale catalogs or mobile build/test manifest. Full app surface enumeration, mobile typechecking and physical-device acceptance cannot be completed from this worktree. The present card exhaustively inventories the mobile-facing modules found in the available desktop/Host/native source, without claiming missing screens were inspected.

## Evidence and handoff

Committed inventory baseline: `f26ac112404e326478adb687c23ca9cc032acfef`. See `docs/reference/managed-workspaces.md` for frozen contracts, not proof of runtime availability. Record subsequent delivered behavior with a commit reference and exercised evidence. This documentation change did not exercise product UI, a native app, a physical phone, a live Host, installation or release.

Inventory delivery: `4454ce32` on `bycoda/wt-model/s7` commits this code-backed
card and the worktree-first documentation. This reference establishes inventory
delivery only; product/runtime acceptance remains as described above.
