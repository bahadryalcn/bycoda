import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { NativeProducerLease } from "./nativeProducerCapture";

const captures = vi.hoisted(() => ({
  parent: vi.fn(),
  editor: vi.fn(),
  beginParent: vi.fn(),
  beginEditor: vi.fn(),
  notes: vi.fn(),
  beginNotes: vi.fn(),
}));
vi.mock("./parentInputClosure", () => ({
  captureParentInputs: captures.parent,
  beginParentInputClosure: captures.beginParent,
}));
vi.mock("../../files/data/mountedEditorClosure", () => ({
  captureEditorInputs: captures.editor,
  beginEditorInputClosure: captures.beginEditor,
}));
vi.mock("../../notes/notesInputClosure", () => ({
  captureNotesInputs: captures.notes,
  beginNotesInputClosure: captures.beginNotes,
}));
import {
  beginNativeProducerInputClosure,
  captureNativeProducerInputs,
} from "./mountedInputCapture";
afterEach(() => {
  captures.parent.mockReset();
  captures.editor.mockReset();
  captures.beginParent.mockReset();
  captures.beginEditor.mockReset();
  captures.notes.mockReset();
  captures.beginNotes.mockReset();
});
beforeEach(() => {
  captures.notes.mockResolvedValue(lease());
  captures.beginNotes.mockReturnValue(gate(lease()));
});

function lease(): NativeProducerLease {
  let current = true;
  return {
    registryEpoch: 1,
    snapshots: [],
    missingCoverage: [],
    current: () => current,
    release: vi.fn(() => {
      current = false;
    }),
  };
}

it("keeps all three real registry leases current and releases each exactly once", async () => {
  const parent = lease(),
    editor = lease(),
    notes = lease();
  captures.parent.mockResolvedValue(parent);
  captures.editor.mockResolvedValue(editor);
  captures.notes.mockResolvedValue(notes);
  const captured = await captureNativeProducerInputs("session");
  expect(captured.current()).toBe(true);
  expect(captured.missingCoverage).toContain("parent-admission-closure");
  expect(captured.missingCoverage).toContain("editor-admission-closure");
  expect(captured.missingCoverage).toContain("notes-admission-closure");
  expect(captured.notes).toBe(notes);
  editor.current = () => false;
  expect(captured.current()).toBe(false);
  captured.release();
  captured.release();
  expect(parent.release).toHaveBeenCalledOnce();
  expect(editor.release).toHaveBeenCalledOnce();
  expect(notes.release).toHaveBeenCalledOnce();
});

it("releases a genuinely late capture after its peer rejects without hiding accepted work", async () => {
  let resolve!: (value: NativeProducerLease) => void;
  captures.parent.mockImplementation(
    () =>
      new Promise<NativeProducerLease>((done) => {
        resolve = done;
      }),
  );
  captures.editor.mockRejectedValue(new Error("actual editor is busy"));
  await expect(captureNativeProducerInputs("session")).rejects.toThrow("actual editor is busy");
  const late = lease();
  resolve(late);
  await vi.waitFor(() => expect(late.release).toHaveBeenCalledOnce());
});

it("retires already acquired peers when another registry fails currentness", async () => {
  const parent = lease(),
    editor = lease();
  parent.release();
  captures.parent.mockResolvedValue(parent);
  captures.editor.mockResolvedValue(editor);
  await expect(captureNativeProducerInputs("session")).rejects.toThrow(
    "changed during acquisition",
  );
  expect(editor.release).toHaveBeenCalledOnce();
});

function gate(captured: NativeProducerLease) {
  let active = true;
  return {
    capture: vi.fn(async () => captured),
    current: () => active,
    release: vi.fn(() => {
      active = false;
    }),
  };
}

it("closes all three actual registries synchronously before obtaining any drained data", async () => {
  const parent = gate(lease()),
    editor = gate(lease()),
    notes = gate(lease());
  captures.beginParent.mockReturnValue(parent);
  captures.beginEditor.mockReturnValue(editor);
  captures.beginNotes.mockReturnValue(notes);
  const closed = beginNativeProducerInputClosure("session", {
    owner: {},
    timeoutMs: 1000,
  });
  expect(captures.beginParent).toHaveBeenCalledOnce();
  expect(captures.beginEditor).toHaveBeenCalledOnce();
  expect(captures.beginNotes).toHaveBeenCalledOnce();
  expect(parent.capture).not.toHaveBeenCalled();
  expect(editor.capture).not.toHaveBeenCalled();
  expect(notes.capture).not.toHaveBeenCalled();
  const captured = await closed.capture();
  expect(captured.current()).toBe(true);
  expect(captured.missingCoverage).not.toContain("parent-admission-closure");
  closed.release();
  closed.release();
  expect(captured.current()).toBe(false);
  expect(parent.release).toHaveBeenCalledOnce();
  expect(editor.release).toHaveBeenCalledOnce();
  expect(notes.release).toHaveBeenCalledOnce();
});

it("rolls back the first gate when the second cannot close, without taking a snapshot", () => {
  const parent = gate(lease());
  captures.beginParent.mockReturnValue(parent);
  captures.beginEditor.mockImplementation(() => {
    throw new Error("IME busy");
  });
  expect(() => beginNativeProducerInputClosure("session", { owner: {}, timeoutMs: 1000 })).toThrow(
    "IME busy",
  );
  expect(parent.release).toHaveBeenCalledOnce();
  expect(parent.capture).not.toHaveBeenCalled();
});

it("keeps the gate owned after capture failure until explicit Native-timed release", async () => {
  const parent = gate(lease()),
    editor = gate(lease());
  editor.capture.mockRejectedValue(new Error("late external change"));
  captures.beginParent.mockReturnValue(parent);
  captures.beginEditor.mockReturnValue(editor);
  const closed = beginNativeProducerInputClosure("session", {
    owner: {},
    timeoutMs: 1000,
  });
  await expect(closed.capture()).rejects.toThrow("late external change");
  expect(parent.release).not.toHaveBeenCalled();
  expect(editor.release).not.toHaveBeenCalled();
  closed.release();
  expect(parent.release).toHaveBeenCalledOnce();
  expect(editor.release).toHaveBeenCalledOnce();
});

it("reopens both earlier gates if a Notes IME cannot close without capturing any input", () => {
  const parent = gate(lease()),
    editor = gate(lease());
  captures.beginParent.mockReturnValue(parent);
  captures.beginEditor.mockReturnValue(editor);
  captures.beginNotes.mockImplementation(() => {
    throw new Error("actual Notes composition is active");
  });
  expect(() => beginNativeProducerInputClosure("session", { owner: {}, timeoutMs: 1000 })).toThrow(
    "actual Notes composition is active",
  );
  expect(parent.release).toHaveBeenCalledOnce();
  expect(editor.release).toHaveBeenCalledOnce();
  expect(parent.capture).not.toHaveBeenCalled();
  expect(editor.capture).not.toHaveBeenCalled();
});

it("releases late Notes data after a peer fails but holds original input gates until final release", async () => {
  let resolve!: (value: NativeProducerLease) => void;
  const parent = gate(lease()),
    editor = gate(lease()),
    notes = gate(lease());
  editor.capture.mockRejectedValue(new Error("original file changed"));
  notes.capture.mockImplementation(
    () => new Promise<NativeProducerLease>((done) => (resolve = done)),
  );
  captures.beginParent.mockReturnValue(parent);
  captures.beginEditor.mockReturnValue(editor);
  captures.beginNotes.mockReturnValue(notes);
  const closed = beginNativeProducerInputClosure("session", {
    owner: {},
    timeoutMs: 1000,
  });
  await expect(closed.capture()).rejects.toThrow("original file changed");
  const late = lease();
  resolve(late);
  await vi.waitFor(() => expect(late.release).toHaveBeenCalledOnce());
  expect(notes.release).not.toHaveBeenCalled();
  expect(parent.release).not.toHaveBeenCalled();
  closed.release();
  expect(notes.release).toHaveBeenCalledOnce();
  expect(editor.release).toHaveBeenCalledOnce();
  expect(parent.release).toHaveBeenCalledOnce();
});

it("invalidates a composed capture when only Notes currentness changes", async () => {
  const parent = lease(),
    editor = lease(),
    notes = lease();
  captures.parent.mockResolvedValue(parent);
  captures.editor.mockResolvedValue(editor);
  captures.notes.mockResolvedValue(notes);
  const captured = await captureNativeProducerInputs("session");
  expect(captured.current()).toBe(true);
  notes.release();
  expect(captured.current()).toBe(false);
  captured.release();
  expect(parent.release).toHaveBeenCalledOnce();
  expect(editor.release).toHaveBeenCalledOnce();
});
