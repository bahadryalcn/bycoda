---
name: feature-inbox-github
description: GitHub Inbox issue and pull request collection, repository/type/state filters, read counts, selection/drafts, Summary/Code/Checks, diff files/context/layout, CI evidence/repair, public comments, Ask, PR actions, exact-head review and native/mobile provider delivery. Read before GitHub Inbox redesign or workflow changes.
---

# GitHub Inbox and PR review

Help the owner distinguish issues, PR lifecycle and unread work; read code/CI
and act on the exact record without losing drafts, selection or provider truth.
Keywords: GitHub, Inbox, issues, pull request, PR, Summary, Code, Checks, diff,
Hunks, Full file, side-by-side, loaded count, review, public comment, merge.
This is a T2 inventory/design card, not delivered product behavior.

Baseline inspected2026-10-27: dirty shared `main @
0a42b1ab4fd891ccec5ca0fa238d7356b396b13c`. Search roots: src/features/inbox,
source-control, settings, connections, app/workspace/layout, shared UI/styles,
src-tauri/src, host, tests/browser and mobile/src/features/inbox. Recent history:
8d7e83ad,4454ce32,29d534f9,cf3944cf. Check live feature claims before product
work; card is not a lock. Claims RPC unavailable in this session; Git/worktree/
native session state inspected without claiming cross-machine reservation.

Read related feature-workbench-design, feature-source-control and
feature-inbox-jira cards plus docs/reference/DESIGN.md, arc-ui.md,
ui-design-system.md and ui-component-catalog.md. Preserve dirty concurrent
updater/sidebar/shared Button/ButtonGroup/Host work. One writer per file.

## Surface inventory and coverage

Full16-family checklist and17 findings are in
`temp/local/2026-10-27-github-redesign/AUDIT.md`; brief is adjacent REDESIGN.md.
Audit done means read/design inspection; product implementation is pending.

| Surface                            | Explicit implementation / test owners                                                                                                                                                                                                                                                                                                                  | Audit coverage                                                                                                       |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| Shell/providers/filters/collection | `src/app/workspace/layout/WorkspaceToolPanels.tsx`; `src/features/inbox/ui/InboxView.tsx`, `InboxView.css`, `InboxFiltersMenu.tsx`, `InboxConnectMenu.tsx`, `InboxPresentation.tsx`, `InboxProviderMark.tsx`                                                                                                                                           | Screenshot/source; kind/status, labels/repo, read scopes, filters, selection/retained scroll.                        |
| Other linked/compact entrypoints   | `src/features/inbox/ui/InboxMiniCard.tsx`; linked work-item panel in InboxView; `src/features/inbox/ui/InboxNotificationMenu.tsx`                                                                                                                                                                                                                      | Shared integration inventory; exercise actual consumers if shared controls change.                                   |
| Detail/header/tabs                 | `src/features/inbox/ui/InboxDetail.tsx`, `useInboxDetailData.ts`, `InboxPrOverview.tsx`                                                                                                                                                                                                                                                                | Code screenshot/source; Summary lifetime/read contracts source-reviewed.                                             |
| Comments/timeline/media            | `src/features/inbox/ui/InboxComments.tsx`, `InboxMedia.tsx`                                                                                                                                                                                                                                                                                            | Public/reply/draft ownership and success-versus-refresh source chain.                                                |
| PR operations                      | `src/features/inbox/ui/InboxPrActions.tsx`; native fs                                                                                                                                                                                                                                                                                                  | Merge/squash/rebase/draft/ready/close/reopen and confirmation; no actual write.                                      |
| Code/files/diff                    | `src/features/inbox/ui/InboxPrDiff.tsx`; `src/features/source-control/ui/UnifiedDiffView.tsx`, `UnifiedDiffView.css`, `DiffLayoutToggle.tsx`, `DiffOverviewRuler.tsx`                                                                                                                                                                                  | Width/tool ownership, file navigation/rename/expansion, context/revision, auto layout and syntax/readability risks.  |
| Checks/evidence/repair             | `src/features/inbox/ui/InboxPrChecks.tsx`, `CheckEvidence.tsx`, `CheckRepairForm.tsx`, `CheckRepairProgress.tsx`; `src/features/inbox/hooks/useGithubPrChecks.ts`                                                                                                                                                                                      | Existing failure-first groups, head-bound evidence and stale refresh/repair behavior.                                |
| Ask/related agent work             | `src/features/inbox/ui/InboxDiscussionPanel.tsx`; `src/features/inbox/model/inboxAsk.ts`, `inboxContext.ts`                                                                                                                                                                                                                                            | Wiring/state-owner inventory; regular session pane owns chat. No agent launched.                                     |
| Fetch/filter/retained state        | `src/features/inbox/model/githubTasks.ts`, `githubReadGate.ts`, `inboxFilters.ts`, `inboxSeen.ts`, `inboxPrefetch.ts`, `inboxPolling.ts`, `githubPrChecks.ts`, `ciRepairTracking.ts`; `src/features/inbox/hooks/useInboxUnseen.ts`                                                                                                                     | Capped arrays, local search/window, partial errors, cache/concurrency/read gate and identity.                        |
| Diff models/theme/preferences      | `src/features/source-control/model/prDiff.ts`, `diffHighlightSource.ts`; `src/features/settings/model/settings.ts`; `src/styles/index.css`                                                                                                                                                                                                             | Shared auto/global choice/code zoom and semantic/high-contrast/colorblind roles; no measured renderer contrast pass. |
| Native/Host delivery               | `src-tauri/src/fs.rs`, `github_review.rs`, `desktop_inbox_review.rs`; `src/features/inbox/model/remoteInbox.ts`; `src/features/connections/model/desktopLive.ts`, `useDesktopLive.ts`; `host/provider-inbox.ts`, `server.ts`, `conversation-workspace-tools.ts`                                                                                        | Specific read/write/guard paths and routing inventory; no isolated native/Host or live acceptance.                   |
| Native mobile                      | `mobile/app/(tabs)/inbox.tsx`; `mobile/src/features/inbox/provider-inbox-screen.tsx`, `provider-list.tsx`, `provider-detail.tsx`, `provider-conversation.tsx`, `provider-composer.tsx`, `provider-pr-review.tsx`, `provider-review-model.ts`, `provider-review-draft.ts`, `provider-review-delivery.ts`, `provider-protocol.ts`, `provider-queries.ts` | Entrypoint/contracts inventory; phone design and native/device checks remain separate.                               |

Native commands include `git_github_work_items`, `git_github_work_item`,
`git_github_work_item_details`, `git_github_work_item_thread`,
`git_github_work_item_comment`, `git_github_pr_action`, `git_github_pr_diff`,
`git_github_pr_review_context`, `git_github_pr_review`. Follow current
githubTasks/checks/native dispatch before changing command shapes. Host provider
jobs route through `inbox.provider.status`, `inbox.provider.request`,
`inbox.provider.result`; project tool facade includes `inbox.providers.status`
and `inbox.providers.list`. Remote operation union distinguishes details,
thread, comment, pr-action, review-context and review; no arbitrary native call.
Retain request receipts/uncertain writes and exact approval/HEAD/window/project
validation. Contract inventory is not evidence of installed Host capability.

Locale families use actual sentence keys: Inbox, Filter inbox, Pull request,
Issue, Summary, Code, Checks, Hunks, Full file, Automatic, Inline, Side-by-side
view, Mark all as read, Ask, Comment, Reply, merge options and check evidence.
Re-enumerate calls and en/tr overrides when implementing; do not add a local
translation system. Reuse shared Button/SplitButton/SegmentedControl/Select,
SearchableSelect, fields, Alert, DropdownMenu, Popover/Modal and theme adapters.

## Owner decisions

2026-10-27, current conversation `0567326f-aade-4baa-89f3-b44c6256ae9e`:
"github kısmı bu şekilde gözüküyor buralarıda toparlıyabiliriz daha yugn gösterimler daha ayırıcı işler verebiliriz. Tasarımıda yine düzenlememiz gerkiyor."

This authorizes the audit/design extension. No new GitHub default grouping,
sort, polling or diff layout selected. Jira's demand-scroll/right-detail choices
do not independently change GitHub native paging or stored global diff choice.

## Behavior to preserve

- Keep provider/repo/kind/key/cwd/account identity, saved filters/selection/read
  state and container-responsive list/detail/back. Never infer needs-review from
  open, or unread from lifecycle. Clarify bulk provider-read scope versus count.
- GitHub array limits are40/default,100/max per repo/kind; local scroll reveals
  already fetched records. Local metadata search does not search body/comments
  or prove all server results. True continuation/search needs real typed/native
  contracts. Preserve cache/in-flight dedup, bounded concurrency4, conservative
  polling/read gate, good data on error and late-response rejection.
- Retain drafts by exact originating target through tabs/navigation and failed
  writes. Public comment is not Ask. Keep issue Send to agent/execution project
  and related-session ownership. Do not invent a PR send action from issue UI.
- Retain all PR operations, shared confirmations and exact reviewed-head merge;
  native --match-head-commit is essential. Keep queued/auto-merge versus merged
  distinction, write success versus failed read-back, and uncertain outcome.
- Automatic diff is already default and uses actual width below900; preserve
  explicit global inline/split. Keep full context provider request, binary/size/
  truncation, exact copy, syntax limits, shared zoom and +/- semantics. Reconcile
  expanded/focused files safely across revisions without stale line anchors.
- Keep checks failure-first/attention/all, cancelled/unknown/skipped states,
  evidence/retry/annotations/progress, visibility/open polling and head-bound
  scope epochs. Saved green data is not current evidence; stale repair blocked.
- Shared diff/header/component changes require representative Git/Jira/GitLab/
  ADO/Linear/linked consumers. No local palette/overlay/control duplication.

## Checks and visual scenarios

Relevant source tests (inspect current scripts, run normal tsc-rs when editing):
InboxView.test/persistence, InboxDetail.tabs, InboxComments, InboxPrActions,
InboxPrOverview, InboxPrChecks/Repair, useInboxDetailData, InboxDiscussionPanel,
githubTasks/test/providers/repositories/concurrency/progressive, githubReadGate,
githubWorkItemFreshness, useGithubPrChecks/revision/provider and
UnifiedDiffViewSplit/markers. Paths follow the source owners above.
`tests/browser/responsive-diff.spec.ts` tests editable CodeMirror, **not** Inbox
UnifiedDiffView. Add/exercise a real Inbox fixture rather than claiming that
suite proves this screen. Native review/Host tests: github_review and
desktop_inbox_review modules, `host/provider-inbox.test.ts`; mobile review/model/
draft/delivery tests preserve remote exact-content/HEAD semantics.

Actual changed surfaces: light/dark1280/800 plus narrow containers, keyboard/
focus/resize/touch/reduced motion, long title/labels/path/rename, code zoom/custom
themes and semantic diff modes. Fake-provider cases: duplicate numbers/repos,
all lifecycle/read states, capped/partial/empty/late data, filtered bulk read and
selected detail, drafts across tabs, failed write versus successful write/failed
read, stale green checks/new HEAD/annotation/repair. Never destructive acceptance
on owner repositories. Save/open captures under temp/verification/<id>.

## Settings connection extension, 2026-10-27

Cross-provider Settings Inbox audit: read
`.agents/skills/feature-inbox-settings/SKILL.md` and
`temp/local/2026-10-27-settings-inbox-audit/`. Five owner captures;11 records/
14 families, two native read-only reviews plus root. GitHub retains the separate
this-computer gh installed/authentication/check-error contract and existing
keyboard/search/draft behavior. No account name or last-verified timestamp is
returned by current git_github_status; do not invent these as summary data.
Bound connection detail width and nearby actions without adding token fields.
60 existing provider/settings tests pass; no product/live/credential operation.
This extends Settings design, not the issue/PR review workflow findings above.

## Proposals, blockers and committed handoff references

Propose task-first mixed collection with visible type/state, honest loaded/read
scopes, deliberate selection, compact contextual header and a wider Code area
with one toolbar/scalable file navigation. Retain Summary reading measure and
existing automatic diff. Promote saved-result freshness and local recovery.
Details remain proposals in REDESIGN; no product behavior shipped by this card.

Local card/audit/brief/concept delivered uncommitted at baseline above; no commit
reference for implementation. Source manifest/document checks are separate from
actual product acceptance. Screenshot/build inclusion UNKNOWN; owner build stamp
absent. Live claims API, installed/provider and physical mobile evidence absent.
No source test, build, install, release or live GitHub operation run for this
documentation-only extension. Update user guides when behavior is delivered.
