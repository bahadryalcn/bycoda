import {
  createNativeCaptureSnapshotEncoder,
  isNativeCaptureObject,
  NativeCaptureJsonError,
  stringifyNativeCaptureJson,
} from "../../../shared/lib/native-capture-json";
import { encodeNativeRawCapture, NATIVE_RAW_CAPTURE_LIMITS } from "./nativeRawCapture";

export type NativeProducerKind =
  | "question-draft"
  | "session-parent"
  | "composer-parent"
  | "queue-edit"
  | "btw-parent"
  | "file-editor";
export type NativeProducerSnapshot = {
  id: number;
  revision: number;
  kind: NativeProducerKind;
  sessionId?: string;
  snapshot: Record<string, unknown>;
};
export type NativeProducerData = {
  registryEpoch: number;
  snapshots: readonly NativeProducerSnapshot[];
};
export type NativeProducerLease = NativeProducerData & {
  missingCoverage: readonly string[];
  current(): boolean;
  release(): void;
};
export type NativeProducerInputs = {
  parent: NativeProducerData;
  editor: NativeProducerData;
};

const invalid = (): never => {
  throw new NativeCaptureJsonError("invalid");
};
const capacity = (): never => {
  throw new NativeCaptureJsonError("capacity");
};
const safe = (value: unknown, minimum = 0): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= minimum;
const own = (value: object, key: PropertyKey) => Object.prototype.hasOwnProperty.call(value, key);
function dataField(value: object, name: string): unknown {
  const property = Object.getOwnPropertyDescriptor(value, name);
  if (!property?.enumerable || !("value" in property)) return invalid();
  return property.value;
}

/** Exact input data only. Passive snapshots cannot close producer admission. */
export function encodeNativeProducerCapture(
  sessionId: string,
  composers: unknown,
  inputs: NativeProducerInputs,
): string {
  const composer = JSON.parse(encodeNativeRawCapture(sessionId, composers)) as {
    snapshots: unknown[];
  };
  const encodeSnapshot = createNativeCaptureSnapshotEncoder();
  const allIds = new Set<number>();
  const producers = [];
  const parentKinds = new Set<NativeProducerKind>([
    "question-draft",
    "session-parent",
    "composer-parent",
    "queue-edit",
    "btw-parent",
  ]);
  const epochs = { parent: 0, editor: 0 };
  if (!isNativeCaptureObject(inputs)) return invalid();
  for (const [index, family] of (["parent", "editor"] as const).entries()) {
    const capture = dataField(inputs, family);
    if (!isNativeCaptureObject(capture)) return invalid();
    const epoch = dataField(capture, "registryEpoch");
    const snapshots = dataField(capture, "snapshots");
    if (!safe(epoch) || !Array.isArray(snapshots)) return invalid();
    if (
      Object.getPrototypeOf(snapshots) !== Array.prototype ||
      Reflect.ownKeys(snapshots).length !== snapshots.length + 1
    )
      return invalid();
    if (snapshots.length > NATIVE_RAW_CAPTURE_LIMITS.snapshots) return capacity();
    epochs[family] = epoch;
    for (let position = 0; position < snapshots.length; position++) {
      const property = Object.getOwnPropertyDescriptor(snapshots, position);
      if (!property?.enumerable || !("value" in property)) return invalid();
      const entry = property.value;
      if (!isNativeCaptureObject(entry)) return invalid();
      const keys = Reflect.ownKeys(entry);
      if (
        keys.some(
          (key) =>
            typeof key !== "string" ||
            !["id", "revision", "kind", "sessionId", "snapshot"].includes(key),
        )
      )
        return invalid();
      const localId = dataField(entry, "id");
      const revision = dataField(entry, "revision");
      const kind = dataField(entry, "kind") as NativeProducerKind;
      if (!safe(localId, 1) || !safe(revision)) return invalid();
      const id = localId * 2 + index;
      if (!safe(id, 1)) return capacity();
      if (allIds.has(id)) return invalid();
      allIds.add(id);
      if (family === "editor" ? kind !== "file-editor" : !parentKinds.has(kind)) return invalid();
      const assigned = own(entry, "sessionId") ? dataField(entry, "sessionId") : undefined;
      if (assigned !== undefined && assigned !== sessionId) return invalid();
      producers.push({
        id,
        revision,
        kind,
        ...(assigned !== undefined ? { sessionId: assigned } : {}),
        ...encodeSnapshot(dataField(entry, "snapshot")),
      });
    }
  }
  if (composer.snapshots.length + producers.length > NATIVE_RAW_CAPTURE_LIMITS.snapshots)
    return capacity();
  return stringifyNativeCaptureJson({
    ...composer,
    version: 2,
    kind: "mounted-native-input-capture",
    producerCoverage: "unknown",
    producerEpochs: epochs,
    producers,
  });
}
