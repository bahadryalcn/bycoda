import { pathKey } from "../../shared/lib/paths";
import { t } from "../../shared/i18n/technical";
import type { DeviceFrame } from "../devices/types";
import type { ImageAnnotationDocument } from "../../shared/ui/ImageAnnotationCanvas";
import type { RuntimeLogsBuffer } from "./runtimeLogsModel";
import type { RuntimeLogEntry } from "./runtimeLogTypes";

export type ToolsDraftScope = { cwd: string; sessionId: string; targetValue: string };
export type ToolsDraftTransfer = {
  diagnostics?: { samples: import("./DiagnosticsPanel").DiagnosticsSample[] };
  device?: {
    selected: string;
    app: string;
    text: string;
    inputs?: Record<string, { app: string; text: string }>;
    zoom: number;
    annotating?: boolean;
    annotationTool?: "box" | "arrow" | "pen" | "pin";
    error?: string;
    errorOperation?: string;
    output?: string;
    notice?: { text: string; error: boolean };
    actionCompleted?: boolean;
    annotations: Record<
      string,
      {
        frame: DeviceFrame;
        document: ImageAnnotationDocument;
        undo: ImageAnnotationDocument[];
        redo: ImageAnnotationDocument[];
        comment: string;
        transferOperation?: import("../devices/deviceImageTransfer").DeviceImageTransferOperation;
      }
    >;
  };
  servers?: {
    showStart: boolean;
    name: string;
    command: string;
    workingDirectory: string;
    port: string;
    restartCommand: string;
    restartCwd: string;
    selectedId?: string;
    selectedEndpoint?: string;
    error?: string;
    notice?: string;
    startResult?: import("./devServerTypes").DevServerStartResult;
  };
  logs?: {
    buffer: RuntimeLogsBuffer;
    search: string;
    source: RuntimeLogEntry["source"] | "all";
    sourceIds: string[];
    level: string;
    grouped: boolean;
    follow: boolean;
    paused: boolean;
    started: boolean;
    monitorUrl: string;
    selected: string[];
    scrollTop?: number;
  };
};
const snapshots = new Map<string, ToolsDraftTransfer>();
const pending = new Map<string, Set<symbol>>();
const listeners = new Map<string, Set<(value: ToolsDraftTransfer) => void>>();
const key = (scope: ToolsDraftScope) =>
  JSON.stringify([pathKey(scope.cwd), scope.sessionId, scope.targetValue]);
export type ToolsWorkspaceDrafts = Record<string, ToolsDraftTransfer>;
export function readToolsWorkspaceDrafts(cwd: string, sessionId: string): ToolsWorkspaceDrafts {
  const project = pathKey(cwd);
  for (const [id, group] of pending) {
    const [ownerProject, ownerSession] = JSON.parse(id) as [string, string, string];
    if (ownerProject === project && ownerSession === sessionId && group.size)
      throw new Error(
        t("Wait for the current tool action to finish before moving this workspace."),
      );
  }
  const result: ToolsWorkspaceDrafts = Object.create(null);
  for (const [id, value] of snapshots) {
    const [ownerProject, ownerSession, target] = JSON.parse(id) as [string, string, string];
    if (ownerProject === project && ownerSession === sessionId)
      result[target] = structuredClone(value);
  }
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > 12 * 1024 * 1024)
    throw new Error(t("Tools draft is too large to transfer. Keep this window open."));
  return result;
}
export function restoreToolsWorkspaceDrafts(
  cwd: string,
  sessionId: string,
  values: ToolsWorkspaceDrafts,
): void {
  if (new TextEncoder().encode(JSON.stringify(values)).byteLength > 12 * 1024 * 1024)
    throw new Error(t("Tools draft is too large to transfer. Keep this window open."));
  for (const [target, value] of Object.entries(values))
    restoreToolsDraftTransfer(cwd, sessionId, target, value);
}
export function readToolsDraftTransfer(
  cwd: string,
  sessionId: string,
  targetValue: string,
): ToolsDraftTransfer | undefined {
  if (pending.get(key({ cwd, sessionId, targetValue }))?.size)
    throw new Error(t("Wait for the current tool action to finish before moving this workspace."));
  const value = snapshots.get(key({ cwd, sessionId, targetValue }));
  if (!value) return undefined;
  const copy = structuredClone(value);
  if (new TextEncoder().encode(JSON.stringify(copy)).byteLength > 12 * 1024 * 1024)
    throw new Error(t("Tools draft is too large to transfer. Keep this window open."));
  return copy;
}
export function holdToolsDraftTransfer(scope: ToolsDraftScope): () => void {
  const id = key(scope);
  const token = Symbol();
  const group = pending.get(id) ?? new Set();
  group.add(token);
  pending.set(id, group);
  return () => {
    group.delete(token);
    if (!group.size) pending.delete(id);
  };
}
export function restoreToolsDraftTransfer(
  cwd: string,
  sessionId: string,
  targetValue: string,
  value: ToolsDraftTransfer,
): void {
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 12 * 1024 * 1024)
    throw new Error(t("Tools draft is too large to transfer. Keep this window open."));
  const id = key({ cwd, sessionId, targetValue });
  const copy = structuredClone(value);
  snapshots.set(id, copy);
  listeners.get(id)?.forEach((listener) => listener(copy));
}
export function writeToolsDraftPart<K extends keyof ToolsDraftTransfer>(
  scope: ToolsDraftScope,
  domain: K,
  value: ToolsDraftTransfer[K],
): void {
  const id = key(scope);
  snapshots.set(id, { ...snapshots.get(id), [domain]: structuredClone(value) });
}
// Shallow update of primitive fields: high-frequency state (scroll) must not clone large parts.
export function patchToolsDraftPart<K extends keyof ToolsDraftTransfer>(
  scope: ToolsDraftScope | undefined,
  domain: K,
  patch: Partial<NonNullable<ToolsDraftTransfer[K]>>,
): void {
  if (!scope) return;
  const id = key(scope);
  const current = snapshots.get(id);
  if (current?.[domain])
    snapshots.set(id, { ...current, [domain]: { ...current[domain], ...patch } });
}
export function peekToolsDraftPart<K extends keyof ToolsDraftTransfer>(
  scope: ToolsDraftScope,
  domain: K,
): ToolsDraftTransfer[K] {
  return snapshots.get(key(scope))?.[domain];
}
export function subscribeToolsDraftTransfer(
  scope: ToolsDraftScope,
  listener: (value: ToolsDraftTransfer) => void,
): () => void {
  const id = key(scope);
  const group = listeners.get(id) ?? new Set();
  group.add(listener);
  listeners.set(id, group);
  return () => {
    group.delete(listener);
    if (!group.size) listeners.delete(id);
  };
}
