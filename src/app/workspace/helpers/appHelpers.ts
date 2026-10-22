import { type RateLimitProvider } from "../../../features/providers/model/rateLimits";
import { worktreeFocus } from "../../../features/source-control/model/worktreeFocus";
import { t } from "../../../shared/i18n";
import { appName } from "../../../shared/lib/appName";
import { type ToolId } from "../../model/toolWindows";
import { routeWindowDestination } from "../../model/windowNavigation";
import { ask, message } from "@tauri-apps/plugin-dialog";

export function setsEqual<T>(a: Set<T>, b: Set<T>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) {
    if (!b.has(value)) return false;
  }
  return true;
}

/** Native sheet. `window.confirm` is swallowed when a macOS menu accelerator fires. */
export function confirmDiscardUnsaved(message: string): Promise<boolean> {
  return ask(message, { title: appName(), kind: "warning" });
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
