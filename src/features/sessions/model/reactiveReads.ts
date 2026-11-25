import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { useLocale } from "../../../shared/i18n";
import { useHostSessionBindingReader } from "../../connections/public/useHostSessionBinding";
import { useRemoteSessionBindings } from "../../connections/public/useRemoteSessionBinding";
import {
  getPathEnvironmentRevision,
  resolveWorkspaceFileReference,
  subscribePathEnvironment,
} from "../../../shared/lib/paths";
import {
  deriveActivityDock,
  dockCountParts,
  dockStateLabel,
  type ActivityDock,
  type ActivityDockInput,
  type DockAgent,
} from "./activityDock";
import { stopAllControl } from "./backgroundStop";
import {
  delegatedChildren,
  delegatedDockAgents,
  delegationParentOf,
  nestedDelegatedChildren,
  nestedDelegationOwner,
} from "./delegatedAgents";
import { cardedChildren, createCardPlacer } from "./delegatedCards";
import { executionUserIndex } from "./executionTurn";
import { queuedSteerRoute, queuedTargetSummary } from "./messageQueue";
import { getModelSnapshot, resolveModel, subscribeModels } from "./models";
import { modelDisplayName, modelHarness } from "./modelDisplayName";
import { advisorModelName } from "./advisorModelName";
import type { Block, HarnessId, Session, ToolPreview } from "./session";
import {
  selectSessionById,
  useSession,
  useSessionsSelector,
  useShellSessionsSelector,
} from "./sessionsStore";
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

/** Advisor identity follows the same live catalog as other model labels. */
export function useAdvisorModelName(
  settings: Record<string, string> | undefined,
): string | undefined {
  const catalog = useModelCatalogRevision();
  return useMemo(
    () => advisorModelName(settings),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- catalog invalidates the live lookup
    [settings, catalog],
  );
}

/** Readable identity follows catalog updates through a subscribed hook. */
export function useModelDisplayName(model: string, harness?: string): string {
  const catalog = useModelCatalogRevision();
  return useMemo(
    () => modelDisplayName(model, harness),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- catalog invalidates the live lookup
    [model, harness, catalog],
  );
}

export function useModelHarness(model: string, harness?: string): HarnessId | undefined {
  const catalog = useModelCatalogRevision();
  return useMemo(
    () => modelHarness(model, harness),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- catalog invalidates the live lookup
    [model, harness, catalog],
  );
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
  const {
    blocks,
    busy,
    pendingQuestion,
    pendingOwnerApproval,
    backgroundTasks,
    backgroundAgents,
    unseenDone,
    delegatedAgents,
  } = input;
  return useMemo(() => {
    const dock = deriveActivityDock({
      blocks,
      busy,
      pendingQuestion,
      pendingOwnerApproval,
      backgroundTasks,
      backgroundAgents,
      unseenDone,
      delegatedAgents,
    });
    return { dock, label: dockStateLabel(dock) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    blocks,
    busy,
    pendingQuestion,
    pendingOwnerApproval,
    backgroundTasks,
    backgroundAgents,
    unseenDone,
    delegatedAgents,
    catalog,
    locale,
  ]);
}

function sameSessionList(a: readonly Session[], b: readonly Session[]): boolean {
  return a.length === b.length && a.every((session, index) => session === b[index]);
}

const noSessions: Session[] = [];

function familySelector<T>(
  id: string | undefined,
  read: (shell: Session[], id: string) => T,
  empty: T,
) {
  let previous: Session[] | undefined;
  let result = empty;
  return (shell: Session[]) => {
    if (id && previous !== shell) {
      result = read(shell, id);
      previous = shell;
    }
    return result;
  };
}

/** Membership depends on the structural snapshot and on the owners stored outside sessions. */
function useDelegationStructure<T>(
  id: string | undefined,
  read: (shell: Session[], id: string) => T,
  empty: T,
  equal: (a: T, b: T) => boolean = Object.is,
): T {
  const hostBindings = useHostSessionBindingReader();
  const remoteBindings = useRemoteSessionBindings();
  const select = useMemo(
    () => familySelector(id, read, empty),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a stored owner change invalidates the family for the same shell
    [id, read, empty, hostBindings, remoteBindings],
  );
  return useShellSessionsSelector(select, equal);
}

function useLiveFamily(members: Session[]): Session[] {
  return useSessionsSelector(
    (sessions) => members.flatMap((member) => selectSessionById(sessions, member.id) ?? []),
    sameSessionList,
  );
}

const noFamilies: Session[][] = [];

function dockFamilies(shell: Session[], parentId: string): Session[][] {
  return delegatedChildren(shell, parentId).map((child) => [
    child,
    ...nestedDelegatedChildren(shell, [child]),
  ]);
}

function sameFamilies(a: Session[][], b: Session[][]): boolean {
  return a.length === b.length && a.every((family, index) => sameSessionList(family, b[index]));
}

/** The transcript's blocks with each delegated run shown as a card. */
export function useDelegatedCardBlocks(
  parentId: string,
  blocks: Block[],
  enabled: boolean,
): Block[] {
  // The family comes from the shell (found once per structural change), the children
  // from the live store, so their streamed text still reaches the cards.
  const members = useDelegationStructure(
    enabled ? parentId : undefined,
    delegatedChildren,
    noSessions,
    sameSessionList,
  );
  const children = useLiveFamily(members);
  const [place] = useState(createCardPlacer);
  return useMemo(() => place(blocks, children), [place, blocks, children]);
}

/**
 * The run ids of a session's delegated children; their results show on their cards.
 * Reads the shell: a run id never changes with streamed text.
 */
export function useDelegatedRunIds(parentId: string | undefined): string[] {
  return useDelegationStructure(
    parentId,
    delegatedRunIds,
    noRunIds,
    (a, b) => a.length === b.length && a.every((id, index) => id === b[index]),
  );
}

const noRunIds: string[] = [];
function delegatedRunIds(shell: Session[], parentId: string): string[] {
  return delegatedChildren(shell, parentId).flatMap(
    (child) => delegationParentOf(child)?.runId ?? [],
  );
}

/** Cross-provider children of one session, as dock rows for its current turn. */
export function useDelegatedDockAgents(parentId: string, blocks: Block[]): DockAgent[] {
  const catalog = useModelCatalogRevision();
  const families = useDelegationStructure(parentId, dockFamilies, noFamilies, sameFamilies);
  const members = useMemo(() => families.flat(), [families]);
  const live = useLiveFamily(members);
  const turnStartedAt = blocks[executionUserIndex(blocks)]?.startedAt;
  return useMemo(() => {
    const children: Session[] = [];
    const nested = new Map<string, Session[]>();
    for (const [member, ...descendants] of families) {
      const child = selectSessionById(live, member.id);
      if (!child) continue;
      children.push(child);
      if (descendants.length) {
        nested.set(
          child.id,
          descendants.flatMap((item) => selectSessionById(live, item.id) ?? []),
        );
      }
    }
    const carded = cardedChildren(blocks, children);
    return delegatedDockAgents(children, turnStartedAt, nested).map((agent) =>
      agent.sessionId && carded.has(agent.sessionId) ? { ...agent, inline: true } : agent,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dock rows resolve labels from the subscribed model catalog
  }, [blocks, families, live, turnStartedAt, catalog]);
}

/** The subagent that started a delegated child, when that one is itself a subagent. */
export function useNestedDelegationOwner(childId: string | undefined): Session | undefined {
  const owner = useDelegationStructure(childId, nestedDelegationOwner, undefined);
  return useSession(owner?.id);
}

export function useDockCountParts(dock: ActivityDock) {
  const locale = useLocale();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => dockCountParts(dock), [dock, locale]);
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
