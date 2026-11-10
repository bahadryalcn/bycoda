# Conversation tools surface map

Devices ownership: `host/devices/device-control-leases.ts`, `host/devices/device-inspection.ts`,
`host/devices/device-host.ts` and `host/devices/android-device-control.ts` own leases, fresh
inspection, stale-input admission and platform constraints. Follow
`host/domains/native-devices/`, `host/ports/native-devices.ts`,
`src/shared/model/host-contracts/native-devices.ts` and native remote dispatch for
HTTP/WebSocket/native delivery. UI preview hit testing lives in
`src/features/devices/deviceInspector.ts`; immutable screenshot receipts live in
`deviceImageTransfer.ts` beside it. `tests/browser/devices.e2e.ts` and
`playwright.devices.config.ts` cover UI fixtures, separately from live Host/native
and emulator or physical-device acceptance.

Paths are repository-root relative. Load the relevant domain below instead of treating all tools as one mutable service.

- Session presentation: `toolsSessionRegistry.ts`, `toolsHubTransport.ts` and
  `browserDraftTransfer.ts`, `toolsDraftTransfer.ts` and `toolsTransferLedger.ts`
  under `src/features/host-tools/` preserve canonical
  ownership, source revisions, targeted native acknowledgement and bounded drafts.
  `src/app/workspace/layout/useActiveTabContext.ts` supplies active chat metadata;
  `src/app/model/hostToolsWindowGeometry.ts` restores reachable monitor bounds.
  `src-tauri/src/window.rs` creates the fixed detached hub from the main window
  configuration; `src-tauri/src/lib.rs` exposes its native command.
- Browser Host scope: `host/browser/shared-browser.ts`, `host/browser/browser-annotation.ts` and
  `host/server.ts` own canonical session contexts, owner-presentation scopes,
  document/input receipts, exact capture references and ephemeral DOM geometry.
  `src/shared/lib/browserAnnotation.ts` is the shared annotation wire shape.

- Shell: `src/features/host-tools/SessionHostTools.tsx`, `ToolsWorkspace.tsx`, `HostToolsWindow.tsx`, `ConversationToolsButton.tsx`, `toolsUiControl.ts`, `toolPaneState.ts`, `host-tools.css`, `tools-workspace.css` (basenames share the host-tools directory).
- Target and transport: `src/features/connections/model/hostFeatureClient.ts`, `hostToolTarget.ts` in the same directory; follow authenticated Host domain services and `src-tauri/src/remote.rs` when transport changes.
- Browser: `src/features/host-tools/BrowserPanel.tsx`, `BrowserInspectorNavigation.tsx`, `BrowserAnnotationDetails.tsx`, `browserComposer.ts` and related browser annotation styles. Keep frame/control/annotation lease identity and capture recovery distinct from merely opening a browser.
- Devices: `src/features/devices/DevicePanel.tsx`, `deviceComposer.ts`, `deviceImageComposer.ts`, `types.ts` in that directory; header, options, setup and stage parts in `ui/`, the live video hook in `hooks/useDeviceLiveStream.ts` and the H.264 access-unit cutter in `model/h264.ts`. Discovery, boot/setup, preview, frame capture, the `devices.stream` video (still captures are its fallback) and device control have separate capability/failure states.
- Development servers: `src/features/host-tools/DevServersPanel.tsx` and `host/dev-servers/dev-servers.ts` own listener/process presentation and effects, runtime source association and intentional start/stop flow.
- Logs/resource/process UI: `src/features/host-tools/RuntimeLogsPanel.tsx`, `runtimeLogsModel.ts`, `DiagnosticsPanel.tsx` in that directory own logs, samples, resource usage and process review/export; `logsComposer.ts` preserves attachment insertion. Follow each action to its actual Host implementation rather than inventing a shared RPC.
- Mobile: inspect corresponding tools routes under `mobile/` and their active adapters. Source presence, simulator, physical-device and serving-Host evidence are separate.
- Tests: adjacent `SessionHostTools.test.ts`, `ToolsWorkspace.test.ts`, Browser/Device and changed domain tests; search `tests/browser/` for host-tools, browser-annotation, devices and tools-workspace fixtures/configs.
- Locales: search actual tool labels in `src/shared/i18n/locales/` and override catalogs, including computer/target, lease, annotation, process review, setup, unavailable and retry copy.
