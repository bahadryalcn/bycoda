import { expect, it } from "vitest";
import { createNotesInputClosure, NotesInputClosureError } from "./notesInputClosure";
import {
  createMountedEditorClosure,
  MountedEditorClosureError,
} from "../files/data/mountedEditorClosure";

it("captures a genuine separate Notes family without guessing a session grant", async () => {
  const notes = createNotesInputClosure();
  const files = createMountedEditorClosure();
  notes.registerNoteInput(() => ({
    snapshot: { noteId: "actual-note", rawTitle: "  ", tagsDraft: "  pending tag  " },
  }));
  const captured = await notes.captureNotesInputs("logical-root");
  expect(captured.snapshots[0]).toMatchObject({ kind: "note-editor", id: 1, revision: 0 });
  expect(captured.snapshots[0]).not.toHaveProperty("sessionId");
  expect(captured.missingCoverage).toContain("notes-profile-shared");
  expect(captured.missingCoverage).not.toContain("editor-profile-shared");
  expect((await files.captureEditorInputs("logical-root")).snapshots).toEqual([]);
  captured.release();
});

it("keeps feature error identities and the existing file-wrapper semantics", async () => {
  const notes = createNotesInputClosure();
  const files = createMountedEditorClosure();
  notes.register(() => ({ snapshot: { invalid: -0 } }));
  files.register(() => ({ snapshot: { invalid: -0 } }));
  const noteError = await notes.captureNotesInputs("root").catch((error: unknown) => error);
  const fileError = await files.captureEditorInputs("root").catch((error: unknown) => error);
  expect(noteError).toBeInstanceOf(NotesInputClosureError);
  expect(noteError).not.toBeInstanceOf(MountedEditorClosureError);
  expect(fileError).toBeInstanceOf(MountedEditorClosureError);
  expect((fileError as Error).name).toBe("MountedEditorClosureError");
});
