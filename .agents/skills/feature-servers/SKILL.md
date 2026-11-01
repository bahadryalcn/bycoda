---
name: feature-servers
description: Servers catalog, SSH forms and identity settings, server details, terminal tabs and saved-tab restore presentation. Read before changing Servers or SSH UI.
---

# Servers and SSH presentation

## Purpose and source identity

Keep saved SSH targets and bycoda Host machines understandable without inferring
health from an inventory entry or terminal existence. This bounded card complements
feature-workbench-design, feature-conversation-tools and feature-terminal.

H5 source implementation, 2026-10-28, shared main baseline
`c03fa98d4819494a53ebfa61ff74320105bd05fc`; uncommitted, not installed.
Search roots: `src/features/connections/ui`, connections models, terminal UI/model,
`docs/guides/remote-access.md`, and Servers browser fixtures.

## Surface checklist

| Surface | Source | Delivery state |
| --- | --- | --- |
| Catalog shell/list/cards, filters, Add, details | ServersWorkspaceView, ServersView.tsx/.css, ServerItem, ServerStatus | Source implemented SVR01-07/14; shell wrapper unchanged; test edilmedi |
| Purpose navigation and organization | ServersConnectionTools, ServerOrganization | SVR06/07/13 source implemented; panels stay mounted; native free-entry suggestions; test edilmedi |
| Quick connect and server editor | QuickConnect, SshServerEditor, SshIdentityField | SVR08/09 source implemented; QuickConnect wrapper unchanged; test edilmedi |
| Keys, known hosts and agent inventory | SshSettings | SVR10-12 source implemented; independent read retry and generation pending; test edilmedi |
| Terminal tabs and lifecycle | ServersTerminalWorkspace, ServerTerminalSession.tsx/.module.css | SSH01-05 source implemented; guarded close and neighbor navigation; test edilmedi |
| Restore | ServerTerminalRestoreControls, ServerTerminalRestorePreview | SSH07 compact controls, explicit reconnect; preview unchanged; test edilmedi |
| Shared terminal discovery and sash | terminal/ui/TerminalTools.tsx, terminal.css | SSH06 and SEL-04 source implemented; test edilmedi |

Connections UI paths above are under `src/features/connections/ui/`.
Forwarding, automation, activity, Files and SSH imports keep their existing feature
controllers; purpose navigation does not replace or unmount those editors.

## Model and operation boundaries

`connections/model/serverInventory.ts` and `serverTerminalRestoreState.ts` retain
canonical identity, metadata, selection and restore ownership. TerminalView retains
PTY lifecycle and native approval. Existing `terminal/model/terminalClose.ts`
checks foreground/unknown process status before UI close. No Host, Rust, adapter,
storage key or operation authority changed in this packet. Existing inventory,
identity, trust, configuration-review, forwarding and mobile-owned-resource APIs
remain authoritative. Native mobile remains a separate implementation.

Locale additions are only the two Add menu descriptions in all eight catalogs.
Existing connection/terminal labels remain shared. User guidance is in
`docs/guides/remote-access.md`.

## Owner decisions and preservation

Current owner prompt, 2026-10-28, session `11a29e09-1ce7-412e-b34c-309f94174bd5`:
"Başka session'ların teslimini bekleme; mevcut public API ile çalış."
Shared night RULES.md quotes the owner's decision:
"test yapmasınlar en iyisi kodları yazsınlar en son testi biz yaparız".

Preserve drafts, optional ephemeral names, selection/search, persisted filters and
settings, explicit submits, validation, free group/tag entry, identity cancellation,
permissions, duplicate guards, terminal ownership and lifetime. Failed process reads
never establish idle. Restoring opens a fresh shell only after Connect; no replay.
Machine connection state and SSH capability remain distinct.

## Checks and acceptance

No tests, fixture, browser, server or screenshots are authorized tonight. Tests in
ServersView.test.ts, SshSettings.test.ts and ServersTerminalWorkspace.test.ts were
extended but not run. Root records the single final type-only fast compiler result
and file fingerprints in `temp/local/2026-10-28-h5-servers-impl/handoff.json`.

Morning acceptance: run affected suites plus existing SSH identity/editor,
organization, restore and TerminalTools suites; render production components in
light/dark 1280/800/narrow and reduced motion; inspect keyboard sash with custom
accents, purpose navigation, catalog selection/filter counts, X/middle/Delete
confirmation/cancel/neighbor focus, lifecycle failure/retry, restore loading/retry
and partial SSH inventory failures. Use isolated mocks only for destructive cases.

Live feature-claim API was not exposed. Available project sessions were read;
shared controls and overlays are active owners, consumed via their current public
APIs. A card is not a lock. Build/source inclusion is unknown; no build, install,
native/live SSH, publication or release acceptance. Handoff requests REVIEW only.

## Handoff and proposals

Per-record evidence, dependencies, remaining checks and source hashes:
`temp/local/2026-10-28-h5-servers-impl/handoff.json`. No delivery commit exists.
Native datalist preserves free entry until a shared autocomplete supports it;
replacing it with a future adapter is a proposal, not delivered scope.

## UI standards round 2026-11-01 (uncommitted)

Round reference: owner request "tamam düzeltmelere başla lütfen hepsini" (2026-11-01, owner chat); primitives and rules in `docs/reference/ui-component-catalog.md` and `ui-design-system.md`. Source only, uncommitted on `main`; nothing built or installed.

Connections, SSH servers, tunnels and phone pairing (`src/features/connections/**`), from `HANDOFF-w2-tools.md`.

- Done: 134 literal font sizes to `text-ui-*`; ServersView header on `PaneHeader` (drag region + chrome inset; both mac spacers gone); SshSettings, ServersConnectionTools and ConnectionsSettings panel switches on `Tabs keepMounted` (selectors are now `[role="tab"]`); errors to `InlineError` (with `retry`), warnings to `InlineMessage`, empty lines to `EmptyState size="inline"`, "Loading" to `LoadingText`; Failed/Running text to `StatusBadge`; dialog footers to `ModalActions`; cards to `Surface`; `Divider`; PhonePairingDialog confirmation on `ConfirmDialog`; RemoteConnectionBanner/AdoptedSessionNotice/RemoteSession notices on `Alert` with `action`.
- Left: ServersTerminalWorkspace header row and native draggable tab strip; ServersView detail header (inside a Popover); `Alert` blocks with their own Retry buttons; about 25 `NativeSelect`/`NativeSearchableSelect` uses; `SessionHostTools` `triggerProps={{ title }}` (SearchableSelect has no tooltip prop).
- Unverified: no screenshots or native run; browser specs reading `[role="radio"]` for the section switch need `[role="tab"]` (`tests/browser`, not run).
