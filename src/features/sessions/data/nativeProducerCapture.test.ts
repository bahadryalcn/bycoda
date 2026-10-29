import { expect, it, vi } from "vitest";
import { NativeCaptureJsonError } from "../../../shared/lib/native-capture-json";
import {
  encodeNativeProducerCapture,
  type NativeProducerInputs,
  type NativeProducerSnapshot,
} from "./nativeProducerCapture";

const composers = () => ({
  qualified: false,
  missingCoverage: [],
  snapshots: [
    {
      id: 1,
      revision: 2,
      sessionId: "logical",
      snapshot: { text: " \t\n", attachments: [], mcpTags: [] },
    },
  ],
});
const parent = (): NativeProducerSnapshot => ({
  id: 1,
  revision: 3,
  kind: "question-draft",
  sessionId: "logical",
  snapshot: { questionId: "original", draft: " answer ", optional: undefined },
});
const editor = (): NativeProducerSnapshot => ({
  id: 1,
  revision: 4,
  kind: "file-editor",
  snapshot: {
    path: "/file",
    text: "\r\nç 😀",
    native: { acknowledgement: undefined },
  },
});
const inputs = (): NativeProducerInputs => ({
  parent: { registryEpoch: 5, snapshots: [parent()] },
  editor: { registryEpoch: 7, snapshots: [editor()] },
});

it("composes exact Composer, Parent and shared-profile editor data with unknown coverage", () => {
  const raw = JSON.parse(
    encodeNativeProducerCapture("logical", composers(), inputs()),
  );
  expect(raw).toMatchObject({
    version: 2,
    kind: "mounted-native-input-capture",
    qualified: false,
    producerCoverage: "unknown",
    producerEpochs: { parent: 5, editor: 7 },
  });
  expect(raw.snapshots[0].snapshot.text).toBe(" \t\n");
  expect(raw.producers.map((entry: { id: number }) => entry.id)).toEqual([
    2, 3,
  ]);
  expect(raw.producers[0].undefinedPaths).toEqual([["optional"]]);
  expect(raw.producers[1].undefinedPaths).toEqual([
    ["native", "acknowledgement"],
  ]);
  expect(raw.producers[1].sessionId).toBeUndefined();
  expect(raw.producers[1].snapshot.text).toBe("\r\nç 😀");
});

it("rejects changed target scopes, duplicate registry IDs, wrong family and unsafe identities", () => {
  const variants = [
    { ...parent(), sessionId: "another" },
    { ...parent(), id: Number.MAX_SAFE_INTEGER },
    { ...parent(), revision: -1 },
    { ...parent(), kind: "file-editor" as const },
  ];
  for (const entry of variants) {
    const value = inputs();
    value.parent.snapshots = [entry];
    expect(() =>
      encodeNativeProducerCapture("logical", composers(), value),
    ).toThrow(NativeCaptureJsonError);
  }
  const duplicate = inputs();
  duplicate.parent.snapshots = [parent(), parent()];
  expect(() =>
    encodeNativeProducerCapture("logical", composers(), duplicate),
  ).toThrow(NativeCaptureJsonError);
});

it("never invokes producer accessors and holds sparse or silently extended source lists", () => {
  const getter = vi.fn(() => "value");
  const entry = parent();
  Object.defineProperty(entry, "snapshot", { enumerable: true, get: getter });
  const value = inputs();
  value.parent.snapshots = [entry];
  expect(() =>
    encodeNativeProducerCapture("logical", composers(), value),
  ).toThrow(NativeCaptureJsonError);
  expect(getter).not.toHaveBeenCalled();
  const sparse: NativeProducerSnapshot[] = [];
  sparse.length = 2;
  value.parent.snapshots = sparse;
  expect(() =>
    encodeNativeProducerCapture("logical", composers(), value),
  ).toThrow(NativeCaptureJsonError);
  const list = [parent()];
  Object.defineProperty(list, "extra", { value: true });
  value.parent.snapshots = list;
  expect(() =>
    encodeNativeProducerCapture("logical", composers(), value),
  ).toThrow(NativeCaptureJsonError);
});

it("enforces one combined mount limit and never rebinds original nested identities", () => {
  const value = inputs();
  value.parent.snapshots = [
    {
      ...parent(),
      snapshot: { childSessionId: "different-original", rootId: "logical" },
    },
  ];
  const raw = JSON.parse(
    encodeNativeProducerCapture("logical", composers(), value),
  );
  expect(raw.producers[0].snapshot.childSessionId).toBe("different-original");
  const many = composers();
  many.snapshots = Array.from({ length: 256 }, (_, id) => ({
    id: id + 1,
    revision: 0,
    sessionId: "logical",
    snapshot: { text: "", attachments: [], mcpTags: [] },
  }));
  expect(() => encodeNativeProducerCapture("logical", many, value)).toThrow(
    NativeCaptureJsonError,
  );
});

it("holds opaque negative zero in both legacy Composer and producer data", () => {
  const value = inputs();
  value.parent.snapshots = [{ ...parent(), snapshot: { opaque: -0 } }];
  expect(() =>
    encodeNativeProducerCapture("logical", composers(), value),
  ).toThrow(NativeCaptureJsonError);
  const composer = composers();
  composer.snapshots[0]!.snapshot.attachments = [{ opaque: -0 }] as never[];
  expect(() =>
    encodeNativeProducerCapture("logical", composer, inputs()),
  ).toThrow();
});

it("retains Notes as a separate v3 family with exact dirty data and original associations", () => {
  const value = inputs();
  value.notes = {
    registryEpoch: 11,
    snapshots: [
      {
        id: 1,
        revision: 9,
        kind: "note-editor",
        snapshot: {
          version: 1,
          qualified: false,
          origin: "local-native",
          surface: "session-dock",
          noteId: "original-note",
          sourceSessionId: "different-original-session",
          base: { body: "saved\n", updatedAt: 23 },
          edits: { body: " \r\nç 😀\t", title: "", tags: [] },
          privateTitle: "  unfinished title  ",
          privateTag: " unfinished-tag ",
          savedRelation: undefined,
        },
      },
    ],
  };
  const raw = JSON.parse(
    encodeNativeProducerCapture("logical", composers(), value),
  );
  expect(raw).toMatchObject({
    version: 3,
    producerCoverage: "unknown",
    qualified: false,
    producerEpochs: { parent: 5, editor: 7, notes: 11 },
  });
  expect(raw.producers.map((item: { id: number }) => item.id)).toEqual([
    3, 4, 5,
  ]);
  expect(raw.producers[2]).toMatchObject({
    kind: "note-editor",
    undefinedPaths: [["savedRelation"]],
    snapshot: { noteId: "original-note", edits: { title: "", tags: [] } },
  });
  expect(Object.hasOwn(raw.producers[2].snapshot, "savedRelation")).toBe(false);
  expect(Object.hasOwn(raw.producers[2], "sessionId")).toBe(false);
  expect(raw.producers[2].snapshot.edits.body).toBe(" \r\nç 😀\t");
  expect(raw.producers[2].snapshot.sourceSessionId).toBe(
    "different-original-session",
  );
});

it("emits v3 even for an actually observed empty Notes family without changing legacy v2", () => {
  const legacy = JSON.parse(
    encodeNativeProducerCapture("logical", composers(), inputs()),
  );
  const current = JSON.parse(
    encodeNativeProducerCapture("logical", composers(), {
      ...inputs(),
      notes: { registryEpoch: 0, snapshots: [] },
    }),
  );
  expect(legacy.version).toBe(2);
  expect(legacy.producerEpochs).toEqual({ parent: 5, editor: 7 });
  expect(legacy.producers.map((item: { id: number }) => item.id)).toEqual([
    2, 3,
  ]);
  expect(current.version).toBe(3);
  expect(current.producerEpochs).toEqual({ parent: 5, editor: 7, notes: 0 });
  expect(current.producers.map((item: { id: number }) => item.id)).toEqual([
    3, 4,
  ]);
});

it("never silently drops an unavailable Notes family or invokes its accessor", () => {
  const getter = vi.fn(() => ({ registryEpoch: 0, snapshots: [] }));
  const accessor = inputs();
  Object.defineProperty(accessor, "notes", { enumerable: true, get: getter });
  for (const value of [
    accessor,
    { ...inputs(), notes: undefined },
    { ...inputs(), notes: null },
    { ...inputs(), notes: { snapshots: [] } },
    { ...inputs(), notes: { registryEpoch: -1, snapshots: [] } },
    { ...inputs(), unknownFamily: { registryEpoch: 0, snapshots: [] } },
  ])
    expect(() =>
      encodeNativeProducerCapture(
        "logical",
        composers(),
        value as NativeProducerInputs,
      ),
    ).toThrow(NativeCaptureJsonError);
  expect(getter).not.toHaveBeenCalled();
});

it("rejects Notes/file family confusion, duplicate owners and cross-target producer assignments", () => {
  const note = {
    id: 1,
    revision: 0,
    kind: "note-editor" as const,
    snapshot: { body: "", title: "", tags: [], sourceSessionId: "data-only" },
  };
  for (const snapshots of [
    [editor()],
    [note, note],
    [{ ...note, sessionId: "another-target" }],
    [{ ...note, id: Number.MAX_SAFE_INTEGER }],
  ])
    expect(() =>
      encodeNativeProducerCapture("logical", composers(), {
        ...inputs(),
        notes: { registryEpoch: 1, snapshots },
      }),
    ).toThrow(NativeCaptureJsonError);
  const mistakenFile = inputs();
  mistakenFile.editor.snapshots = [note];
  expect(() =>
    encodeNativeProducerCapture("logical", composers(), mistakenFile),
  ).toThrow(NativeCaptureJsonError);
});

it("shares the total producer budget with Notes rather than granting another mount allowance", () => {
  expect(() =>
    encodeNativeProducerCapture("logical", composers(), {
      ...inputs(),
      notes: {
        registryEpoch: 1,
        snapshots: Array.from({ length: 254 }, (_, index) => ({
          id: index + 1,
          revision: 0,
          kind: "note-editor" as const,
          snapshot: { body: "" },
        })),
      },
    }),
  ).toThrow(NativeCaptureJsonError);
});

it("encodes an actual lease's data without invoking or retaining its capability methods", () => {
  const current = vi.fn(() => true),
    release = vi.fn();
  const raw = JSON.parse(
    encodeNativeProducerCapture("logical", composers(), {
      ...inputs(),
      notes: { registryEpoch: 1, snapshots: [] },
      current,
      release,
      missingCoverage: ["host-notes-writer-closure"],
    } as NativeProducerInputs),
  );
  expect(raw.version).toBe(3);
  expect(raw.current).toBeUndefined();
  expect(raw.release).toBeUndefined();
  expect(current).not.toHaveBeenCalled();
  expect(release).not.toHaveBeenCalled();
});
