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
  snapshot: { path: "/file", text: "\r\nç 😀", native: { acknowledgement: undefined } },
});
const inputs = (): NativeProducerInputs => ({
  parent: { registryEpoch: 5, snapshots: [parent()] },
  editor: { registryEpoch: 7, snapshots: [editor()] },
});

it("composes exact Composer, Parent and shared-profile editor data with unknown coverage", () => {
  const raw = JSON.parse(encodeNativeProducerCapture("logical", composers(), inputs()));
  expect(raw).toMatchObject({
    version: 2,
    kind: "mounted-native-input-capture",
    qualified: false,
    producerCoverage: "unknown",
    producerEpochs: { parent: 5, editor: 7 },
  });
  expect(raw.snapshots[0].snapshot.text).toBe(" \t\n");
  expect(raw.producers.map((entry: { id: number }) => entry.id)).toEqual([2, 3]);
  expect(raw.producers[0].undefinedPaths).toEqual([["optional"]]);
  expect(raw.producers[1].undefinedPaths).toEqual([["native", "acknowledgement"]]);
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
    expect(() => encodeNativeProducerCapture("logical", composers(), value)).toThrow(
      NativeCaptureJsonError,
    );
  }
  const duplicate = inputs();
  duplicate.parent.snapshots = [parent(), parent()];
  expect(() => encodeNativeProducerCapture("logical", composers(), duplicate)).toThrow(
    NativeCaptureJsonError,
  );
});

it("never invokes producer accessors and holds sparse or silently extended source lists", () => {
  const getter = vi.fn(() => "value");
  const entry = parent();
  Object.defineProperty(entry, "snapshot", { enumerable: true, get: getter });
  const value = inputs();
  value.parent.snapshots = [entry];
  expect(() => encodeNativeProducerCapture("logical", composers(), value)).toThrow(
    NativeCaptureJsonError,
  );
  expect(getter).not.toHaveBeenCalled();
  const sparse: NativeProducerSnapshot[] = [];
  sparse.length = 2;
  value.parent.snapshots = sparse;
  expect(() => encodeNativeProducerCapture("logical", composers(), value)).toThrow(
    NativeCaptureJsonError,
  );
  const list = [parent()];
  Object.defineProperty(list, "extra", { value: true });
  value.parent.snapshots = list;
  expect(() => encodeNativeProducerCapture("logical", composers(), value)).toThrow(
    NativeCaptureJsonError,
  );
});

it("enforces one combined mount limit and never rebinds original nested identities", () => {
  const value = inputs();
  value.parent.snapshots = [
    { ...parent(), snapshot: { childSessionId: "different-original", rootId: "logical" } },
  ];
  const raw = JSON.parse(encodeNativeProducerCapture("logical", composers(), value));
  expect(raw.producers[0].snapshot.childSessionId).toBe("different-original");
  const many = composers();
  many.snapshots = Array.from({ length: 256 }, (_, id) => ({
    id: id + 1,
    revision: 0,
    sessionId: "logical",
    snapshot: { text: "", attachments: [], mcpTags: [] },
  }));
  expect(() => encodeNativeProducerCapture("logical", many, value)).toThrow(NativeCaptureJsonError);
});

it("holds opaque negative zero in both legacy Composer and producer data", () => {
  const value = inputs();
  value.parent.snapshots = [{ ...parent(), snapshot: { opaque: -0 } }];
  expect(() => encodeNativeProducerCapture("logical", composers(), value)).toThrow(
    NativeCaptureJsonError,
  );
  const composer = composers();
  composer.snapshots[0]!.snapshot.attachments = [{ opaque: -0 }] as never[];
  expect(() => encodeNativeProducerCapture("logical", composer, inputs())).toThrow();
});
