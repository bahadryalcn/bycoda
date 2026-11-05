---
name: feature-file-formatting
description: "Change editor formatting, format-on-save feedback, formatter execution bounds and Native/Host format delivery recovery without losing edits or replaying uncertain effects."
---

# File formatting

Use for Format document, Alt+Shift+F and format-on-save execution. Workspace
preferences belong to [Workspace settings](../feature-workspace-settings/SKILL.md);
shared delivery authority belongs to [Host runtime](../feature-host-runtime/SKILL.md).
All source paths below are repository-root relative.

## Source map

- `src/features/files/ui/CodeMirrorEditor.tsx`: manual/automatic format, save
  generations, editor identity, undo and inline errors.
- `src/features/files/ui/FileEditor.tsx`: actual filesystem save, conflict and
  draft ownership. A formatter result does not prove a successful save.
- `src/shared/lib/format.ts`: owning-machine formatter and bundled fallback.
- `host/files/editor-format.ts`: bounded project formatter worker. Project plugins
  execute code; do not assume an uncertain formatter can be replayed safely.
- `host/native-delivery/native-delivery-store.ts`, `host/domains/native-services/service.ts`:
  original receipt, result reservation, recording, status and cleanup.
- `src-tauri/src/fs.rs`, `remote.rs`, `remote_native_service.rs` and
  `remote_native_service_delivery.rs`: native editor admission, original route,
  response ownership and durable recovery.
- `src-tauri/src/session_store/native_delivery.rs` and its `epochs.rs` module:
  immutable original bytes, bounded capacity and retirement fences.

## Preserve

- Format uses the captured unsaved buffer. It changes that buffer through the
  existing editor transaction/undo path; saving remains separately owned.
- A late format result or error cannot replace newer edits or another document.
- Format failure must not prevent the ordinary authorized save. Say the file
  was saved only after the matching save succeeds and while that document is
  still current. Manual format failure never implies a save.
- Keep configured project tools, owning-machine routing, input/output limits,
  deadlines and existing access gates. Do not download tools automatically.
- Bound format admission separately from control traffic. Retained legacy
  originals must keep their original result bounds and replay protection.
- Missing results, disconnects and timeouts do not prove failure or permit
  execution again. Release reservations only against durable original-bound
  evidence; never substitute a new route or current editor for an old consumer.
- Cleanup cannot turn a successful local handoff into failure. Preserve original
  identities and terminal fences after releasing payloads.

## Checks and references

- Exercise `CodeMirrorEditor.format.test.ts`, `CodeMirrorEditor.saveContract.test.ts`,
  `FileEditorSave.test.ts`, `src/shared/lib/format.test.ts` and the changed
  Host/native delivery suites. Include sequential saves, failed saves, late
  results, retained legacy requests, disconnect/restart and bounded exhaustion.
- `tests/browser/file-save.tsx` and its spec exercise the actual editor with
  fixture filesystem/formatter responses; label that evidence as fixtures.
- See [file content guide](../../../docs/guides/explorer-and-file-content.md)
  and [delivery architecture](../../../docs/reference/host-runtime.md).
