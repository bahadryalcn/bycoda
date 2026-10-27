---
name: feature-inbox-jira
description: Jira Inbox, List/Board, Kanban/backlog/sprints, issue detail activation, bounded pagination/search, loaded completeness, transitions/rank, comments/agent work, visibility allowlists and native/mobile bridge. Read before Jira UI or workflow changes.
---

# Jira Inbox and board

## Purpose and scope

Find Jira work, open details, keep position and perform explicit permitted actions.
Keywords: Inbox Jira, List Board, Kanban, backlog, sprint, Load more issues,
card click, drag, Move, issue detail, rank, comment, agent workspace.

Inspected 2026-10-27 at dirty shared `main @
0a42b1ab4fd891ccec5ca0fa238d7356b396b13c`; recent history `29d534f9`,
`cf3944cf`, `3419af02`, `0d269190`. Roots: `src/features/inbox`, Jira settings,
`src-tauri/src/jira.rs` and `jira/`, shared Button, Jira browser fixtures and mobile
Inbox/Jira routes. Two native reviews covered board input and pagination;
parent inspected shared header/detail and representative source chains.
Adjacent GitHub/Linear/GitLab/Azure capabilities are preservation boundaries.

## Surface inventory and coverage

| Surface family               | Owners                                                                                                                                                                                                     | Current evidence                                                          |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Provider/Jira view toolbar   | `src/features/inbox/ui/InboxView.tsx`, `InboxView.css`, `InboxProviderMark.tsx`                                                                                                                            | Two screenshots + source audit.                                           |
| Issue list/completeness      | InboxView; `src/features/inbox/model/jira.ts`, `githubTasks.ts`, `inboxFilters.ts`, `inboxSeen.ts`                                                                                                         | List screenshot + source; capped-list contract requires real extension.   |
| Board discovery/visibility   | `src/features/inbox/model/jiraBoard.ts`, `jira.ts`; `src/features/settings/ui/JiraSettings.tsx`                                                                                                            | Source audit; retain explicit allowed boards/hidden projects.             |
| Card activation              | `src/features/inbox/ui/JiraBoardView.tsx`; `src/shared/ui/Button.tsx`                                                                                                                                      | Matching pointer mechanism reproduced in isolated Chromium, not full app. |
| Columns/cards/scroll         | JiraBoardView; `src/features/inbox/ui/jira-board.css`                                                                                                                                                      | Board screenshot + source audit.                                          |
| Move/transitions             | JiraBoardView; jiraBoard; `src-tauri/src/jira/board.rs`                                                                                                                                                    | Source audit; gesture/menu/native restrictions preserved.                 |
| Backlog/sprints              | Same panel/models/native board                                                                                                                                                                             | Source audit; lazy visible-demand proposal.                               |
| Cursor/read scheduling       | jiraBoard, JiraBoardView; native board                                                                                                                                                                     | Source audit; advancing cursor/dedup/generation rules.                    |
| Search/count scope           | JiraBoardView; native board; capped List path                                                                                                                                                              | Source audit; loaded-only search must not imply global result.            |
| Rank/order                   | JiraBoardView; jiraBoard; native board                                                                                                                                                                     | Source audit; incomplete/filtered/hidden guards remain.                   |
| Selected detail/focus        | InboxView; `src/features/inbox/ui/InboxDetail.tsx`, `useInboxDetailData.ts`, `InboxMedia.tsx`                                                                                                              | List screenshot + source, board narrow/focus pending.                     |
| Comments/agent/discussion    | InboxDetail; `src/features/inbox/ui/InboxComments.tsx`, `InboxDiscussionPanel.tsx`, `InboxPresentation.tsx`; `src/features/inbox/model/inboxAsk.ts`, `inboxContext.ts`                                     | Screenshot/source audit; exact draft and action consequences preserved.   |
| Native/desktop/mobile bridge | `src/features/inbox/model/jiraMobileBridge.ts`, `jiraBoardProtocol.ts`; `src-tauri/src/jira/mobile_board.rs`, `src-tauri/src/desktop_inbox_review.rs`                                                      | Routing/snapshot inventory; no live operations.                           |
| Native mobile                | `mobile/src/features/inbox/jira-board-screen.tsx`, `jira-board-issue.tsx`, `jira-board-model.ts`, `jira-board-delivery.ts`, `provider-inbox-screen.tsx`; `mobile/src/features/management/inbox-screen.tsx` | Routes/model inventory, separate native acceptance.                       |

Native commands include `jira_status`, `jira_set_config`, `jira_list_projects`,
`jira_list_issues`, `jira_issue_details`, `jira_issue_thread`, `jira_issue_comment`,
`jira_list_boards`, `jira_board_configuration`, `jira_board_issues`,
`jira_issue_transitions`, `jira_issue_transition`, `jira_board_move`.
Remote-board bridge actions include `jira-boards`, `jira-board-read`,
`jira-issue-transitions`, `jira-board-transition` and reviewed board moves;
native `jira_mobile_boards/read` use desktop-owned visibility/snapshot contracts.
Do not invent a pageable List API: current List returns a capped array, while
Board has cursor pages. Required typed/native compatibility work is planned.

Reuse existing locale families: Inbox, Jira, List, Board, Kanban, Backlog & sprints,
Load more issues, Move, Saved to Jira, No issues, comment/agent and visibility
strings. Use shared SegmentedControl, SearchableSelect, Button, DropdownMenu,
Popover, Modal/overlay, inputs and Alert, with existing native props/ref semantics.

## Owner decisions

2026-10-27, current conversation `0567326f-aade-4baa-89f3-b44c6256ae9e`:

- Report: "bu jira ekranlarıda yeniden tasarlanmalı süreli load more issues demek zorundayız detaylarına tıklayınca açılmıyor kanban gösteriminde filan. Herşey çok sıradan ve anlaşılmaz gözüküyor. En üstteki list board daha uygun bir yerde gösterilebilir yeri çok yanlış ve daha uygun şekilde gösteirlmesi gerekiyor bence"
- Continuation: "Kaydırırken kontrollü yükleme (önerim)".
- Detail: "Sağda ayrıntı paneli (önerim)".

Only visible user-demand reads, no implicit background sync. Wide right detail,
narrow detail/back improves the existing aside. Finer layout remains agent design.

## Critical findings and preservation

Card title already calls onSelect and Inbox owns a detail aside. Immediate
ancestor pointer capture can retarget ordinary mouse activation away from the
button; isolated real-pointer evidence confirms that mechanism. Separate drag
from click/tap and retain actual-drag click suppression, threshold, keyboard
activation, touch pan, Move and permission/required-fields checks.

Keep List/Board and provider/board/sprint/filter identities, existing view state,
selection, scroll and issue draft ownership. List native reads cap at 40/default,
100/max without continuation; Board cursors do not solve it. Demand paging needs
real List/native response work and safe old-version/mobile compatibility.

Only visible/expanded demand fetches next page, finite budget and one in flight,
explicit error/fallback, dedup and advancing cursor. Stop on empty/nonadvancing/
failed scope without a loop. Preserve background sync off by default and explicit
board/project allowlists. Retire stale account/board/query/sprint responses.
Native mobile snapshots bind account, desktop project/window, filters and board.

Loaded counts are not totals. Loaded-only filters are not global search. Keep
last-loaded versus actual end distinct. Rank stays blocked under incomplete/
filtered/hidden scope until a deliberately proven exact-anchor strategy exists.
Do not unlock ranking merely by replacing Load more. Keep native mutation checks.

Refresh/moves must preserve read depth and selected later-page identity while
revalidating current ordering. Absence from page 1 is not deletion, but permission
revocation/confirmed deletion still invalidates display safely. Keep comments,
agent launch/discussion and Jira mutations explicit and separate. Working folder
for the agent is not automatically the Jira project. Never post or launch on read.

## Checks and scenarios

Existing focused owners: JiraBoardView, jiraBoard/jiraBoardProtocol/
jiraMobileBridge, InboxView/persistence, InboxDetail/tabs, InboxComments/
InboxDiscussionPanel, JiraSettings and native board/mobile tests.
Browser entrypoints: `tests/browser/jira-board.tsx`, `jira-board.html`,
`jira-board.spec.ts`, `playwright.jira-board.config.ts`, `vite.jira-board.config.ts`,
`serve-jira-board.mjs`. Current browser fixture uses onSelect noop: add integrated
real-pointer detail opening, keyboard/close/focus and below-threshold/actual-drag
coverage. Element.click alone cannot establish pointer capture behavior.

Use meaningful focused tests and tsc-rs, then actual light/dark at 1280/800/narrow,
long titles/statuses, mouse/touch/keyboard, complete/partial/filtered pages,
first/next/empty/repeated/failed/stale cursors, later-page detail during refresh,
rank guards, revoked boards, many planning groups and comment/move recovery.
Use fake providers for mutations. Fixture/isolated proof is not installed/live
Jira or native mobile acceptance.

## Settings connection and scope extension, 2026-10-27

The owner supplied five Settings Inbox captures and requested improved design.
Read `.agents/skills/feature-inbox-settings/SKILL.md` and
`temp/local/2026-10-27-settings-inbox-audit/` before editing JiraSettings.
The11-record/14-family cross-provider audit adds specific Jira project-read
account epochs, retain-on-error board refresh, pending scope counts/editability,
operation-specific errors and persistence/sibling reconciliation. Saved config
is not verified API access; native discovery already pages fully. Preserve hidden
project exclusions, explicit board allowlist, unknown IDs, reconnect scope,
desktop/mobile enforcement and separate background opt-in. This extension does
not alter earlier visible-demand paging decisions or implement repairs.60 tests
in seven provider/settings suites pass; no actual native/live/UI change accepted.

## Proposals, blockers and handoff

Direction: Jira-local toolbar, compact columns/cards, deliberate activation/drag,
wide right/narrow back detail and bounded user-demand paging with honest scope.
Register: `temp/local/2026-10-27-jira-redesign/AUDIT.md` (15 records: six V+S,
eight S, one I+S; 14 coverage families). Brief: adjacent `REDESIGN.md`; evidence:
`temp/verification/2026-10-27-jira-redesign/`.

Audit/card/brief/concept delivered locally and uncommitted at the baseline above.
No product or live Jira data changes. Current capture/source inclusion UNKNOWN.
Only isolated Chromium pointer mechanism was exercised; full app, installed/live
Jira, native mobile/build/install/release acceptance not performed. Live feature
claims unavailable; shared Git/session inspected without a reservation claim.
Preserve concurrent updater/sidebar/shared ButtonGroup/Host work. Update user
guides when real behavior changes, not on this proposed design alone.
