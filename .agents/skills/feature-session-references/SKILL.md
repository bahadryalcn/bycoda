---
name: feature-session-references
description: "Use when changing conversation links, citations and previews. Not for file links; see feature-generated-file-links."
---

# Local session references

Own a versioned address to existing authorized content. Link activation is not a send, unarchive, migration, execution-workspace change or public upload. Mobile, remote and OS activation preserve exact origin checks and existing authority.

## Source starts

- `src/features/sessions/model/localSessionReference.ts`
- `src/app/workspace/sessions/useLocalSessionReferences.ts`
- `docs/guides/local-session-references.md`
- The public HTTPS handoff service at `link.bycoda.codes` is server-side and lives in the private infrastructure repository; this repository owns only the client parser (`src/features/sessions/model/localSessionReference.ts`) and native link routing.
- `src-tauri/src/session_links/`: desktop cold/warm activation.
- `host/sessions/session-reference.ts`: authenticated exact-origin read guard.
- `mobile/src/features/workspace/session-reference.ts`: paired mobile resolution.
- `src/features/sessions/model/chatCitation.ts`, `src/features/sessions/model/chatCitationHighlight.ts`, `src/features/sessions/ui/ChatCitationText.tsx`: selected-message snapshots inside the current conversation, distinct from cross-session URI authority.

## Workflow

1. Trace the returned reference from persistent Host environment or Native store/profile identity through strict parsing, Markdown sanitization and existing tab/history routing.
2. Use exact tool-returned reference/link/markdownReference on first mention; read the conversation before describing its work. Found/read does not establish a message or acknowledgement.
3. Keep details lazy/read-only, with visibility checks before disclosure and after awaited history loading. Retain original target/turn identity through loading and tab insertion.
4. Check invalid/wrong-origin/locked/missing references, existing-tab/worker reuse, archived targets, older cited turns, copy failure and navigation races.

## Preserve

- Never construct a target from title, provider ID, cwd, unsent shell or guessed origin. Host environment and Native store/profile/session identity remain authoritative.
- A local origin mismatch cannot fall back to a bare session ID. Paired Host resolution requires `sessions.references.v1` and full origin validation; Native resolution may use existing verified migration receipts but must not initialize a store or start migration.
- Preserve project bounds, private reasoning exclusion, bounded pages/cursors/prose, drafts/caret/selection, archive membership and existing history/split/worker navigation.
- Invalid internal links must not fall through to OS launch. Consumers outside an authorized provider expose unavailable actions rather than inventing access.
- Selected-message citations retain exact session/block identity, source snapshot and occurrence. Hover/focus must not scroll; click may reveal the existing source. A changed/missing source preserves its saved excerpt and must never resolve by matching a different message. Reduced motion keeps a static brief highlight.
- Preview caches retain only appropriate in-flight work and invalidate on privacy-context change. Worker references navigate to the worker transcript/turn rather than silently focusing its lead.

## Focused checks

Citation parsing skips prose without its marker and bounds labels to 200 characters.
Keep malformed or unsupported links as exact editable draft text.

- Select URI/parser, actual Markdown/sanitizer/Notes interaction, navigation/visibility race, worker and Sidebar copy tests; new Native metadata needs read-only wrong-origin coverage.
- Use the session-references browser family for changed UI, then isolated Host/Native origin and history-loading checks. Existing binaries cannot establish acceptance of a new IPC command.

## References

- Read the [surface map](references/surfaces.md) for the affected UI, state, transport and test owners.
- [Reference behavior and URI format](../../../docs/guides/local-session-references.md) when changing the linked contract.
- [Host origin authority](../../../docs/reference/host-runtime.md) when changing the linked contract.
