---
name: feature-mobile
description: "bycoda mobile feature map: Expo routes, pairing, projects, sessions, management, Host tools, RPCs, locales and tests. Read before changing phone access or mobile-facing Host contracts; the mobile app is a separate nested repository."
---

# Mobile

Purpose: connect a phone to the selected execution Host and preserve authenticated project/session controls across pairing, networking and recovery. Keywords: mobile, phone, Android, iOS, pairing, QR, LAN, Tailscale, private network, projects, sessions, terminal, PTY, Jira, preview, devices.

## Inventory and concurrency

Desktop/Host inventory starts at the s0 contract baseline. Mobile inventory was refreshed read-only on 2026-10-26 for F1 item 12 from `G:/Projects/my_projects/monocode/mobile`, a separate nested Git repository excluded from this branch. Its HEAD was `e480dac5f66e068e17cfc54a623a4d5aa7bacc39`; the inspected working snapshot had 159 changed tracked entries and 46 untracked entries. Those dirty files are part of this source inventory, not delivered by the HEAD or copied into this worktree. Counts are observations at inventory time, not stable repository properties.

Below, `mobile/` paths refer to that external read-only source root; other paths refer to this integration worktree. Search roots were `mobile/app`, `mobile/src`, `mobile/package.json`, `mobile/vitest.config.ts`, plus the desktop/Host/native roots below. Searches followed route exports, screen imports, request adapters, literal/dynamic RPC dispatch, English message keys and colocated tests. Source inventory is complete for the route tree; runtime acceptance is separate. This card is not a live feature lock. F1 workers coordinated file ownership in-session; no running-owner Host or claim service was contacted for this read-only inventory.

## Owner decisions

- 2026-10-26, owner F1 stream brief, item 12: "mobile/ is a separate nested repo excluded from this branch; inventory it read-only from G:/Projects/my_projects/monocode/mobile (screens/routes, host RPCs it calls, locale prefixes, tests). Do not copy mobile files into this repo."

## Proposals

None recorded. Agent design suggestions belong here, separately from dated owner quotations.

## Surfaces

### Mobile routes and screens

The Expo Router tree contains 17 `.tsx` files, including two layouts and the not-found screen. All 17 were inspected; dynamic route parameters are scoped to the selected machine/project by `mobile/src/features/workspace/route-scope.tsx`.

| Route file under `mobile/app/` | Screen and source under `mobile/src/`                                                                                                                    |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `_layout.tsx`                  | Root Stack, app providers, theme, status/navigation bars and reduced motion                                                                              |
| `(tabs)/_layout.tsx`           | Projects, chats, inbox, tools and settings tabs; machine health and floating tab bar                                                                     |
| `(tabs)/index.tsx`             | `features/workspace/projects-screen.tsx`; falls back to `features/connections/welcome-screen.tsx` or `machines-screen.tsx` according to connection state |
| `(tabs)/chats.tsx`             | `features/workspace/active-sessions-screen.tsx`                                                                                                          |
| `(tabs)/inbox.tsx`             | `features/management/index.tsx` with Inbox section                                                                                                       |
| `(tabs)/manage.tsx`            | `features/management/index.tsx`, ManagementHome / searchable ToolDirectory                                                                               |
| `(tabs)/settings.tsx`          | `features/settings/settings-screen.tsx`                                                                                                                  |
| `machines.tsx`                 | `features/connections/machines-screen.tsx`: saved computers, pairing entry/scanner, connection recovery                                                  |
| `demo.tsx`                     | `features/connections/demo-screen.tsx`                                                                                                                   |
| `sessions.tsx`                 | `features/workspace/active-sessions-screen.tsx`, route-selected session scope                                                                            |
| `project/[id].tsx`             | `features/workspace/project-screen.tsx`, machine/project/execution-cwd scope                                                                             |
| `session/[id].tsx`             | `features/workspace/session-screen.tsx`, transcript, composer, settings and toolbar                                                                      |
| `manage/[section].tsx`         | Eight sections from `features/management/sections.ts`: inbox, tasks, goals, crews, automations, notes, social, stewards                                  |
| `tools/[tool].tsx`             | Nine tools from `features/tools/index.tsx`: providers, access, servers, logs, diagnostics, usage, devices, browser, terminals                            |
| `legal/[document].tsx`         | `features/legal/legal-screen.tsx`                                                                                                                        |
| `report.tsx`                   | `features/reporting/report-screen.tsx`                                                                                                                   |
| `+not-found.tsx`               | Unknown-route recovery                                                                                                                                   |

Surface completeness checklist (done means source inventoried):

| Surface                 | Status and owning modules under `mobile/src/`                                                                                                                                                                                                                                                                                                      |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pairing and connection  | Done: `features/connections/{welcome-screen,machines-screen,demo-screen,pairing-entry,pairing-scanner}.tsx`, connection/recovery models; `remote/pairing.ts`, `remote/lan-fetch.ts`, native fetch/random variants                                                                                                                                  |
| Project and worktree    | Done: `features/workspace/{projects-screen,project-screen,sessions-panel,files-panel,file-editor,file-review,git-panel,git-history,git-stashes,git-selective,worktree-create,worktree-removal,submodule-view}.tsx`; project directory/privacy and workspace-state models                                                                           |
| Session and chat        | Done: `features/workspace/{active-sessions-screen,session-screen,session-transcript,session-composer,session-settings,session-toolbar,session-checkpoints,session-files,transcript-actions,transcript-attachments,agent-model-fields}.tsx`; queue, attachments, model catalog, draft, context transfer and transcript selection/find/scroll models |
| Management              | Done: `features/management/{tasks-screen,goals-screen,crews-screen,automations-screen,notes-screen,inbox-screen,social-screen,stewards-screen}.tsx`, their editor/detail folders and shared scope/model fields                                                                                                                                     |
| Inbox                   | Done: `features/inbox/{jira-board-screen,provider-inbox-screen}.tsx`; Jira issue/delivery and provider review/job/draft modules                                                                                                                                                                                                                    |
| Host tools              | Done: `features/tools/{provider-center,access-center,dev-servers-screen,runtime-logs-screen,diagnostics-screen,usage-screen,devices-screen,device-preview,browser-screen,terminal-screen}.tsx`; mobile PTY and SSH workspace controls                                                                                                              |
| Settings and protection | Done: `features/settings/{settings-screen,host-settings-editor,local-data-controls,chat-appearance-settings}.tsx`, `features/security/security-settings.tsx`, `features/permissions/device-permission-settings.tsx`, `features/engagement/engagement-settings.tsx`; state/security, privacy, machine and query stores                              |
| Legal and reporting     | Done: `features/legal/legal-screen.tsx`, `features/reporting/report-screen.tsx`                                                                                                                                                                                                                                                                    |

`mobile/src/screens/workspace/{session-screen,sessions-screen,shared}.tsx` and `mobile/src/screens/management/{work-screens,shared}.tsx` also exist as compatibility surfaces; route imports above identify the active feature implementations. Their presence is not an additional Expo route.

### Mobile Host RPC inventory

Both `mobile/src/api/hostClient.ts` / `api/transport.ts` and the split `mobile/src/remote/api.ts` / `remote/services/` exist. Feature code also calls `client.request` and `useHostQuery` directly. Inventory both paths; the service directory alone omits current tools, queue, privacy and reviewed operations. Authentication, machine identity and request replay policy live in `remote/{host-transport,transport,request-policy}.ts` and `state/host-request.ts`.

| Mobile owner                                                                                           | Host RPC identifiers used                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `remote/api.ts`, transport                                                                             | `environment.describe`, `machine.changes`; session chunk/event polling through the shared transport                                                                                                                                                                                                               |
| `remote/services/workspace-api.ts`                                                                     | `projects.list/directory/browse/open/createDirectory`, `models.list`, `files.list/read/write/create/index/search/searchContent`, `git.index/fileDiff/action/branches/switch/createBranch/worktrees/worktreeCreate`                                                                                                |
| `remote/services/sessions-api.ts`, `features/workspace/session-wire.ts`, session queue/context modules | `sessions.list/get/page/sync/syncChunk/block/update/delete`, `sessions.contextual.preview`, `sessions.queue.get/change/lease`, `commands.dispatch/status`; create/send/draft/steer/cancel/configure/rewind/contextual are command payloads, not separate RPC authority                                            |
| Workspace attachments, imports and HTML previews                                                       | `attachments.upload/status/claim/claims/release/read`, `history.import.preview/status/commit/cancel`, `html.artifacts.list/read`                                                                                                                                                                                  |
| Project privacy and desktop preferences                                                                | `projects.organization.read/status/patch`, `preferences.desktop.read/status/patch/template.read`; reviewed worktree removal uses `worktrees.removal.review/approve/status`                                                                                                                                        |
| `remote/services/work-api.ts`                                                                          | `tasks.list/save/move/delete/notes.read/notes.resolve/review.recheck`, `goals.list/create/update/approve/cancel/replan`, `automations.list/save/delete/preview/runNow/runs`, `stewards.list/save/runNow/decline`, `host.settings.get/save`, `devices.revokeSelf`                                                  |
| `remote/services/crews-api.ts`                                                                         | `crews.list/get/inspect/save/delete/start/deleteRun/agent.save/agent.delete`; schema capability/read handling also appears in `remote/request-policy.ts`                                                                                                                                                          |
| `remote/services/content-api.ts`                                                                       | `notes.list/get/upsert/delete`, `inbox.list`, `delivery.pr.list/link/pause/resume`                                                                                                                                                                                                                                |
| `remote/services/social-api.ts`, management/social                                                     | `social.request`, with action names including `policy.get`, `accounts.list/create/grants/pause/disconnect`, `thread.read/assign`, `messages.draft/send`, `replies.draft/send`, `drafts.update/approve`, `comments.send`, `jobs.cancel`, `automations.pause`, `campaigns.create`; these are scoped action payloads |
| Provider inbox and Jira                                                                                | `inbox.provider.request/status/result`; Jira board actions are submitted through that provider-request contract, with authoritative result polling                                                                                                                                                                |
| Provider/access centers                                                                                | `providers.center.read`, `providers.desktop.read/status/patch/quota.refresh`, `providers.acp.patchMetadata`, `host.access.read`, `devices.revokeSelf/revokeOther`                                                                                                                                                 |
| Runtime, diagnostics and usage                                                                         | `runtimeLogs.read/sources/monitors.list/monitors.start/monitors.stop`, `resources.read`, `usage.sessions.read`                                                                                                                                                                                                    |
| Development servers                                                                                    | `devServers.list/details/logs/start/stop/restart/kill`                                                                                                                                                                                                                                                            |
| Device tools                                                                                           | `devices.status/list/preflight/setup/start/stop/boot/action/capture`, `devices.preview.impact`, `devices.preview.mobile.start/status`                                                                                                                                                                             |
| Shared browser                                                                                         | `browser.status/setup/open/close/claim/release/frame/input`, `browser.annotation.start/read/select/cancel`; `browser.shared` and `browser.annotation` strings are capability names, not mutation approval                                                                                                         |
| Terminals                                                                                              | `shell.profiles`, `terminals.list/create/read/write/interrupt/close`; native desktop PTY bridge: `terminals.pty.desktop.list/create/attach/read/write/resize/status/close`                                                                                                                                        |
| SSH workspace                                                                                          | `ssh.workspace.catalog.read/review/approve/status/close.review/close.approve`                                                                                                                                                                                                                                     |
| Git management / workspace command bridge                                                              | `workspace.run` with reviewed commands from `features/workspace/git-*` and `submodule-view.tsx`; includes `git_management_snapshot`, `git_pr_destination`, `git_submodules`. Read-only retry allowlisting does not authorize mutations.                                                                           |

Notation such as `projects.list/directory` means the exact RPCs `projects.list` and `projects.directory`, sharing one prefix. Dynamic tool dispatch is defined alongside `features/tools/*-runtime.ts` and UI action maps; capability names must not be substituted for RPC methods. This inspected mobile snapshot uses legacy worktree/removal and session command routes; it does not itself establish implemented `workspaces.managed.v1` UI or managed owner-delivery acceptance.

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

Pairing is presented by PhoneConnectionPanel and PhonePairingDialog through ConnectionsSettings; model coordinator/API/contracts/types handle machine identity, cancellation and status. Mobile project directory/logo modules, Jira mobile bridge and PTY control remain distinct desktop surfaces alongside the phone app inventory above.

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

Desktop catalogs: `src/shared/i18n/locales/`, `src/shared/i18n/en-overrides.json`, `src/shared/i18n/tr-overrides.json`; use exact English source messages, not a guessed mobile namespace. Observed component keys include `Connect your phone`, `Pairing target: {p0}. You can choose another computer in the pairing screen.`, `Connection method`, `Local network`, `Tailscale`, `Local network address`, `Copy pairing code`, `Pairing code copied`, `Opening the secure connection…` and `Creating your QR code…`.

Mobile has its own eight catalogs at `mobile/src/locales/{en,tr,de,fr,es,pt,ja,zh-CN}.json`; the inspected English catalog contained 2,435 keys. `mobile/src/localization.ts` imports these catalogs and language definitions from the shared desktop language module. `mobile/src/ui/copy.ts` exposes `copy(turkish, english, values)`: Turkish/English use their supplied source string, other languages index the English message key and fall back to English. Parameters use `{p0}`, `{p1}`, etc. There is no `mobile.*`, `tasks.*` or `workspace.*` locale namespace.

Search actual English families: `Connect`, `Computer`, `Connection`, `Project`, `Session`, `Worktree`, `Branch`, `Files`, `Task`, `Goal`, `Crew`, `Automation`, `Note`, `Inbox`, `Social`, `Steward`, `Terminal`, `Browser`, `Device`, `Provider`, `Settings`, `Privacy`, `Review`, `Retry` and `Rewind`. Concrete observed keys include `Connect a computer`, `Connect manually`, `Connect over local network`, `Connect with Tailscale`, `Connection interrupted. Check whether the computer accepted this command before trying again.`, `Open bycoda on this computer to sync the project directory. Protected groups stay hidden.` and `Update bycoda on your computer to use this tool.`. Check the catalog and call site before adding or renaming copy.

### Mobile tests and tooling

The read-only snapshot contained 253 colocated `src/**/*.test.ts` files (including untracked test files). `mobile/vitest.config.ts` selects exactly that pattern in Node, with the `@` alias pointing to `mobile/src`. These are source/model/contract tests, not native screen rendering proof. Representative tests and their owning directories are explicit below; the directory counts cover the broader inventory without claiming those tests ran.

| Area and source directory under `mobile/src/` | Test inventory                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Localization                                  | `i18n.test.ts`, `localization.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                          |
| `features/connections/` (5)                   | `computer-connection.test.ts`, `machines-screen.test.ts`, `pairing-code.test.ts`, `pairing-redeem.test.ts`, `recovery.test.ts`                                                                                                                                                                                                                                                                                                                  |
| `features/settings/` (5)                      | `chat-appearance-settings.test.ts`, `local-data.test.ts`, `settings-draft.test.ts`, `shell-profile-model.test.ts`, `shell-profile-settings.test.ts`                                                                                                                                                                                                                                                                                             |
| `features/workspace/` (88)                    | Includes `agent-model-fields.test.ts`, `file-review.test.ts`, `git-management.test.ts`, `git-selective-query.test.ts`, `project-directory-privacy.test.ts`, `project-privacy-cache.test.ts`, `queue-delivery.test.ts`, `session-checkpoint-model.test.ts`, `session-queries-privacy.test.ts`, `session-screen-privacy.test.ts`, `worktree-create.test.ts`, `worktree-removal.test.ts`, plus their models and transcript/draft/find/scroll tests |
| `features/management/` and subfolders (42)    | Screen/contract tests in the root; crews (6), notes (3), social (12), plans/templates/shared (2 each), automations/goals (1 each). Includes `crews/run-card.test.ts`, `notes/note-editor.test.ts`, `shared/agent-model-selection.test.ts`, `social/review-presentation.test.ts` and `social/workspace-query-model.test.ts`                                                                                                                      |
| `features/inbox/` (12)                        | `jira-board-delivery.test.ts`, `jira-board-issue.test.ts`, `jira-board-model.test.ts`, `jira-board-screen.test.ts`, `provider-actions.test.ts`, `provider-jobs.test.ts`, `provider-model.test.ts`, `provider-pr-review.test.ts`, `provider-review-delivery.test.ts`, `provider-review-draft.test.ts`, `provider-review-model.test.ts`, `provider-state.test.ts`                                                                                 |
| `features/tools/` (35)                        | Includes `browser-runtime.test.ts`, `browser-annotation-model.test.ts`, `device-runtime.test.ts`, `device-preview.test.ts`, `device-preview-intent.test.ts`, `mobile-pty.test.ts`, `mobile-pty-error.test.ts`, `runtime-monitors.test.ts`, `runtime-log-presentation.test.ts`, `terminal-model.test.ts`, `use-terminal-output.test.ts`                                                                                                          |
| Remote/API (11)                               | `api/hostClient.test.ts`; `remote/{api,lan-fetch,native-platform,request-policy,response-body,transport}.test.ts`; `remote/services/{crews-api,terminal-api,work-api,workspace-api}.test.ts`                                                                                                                                                                                                                                                    |
| State and shared UI (46)                      | `state/` (13) includes `host-request.test.ts`, `machine-model.test.ts`, `machines.test.ts`, `queries.test.ts`, `reviewed-operation-identity.test.ts`, `security.test.ts`; `ui/` (33) includes component, private-content, selection, terminal-document, theme and reduced-motion contracts                                                                                                                                                      |
| Other feature tests (7)                       | Engagement (1), legal (1), permissions (2), privacy (2), reporting (1)                                                                                                                                                                                                                                                                                                                                                                          |

`mobile/package.json` uses pinned pnpm and defines `pnpm test`, `pnpm typecheck` / `pnpm typecheck:fast` (tsc-rs, with theme/UI/runtime/locale checks), `pnpm check:ui`, `pnpm check:runtime`, `pnpm check:locales`, `pnpm check:release` and `pnpm theme:check`. Refresh this manifest before executing; do not install or run export/build scripts in the owner's nested repo during a read-only inventory.

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

- Refresh desktop roots with `rg --files src host src-tauri/src tests/browser`; refresh the external mobile repo with bounded searches under `app/`, `src/` and its package/test manifests. Avoid generated outputs and dependency directories. Check its Git HEAD and dirty provenance separately from this branch.
- Run focused checks with `pnpm vitest run src/features/connections/model/phonePairingContract.test.ts src/features/connections/model/phonePairingCoordinator.test.ts src/features/connections/ui/PhoneConnectionPanel.test.ts src/features/projects/model/mobileProjectDirectory.test.ts src/features/terminal/model/mobilePtyControl.test.ts`; run changed Host services via `pnpm test:host -- host/mobile-pairing.test.ts host/mobile-access.test.ts host/mobile-lan.test.ts`. Use temporary network/service fixtures and fake project data.
- Exercise desktop phone settings/pairing at 1280 and 800 widths in light/dark; open saved screenshots from `temp/verification/<id>/`. Cover machine switching, unsupported older Host, LAN/private-network status, expired/cancelled pairing and retry without duplicate work.
- With an authorized mobile execution workspace and test device, exercise each changed screen at native phone widths in both themes, keyboard shown/hidden, long content, reconnect, model/settings changes and state restoration. Preserve drafts, selection, private project visibility, held uncertain delivery and reviewed-operation identity. Report simulator, physical device, live Host, packaged and installed evidence separately. Check build identity before interpreting an owner screenshot.

## Known concrete blockers

Mobile source enumeration is no longer blocked: the authorized external repository was inspected as described above. The integration branch still does not include or deliver that nested repository or its dirty changes. F1 item 12 authorized a read-only inventory, so mobile typechecks/tests, Expo/native rendering, APK/IPA packaging, installation, live Host/provider operation and physical-device acceptance were not run. Reproduce those checks in an owner-assigned mobile execution workspace; this card does not turn the inspected dirty snapshot into a frozen build identity.

## Evidence and handoff

Committed inventory baseline: `f26ac112404e326478adb687c23ca9cc032acfef`. See `docs/reference/managed-workspaces.md` for frozen contracts, not proof of runtime availability. Record subsequent delivered behavior with a commit reference and exercised evidence. This documentation change did not exercise product UI, a native app, a physical phone, a live Host, installation or release.

Inventory delivery: `4454ce32` on `bycoda/wt-model/s7` commits this code-backed
card and the worktree-first documentation. This reference establishes inventory
delivery only; product/runtime acceptance remains as described above.

F1 item 12 refresh: `bycoda/wt-model/integration`, 2026-10-26. Read-only route exports, screen imports, RPC adapters/call sites, locale keys and test/manifest inventory were verified against the external mobile HEAD/dirty snapshot above. No mobile file was copied or changed. Locate the committed refresh with `git log --oneline -- .agents/skills/feature-mobile/SKILL.md`; local inventory artifacts under `temp/local/f1/` are ignored evidence, not product dependencies. Build inclusion of the external mobile snapshot in any installed package remains unknown.
