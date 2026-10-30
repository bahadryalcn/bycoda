---
name: feature-session-references
description: Stable local session links and Markdown citations, Host and Native origin resolution, sessions.list/read results, transcript and Notes routing, copy actions, lazy preview and cited-turn navigation.
---

# Local session references

## Purpose and keywords

Open an exact existing local conversation from a saved reference, reuse its tab,
copy plain/Markdown links, inspect authorized details and navigate to a cited user
turn. Local desktop only; no OS protocol registration, mobile/remote expansion,
new send permission or migration initiation. Read `feature-host-runtime`,
`feature-sessions-sidebar`, `feature-notes` and the current `.artifact` before changes.

Source inventory refreshed 2026-10-30, shared `main @ 654256cb2`.
The original implementation is included in that commit; the current corrections
are uncommitted. Preserve unrelated staged and unstaged admission/UI work.
Search roots: `src/app/`, `src/features/{sessions,agent-app,connections,notes}/`,
`src/integrations/harness/`, `host/`, `src-tauri/src/`, `tests/browser/`,
`src/shared/i18n/`. Existing dirty/staged work belongs to other workstreams.
Live feature-claim APIs were unavailable; current T3 thread and worktree state
were inspected before assigning disjoint writers. This card is not a live lock.

## Surface inventory and completeness

| Surface | Owner paths | Delivery / evidence |
| --- | --- | --- |
| Stable contract | `src/features/sessions/model/localSessionReference.ts` | Versioned strict `bycoda://session/v1/host/<environment>/<session>` and `native/<store>/<profile>/<session>`; optional `?turn=`; escaped labels; adjacent tests |
| Native identity | `src-tauri/src/session_store/references.rs`, registration in `session_store.rs` / `lib.rs`; `nativeSessionReference.ts` | Read-only current-origin metadata commands `session_reference_get` / `session_reference_resolve`; committed mappings only; tests exclude initialization/migration/metadata reads for wrong origin |
| Agent results | `host/server.ts`, `host/mcp-http.ts`, `host/desktopSessions.ts`, worker, `src/features/agent-app/model/{agentApp,sessionConversation}.ts`, `src/app/workspace/control/useAppControlRequests.ts` | Additive verified references on existing list/read and cited user turns; unavailable/unsaved owners never get guessed links; strict unrelated RPC schemas retained |
| Agent guidance | `src/integrations/harness/core/conversationToolsBridge.ts`, `host/app-skills/bycoda/references/work.md` | Exact returned first-mention reference; found/read/requested/acknowledged distinguished |
| Markdown | `AgentMarkdown.tsx`, `remarkLocalSessionLinks.ts`, `LocalSessionReferenceContext.tsx`, `LocalSessionReferenceLink.tsx` | Actual sanitize/streaming route, shared lazy Popover and actions, local pending/retry, invalid internal URIs never externally launched |
| Navigation/state | `localSessionNavigation.ts`, `src/app/workspace/sessions/useLocalSessionReferences.ts`, `src/app/App.tsx`, `SessionPane.tsx`, `useCitedTurnHistory.ts` | Validated local origin, visibility rechecks, existing history/tab/worker navigation and side-by-side owner, stale click guards, stable user-turn requests and demand-loaded older pages |
| Worker transcript | `AgentTabView.tsx`, `useReadOnlyHostSession.ts`, `src/app/workspace/bridges/useOrchestrationWorkerPanes.ts`, `useOpenSessionActions.ts` | Lead/worker editor reuse, guarded asynchronous pane publication, exact worker turn paging; Host reader mounts bounded read helpers only, with no queue/drain/recovery/send lifecycle |
| Copy | `src/app/shell/Sidebar.tsx` | Local single-session context menu plain/Markdown actions; initiating menu progress/success/error; existing ID actions retained |
| Documents | Existing `NoteEditablePreview`, `MarkdownPreview`, `MarkdownDocumentPreview` via shared AgentMarkdown | Shared provider covers workspace and retained transcript outlet; Notes anchor/button boundary retains editing state |
| Locales | `src/shared/i18n/locales/{en,tr,de,fr,es,pt,zh-CN,ja}.json` | New link/details/copy/recovery labels in all eight desktop locales |
| Guide | `docs/guides/local-session-references.md`, `workbench.md` | Copy, reference semantics, permissions, recovery and scope |

AgentMarkdown caller inventory also includes AgentTranscript, AgentTranscriptActivity,
SubagentSheet, SubagentAnatomy, TaskDetail/TaskSessionSheet, InboxDetail/InboxComments/
InboxPrOverview, PoliciesSettings, WhatsNewDialog and ReleaseNotesSurface. Consumers
outside an authorized provider show an unavailable action and never invoke OS launch.

## Owner decisions

2026-10-29, T3 conversation `d33140e6-93b7-4e25-bf6a-06c2a93a9c6b`, user request:

> Gerekli Host/API/Native işlerini tamamla; linkleme için migration başlatma.

> Oturumlar arası mesajlaşma yetkisini genişletme.

> Build/install/release yapma; commit/push yapma.

Scope follows `temp/local/2026-10-29-session-references-plan/LOCAL-PLAN.md`;
the broader `PLAN.md` is research, not authorization to implement mobile/OS links.

2026-10-30, T3 conversation `7bd70718-c924-4e7a-a551-b64fa19cf422`, user request:

> Aşağıda vereceğim plana bakarmısın link gibi paylaşılabilir olsun ilerde webten yönlendirebilelim filan istiyorum

> Önce temel akışı uçtan uca tamamla, ardından plandaki yerel
> önizleme ve konuşma turuna gitme adımlarını ele al.

> Build/install/release yapma; commit/push yapma.

Current scope implements the local plan and documents the versioned URI as the
future web handoff target. OS registration and public web content sharing remain
separate capabilities.

## Behavior to preserve

Persistent store/profile/environment identity, project visibility and authentication;
list/read project bounds, pages, cursors, prose caps and private reasoning exclusion;
existing send gates; drafts, caret, selection, retained transcript/Notes state;
history/tab/worker routing; archived membership; execution-workspace identity.
Do not create a link from a provider ID, unsent shell, title, cwd or guessed origin.
No authority fallback after a mismatch. Preview caches only in-flight reads and
is invalidated when privacy context changes. Opening never unarchives or migrates.

## Checks and visual scenarios

Focused suites cover URI encoding/collisions/labels, Native read-only identity and
verified migration receipts, bounded tools, actual DOM sanitizer/streaming/Notes
interaction, navigation races/visibility and existing tab ownership. Browser fixture:
`tests/browser/session-references.spec.ts` with dedicated dev-server config, both
themes at 1280/800, keyboard/details/retry and selection/edit boundaries.
Evidence is recorded under `temp/verification/2026-10-29-session-references/`.
Fixtures are not isolated Native/Host or installed acceptance. Final check results
and concrete blockers are recorded in that packet's `DELIVERY.md` and
`RENDERER-UI.md`. That packet records the original implementation, including its
then-blocked browser attempts. Current correction evidence belongs under
`temp/verification/2026-10-30-session-references/`; see its `DELIVERY.md`,
`BACKEND.md`, `NAVIGATION.md` and `RENDERER-UI.md` for final commands and limits.
Normal desktop/Host types and focused reference, navigation, worker, renderer,
Sidebar and isolated Host checks passed in the current run. Browser acceptance
uses actual Markdown/Popover/Notes/Sidebar components with fixture metadata and
navigation. Bounded Tailwind scanning/dependency discovery and a test-only local
HTTP transport shim resolve the earlier loading blocker. Captures are inspected
at 1280/800 in both themes. Fixture evidence does not establish Native GUI or
installed acceptance.

Current corrections also cover a Native authority phase check before advertising
a link, synchronous duplicate-open prevention, action-specific pending feedback,
revocation during delegated history loading, refreshed archived Host shell
metadata and exact worker panes instead of lead-only focus.

## Known blockers and evidence limits

New Native IPC commands require an executable containing the source change. The
owner prohibited builds and installations, so real new-command Native UI acceptance
cannot be claimed from an existing binary. Fixture screenshots and Rust unit tests
are separate evidence. Installed inclusion is unknown; release is not requested.

## Committed handoff references

Original source implementation is present in `main @ 654256cb2` (already in the
checkout when this run began). Corrections from this run remain uncommitted;
this run did not stage, commit, push, build, install or release.

## Proposals

Mobile/remote-machine navigation, external OS scheme launch and composer session
mentions remain separate later scopes. Inter-session messaging needs its own
authority/lifecycle specification.
