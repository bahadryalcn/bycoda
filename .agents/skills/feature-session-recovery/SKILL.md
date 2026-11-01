---
name: feature-session-recovery
description: "Change recovered conversations, previous chat layout, verification/attention status, selection/bulk scopes, journal maintenance or native file-copy recovery presentation."
---

# Session recovery

Opening recovery entries is navigation, not a submitted turn. Conversation-journal maintenance is separate from native file-copy recovery and from history deletion. Host/native source owners retain durability and recovery authority.

## Source entry points

Code paths below are repository-root relative.

- `src/app/workspace/layout/WorkspaceRecoveryDialog.tsx`
- `src/app/workspace/sessions/useSessionRecoveryActions.ts`
- `docs/guides/search-and-recovery.md`

## Workflow

1. Locate the existing recovery dialog/panel, action hooks, journal and current status verification. Separate conversation entries from native file copies before changing scope.
2. Calculate eligible/all, selected/shown and hidden selections deliberately. Revalidate project locks, identity and membership during async preparation and tab insertion.
3. Keep successful opens while reporting remaining failures and journal-save/acknowledgement errors separately; retries must not duplicate already opened tabs or repeat unknown writes.
4. Exercise restore, already-open, unavailable/read-error/stale-remote, partial success, close/save failure and independent file-copy search/open/retry.

## Preserve

- Recovered/dismissed/resolved IDs remain held from automatic continuation; list cleanup does not stop work or erase conversation history.
- Attention includes non-Done/non-Idle states, including unknown/unavailable. A failed read is not a confirmed missing session.
- Open all/Restore includes eligible filter-hidden rows; selected actions intersect selected IDs with shown rows while retaining hidden selections.
- Restore concerns saved chat splits, preserving unrelated new work; do not silently recreate stale editor/terminal panes or promise the entire workbench.
- Preserve alias/existing-tab dedup, exact remote cwd/session identity, authored titles and provider context without restarting. A missing local session must not become a fabricated shell.
- Retain serialized journal writes/rollback, pending duplicate guards and lock/privacy rechecks. Conversation maintenance cannot clear original file copies; unknown file-open/save outcomes retain their original identity.

## Verification and references

- Select existing recovery model/action/panel/journal tests, plus editor draft-recovery hooks when file-copy behavior changes.
- Use the affected recovery UI matrix including partial/read/save error states. Actual Native persistence/Host status and restore need isolated integration evidence beyond fixtures.
- Read the [surface map](references/surfaces.md) for the affected UI, state, transport and test owners. Re-search current callers before broad changes.
- [Conversation recovery](../../../docs/guides/search-and-recovery.md)
- [Editor draft recovery](../../../docs/guides/editor-draft-recovery.md)
- [Source authority](../../../docs/reference/host-runtime.md)
