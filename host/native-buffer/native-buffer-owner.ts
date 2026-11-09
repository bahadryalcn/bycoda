import { isAbsolute } from "node:path";
export const HOLD_PREFIX = "host-held:v1:";
export const EMPTY_PREFIX = "host-empty:v1:";
export const hex = /^[a-f0-9]{64}$/;
export const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
/** Native provenance is routing/retention metadata, never an enrolled actor grant. */
export interface NativeBufferSourceMetadata {
  version: 2;
  sourceStoreId: string;
  sourceProfileId: string;
  storeInstance: string | null;
  windowIncarnation: string | null;
  kind: "physical" | "unattributed" | "legacy" | "retained";
  reportVersion: number;
  reportNonce: string | null;
  snapshotDigest: string;
}
export interface NativeBufferOwnerSnapshot {
  ownerId: string;
  updatedAt: number;
  unknown: boolean;
  buffers: { path: string; dirty: boolean }[];
  source?: NativeBufferSourceMetadata;
}
export const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
export const integer = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
export function identity(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !value.trim() || value.length > 512 || value.includes("\0"))
    throw new Error(`Invalid native ${label}`);
}
export function provenance(value: unknown): NativeBufferSourceMetadata {
  if (!record(value) || value.version !== 2) throw new Error("Invalid native buffer source");
  const keys = [
    "version",
    "sourceStoreId",
    "sourceProfileId",
    "storeInstance",
    "windowIncarnation",
    "kind",
    "reportVersion",
    "reportNonce",
    "snapshotDigest",
  ];
  if (Object.keys(value).some((key) => !keys.includes(key)))
    throw new Error("Invalid native buffer source");
  identity(value.sourceStoreId, "source store identity");
  identity(value.sourceProfileId, "source profile identity");
  for (const key of ["storeInstance", "windowIncarnation", "reportNonce"] as const) {
    if (value[key] !== null && (typeof value[key] !== "string" || !uuid.test(value[key])))
      throw new Error("Invalid native buffer source identity");
  }
  if (
    !integer(value.reportVersion) ||
    value.reportVersion === 0 ||
    !["physical", "unattributed", "legacy", "retained"].includes(value.kind as string) ||
    typeof value.snapshotDigest !== "string" ||
    !hex.test(value.snapshotDigest)
  )
    throw new Error("Invalid native buffer source");
  return {
    version: 2,
    sourceStoreId: value.sourceStoreId,
    sourceProfileId: value.sourceProfileId,
    storeInstance: value.storeInstance as string | null,
    windowIncarnation: value.windowIncarnation as string | null,
    kind: value.kind as NativeBufferSourceMetadata["kind"],
    reportVersion: value.reportVersion,
    reportNonce: value.reportNonce as string | null,
    snapshotDigest: value.snapshotDigest,
  };
}
export function ownerSnapshot(
  value: unknown,
  input: boolean,
  now: number,
): NativeBufferOwnerSnapshot {
  if (!record(value)) throw new Error("Invalid native buffer snapshot");
  identity(value.ownerId, "window identity");
  if (input && (value.ownerId.startsWith(HOLD_PREFIX) || value.ownerId.startsWith(EMPTY_PREFIX)))
    throw new Error("Reserved native buffer window identity");
  if (
    typeof value.unknown !== "boolean" ||
    !integer(value.updatedAt) ||
    (input && value.updatedAt > now + 5000) ||
    !Array.isArray(value.buffers) ||
    value.buffers.length > 10_000
  )
    throw new Error("Invalid native buffer snapshot");
  const buffers = value.buffers.map((item) => {
    if (
      !record(item) ||
      typeof item.path !== "string" ||
      !isAbsolute(item.path) ||
      item.path.includes("\0") ||
      Buffer.byteLength(item.path) > 32768 ||
      typeof item.dirty !== "boolean"
    )
      throw new Error("Invalid native buffer path");
    return { path: item.path, dirty: item.dirty };
  });
  const source = value.source === undefined ? undefined : provenance(value.source);
  return {
    ownerId: value.ownerId,
    updatedAt: value.updatedAt,
    unknown: source?.kind === "unattributed" || source?.kind === "retained" ? true : value.unknown,
    buffers,
    ...(source === undefined ? {} : { source }),
  };
}
