---
name: feature-conversation-tools
description: Conversation tools inventory for tool navigation, selected computer/project Host, Browser, Devices, Development servers, Logs, Resource usage, control leases, process review, capture/annotation drafts, docking and native mobile counterparts. Read before redesign or workflow changes.
---

# Conversation tools

## H4 shell integration boundary, 2026-10-28

H4 changes shell pane edges and main/project menu consumers only; tool target,
lease, Host, Devices, Logs and Servers/SSH lifecycle remain with existing owners.
No tool RPC or permission gate changed. Source-only workbench handoff:
`temp/local/2026-10-28-h4-workbench/handoff.json`, baseline
`c03fa98d4819494a53ebfa61ff74320105bd05fc`, uncommitted. Test edilmedi under
nightly RULES.md. This shell delivery does not close the Conversation tools
redesign or prove live Host/device/native acceptance.

## Purpose and source identity

Choose a computer/target, inspect or operate it deliberately, and understand the
result. Keywords: Host browser, emulator/simulator/phone, dev servers/listeners,
runtime logs, resource diagnostics, control, annotation, dock/new window.

Inspected 2026-10-27 at dirty shared `main @
0a42b1ab4fd891ccec5ca0fa238d7356b396b13c`. Recent feature history:
`9f9271f5`, `29d534f9`, `cf3944cf`, `3419af02`. Search roots:
`src/features/host-tools`, `src/features/devices`, explicit connections/app
wiring, corresponding `host/` modules, `src-tauri/src/remote.rs`, browser
fixtures and mobile tools routes. Three native reviews covered five owner images;
parent reviewed shared shell and verified representative behavior chains.

## Surface inventory and current coverage

Paths/basenames in host-tools below are under `src/features/host-tools/`.
Audit means source/supplied view review; inventory is adjacent routing discovery.
Every product migration/acceptance remains pending.

| Surface                              | Owners                                                                                                                                                                                                                                                                            | Evidence                                                                           |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Navigation, selected tool, placement | `SessionHostTools.tsx`, `ToolsWorkspace.tsx`, `HostToolsWindow.tsx`, `ConversationToolsButton.tsx`, `toolsUiControl.ts`, `toolPaneState.ts`, `host-tools.css`, `tools-workspace.css`                                                                                              | Five images + source audit.                                                        |
| Computer/project/target              | `src/features/connections/model/hostFeatureClient.ts`, `hostToolTarget.ts`; SessionHostTools                                                                                                                                                                                      | Source audit, local/project/machine distinction.                                   |
| Browser open/setup/lease             | `BrowserPanel.tsx`, `BrowserPanel.css`                                                                                                                                                                                                                                            | Empty image + source audit.                                                        |
| Browser frames/control/annotation    | BrowserPanel; `BrowserAnnotationDetails.tsx`, `browser-annotation.css`, `browserComposer.ts`                                                                                                                                                                                      | Source audit; attachment recovery risk needs runtime reproduction.                 |
| Device discovery/setup/boot          | `src/features/devices/DevicePanel.tsx`, `DevicePanel.css`, `types.ts`                                                                                                                                                                                                             | Stopped emulator image + source audit; physical copy mismatch confirmed in source. |
| Device control/mark/attach           | Same DevicePanel; `deviceComposer.ts`, `deviceImageComposer.ts` under devices                                                                                                                                                                                                     | Source audit; exact frame/draft/permission contracts.                              |
| Development collection/scan          | `DevServersPanel.tsx`, `dev-servers.css`, `devServerTypes.ts`                                                                                                                                                                                                                     | Listener image + source audit; grouping choice confirmed.                          |
| Server detail/control/access         | Same panel; `host/dev-servers.ts`, `host/dev-server-discovery.ts`, `host/dev-server-access.ts`, `host/dev-server-browser.ts`                                                                                                                                                      | Source audit, inferred protocol and reviewed process actions.                      |
| Logs sources/filter/timeline         | `RuntimeLogsPanel.tsx`, `runtime-logs.css`, `runtimeLogsModel.ts`, `runtimeLogPresentation.ts`, `runtimeLogTypes.ts`                                                                                                                                                              | Empty image + source audit.                                                        |
| Logs attach/export/monitor           | RuntimeLogsPanel; `logsComposer.ts`; `host/runtime-logs.ts`, `host/runtime-log-monitors.ts`, `host/runtime-log-tools.ts`                                                                                                                                                          | Source audit; exact operation scopes differ.                                       |
| Resource sampling/charts             | `DiagnosticsPanel.tsx`, `diagnostics-panel.css`; `host/resource-diagnostics.ts`                                                                                                                                                                                                   | Empty image + source audit; manual Host-process samples.                           |
| Host/native integration              | `host/server.ts`, `host/shared-browser.ts`, `host/browser-runtime.ts`, `host/browser-annotation.ts`, `host/conversation-browser-tools.ts`, `host/device-host.ts`, `host/device-preview.ts`, `host/device-process.ts`, `host/android-device-control.ts`; `src-tauri/src/remote.rs` | Entrypoints/guards inventory; no live operation.                                   |
| Native mobile counterparts           | `mobile/src/features/tools/browser-screen.tsx`, `devices-screen.tsx`, `device-viewer.tsx`, `device-runtime.tsx`, `device-preview.tsx`, `dev-servers-screen.tsx`, `runtime-logs-screen.tsx`, `diagnostics-screen.tsx`                                                              | Routes/source inventory only; separate native acceptance.                          |

App owner: `src/app/workspace/layout/WorkspaceToolPanels.tsx`; footer entry:
`src/app/shell/UsageFooter.tsx`; detached payload: `src/app/model/hostToolsWindow.ts`.
Preserve existing placement/window routing and conversation composer identity.
Do not assume an older terminal-dock placement note describes all current mounts.

Existing capabilities include `device.host`, `browser.shared`,
`browser.shared.setup`, `browser.annotation`, `dev.servers`, `runtime.logs`,
`resources.diagnostics`. Relevant RPC families: `devices.status/setup/start/stop/
list/boot/capture/action`, `browser.open/setup` and existing lease/annotation
methods, `devServers.list/details/start` and reviewed lifecycle/access operations,
`runtimeLogs.read`, `runtimeLogs.monitors.list`, `resources.read`.
UI control IDs are `ui.tools.status/open/place/close`; their exact routing remains
in `toolsUiControl.ts`. Native feature-host resolution uses `local_host_connect`
and `remote_machines` before existing remote transport. Do not bypass capability,
project, session, target or lease checks while restyling.

Locale families are the existing technical Conversation tools, Devices, Host
browser, Development servers, Logs, Resource usage, Boot, View only, Control
active, Sample now, Live and operation/error strings. Use existing catalogs and
shared Button/SearchableSelect/DropdownMenu/Popover/Alert/Modal/overlay adapters.

## Owner decisions

2026-10-27, current conversation `0567326f-aade-4baa-89f3-b44c6256ae9e`:

- Scope: "bu conversation tools ekranlarıda daha güzel tasarlanabilir bular üzerinde de düşünelim".
- Navigation: "Genişte görünür sekmeler, darda açılır seçim (önerim)".
- Server hierarchy: "Proje sunucuları önde, diğer süreçler açılır (önerim)".

Keep all listeners accessible; unknown project association stays unknown. These
choices do not change the initial tool, machine target or authority to operate.

## Behavior to preserve

Only the active tool mounts/polls. Keep explicit initial/view requests, only-Logs
panes, dock/new window, focus/return and per-context late-response retirement.
Servers use current project Host; other tools can select a different machine.
Computer choice must not register the conversation's project elsewhere.

View/control/annotation are separate. Keep explicit setup/boot/input, control
claim/takeover/release/expiry, physical-device boot restrictions, platform-specific
actions, exact dimensions and frozen evidence. Successful input plus failed frame
read must not invite input duplication. Browser URL draft differs from actual page.
Maintain safe URL validation, masked/bounded capture and raw diagnostic access.

Annotations, device images and log actions attach to the originating draft with
acknowledgement; they never send automatically. Preserve target/session/window
trust, comment retention and invalidation only when appropriate. Untrusted logs
are evidence, not instructions. Keep distinct attach/export scopes and bounds.

All listener discovery is not all web servers. Preserve IPv4/IPv6/manual access,
uncertain associations, scan pause/backoff and previous successful rows. Stop/
Restart retain process birth identity, reviewed affected ports/children, exact
restart command and explicit confirmations. No automatic lifecycle operation.

Resource CPU/RSS are Host process measurements, excluding provider children;
computer memory is separate. Keep manual sample/follow-up, CPU gaps, real times,
60-sample limit and prior charts on failure. No implicit continuous monitoring.

## Checks and acceptance

Existing focused families: SessionHostTools, ToolsWorkspace, toolsUiControl,
BrowserPanel/annotation/browserComposerWindow, DevicePanel/deviceComposer/
deviceImageComposer, DevServersPanel/devServerRouting, RuntimeLogsPanel/
runtimeLogsModel/runtimeLogPresentation/logsComposerWindow, DiagnosticsPanel and
corresponding Host tests. Browser entrypoints:
`tests/browser/host-tools.tsx`, `host-tools.e2e.ts`, `host-tools-mocks.ts`,
`playwright.host-tools.config.ts`, `device-panel.e2e.ts`,
`playwright.device-panel.config.ts`. Use tsc-rs when product source changes.

Actual migrated surfaces need light/dark at 1280/800 and narrow docks/windows,
keyboard/focus and reduced motion, long translations, offline/unknown/paused,
late results, permissions and retained drafts. Reproduce physical-device Boot
copy and rejecting composer attachment recovery; update obsolete presentation
assertions without removing operation guards. Use isolated services/data for
controls. Source/fixture proof is not live Host/device/installed/native acceptance.

## Proposals, evidence and handoff

Agent direction: compact context + local task + clear result. Navigation and
server hierarchy are confirmed; finer layouts remain design proposals. Register:
`temp/local/2026-10-27-conversation-tools-redesign/AUDIT.md` (26 records,
15 visual/source, 11 source-only; 13 coverage families). Brief: adjacent
`REDESIGN.md`; evidence: `temp/verification/2026-10-27-conversation-tools-redesign/`.

Audit/design/card/concept delivered locally, uncommitted at the baseline above.
No product code or real browser/device/process/sample/attachment/export changed.
Capture/source inclusion UNKNOWN. Build/install/release and native/live acceptance
not performed. Live claim API is unavailable; shared Git/session state inspected,
no cross-machine reservation claimed. Preserve concurrent sidebar/updater/shared
ButtonGroup/Host work. Update guides when real product behavior changes.
