---
name: feature-inbox-github
description: "Change GitHub Inbox collection, issue/PR details, code review, checks and actions with exact-record identity, retained drafts and provider approval gates."
---

# GitHub Inbox changes

## When and scope

Use for GitHub issues and pull requests inside Inbox, including compact cards and linked details. Connection setup belongs to Inbox settings; Git repository operations and shared diff rendering have separate contracts.

## Source starts

Full paths are repository-root relative; adjacent abbreviated names share the preceding
directory. Follow current imports and callers; this map is not a completeness claim.

- `src/features/inbox/ui/InboxView.tsx`, `InboxDetail.tsx`, `InboxPrDiff.tsx`, `InboxPrChecks.tsx`, `InboxPrActions.tsx`: collection/detail/actions.
- `src/features/inbox/model/githubTasks.ts` and adjacent provider/read-gate/freshness models: fetching and cached identity.
- `src/features/source-control/ui/UnifiedDiffView.tsx`: Inbox code review rendering.
- `src-tauri/src/`, `host/`: search exact `git_github_` commands and `inbox.provider.*` routes before changing delivery.

## Preserve

- Keep provider/account/repository/kind/key/cwd and exact PR head identity through reads, drafts and writes. An old head cannot authorize a newer review.
- Unread, lifecycle and needs-review are distinct. Shown counts/local reveal are not proof of complete provider results or full-body search.
- `inboxSeen.ts` migrates legacy seen history to exact-key IndexedDB records, retains legacy bytes for older windows, and bounds the in-memory cache. Writes merge timestamps transactionally; unavailable storage and partial saves remain visible and retryable. First-snapshot staging commits one complete generation. Partial fetches do not prove an identity is safe to evict.
- Retain saved filters, selected detail/tab/file, comment/Ask/repair drafts and responsive detail/back navigation.
- Keep bounded fetching, cache/in-flight deduplication, late-response rejection, good data on error and operation-specific recovery.
- Media authentication coalesces only concurrent token lookups; bound request admission, token output and deadlines, retain original process and pipe ownership through retirement, and never cache credentials after the flight.
- Public comments, reviews, merge and repair actions retain their native owner approval and provider gates; reads and drafts grant no write authority.
- An agent review is approved once: the conversation approval leaves a native one-shot grant bound to the exact review content, and `desktop_inbox_review` consumes it instead of prompting again; changed, reused or late content asks again.

## Workflow

1. Trace the requested GitHub flow across collection, detail, model and actual provider dispatcher; inspect compact/linked entry points.
2. Separate shared Inbox chrome changes from GitHub paging/revision behavior and Jira-specific decisions.
3. Exercise the exact target revision, incomplete/error data, retained drafts and uncertain write results with disposable data.

## Focused checks

Run affected Inbox/model suites, starting with `pnpm exec vitest run src/features/inbox/ui/InboxView.test.ts src/features/inbox/ui/InboxDetail.tabs.test.ts src/features/inbox/model/githubTasks.test.ts`.
Code-review changes need `UnifiedDiffViewSplit.test.ts`/markers tests and a real Inbox consumer. A CodeMirror diff fixture alone does not verify Inbox review. Check Summary/Code/Checks, long file lists and narrow detail/back.

## Read when needed

- [Inbox connection settings](../feature-inbox-settings/SKILL.md) for authentication/configured-versus-verified state.
- [Source control](../feature-source-control/SKILL.md) when shared diff controls change; [Jira](../feature-inbox-jira/SKILL.md) when shared Inbox shell changes.
