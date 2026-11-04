---
name: feature-session-recovery
description: "Change recovered conversations, previous chat layout, verification/attention status, selection/bulk scopes, journal maintenance or native file-copy recovery presentation."
---

# Session recovery

Only interrupted work enters recovery. Opening recovery entries is navigation, not a submitted turn. Conversation-journal maintenance is separate from native file-copy recovery and from history deletion. Host/native source owners retain durability and recovery authority.

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

- Scope: boot captures only sessions named by the in-flight list (`interrupted` in `src/app/model/appLifecycle.ts`), minus inbox asks, orchestration leads and unsent remote chats. Remote chats keep running on their Host and enter only when listed in flight. Never re-add "every open chat with a user message".
- Native in-flight ownership aggregates contributions by exact page and window; clearing one contribution cannot clear another. The canonical aggregate remains visible to Host and worktree consumers. Prior-process recovery requires an unlocked kernel lease; same-process recovery requires confirmed retirement of the exact page. Live, pending and unknown owners remain protected, and late confirmed retirements enter the journal without automatic continuation. A native receipt binds exact recovered occurrences to the saved journal; acknowledge only covered, still-retired rows in the same transaction. Remote Host activity is not inferred from local page retirement.
- Closing an SSE reader does not prove its provider turn ended. A page with unproven external-stream retirement remains unknown; never turn transport teardown into local interruption or automatic continuation.
- `useRecoveryAutoResolve` resolves entries confirmed Done/Idle (references only, never history or running work), skips loading/unreadable/unverified/unavailable ones, and opens the dialog after boot only when attention work remains. The rail count is then the attention count.
- Dialog density: tabs exist only for non-empty content (no strip for conversations alone; reports ride with file copies because they can only be counted after a manual listing); the Needs attention/All filter shows only while it separates rows and defaults to All otherwise; search only above 8 rows; the list menu only above one row and lists only applicable actions; scope/consequence text lives in the `InfoPopover`, not a footer paragraph.
- Recovered/dismissed/resolved IDs remain held from automatic continuation; list cleanup does not stop work or erase conversation history.
- Explicit owner Stop is terminal idle for recovery, even when older history uses `notice: "interrupt"`. Never auto-continue that stop or remove its history note; retain actual app/Host interruptions and unknown/unverified read handling.
- Attention includes non-Done/non-Idle states, including unknown/unavailable. A failed read is not a confirmed missing session.
- Open all/Restore includes eligible filter-hidden rows; selected actions intersect selected IDs with shown rows while retaining hidden selections.
- Restore concerns saved chat splits, preserving unrelated new work; do not silently recreate stale editor/terminal panes or promise the entire workbench.
- Preserve alias/existing-tab dedup, exact remote cwd/session identity, authored titles and provider context without restarting. A missing local session must not become a fabricated shell.
- Explicit conversation deletion is durable across restart. Native and Host deletion markers reject late saves/adoption; boot removes confirmed deleted IDs from saved layouts, in-flight references and recovery entries before claiming them. A failed deletion lookup remains unknown and retains the restore retry. Never expire renderer deletion guards on a timer.
- Stale in-flight references cannot override owner Stop. An existing adjacent Stop + exact app-quit notice also remains stopped without erasing history; native summaries and recovery/list classifiers must agree. Unsent-draft disposal retains its guarded same-ID editing flow.
- Retain serialized journal writes/rollback, pending duplicate guards and lock/privacy rechecks. Conversation maintenance cannot clear original file copies; unknown file-open/save outcomes retain their original identity.
- Native editor copies may carry exact `serializedText` for mixed line endings. Validate its normalized text, digest and byte charge through capture, recovery and checkpoint proof; missing legacy values retain their original uniform-EOL interpretation. Existing record limits still apply, and rejected captures cannot claim durable recovery or a completed save.

## Verification and references

- Select existing recovery model/action/panel/journal tests, plus editor draft-recovery hooks when file-copy behavior changes.
- Use the affected recovery UI matrix including partial/read/save error states. Actual Native persistence/Host status and restore need isolated integration evidence beyond fixtures.
- Read the [surface map](references/surfaces.md) for the affected UI, state, transport and test owners. Re-search current callers before broad changes.
- Durable choice provenance: [owner decisions](references/decisions.md).
- [Conversation recovery](../../../docs/guides/search-and-recovery.md)
- [Editor draft recovery](../../../docs/guides/editor-draft-recovery.md)
- [Source authority](../../../docs/reference/host-runtime.md)
