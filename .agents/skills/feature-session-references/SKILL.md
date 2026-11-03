---
name: feature-session-references
description: "Change stable local conversation links/citations, origin resolution, sessions.list/read references, copy actions, lazy previews and cited-turn navigation."
---

# Local session references

Own a versioned address to existing authorized local content. Link activation is not a send, unarchive, migration, execution-workspace change or public upload. Mobile/remote/OS scheme launch require their own explicit implementation and authority.

## Source entry points

Code paths below are repository-root relative.

- `src/features/sessions/model/localSessionReference.ts`
- `src/app/workspace/sessions/useLocalSessionReferences.ts`
- `docs/guides/local-session-references.md`
- `src/features/sessions/model/chatCitation.ts`, `src/features/sessions/model/chatCitationHighlight.ts`, `src/features/sessions/ui/ChatCitationText.tsx`: selected-message snapshots inside the current conversation, distinct from cross-session URI authority.

## Workflow

1. Trace the returned reference from persistent Host environment or Native store/profile identity through strict parsing, Markdown sanitization and existing tab/history routing.
2. Use exact tool-returned reference/link/markdownReference on first mention; read the conversation before describing its work. Found/read does not establish a message or acknowledgement.
3. Keep details lazy/read-only, with visibility checks before disclosure and after awaited history loading. Retain original target/turn identity through loading and tab insertion.
4. Check invalid/wrong-origin/locked/missing references, existing-tab/worker reuse, archived targets, older cited turns, copy failure and navigation races.

## Preserve

- Never construct a target from title, provider ID, cwd, unsent shell or guessed origin. Host environment and Native store/profile/session identity remain authoritative.
- Wrong-origin mismatch has no authority fallback. Native resolution may use existing verified migration receipts but must not initialize a store or start migration.
- Preserve project bounds, private reasoning exclusion, bounded pages/cursors/prose, drafts/caret/selection, archive membership and existing history/split/worker navigation.
- Invalid internal links must not fall through to OS launch. Consumers outside an authorized provider expose unavailable actions rather than inventing access.
- Selected-message citations retain exact session/block identity, source snapshot and occurrence. Hover/focus must not scroll; click may reveal the existing source. A changed/missing source preserves its saved excerpt and must never resolve by matching a different message. Reduced motion keeps a static brief highlight.
- Preview caches retain only appropriate in-flight work and invalidate on privacy-context change. Worker references navigate to the worker transcript/turn rather than silently focusing its lead.

## Verification and references

- Select URI/parser, actual Markdown/sanitizer/Notes interaction, navigation/visibility race, worker and Sidebar copy tests; new Native metadata needs read-only wrong-origin coverage.
- Use the session-references browser family for changed UI, then isolated Host/Native origin and history-loading checks. Existing binaries cannot establish acceptance of a new IPC command.
- Read the [surface map](references/surfaces.md) for the affected UI, state, transport and test owners. Re-search current callers before broad changes.
- [Reference behavior and URI format](../../../docs/guides/local-session-references.md)
- [Host origin authority](../../../docs/reference/host-runtime.md)
