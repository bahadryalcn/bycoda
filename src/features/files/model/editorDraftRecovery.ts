import { pathKey } from "../../../shared/lib/paths";
import type { LockSnapshot } from "../../group-lock/model/lockState";

/** A local Native row locator; never a filesystem receipt or migration grant. */
export type RecoveredEditorDraft = Readonly<{
  version: 1;
  ownerEpoch: string;
  documentId: string;
  path: string;
  revision: number;
  payloadDigest: string;
}>;

export function parseRecoveredEditorDraft(value: unknown): RecoveredEditorDraft | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).sort().join(",") !==
    "documentId,ownerEpoch,path,payloadDigest,revision,version"
  )
    return null;
  const digest = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{64}$/.test(v);
  if (
    record.version !== 1 ||
    !digest(record.ownerEpoch) ||
    !digest(record.payloadDigest) ||
    typeof record.documentId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      record.documentId,
    ) ||
    typeof record.path !== "string" ||
    record.path.includes("\0") ||
    !/^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(record.path) ||
    new TextEncoder().encode(record.path).length > 4096 ||
    typeof record.revision !== "number" ||
    !Number.isSafeInteger(record.revision) ||
    record.revision < 1
  )
    return null;
  return Object.freeze({
    version: 1,
    ownerEpoch: record.ownerEpoch,
    documentId: record.documentId,
    path: record.path,
    revision: record.revision,
    payloadDigest: record.payloadDigest,
  });
}

export type EditorDraftProjectRoot = Readonly<{ root: string; projectCwd: string }>;
const under = (path: string, root: string) =>
  path === root || path.startsWith(root.endsWith("/") ? root : `${root}/`);

/** Unknown origins stay concealed while any groups are locked/hidden. */
export function editorDraftProject(
  path: string,
  roots: readonly EditorDraftProjectRoot[],
): string | undefined {
  const key = pathKey(path);
  let selected: EditorDraftProjectRoot | undefined;
  for (const entry of roots) {
    if ((!selected || entry.root.length > selected.root.length) && under(key, pathKey(entry.root)))
      selected = entry;
  }
  return selected?.projectCwd;
}

export function editorDraftPathVisible(
  path: string,
  locks: LockSnapshot,
  roots: readonly EditorDraftProjectRoot[],
): boolean {
  const key = pathKey(path);
  if (
    locks.lockedGroupIds.size &&
    key.split("/").some((segment) => segment === "." || segment === "..")
  )
    return false;
  if ([...locks.lockedProjectKeys].some((root) => under(key, root))) return false;
  const project = editorDraftProject(path, roots);
  if (project && locks.lockedProjectKeys.has(pathKey(project))) return false;
  return !locks.lockedGroupIds.size || project !== undefined;
}
