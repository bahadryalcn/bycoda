---
name: feature-session-recovery
description: "Use when changing recovered conversations, the recovery panel, chat splits and journals. Not for archived conversations; see feature-archive."
---

# Session recovery

Own interrupted-conversation recovery, previous chat splits, attention/verification, selection and journal maintenance across workspace UI, session models, Host/native storage. File-copy recovery has separate source authority; opening recovered entries navigates without submitting a turn or deleting history.

## Source starts

- Dialog composition and file-copy sections: `src/app/workspace/layout/`; rail entry: `src/app/shell/`.
- Conversation actions/journal: `src/app/workspace/sessions/`; boot/retirement: `src/app/model/`; session state: `src/features/sessions/`.
- File-copy actions: `src/app/workspace/files/`, `src/features/files/`; Host storage: `host/sessions/`; native storage: `src-tauri/src/session_store/`.

## Workflow

1. Trace dialog, action hooks, journal and status verification; separate conversation entries from native copies.
2. Compute eligible/all, selected/shown and hidden populations; recheck locks, identity and membership across preparation and tab insertion.
3. Retain successful opens while reporting remaining failures and journal-save/ack errors separately; retry without duplicate tabs or unknown writes.
4. Exercise restore, already-open, unavailable/read-error/stale-remote, partial success, close/save failure and independent copy search/open/retry.

## Preserve

- Boot captures only eligible in-flight interruptions, excluding inbox asks, orchestration leads and unsent remote chats; remote Host work remains running.
- Native contributions bind exact page/window and durable journal receipts. Recovery requires proven process/page retirement; live, pending and unknown owners stay protected.
- SSE teardown does not prove provider retirement or authorize local interruption/continuation; remote Host activity is independent of local page retirement.
- Auto-resolution removes only references confirmed Done/Idle. Loading, unreadable, unverified and unavailable remain unresolved; boot opens only for attention work.
- Recovered, dismissed and resolved IDs remain held from automatic continuation. Cleanup neither stops work nor deletes history.
- Owner Stop is terminal idle, including legacy interrupt notices and adjacent quit markers; retain transcript bytes and consistent native/list/recovery classification.
- Attention includes unknown/unavailable. Failed reads never prove absence; keep retry available.
- Open all/Restore includes eligible filter-hidden rows; selected actions intersect shown rows while retaining hidden selections.
- Restore saved chat splits without replacing unrelated work or recreating stale editor/terminal panes. Deduplicate aliases/tabs and retain exact remote identity, authored titles and provider context.
- Durable deletion fences late saves/adoption and boot references across restart; unknown lookups retain retry and renderer guards never expire by timer.
- Serialize journal writes with rollback, duplicate guards and lock/privacy rechecks. Conversation maintenance cannot clear file copies; unknown effects keep their original identity.
- File-copy capture/recovery/checkpoint proof retains exact source, normalized text, digest and byte accounting; rejected capture cannot claim durable recovery or completed save.

## Focused checks

Select recovery model/action/panel/journal tests in `src/app/model/`, `src/app/workspace/sessions/`, `src/app/shell/` and `src/features/sessions/model/`. File-copy changes also need `src/app/workspace/files/` and `src/features/files/` suites; UI fixture: `tests/browser/sessions/session-recovery.spec.ts`. Cover partial/read/save failures. Native persistence, live Host verification and restore need isolated integration evidence beyond fixtures.

## References

- [Source owners](references/surfaces.md): UI, journal, Host/native and test seams.
- [Recovery contracts](references/contracts.md): retirement receipts, eligibility, exact source and selection details.
- [Owner decisions](references/decisions.md): durable choice provenance.
- [Conversation recovery](../../../docs/guides/search-and-recovery.md): user-visible actions.
- [Editor draft recovery](../../../docs/guides/editor-draft-recovery.md): independent file copies.
- [Host runtime](../../../docs/reference/host-runtime.md): source authority.
- [Testing order](../../../docs/reference/testing.md): focused checks and evidence.
