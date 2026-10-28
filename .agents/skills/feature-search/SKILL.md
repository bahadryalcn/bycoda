---
name: feature-search
description: General workspace Search dialog/page, All/Conversations/Files/Projects, title/message/filename/content/project results, scopes/filters, FTS indexing and limits, retained query, keyboard/active identity, exact file or message opening, privacy locks and native/Host cancellation. Read before global Search redesign or workflow changes.
---

# General workspace search

## H4 source implementation, 2026-10-28

Search UI and model/action delivery for GS-U01..06 and GS-D01..04 is recorded
per ID in `temp/local/2026-10-28-search-recovery-impl/handoff.json`. Baseline
`4de508deabfdae8fd9a8c4c35ab7c4032b5924e9`, shared `main`, uncommitted packet.
Public shared controls and dialog/page/query/filter/permission owners remain
authoritative. GS-D04 visibility-before-native-limit saturation needs a typed
native search contract; client filtering must not leak locked rows or silently
narrow Everywhere to known recent directories. Test edilmedi under RULES.md;
suites, fixtures, screenshots, keyboard/reader/native acceptance remain morning
checks. Handoff records the single fast typecheck and exact dependencies. Guide:
`docs/guides/search-and-recovery.md`. No installed/build inclusion is implied.

Find and open the correct conversation/message/file/content location/project
without losing workspace context, retained query or privacy. Keywords: Search,
global search, general search, Ctrl K, All, Conversations, Files, Projects,
indexing, FTS, results, active option, expand, dialog, page.

Inventory inspected2026-10-27 at dirty shared `main @
0a42b1ab4fd891ccec5ca0fa238d7356b396b13c`. Search roots: src/features/search,
files/model, sessions/data, group-lock, shared/ui, app/workspace, src-tauri/src,
host, tests/browser, mobile/app and mobile/src. Recent history9f9271f5a,
29d534f9f,3419af022. This is T2 audit/design inventory; implementation pending.
Read feature-workbench-design and relevant sessions/projects/mobile cards plus
docs/reference/DESIGN.md, arc-ui.md, ui-design-system.md and
ui-component-catalog.md. Check live claims before source work; card is not a lock.
Claim RPC unavailable; Git/worktree/native session state inspected without
cross-machine reservation. Preserve concurrent updater/sidebar/Host/shared UI.

## Surface inventory and coverage

Full14-family checklist/10 records: `temp/local/2026-10-27-search-redesign/AUDIT.md`.
Brief: adjacent REDESIGN.md; evidence: temp/verification/2026-10-27-search-redesign.
Audit done means source/design reviewed, not product repaired or accepted.

| Surface                             | Explicit source/test owners                                                                                                                                                       | Coverage                                                                                                                                                  |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Open/close/context and dialog/page  | `src/app/workspace/actions/useSearchActions.ts`; `src/app/workspace/layout/WorkspaceAuxSurfaces.tsx`, `LiveSearchView.tsx`; `src/features/search/ui/SearchView.tsx`, `search.css` | Empty dialog screenshot/source; retained states and exact destination wiring.                                                                             |
| Mixed results and conversation rows | SearchView ResultList/rowCopy; `src/features/search/ui/ChatSearchResults.tsx`; `src/features/search/model/appSearch.ts`, `chatSearch.ts`                                          | Category order, caps, excerpts/project hierarchy, active identity and narrow copy.                                                                        |
| Query/type/filter/a11y              | SearchView; ChatSearchResults ChatFilterBar; `src/shared/ui/SearchInput.tsx`, `SegmentedControl.tsx`, `Modal.tsx`, `overlay.ts`                                                   | Input/list relationship, IME/Escape/pointer/keyboard and existing overlay ownership.                                                                      |
| File/cache/content requests         | `src/features/search/model/useProjectFileSearch.ts`, `search.ts`; `src/features/files/model/fileIndex.ts`                                                                         | Current cwd, exact path/line/column, debounce/cancel/late replies and refresh/retry.                                                                      |
| Conversation/index requests         | `src/features/search/model/useConversationSearch.ts`; `src/features/sessions/data/sessionStore.ts`; `src-tauri/src/session_store/content_search.rs`                               | FTS options/caps/index progress/role limits; no real index queried.                                                                                       |
| Privacy/project boundary            | LiveSearchView/SearchView; `src/features/group-lock/model/lockState.ts`; `src/features/projects/model/projectNames.ts`                                                            | Visible recents, locks/archive and capped-budget recall chain.                                                                                            |
| Native/Host                         | `src-tauri/src/search.rs`; `src/platform/tauri/fs.ts`; `host/server.ts`, `workspace.ts`, `workspace-commands.ts`, `workspace-search-stream.test.ts`                               | Specific routed search/cancel/limits inventory; native/Host runtime not exercised.                                                                        |
| Native mobile counterparts          | `mobile/src/remote/services/workspace-api.ts`; `mobile/src/features/management/shared/search.ts`, `social/collection-search.tsx`                                                  | Separate service/collection search inventory. No equivalent desktop global modal found in route/name scan; not a complete native phone design/acceptance. |

Native command families: `search_project`, `cancel_project_search`,
`session_search`, `session_search_content`, `cancel_session_search` (verify current sessionStore
invoke names before command changes). Host file RPCs: `files.index`,
`files.search`, `files.searchContent`; exact search/cancel routing lives in
platform/fs and workspace-commands. Follow current dispatch/owner/root/id and
revocation guards rather than exposing arbitrary new RPCs. Native/global stored
conversation search and remote workspace file search have different owners.

Sentence-key locale families: Search, Search everything..., Search in, All,
Conversations, Files, Projects, Chat search filters, Everywhere, This project,
Indexing, Results may be incomplete, Results limited to the first matches,
No results, Retry file search, Retry conversation search, Full screen, Restore,
Navigate, Open, Close. Re-enumerate actual call sites/en/tr overrides on delivery.
Reuse shared SearchInput, SegmentedControl, Button, fields, Popover and Modal;
no screen-specific visual controls or independent overlay/focus system.

## Owner decisions

2026-10-27, current conversation `0567326f-aade-4baa-89f3-b44c6256ae9e`:

- Report: "Genel search ekranı bu şekilde bunuda toparlıyabiliriz."
- Opening: "Kısa arama penceresi; sonuç geldikçe genişlesin (önerim)".

Keep existing dialog/page options, retained query/type/filters and controlled
bounded result growth without per-result movement. Do not turn this into a
recent-content/history-storage default or automatic full-page expansion.
Existing dialog-first workspace-preserving intent is also reflected in current
useSearchActions; no new command execution/search source selected.

## Behavior to preserve

- Per-normalized-cwd retained query/type/chat filters and contextual omitted
  request fields; current dialog autofocus/Escape/nested-filter dismissal,
  explicit expand/restore and native-window behavior.
- All searches current cwd filenames/content, default Everywhere nonarchived
  conversations and supplied recent projects. Conversation filters belong to
  that tab. Do not silently change query scope or claim all computers/Notes/
  social/Inbox/settings are included.
- Independent200ms debounced file/conversation requests; exact owner/cwd/query/
  searchId cancellation, stale-response rejection/current-key visibility, file
  cache refresh and source-local error/retry. Keep healthy results on partial
  failure and current bounded index work/pending polling; no background expansion.
- Distinguish local display top-K from native truncation. All caps8/8/10/12/6,
  Files40 filenames/48 content, Projects24. Native conversation60 sessions/5 hits;
  displayed snippets have further per-session limits. No true continuation cursor
  is currently exposed. Do not label displayed count a provider total.
- Fuzzy title/filename/project versus FTS token/prefix versus literal grep remain
  different. Current role set includes user/assistant/tool/tasks/plan/image; role
  scopes are absent. Historical Titles/My messages/AI request is a proposal that
  needs typed/native filtering before count/limit, not frontend postfiltering.
- Locks/archive/group/project eligibility, private snippets/counts and immediate
  removal. Visibility should not consume capped eligible recall; fix without
  leaking locked records or overreading sources.
- Preserve exact file path, content line/column, message session/block/query and
  project path. Keep selected identity stable through async merges. Input focus,
  IME/deferred-query guard, active-result announcement, pointer movement gating
  and scroll ownership must agree. No implicit opening on result arrival.
- Shared Summary/search/filter adapters and other consumers retain their own
  scopes/drafts. Phone searches are separate surfaces, not desktop CSS acceptance.

## Checks and visual scenarios

Existing test owners: `src/features/search/ui/SearchView.test.ts`;
`src/features/search/model/appSearch.test.ts`, `chatSearch.test.ts`,
`useProjectFileSearch.test.ts`, `useConversationSearch.test.ts`,
`messageSearchCache.test.ts`, `search.test.ts`;
`src/app/workspace/actions/useSearchActions.test.ts`;
`src/app/workspace/layout/LiveSearchView.test.ts`;
`src/shared/ui/SearchInput.test.ts`; native search/content_search module tests;
`host/workspace-search-stream.test.ts`. No dedicated global Search fixture found
under tests/browser. Add meaningful real-route coverage when implementing.
Use normal tsc-rs checks for source changes; isolate fake native/Host projects.

Actual dialog/page/all four types at1280/800 light/dark plus narrow containers,
font/density/zoom/custom appearance and reduced motion. Blank/retained query,
zero/one/many groups, duplicate basenames/long paths, message/full path recovery,
dialog→page→restore state, keyboard/IME/pointer/touch/focus return and child
filter-first Escape. Async source arrival/reordering/selection removal, rapid
query/cwd/cancel/late results, partial failures/retry, local/native cap+1, global
pending index outside selected scope, archived/locked/many locked versus older
eligible results. No destructive privacy checks on owner content. Separate real
screen-reader, native/Host/installed and physical mobile acceptance.

## Proposals, blockers and handoff

Propose visible scope explanation, category separation, title/snippet-first rows,
full target recovery, selected stable identity and honest incomplete/limited
states. Compact opening is owner-selected; other fine layout remains proposal.
No new search engine, role-filter implementation, Notes search or recent-query
store delivered here. Update user guides with real behavior changes later.

Card/audit/brief/concept delivered locally uncommitted at baseline above.
One V+S/nine S findings, no application failure reproduction. Build inclusion
UNKNOWN: owner capture has no source stamp. Product repairs/real theme/layout/
screen-reader/native/Host/mobile acceptance pending. Claims RPC unavailable;
installed/provider/device evidence not supplied. No build/install/release or
live search performed; preserve unrelated dirty work.
