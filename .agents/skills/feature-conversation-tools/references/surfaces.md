# Conversation tools surface map

Paths are repository-root relative. Load the relevant domain below instead of treating all tools as one mutable service.

- Shell: `src/features/host-tools/SessionHostTools.tsx`, `ToolsWorkspace.tsx`, `HostToolsWindow.tsx`, `ConversationToolsButton.tsx`, `toolsUiControl.ts`, `toolPaneState.ts`, `host-tools.css`, `tools-workspace.css` (basenames share the host-tools directory).
- Target and transport: `src/features/connections/model/hostFeatureClient.ts`, `hostToolTarget.ts` in the same directory; follow authenticated Host domain services and `src-tauri/src/remote.rs` when transport changes.
- Browser: `src/features/host-tools/BrowserPanel.tsx`, `BrowserAnnotationDetails.tsx`, `browserComposer.ts` and related browser annotation styles. Keep frame/control/annotation lease identity and capture recovery distinct from merely opening a browser.
- Devices: `src/features/devices/DevicePanel.tsx`, `deviceComposer.ts`, `deviceImageComposer.ts`, `types.ts` in that directory. Discovery, boot/setup, preview, frame capture and device control have separate capability/failure states.
- Development servers: `src/features/host-tools/DevServersPanel.tsx` and `host/dev-servers.ts` own listener/process presentation and effects, runtime source association and intentional start/stop flow.
- Logs/resource/process UI: `src/features/host-tools/RuntimeLogsPanel.tsx`, `runtimeLogsModel.ts`, `DiagnosticsPanel.tsx` in that directory own logs, samples, resource usage and process review/export; `logsComposer.ts` preserves attachment insertion. Follow each action to its actual Host implementation rather than inventing a shared RPC.
- Mobile: inspect corresponding tools routes under `mobile/` and their active adapters. Source presence, simulator, physical-device and serving-Host evidence are separate.
- Tests: adjacent `SessionHostTools.test.ts`, `ToolsWorkspace.test.ts`, Browser/Device and changed domain tests; search `tests/browser/` for host-tools, browser-annotation, devices and tools-workspace fixtures/configs.
- Locales: search actual tool labels in `src/shared/i18n/locales/` and override catalogs, including computer/target, lease, annotation, process review, setup, unavailable and retry copy.
