import { type RateLimitProvider } from "../../../features/providers/model/rateLimits";
import { worktreeFocus } from "../../../features/source-control/model/worktreeFocus";
import { t } from "../../../shared/i18n";
import { confirmInApp } from "../../../shared/model/appConfirm";
import { basename } from "../../../platform/tauri/fs";
import { type ToolId } from "../../model/toolWindows";
import { routeWindowDestination } from "../../model/windowNavigation";
import { message } from "@tauri-apps/plugin-dialog";

export function setsEqual<T>(a: Set<T>, b: Set<T>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) {
    if (!b.has(value)) return false;
  }
  return true;
}

export type DiscardUnsavedRequest = {
  /** The decision, e.g. "Close tab with unsaved files?". */
  title: string;
  /** The real action, e.g. "Discard and close". */
  confirmLabel: string;
  /** Files whose unsaved edits would be lost; names the target, or the count for several. */
  files?: readonly { path: string }[];
};

/** What is lost when the owner confirms: one named file, a count, or the open files in general. */
export function discardUnsavedMessage(files: DiscardUnsavedRequest["files"]): string {
  if (!files?.length) return t("Unsaved changes in the open files will be lost.");
  if (files.length === 1) {
    return t("Unsaved changes in “{p0}” will be lost.", { p0: basename(files[0].path) });
  }
  return t("Unsaved changes in {p0} files will be lost.", { p0: files.length });
}

/**
 * The one confirmation for closing work that has unsaved files. Resolves true only when the owner
 * discards the edits; Cancel, Escape and closing keep everything open.
 */
export function confirmDiscardUnsaved(request: DiscardUnsavedRequest): Promise<boolean> {
  return confirmInApp({
    title: request.title,
    message: discardUnsavedMessage(request.files),
    confirmLabel: request.confirmLabel,
    tone: "danger",
  });
}

/** The worktree a project's workspace currently shows. */
export function currentWorkspace(project: string): string {
  return worktreeFocus(project)?.path ?? project;
}

/** How often a running session's stored copy follows it, for a local host. */
export const LIVE_PERSIST_MS = 1_500;
export const USAGE_PROVIDERS: RateLimitProvider[] = ["claude", "codex", "opencode"];

export async function revealExistingTool(tool: ToolId, cwd: string): Promise<boolean> {
  try {
    return await routeWindowDestination({ kind: "tool", tool, cwd });
  } catch (cause) {
    await message(String(cause), { title: t("Could not open window"), kind: "error" });
    return true;
  }
}

export function sameSettings(
  a: Record<string, string> | undefined,
  b: Record<string, string> | undefined,
): boolean {
  const left = a ?? {};
  const right = b ?? {};
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    if (left[key] !== right[key]) return false;
  }
  return true;
}
