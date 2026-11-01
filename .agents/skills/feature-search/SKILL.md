---
name: feature-search
description: "Change workspace Search dialog/page, filters, result selection and opening while preserving scope, retained query, native visibility limits and incomplete-result truth."
---

# Workspace search changes

## When and scope

Use for general All/Conversations/Files/Projects search and its destinations. Explorer filtering, Notes full-body search and Inbox queries remain independent features.

## Source starts

Full paths are repository-root relative; adjacent abbreviated names share the preceding
directory. Follow current imports and callers; this map is not a completeness claim.

- `src/features/search/ui/SearchView.tsx`, `ChatSearchResults.tsx`: result composition and navigation.
- `src/features/search/model/`: file/conversation requests, indexing state and result identities.
- `src/app/workspace/actions/useSearchActions.ts`, `layout/LiveSearchView.tsx`: dialog/page ownership and retained context.
- `host/workspace-commands.ts`, `host/workspace-search-stream.test.ts`, `src-tauri/src/`: trace the actual file/content/conversation search commands and visibility gates.

## Preserve

- Keep normalized-cwd query/type/filter retention, contextual omitted fields, explicit dialog/page expand/restore and nested-filter Escape/focus handling.
- All combines distinct scopes: cwd files/content, the existing conversation scope and supplied recent projects. Do not silently claim all computers, Notes or Inbox coverage.
- Native result limits, display limits, ongoing indexing and loaded counts are distinct. Apply visibility/permission constraints at the owning search boundary before saturation.
- Reject stale asynchronous results and retain active result by identity rather than old index as independent sources arrive.
- Opening a result preserves exact path/session/project identity and proper owner routing; failed sources remain individually retryable.

## Workflow

1. Trace the query from dialog/page to each source, native limit/visibility contract and destination opener.
2. Check all result types and supplied scopes; preserve query and keyboard ownership during filtering or resize.
3. Exercise out-of-order results, no index/partial results, duplicate long identities and exact destination failure/retry.

## Focused checks

Run `pnpm exec vitest run src/features/search/ui/SearchView.test.ts src/app/workspace/actions/useSearchActions.test.ts src/app/workspace/layout/LiveSearchView.test.ts` plus changed search models/native commands.
Inspect compact opening, explicit page/restore, keyboard active identity, locked/filtered rows, indexing and native/display caps. Add real consumer coverage when a backend contract changes; a similar filename filter is insufficient.

## Read when needed

- [Search and recovery guide](../../../docs/guides/search-and-recovery.md) for user-visible scopes.
- [Selected opening decision](references/decisions.md) before changing dialog defaults; [Recovery](../feature-session-recovery/SKILL.md) for recovered-session actions.
