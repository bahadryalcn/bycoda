import { useCallback, useMemo, useSyncExternalStore } from "react";
import { useLocale } from "../../../shared/i18n";
import {
  getPathEnvironmentRevision,
  resolveWorkspaceFileReference,
  subscribePathEnvironment,
} from "../../../shared/lib/paths";
import {
  deriveActivityDock,
  dockCountLabel,
  dockStateLabel,
  type ActivityDock,
  type ActivityDockInput,
} from "./activityDock";
import { stopAllControl } from "./backgroundStop";
import { queuedSteerRoute, queuedTargetSummary } from "./messageQueue";
import { getModelSnapshot, resolveModel, subscribeModels } from "./models";
import type { Block, HarnessId, ToolPreview } from "./session";
import { resolveToolCallDisplay, subagentModelName } from "./transcriptActivity";

/*
 * Model lookups, file-reference resolution and the module `t` read state React
 * cannot see (the live model catalog, the machine's path environment, the
 * locale). React Compiler would keep a memoized result after that state
 * changes, so components rendering these values read them through hooks: a
 * hook runs on every render and subscribes to the change, and its result is a
 * reactive value the compiled caller depends on.
 */

/** Changes when the live model catalog or the turned-off models change. */
export function useModelCatalogRevision(): number {
  return useSyncExternalStore(subscribeModels, getModelSnapshot, getModelSnapshot);
}

/** Changes when the home directory or path variables arrive from the machine. */
export function usePathEnvironmentRevision(): number {
  return useSyncExternalStore(
    subscribePathEnvironment,
    getPathEnvironmentRevision,
    getPathEnvironmentRevision,
  );
}

export function useResolvedModelName(
  harness: HarnessId | undefined,
  model: string | undefined,
): string | undefined {
  const catalog = useModelCatalogRevision();
  return useMemo(
    () => (harness ? resolveModel(harness, model).name : undefined),
    // `catalog` invalidates the lookup when the catalog changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [harness, model, catalog],
  );
}

export function useSubagentModelName(block: Block): string | undefined {
  const catalog = useModelCatalogRevision();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => subagentModelName(block), [block, catalog]);
}

export function useToolCallDisplay(
  label: string,
  preview: ToolPreview | undefined,
  cwd: string | undefined,
) {
  const paths = usePathEnvironmentRevision();
  return useMemo(
    () => resolveToolCallDisplay(label, preview, cwd),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [label, preview, cwd, paths],
  );
}

/** The dock and its wording; subagent rows name models from the catalog. */
export function useActivityDock(input: ActivityDockInput): {
  dock: ActivityDock;
  label: string;
} {
  const catalog = useModelCatalogRevision();
  const locale = useLocale();
  const { blocks, busy, pendingQuestion, backgroundTasks, backgroundAgents, unseenDone } = input;
  return useMemo(() => {
    const dock = deriveActivityDock({
      blocks,
      busy,
      pendingQuestion,
      backgroundTasks,
      backgroundAgents,
      unseenDone,
    });
    return { dock, label: dockStateLabel(dock) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    blocks,
    busy,
    pendingQuestion,
    backgroundTasks,
    backgroundAgents,
    unseenDone,
    catalog,
    locale,
  ]);
}

export function useDockCountLabel(dock: ActivityDock): string {
  const locale = useLocale();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => dockCountLabel(dock), [dock, locale]);
}

/** The stop-all control; its wording is read through getters, so it is rebuilt
 * per language. */
export function useStopAllControl(dock: ActivityDock, perItem: boolean) {
  const locale = useLocale();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => stopAllControl(dock, perItem), [dock, perItem, locale]);
}

/** How each queued message would reach the running turn; model targets resolve
 * against the catalog. */
export function useQueuedSteerRoute(
  session: Parameters<typeof queuedSteerRoute>[0] | undefined,
  steerAppliesSettings: boolean,
): (message: Parameters<typeof queuedSteerRoute>[1]) => ReturnType<typeof queuedSteerRoute> {
  const catalog = useModelCatalogRevision();
  return useCallback(
    (message: Parameters<typeof queuedSteerRoute>[1]) =>
      session ? queuedSteerRoute(session, message, steerAppliesSettings) : "join",
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session, steerAppliesSettings, catalog],
  );
}

/** Model and effort names for queued messages' targets, from the live catalog. */
export function useQueuedTargetSummary(): typeof queuedTargetSummary {
  const catalog = useModelCatalogRevision();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useCallback((target) => queuedTargetSummary(target), [catalog]);
}

/** `resolveWorkspaceFileReference` bound to the current home directory and path
 * variables; a new function once they change. */
export function useWorkspaceFileResolver(): typeof resolveWorkspaceFileReference {
  const paths = usePathEnvironmentRevision();
  return useCallback(
    (reference, cwd) => resolveWorkspaceFileReference(reference, cwd),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [paths],
  );
}
