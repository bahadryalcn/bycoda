// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  beginNotesInputClosure,
  captureNotesInputs,
  type NotesInputClosure,
} from "./notesInputClosure";
import {
  NoteInputOwner,
  noteActivityOwner,
  publishNoteInputResult,
  deriveNoteInputResult,
  getNotePrivateRecoveries,
  NOTE_PRIVATE_INPUT_LIMITS,
} from "./notesInputOwners";
import {
  draftInputOwner,
  drafts,
  enqueueNoteSave,
  pruneDraft,
  removeNoteDraft,
} from "./noteDrafts";
import { resolveNoteImagePath, upsertNote, type Note } from "./notes";
import { resetNoteInputWindowForTest } from "./testing/noteInputWindow.test-support";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
const owners: NoteInputOwner[] = [];
const closures: NotesInputClosure[] = [];
const note: Note = {
  id: "logical-note",
  slug: "logical",
  title: "Original",
  body: "raw\r\n漢🦀\n",
  tags: ["tag"],
  createdAt: 1,
  updatedAt: 1,
};
beforeEach(() => {
  resetNoteInputWindowForTest();
  invoke.mockReset();
  noteActivityOwner();
});
afterEach(() => {
  closures.splice(0).forEach((close) => close.release());
  owners.splice(0).forEach((owner) => owner.retire());
  for (const id of drafts.keys()) removeNoteDraft(id);
});
function owner(surface = "retained-draft") {
  const value = new NoteInputOwner(() => ({ surface, noteId: note.id, canonical: note }));
  owners.push(value);
  return value;
}
function close() {
  const value = beginNotesInputClosure("target", { owner: {}, timeoutMs: 10_000 });
  closures.push(value);
  return value;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (value: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

it("retains independent exact library/session drafts as note-editor, never a file ACK", async () => {
  owner("library");
  owner("session-dock");
  const lease = await captureNotesInputs("target");
  const rows = lease.snapshots.filter((row) => row.snapshot.noteId === note.id);
  expect(rows).toHaveLength(2);
  for (const row of rows) {
    expect(row.kind).toBe("note-editor");
    expect(row).not.toHaveProperty("sessionId");
    expect(row.snapshot).toMatchObject({
      version: 1,
      qualified: false,
      origin: "local-native",
      canonical: { body: note.body },
    });
    expect(row.snapshot).not.toHaveProperty("nativeDraftReceipt");
  }
  lease.release();
});

it("carries actual original delayed queue work through Native result while denying new service ingress", async () => {
  const draft = {
    edits: { current: { body: "unsaved\r\n" } },
    project: { current: null },
    skipSave: { current: false },
    error: null,
    base: note,
  };
  drafts.set(note.id, draft);
  const input = draftInputOwner(draft);
  const original = input.operation("original-autosave-delay")!;
  const result = deferred<Note>();
  invoke.mockReturnValue(result.promise);
  const gate = close();
  const queued = enqueueNoteSave(
    note.id,
    async (_latest, work) => {
      const saved = await upsertNote(
        {
          id: note.id,
          expectedUpdatedAt: 1,
          title: note.title,
          body: draft.edits.current.body,
          tags: note.tags,
        },
        work,
      );
      work!.apply(() => {
        draft.base = saved;
      });
      return saved;
    },
    original,
  );
  original();
  let captured = false;
  const capturing = gate.capture().then((lease) => {
    captured = true;
    return lease;
  });
  await Promise.resolve();
  expect(captured).toBe(false);
  await expect(
    upsertNote({ id: "new", expectedUpdatedAt: 0, title: "New", body: "no", tags: [] }),
  ).rejects.toThrow("Preparing checkpoint");
  expect(invoke).toHaveBeenCalledTimes(1);
  result.resolve({ ...note, body: "unsaved\r\n", updatedAt: 2 });
  await queued;
  const data = await capturing;
  expect(
    data.snapshots.find((row) => row.snapshot.noteId === note.id)?.snapshot.canonical,
  ).toMatchObject({ body: "unsaved\r\n" });
  expect(gate.current()).toBe(true);
  data.release();
});

it("never carries a synchronous original permit across await or into another owner", async () => {
  const first = owner();
  const second = owner();
  const original = first.operation("original")!;
  const gate = close();
  expect(second.operation("foreign", original)).toBeNull();
  await original.apply(async () => {
    await Promise.resolve();
    await expect(resolveNoteImagePath("/note-assets/id/x.png")).rejects.toThrow(
      "Preparing checkpoint",
    );
  });
  expect(invoke).not.toHaveBeenCalled();
  original();
  const data = await gate.capture();
  data.release();
  gate.release();
  expect(first.operation("finished-parent", original)).toBeNull();
  await expect(resolveNoteImagePath("/note-assets/id/late.png", original)).rejects.toThrow(
    "busy or unavailable",
  );
  expect(invoke).not.toHaveBeenCalled();
});

it("retains retiring accepted work and its unapplied original without reading removed DOM after its real finalizer", async () => {
  const input = owner();
  const read = vi.fn(() => ({ snapshot: { text: "private exact draft" } }));
  const port = input.observer("title").attach(read, { canClose: () => true, close: () => {} });
  const work = port.operation("deferred-title-submit")!;
  port.unregister();
  input.retire();
  read.mockClear();
  await expect(captureNotesInputs("target")).rejects.toMatchObject({ code: "busy" });
  expect(read).not.toHaveBeenCalled();
  work();
  work();
  const data = await captureNotesInputs("target");
  expect(data.snapshots.find((row) => row.snapshot.noteId === note.id)!.snapshot.inputs).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ text: "private exact draft", mounted: false, unapplied: true }),
    ]),
  );
  expect(read).not.toHaveBeenCalled();
  data.release();
});

it("forwards live and retained missing coverage and explicitly marks unreadable retired input", async () => {
  const input = owner();
  let unavailable = false;
  const port = input.observer("private").attach(
    () => {
      if (unavailable) throw new Error("removed private input");
      return { snapshot: { text: "exact" }, missingCoverage: ["notes-real-private-gap"] };
    },
    { canClose: () => true, close: () => {} },
  );
  const first = await captureNotesInputs("target");
  expect(first.missingCoverage).toContain("notes-real-private-gap");
  first.release();
  port.unregister();
  const retained = await captureNotesInputs("target");
  expect(retained.missingCoverage).toContain("notes-real-private-gap");
  retained.release();
  const bad = input.observer("unreadable").attach(
    () => {
      if (unavailable) throw new Error("lost");
      return { snapshot: { text: "last" } };
    },
    { canClose: () => true, close: () => {} },
  );
  unavailable = true;
  bad.unregister();
  const final = await captureNotesInputs("target");
  expect(final.missingCoverage).toContain("notes-retired-input-unreadable");
  expect(final.snapshots.find((row) => row.snapshot.noteId === note.id)?.snapshot.inputs).toEqual(
    expect.arrayContaining([expect.objectContaining({ retainedInputStatus: "unreadable" })]),
  );
  final.release();
});

it("preserves an actual Native failure once and permits raw failed data after true settlement", async () => {
  const input = owner();
  const original = input.operation("accepted")!;
  const result = deferred<string>();
  invoke.mockReturnValue(result.promise);
  const gate = close();
  const actual = resolveNoteImagePath("/note-assets/original/file.png", original);
  result.reject(new Error("original Native gate refused"));
  await expect(actual).rejects.toThrow("original Native gate refused");
  original();
  const data = await gate.capture();
  expect(invoke).toHaveBeenCalledExactlyOnceWith("notes_image_path", {
    asset: "/note-assets/original/file.png",
  });
  data.release();
});

it("preserves external ABA and invalidates the original cut even when final bytes match", async () => {
  const input = owner();
  const gate = close();
  const data = await gate.capture();
  input.external(() => {});
  expect(gate.current()).toBe(false);
  expect(data.current()).toBe(false);
  await expect(gate.capture()).rejects.toMatchObject({ code: "busy" });
  data.release();
});

it("reports actual open work capacity without invoking Native, clearing private input or inventing a completed save", async () => {
  const input = owner();
  const accepted = Array.from({ length: 16 }, () => input.operation("accepted-slow-work")!);
  try {
    expect(accepted.every(Boolean)).toBe(true);
    expect(input.operation("new-at-capacity")).toBeNull();
    await expect(resolveNoteImagePath("/note-assets/id/over-cap.png", accepted[0])).rejects.toThrow(
      "busy or unavailable",
    );
    expect(invoke).not.toHaveBeenCalled();
    await expect(captureNotesInputs("target")).rejects.toMatchObject({ code: "busy" });
  } finally {
    accepted.forEach((work) => work?.());
  }
  const later = input.operation("explicit-later-request");
  expect(later).not.toBeNull();
  later!();
  const data = await captureNotesInputs("target");
  data.release();
});

it("holds the original successful writer until the exact published canonical object commits", async () => {
  const input = owner();
  const target = {};
  const detach = input.attachCanonical(target);
  const original = input.operation("actual-native-writer")!;
  const gate = close();
  const saved = { ...note, body: "actual returned bytes", updatedAt: 2 };
  original.apply(() => publishNoteInputResult(original, saved));
  const summary = deriveNoteInputResult({ ...saved, body: undefined }, saved);
  const rendered = deriveNoteInputResult({ ...summary, body: saved.body }, saved, summary);
  original();
  let captured = false;
  const pending = gate.capture().then((data) => {
    captured = true;
    return data;
  });
  await Promise.resolve();
  expect(captured).toBe(false);
  expect(input.operation("cannot-reuse-finished-parent", original)).toBeNull();
  expect(input.commitCanonical(target, { ...rendered })).toBe(false);
  expect(input.commitCanonical(target, rendered)).toBe(true);
  expect(input.commitCanonical(target, rendered)).toBe(false);
  const data = await pending;
  expect(gate.current()).toBe(true);
  expect(data.current()).toBe(true);
  data.release();
  gate.release();
  detach();
});

it("rejects equal unmarked refresh and actual external ABA while an owned result awaits commit", async () => {
  const input = owner();
  const target = {};
  const detach = input.attachCanonical(target);
  const original = input.operation("original")!;
  const gate = close();
  const saved = { ...note, updatedAt: 2 };
  original.apply(() => publishNoteInputResult(original, saved));
  original();
  const unmarked = { ...saved };
  expect(input.commitCanonical(target, unmarked)).toBe(false);
  expect(deriveNoteInputResult({ ...saved }, saved, unmarked)).toEqual(saved);
  expect(input.commitCanonical(target, deriveNoteInputResult({ ...saved }, saved, unmarked))).toBe(
    false,
  );
  input.external(() => {});
  input.external(() => {});
  expect(input.commitCanonical(target, saved)).toBe(false);
  expect(gate.current()).toBe(false);
  await expect(gate.capture()).rejects.toMatchObject({ code: "busy" });
  gate.release();
  detach();
});

it("never lets an old admitted writer publish into a replacement view generation", async () => {
  const input = owner();
  const target = {};
  const detach = input.attachCanonical(target);
  const first = input.observer("source").attach(() => ({ snapshot: { text: "old" } }), {
    canClose: () => true,
    close: () => {},
  });
  const original = first.operation("old-view-save")!;
  const gate = close();
  first.unregister();
  const second = input.observer("source").attach(() => ({ snapshot: { text: "replacement" } }), {
    canClose: () => true,
    close: () => {},
  });
  const saved = { ...note, updatedAt: 2 };
  original.apply(() => publishNoteInputResult(original, saved));
  expect(input.commitCanonical(target, saved)).toBe(false);
  original();
  expect(gate.current()).toBe(false);
  await expect(gate.capture()).rejects.toMatchObject({ code: "busy" });
  gate.release();
  second.unregister();
  detach();
});

it("commits the exact later queued publication without orphaning batched earlier writer obligations", async () => {
  const input = owner();
  const target = {};
  const detach = input.attachCanonical(target);
  const first = input.operation("first-queued-writer")!;
  const second = input.operation("second-queued-writer")!;
  const gate = close();
  const earlier = { ...note, title: "earlier", updatedAt: 2 };
  const later = { ...note, title: "later", updatedAt: 3 };
  first.apply(() => publishNoteInputResult(first, earlier));
  second.apply(() => publishNoteInputResult(second, later));
  first();
  second();
  expect(input.commitCanonical(target, later)).toBe(true);
  const data = await gate.capture();
  expect(gate.current()).toBe(true);
  expect(input.commitCanonical(target, earlier)).toBe(false);
  data.release();
  gate.release();
  detach();
});

it("drops a definitely rejected production upsert request even without an editor owner", async () => {
  // Tauri rejects with what the command returned (a string), never an Error.
  const failure = "Native rejected the note";
  invoke.mockRejectedValue(failure);
  const request = {
    id: crypto.randomUUID(),
    expectedUpdatedAt: 0,
    title: "Original service title",
    body: "exact service-only\r\n漢🦀",
    tags: ["original"],
  };
  await expect(upsertNote(request)).rejects.toBe(failure);
  request.body = "caller changed object after failure";
  const gate = close();
  const data = await gate.capture();
  const records = data.snapshots.find((row) => row.snapshot.surface === "service-intents")!.snapshot
    .records;
  // A definite Native rejection is returned to the caller; nothing is conserved.
  expect(records).toEqual([]);
  expect(invoke).toHaveBeenCalledExactlyOnceWith("notes_upsert", { note: request });
  expect(gate.current()).toBe(true);
  data.release();
});

it("preserves actual production Native success and its request when local result publication fails", async () => {
  const input = owner();
  const target = {};
  const detach = input.attachCanonical(target);
  const original = input.operation("actual-save")!;
  const request = {
    id: note.id,
    expectedUpdatedAt: note.updatedAt,
    title: note.title,
    body: "actual saved body",
    tags: note.tags,
  };
  const saved = { ...note, body: request.body, updatedAt: 2 };
  invoke.mockResolvedValue(saved);
  input.setRead(() => {
    throw new Error("actual result projection unavailable");
  });
  expect(await upsertNote(request, original)).toBe(saved);
  input.setRead(() => ({ surface: "library", noteId: note.id, canonical: saved }));
  original();
  const gate = close();
  const data = await gate.capture();
  const records = data.snapshots.find((row) => row.snapshot.surface === "service-intents")!.snapshot
    .records;
  expect(records).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        command: "notes_upsert",
        phase: "result-application-unverified",
        status: "unverified",
        args: { note: request },
        error: "actual result projection unavailable",
      }),
    ]),
  );
  expect(invoke).toHaveBeenCalledExactlyOnceWith("notes_upsert", { note: request });
  expect(gate.current()).toBe(true);
  data.release();
  gate.release();
  detach();
});

it("does not execute mutated DTO accessors or accept extra symbols as original publication bytes", () => {
  const input = owner();
  const target = {};
  const detach = input.attachCanonical(target);
  const original = input.operation("actual-writer")!;
  const saved = { ...note, updatedAt: 2 };
  original.apply(() => publishNoteInputResult(original, saved));
  const getter = vi.fn(() => note.body);
  Object.defineProperty(saved, "body", { enumerable: true, configurable: true, get: getter });
  expect(input.commitCanonical(target, saved)).toBe(false);
  expect(getter).not.toHaveBeenCalled();
  Object.defineProperty(saved, "body", { enumerable: true, configurable: true, value: note.body });
  Object.defineProperty(saved, Symbol("extra"), { value: "unknown" });
  expect(input.commitCanonical(target, saved)).toBe(false);
  original();
  detach();
});

it("prunes a clean retired view only after every actual accepted job settles, including a canceled picker", async () => {
  const draft = {
    edits: { current: {} },
    project: { current: null },
    skipSave: { current: false },
    error: null,
    base: note,
  };
  drafts.set(note.id, draft);
  const input = draftInputOwner(draft);
  const picker = input.operation("original-picker")!;
  const independent = input.operation("other-original-job")!;
  pruneDraft(note.id, draft);
  pruneDraft(note.id, draft);
  expect(drafts.get(note.id)).toBe(draft);
  picker();
  await Promise.resolve();
  expect(drafts.get(note.id)).toBe(draft);
  independent();
  await Promise.resolve();
  expect(drafts.has(note.id)).toBe(false);
  const data = await captureNotesInputs("target");
  expect(data.snapshots.some((row) => row.snapshot.noteId === note.id)).toBe(false);
  data.release();
  expect(invoke).not.toHaveBeenCalled();
});

it("archives exact private whitespace across same-key view generations without evicting an original", async () => {
  const input = owner();
  const observer = input.observer("tags");
  const controls = { canClose: () => true, close: () => {} };
  const first = observer.attach(
    () => ({ snapshot: { source: "tag-input", draft: "  \t  ", acceptedChanges: [] } }),
    controls,
  );
  first.unregister();
  const second = observer.attach(
    () => ({ snapshot: { source: "tag-input", draft: "second exact raw", acceptedChanges: [] } }),
    controls,
  );
  second.unregister();
  const clean = observer.attach(
    () => ({ snapshot: { source: "tag-input", draft: "", acceptedChanges: [] } }),
    controls,
  );
  clean.unregister();
  const data = await captureNotesInputs("target");
  const inputs = data.snapshots.find((row) => row.snapshot.noteId === note.id)!.snapshot
    .inputs as Record<string, unknown>[];
  expect(inputs.map((entry) => entry.draft)).toEqual(["  \t  ", "second exact raw"]);
  expect(new Set(inputs.map((entry) => entry.generation)).size).toBe(2);
  expect(inputs.every((entry) => entry.mounted === false && entry.unapplied === true)).toBe(true);
  expect(getNotePrivateRecoveries().map((entry) => entry.text)).toEqual([
    "  \t  ",
    "second exact raw",
  ]);
  data.release();
});

it.each(["inline", "native"] as const)(
  "preserves an empty private %s title distinctly from the loaded nonempty title",
  async (kind) => {
    const input = owner();
    const snapshot =
      kind === "inline"
        ? {
            source: "inline-edit",
            draft: "",
            stateDraft: "",
            value: note.title,
            committed: note.title,
            shown: note.title,
            editing: true,
            phase: "idle",
            failed: null,
            error: null,
            pendingInput: null,
          }
        : { inputKind: "native-text", text: "" };
    input
      .observer("title")
      .attach(() => ({ snapshot }), { canClose: () => true, close: () => {} })
      .unregister();
    expect(input.hasUnappliedPrivateInputs()).toBe(true);
    expect(getNotePrivateRecoveries().find((entry) => entry.noteId === note.id)?.text).toBe("");
    const data = await captureNotesInputs("target");
    expect(
      data.snapshots.find((row) => row.snapshot.noteId === note.id)!.snapshot.privateInputRecovery,
    ).toMatchObject({ count: 1, disposition: "retained-unverified" });
    data.release();
  },
);

it("prunes a fully acknowledged clean CM view using line ending equivalence without changing saved bytes", () => {
  const draft = {
    edits: { current: {} },
    project: { current: null },
    skipSave: { current: false },
    error: null,
    base: note,
  };
  drafts.set(note.id, draft);
  const input = draftInputOwner(draft);
  input
    .observer("source")
    .attach(
      () => ({
        snapshot: {
          inputKind: "codemirror",
          text: note.body.replace(/\r\n?/g, "\n"),
          canonicalValue: note.body,
        },
      }),
      { canClose: () => true, close: () => {} },
    )
    .unregister();
  expect(input.hasUnappliedPrivateInputs()).toBe(false);
  pruneDraft(note.id, draft);
  expect(drafts.has(note.id)).toBe(false);
  expect(note.body).toBe("raw\r\n漢🦀\n");
});

it("keeps an unapplied CM document's original bytes instead of treating a canonical value as application proof", () => {
  const input = owner();
  const text = "actual unapplied\r\n漢🦀";
  input
    .observer("source")
    .attach(() => ({ snapshot: { inputKind: "codemirror", text, canonicalValue: note.body } }), {
      canClose: () => true,
      close: () => {},
    })
    .unregister();
  expect(input.hasUnappliedPrivateInputs()).toBe(true);
  expect(getNotePrivateRecoveries().find((entry) => entry.noteId === note.id)?.text).toBe(text);
});

it("does not retain the exact already acknowledged InlineEdit raw form forever after its saved indicator expires", () => {
  const input = owner();
  let phase = "saved";
  const port = input.observer("title").attach(
    () => ({
      snapshot: {
        source: "inline-edit",
        value: "Saved",
        committed: "Saved",
        shown: "Saved",
        draft: "  Saved  ",
        editing: false,
        phase,
        failed: null,
        error: null,
        pendingInput: null,
      },
    }),
    { canClose: () => true, close: () => {} },
  );
  port.changed();
  phase = "idle";
  port.changed();
  port.unregister();
  expect(input.hasUnappliedPrivateInputs()).toBe(false);
  expect(getNotePrivateRecoveries()).toEqual([]);
});

it("bounds original private generations upfront without evicting any retained data or granting a fake permit", async () => {
  const input = owner();
  for (let index = 0; index < NOTE_PRIVATE_INPUT_LIMITS.records; index++)
    input
      .observer(`tags-${index}`)
      .attach(
        () => ({ snapshot: { source: "tag-input", draft: `raw ${index}`, acceptedChanges: [] } }),
        {
          canClose: () => true,
          close: () => {},
        },
      )
      .unregister();
  const closeControl = vi.fn();
  const refused = input
    .observer("tags-overflow")
    .attach(() => ({ snapshot: { source: "tag-input", draft: "", acceptedChanges: [] } }), {
      canClose: () => true,
      close: closeControl,
    });
  expect(closeControl).toHaveBeenCalledWith(true);
  expect(refused.allowed()).toBe(false);
  expect(refused.operation("new-input-effect")).toBeNull();
  expect(getNotePrivateRecoveries()).toHaveLength(64);
  refused.unregister();
  const data = await captureNotesInputs("target");
  expect(
    data.snapshots.find((row) => row.snapshot.noteId === note.id)!.snapshot.inputs as unknown[],
  ).toHaveLength(64);
  expect(invoke).not.toHaveBeenCalled();
  data.release();
});

it("never charges the first same-key generation's larger reservation on behalf of a different port near the aggregate byte bound", () => {
  const input = owner();
  const controls = { canClose: () => true, close: () => {} };
  const fillers = Array.from({ length: 6 }, (_, index) =>
    input.observer(`body-${index}`).attach(
      () => ({
        snapshot: { inputKind: "native-text", text: "x".repeat(3 * 1024 * 1024) },
      }),
      controls,
    ),
  );
  const observer = input.observer("tags");
  const first = observer.attach(
    () => ({
      snapshot: { source: "tag-input", draft: "x".repeat(400 * 1024), acceptedChanges: [] },
    }),
    controls,
  );
  const replacement = observer.attach(
    () => ({ snapshot: { source: "tag-input", draft: "", acceptedChanges: [] } }),
    controls,
  );
  expect(input.canRetainText("tags", "x".repeat(1024 * 1024))).toBe(false);
  expect(replacement.allowed()).toBe(false);
  expect(replacement.operation("new-effect")).toBeNull();
  replacement.unregister();
  first.unregister();
  fillers.forEach((port) => port.unregister());
  expect(
    getNotePrivateRecoveries()
      .filter((entry) => entry.field === "tags")
      .map((entry) => entry.text),
  ).toEqual(["x".repeat(400 * 1024)]);
});

it("keeps exact original recovery and a genuine current data lease after generic retirement without a user discard or ACK", async () => {
  const input = owner();
  const raw = "  \tretired 漢🦀  ";
  input
    .observer("tags")
    .attach(() => ({ snapshot: { source: "tag-input", draft: raw, acceptedChanges: [] } }), {
      canClose: () => true,
      close: () => {},
    })
    .unregister();
  input.retire();
  input.retire();
  expect(input.operation("no-fresh-owner-after-retire")).toBeNull();
  expect(getNotePrivateRecoveries().find((entry) => entry.noteId === note.id)?.text).toBe(raw);
  const data = await captureNotesInputs("target");
  expect(data.current()).toBe(true);
  expect(data.snapshots.find((row) => row.snapshot.noteId === note.id)!.snapshot.inputs).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ source: "tag-input", draft: raw, unapplied: true }),
    ]),
  );
  data.release();
  expect(invoke).not.toHaveBeenCalled();
});
