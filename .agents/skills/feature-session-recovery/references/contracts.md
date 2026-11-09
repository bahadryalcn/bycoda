# Session recovery contracts

Read only the section needed for the change. Source owners remain in [the surface map](surfaces.md).

## Eligibility and retirement

- Scope: boot captures only sessions named by the in-flight list (`interrupted` in `src/app/model/appLifecycle.ts`), minus inbox asks, orchestration leads and unsent remote chats. Remote chats keep running on their Host and enter only when listed in flight. Never re-add "every open chat with a user message".

- Native in-flight ownership aggregates contributions by exact page and window; clearing one contribution cannot clear another. The canonical aggregate remains visible to Host and worktree consumers. Prior-process recovery requires an unlocked kernel lease; same-process recovery requires confirmed retirement of the exact page. Live, pending and unknown owners remain protected, and late confirmed retirements enter the journal without automatic continuation. A native receipt binds exact recovered occurrences to the saved journal; acknowledge only covered, still-retired rows in the same transaction. Remote Host activity is not inferred from local page retirement.

- Closing an SSE reader does not prove its provider turn ended. A page with unproven external-stream retirement remains unknown; never turn transport teardown into local interruption or automatic continuation.

## Attention and continuation

- `useRecoveryAutoResolve` resolves entries confirmed Done/Idle (references only, never history or running work), skips loading/unreadable/unverified/unavailable ones, and opens the dialog after boot only when attention work remains. The rail count is then the attention count.

- Recovered/dismissed/resolved IDs remain held from automatic continuation; list cleanup does not stop work or erase conversation history.

- Explicit owner Stop is terminal idle for recovery, even when older history uses `notice: "interrupt"`. Never auto-continue that stop or remove its history note; retain actual app/Host interruptions and unknown/unverified read handling.

- Attention includes non-Done/non-Idle states, including unknown/unavailable. A failed read is not a confirmed missing session.

- Stale in-flight references cannot override owner Stop. An existing adjacent Stop + exact app-quit notice also remains stopped without erasing history; native summaries and recovery/list classifiers must agree. Unsent-draft disposal retains its guarded same-ID editing flow.

## Selection and restoration

- Open all/Restore includes eligible filter-hidden rows; selected actions intersect selected IDs with shown rows while retaining hidden selections.

- Restore concerns saved chat splits, preserving unrelated new work; do not silently recreate stale editor/terminal panes or promise the entire workbench.

- Preserve alias/existing-tab dedup, exact remote cwd/session identity, authored titles and provider context without restarting. A missing local session must not become a fabricated shell.

## Durability and file copies

- Explicit conversation deletion is durable across restart. Native and Host deletion markers reject late saves/adoption; boot removes confirmed deleted IDs from saved layouts, in-flight references and recovery entries before claiming them. A failed deletion lookup remains unknown and retains the restore retry. Never expire renderer deletion guards on a timer.

- Retain serialized journal writes/rollback, pending duplicate guards and lock/privacy rechecks. Conversation maintenance cannot clear original file copies; unknown file-open/save outcomes retain their original identity.

- Native editor copies may carry exact `serializedText` for mixed line endings. Validate its normalized text, digest and byte charge through capture, recovery and checkpoint proof; missing legacy values retain their original uniform-EOL interpretation. Existing record limits still apply, and rejected captures cannot claim durable recovery or a completed save.

## Presentation

Show tabs only for non-empty content; conversations alone need no strip. Reports
share file copies because manual listing establishes their count. Search appears
above eight rows and the list menu above one row, containing only applicable
actions. Put scope/consequence copy in `InfoPopover`, not a footer paragraph.
The Needs attention/All filter appears only when it separates rows; otherwise
default to All. Panel regressions cover filter and consequence presentation.
