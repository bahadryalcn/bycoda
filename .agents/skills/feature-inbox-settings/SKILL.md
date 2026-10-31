---
name: feature-inbox-settings
description: Settings Inbox connection inventory for GitHub CLI, GitLab, Azure DevOps, Jira and Linear credentials, configured-versus-verified state, draft retention, account replacement, project/board/team scope, local persistence and desktop-owned Host/mobile authority. Read before redesigning Inbox integration settings.
---

# Inbox connection settings

## H3 implementation, 2026-10-28 (uncommitted)

Settings Inbox now consumes shared topic/row layout without page-local Group/Row skins.
Only first-visited provider panels initialize; visited panels stay mounted with drafts and
operations retained. Hidden Jira board discovery pauses while its saved state/roster stays.
Existing tabs, keyboard/search reveal and permission/native credential owners remain.

GitLab, Azure DevOps, Jira and Linear have explicit Edit/Cancel credential replacement
through their existing validate-before-save APIs. Saved GitLab/ADO URLs are separate from
editable drafts; failed replacement keeps the previous configured state and secret draft.
Successful-only secret clearing and explicit disconnect remain. Configured is a neutral
saved-presence badge. Status-read failures have their own error, so save/disconnect/help
failures no longer become Check failed. No connectivity timestamp/account was invented.

Jira projects reject obsolete request/account generations; same-account board refresh
retains its previous roster/error recovery, while account changes clear mismatched data.
Selectors expose loading and block editing during stale/pending discovery. The new local
`useInboxScopePreference.ts` reads fresh durable scope before patching known IDs, preserves
unknown IDs, verifies model save readback, keeps failed edit retry, follows same/sibling
events and drops superseded retries. Unreadable scope has no authoritative selector/count.
Background-sync remains a separate default-off opt-in with guarded read/save/readback.

These are Settings-local protections; H7 model/Inbox-filter/board/unseen/mobile read
fallbacks and account revisions remain their owners' follow-up. No actual credentials,
scope/user data, remote service or native operation was changed by this worker.
Per-IS/PR delivery is `temp/local/2026-10-28-settings-pages-b/providers.json`.
**test edilmedi**: no tests/compiler/dev server/captures/build/live operations ran under
the overnight exception. Morning checks must use fake credentials/isolated data and cover
draft/replacement/failure, request races, same/sibling scope recovery, keyboard/density/
theme/narrow views and separate native/Host/mobile permission enforcement.

Purpose: configure this computer's Inbox integrations, understand saved account
versus tested access and manage scope without losing drafts or silently widening
visibility. Keywords: Settings Inbox, GitHub CLI, GitLab URL/token, Azure DevOps
organization/PAT, Jira site/email/token/projects/boards, Linear key/teams,
Configured, Save and test, Disconnect, scope, background sync.

T2 audit/design baseline2026-10-27: dirty shared main at
d8bf868fae841b8b391ce148487cd7d373ea9762. Relevant inspected source unchanged
from HEAD. Recent history29d534f9f/3419af022/0a6973a21. Read feature-settings,
feature-inbox-jira, feature-inbox-github, feature-workbench-design and Arc/design
system/component references. Live claims tools unavailable; available session/
worktree state inspected. This card is not a concurrency lock. Root owns docs;
two native read-only reviewers supplied auth and Jira scope findings. Preserve
concurrent staged/shared UI/Host/updater work. No source patch committed.

## Surface inventory

Full14-family checklist and11 findings (three V+S/eight S) are in
`temp/local/2026-10-27-settings-inbox-audit/AUDIT.md`; adjacent REDESIGN.md owns
proposals. Evidence is under `temp/verification/2026-10-27-settings-inbox-audit/`.
Source-reviewed means inspected, not exercised in native or installed app.

- Desktop: `src/features/settings/ui/InboxSettings.tsx`, InboxSettings.css,
  InboxConnectionStatus.tsx, JiraSettings.tsx, settingsControls.tsx and
  SettingsView.tsx; `src/features/settings/model/settings.ts` owns provider/search
  IDs. `src/app/workspace/layout/WorkspaceSettingsSurface.tsx` wires Settings.
- Models/persistence: `src/features/inbox/model/githubTasks.ts`, gitlab.ts,
  azureDevOps.ts, jira.ts, jiraBoard.ts, linear.ts. Follow InboxView.tsx,
  JiraBoardView.tsx and useInboxUnseen.ts consumers for scopes/events/caches.
- Native: `src-tauri/src/fs.rs` git_github_status; gitlab.rs gitlab_status/
  gitlab_set_config; azure_devops.rs azure_devops_status/azure_devops_set_config;
  linear.rs linear_status/linear_set_token/linear_list_teams; jira.rs jira_status/
  jira_set_config/jira_list_projects; jira/board.rs jira_list_boards. Registration
  in lib.rs. Search roots include src-tauri/src/jira/ for mobile enforcement.
- Host: remoteInbox.ts contains the typed bridge, `host/provider-inbox.ts` and
  `host/conversation-workspace-tools.ts` deliver provider availability/items via
  inbox.providers.status/list and inbox.provider.status/request/result routing.
  No arbitrary credential Tauri command or saved-token disclosure is authorized.
- Mobile: `mobile/app/(tabs)/inbox.tsx`,
  `mobile/src/features/inbox/provider-inbox-screen.tsx`, provider-list.tsx,
  provider-protocol.ts; Jira bridge jiraMobileBridge.ts and native
  jira/mobile_board.rs validate desktop-owned account/allowlist and
  inbox.jiraBoard.v1. These are consumers, not phone credential manager parity.
- Shared UI/locales: Button, PasswordField, TextField, SearchableSelect,
  MultiSelect, Badge, settings feedback/InfoPopover/Popover/DropdownMenu; shared
  i18n locales en.json/tr.json and tr-overrides.json. Sentence families include
  Connection status, Configured, Check saved configuration, Save and test
  connection, Inbox scope, Refresh projects/boards/teams, Disconnect.
- Checks: InboxSettings.test.ts, JiraSettings.test.ts; model gitlab.test.ts,
  azureDevOps.test.ts, linear.test.ts, jira.test.ts, githubTasks.providers.test.ts;
  jiraBoard.test.ts/jiraMobileBridge.test.ts are related future scope acceptance.
  Browser fixtures tests/browser/settings.html, settings-subviews.e2e.ts.

## Owner decisions

2026-10-27, conversation0567326f-aade-4baa-89f3-b44c6256ae9e, five supplied
Settings Inbox provider screenshots:

> bu ekranda daha iyi yapılabilir diye düşünüyorum

This continues staged audit/design; no new credential, scope, polling default,
account test/replace behavior or exact navigation layout was selected. Jira's
earlier visible-demand continuation proposal remains separate from persisted
background-sync opt-in. Do not silently reset it.

## Behavior to preserve

- All five hidden panels currently remain mounted: drafts, busy state, tab
  arrows/Home/End and Settings search reveal already work. Delay hidden discovery
  only with retained state ownership; do not unmount busy/dirty forms.
- Configured is saved presence, not API connectivity. Native save validates first
  then stores; failed replacement must retain valid previous config. Empty token
  explicitly disconnects. GitHub is gh installed/authentication status with no
  returned account name or last-tested timestamp. No invented summary data.
- Preserve masked token/reveal access, PrivateEmail, editable URL/secret on failure,
  successful-only secret clearing, validation and duplicate action gates. Local
  pending/retry belongs to the initiated operation; status error is distinct from
  save/disconnect/help/read failures. No logs/captures of real credentials.
- Separate saved identity and draft identity, never overwrite unsaved draft on
  saved-config check. Keep credential success independent of failed roster read.
  Linear already retains known teams and rejects stale generations.
- Jira project hidden exclusions and board explicit allowlist differ. Preserve
  unknown IDs, null unrestricted versus [] none in fetch contracts, reconnect
  choices and account-aware epochs. Native Jira/Linear already page discovery
  fully with failure/cursor guards; no invented first-page-only defect.
- Preserve local scope persistence and correct read/write failure truth; no
  silent access widening. Cross-entrypoint and sibling changes need reconciliation.
  Background sync defaults off; keep owner opt-in separate from visible reads.
- Desktop owns saved credentials; typed Host/mobile access retains exact account,
  project and scope enforcement. UI restyling grants no new network/write authority.

## Proposals and findings

Bound provider detail/form width; place status/actions beside identity and fields.
Remove repeated idle save guidance. Propose direct credential edit and true
saved-access verification only with native/API support. Preserve useful current
wording. Distinguish saved/read/test/draft/discovery state, retain rosters during
refresh and make errors local. Fix late Jira project reads, board clear-on-refresh,
pending scope truth, shared Check failed mislabelling, persistence recovery and
sibling state before treating presentation as done. All11 repairs are pending.

## Checks, blockers and handoff

60 tests/seven suites passed at this baseline; static scan[] of four source files.
Diagram captures light728/dark390 are proposals only. Required changed-app checks:
all five providers light/dark1280/800, narrow/high zoom, long labels, keyboard,
reader/reduced motion and each saved/draft/discovery/error/retry state. Use fake
credentials and isolated data. New generation/storage/sibling/replace/verification
tests remain unimplemented. Installed source inclusion unknown; no isolated
native/Host/mobile, provider network or installed check ran. These are specific
acceptance gaps, not claims that existing APIs are absent.

Audit is ready for repair planning. No product code, credentials/preferences/
scopes, live state, source index/branch, package build/install/release or commit
changed. No behavior change requires a user-guide update yet. Baseline SHA is
context, not committed delivery. Refresh this card with actual change/evidence
when implementation is delivered.

## V3-014 Inbox page layout and stable status (2026-10-31)

Owner, 2026-10-31, with the Inbox → Jira screenshot: “bu ekranda daha iyi olabilirdi.” With the button screenshot: “buna basınca solundaki buton küçülüp büyüyor sayfada kaıyoyr bu tarz problemlerde var bunlarıda düzeltelim”

Delivered in source (uncommitted; handoff `temp/local/2026-10-31-ui-refinements-3/HANDOFF-v3-p5.md`; no runtime acceptance):
- `InboxConnectionStatus.tsx`: the status Badge has a reserved minimum width, a spinner with `aria-busy` while checking and a short `Verified` with the timestamp in a tooltip; the action Button uses `stableWidth`, so nothing moves when the state changes. `Configured` stays saved presence; only Save and test marks verification.
- One Connection group with a scope line per provider; long explanations moved into `info`; credential-provider account rows keep Edit and move the rest into an overflow menu with confirmation. Jira masked email, save/test, errors and handlers are unchanged. GitHub uses a reserved Badge and no duplicate scope line.
- A source sweep for other async labels is in `ASYNC-LABELS-v3-p5.md` (candidates, not measured defects).
- Connections (V3-016) share the pattern: Machines count and header actions, sync/details in an overflow, one Options toggle for recovery, a simplified phone page and pairing dialog, the Sharing form in one column. Not done: a paired-phone roster (no data source exposes it).
- Unverified: all five provider tabs at 1280/800 light/dark with long locales.
