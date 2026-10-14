import {
  leafIds,
  firstLeafId,
  closeLeaf,
  selectPaneTab,
  isFilesystemTab,
  type LayoutNode,
  type PaneEdge,
  type PaneTabDropPosition,
  type WorkspaceTab,
} from "../../features/workspace/model/layout";
import {
  applyMoveFileBetweenPanes,
  applyPlaceTabOnPane,
} from "../../features/workspace/model/workspaceTabGroups";
import type { ProjectTerminalDock } from "../../features/projects/model/projectTerminal";
import type { Session } from "../../features/sessions/model/session";
import {
  composerDraftOf,
  setComposerDraft,
  setComposerMcpTags,
  setComposerAttachments,
} from "../../features/sessions/model/draftCache";

export type WindowTransferPayload = {
  tabs: WorkspaceTab[];
  sessions: Session[];
  activeTabId: string;
  projectCwd: string;
  dirtyFileIds: string[];
  projectTerminals?: ProjectTerminalDock[];
  composerDrafts?: Record<string, ReturnType<typeof composerDraftOf>>;
  /** Native logical coordinates; scaleFactor converts them to the receiving webview's CSS pixels. */
  dropPoint?: { x: number; y: number; scaleFactor?: number };
};

/** Focus can outlive a closed/moved pane; recover it without dropping content. */
function normalizeTransferFocus(tab: WorkspaceTab): WorkspaceTab {
  const focusedId = leafIds(tab.layout).includes(tab.focusedId)
    ? tab.focusedId
    : firstLeafId(tab.layout);
  return { ...tab, focusedId, layout: selectPaneTab(tab.layout, focusedId) };
}

/** Decode before mounting anything: a malformed payload must never acknowledge a move. */
export function parseWindowTransfer(raw: string): WindowTransferPayload {
  const payload = JSON.parse(raw) as WindowTransferPayload;
  if (
    !payload ||
    !Array.isArray(payload.tabs) ||
    payload.tabs.length === 0 ||
    !Array.isArray(payload.sessions) ||
    typeof payload.projectCwd !== "string" ||
    !Array.isArray(payload.dirtyFileIds) ||
    !payload.dirtyFileIds.every((id) => typeof id === "string")
  ) {
    throw new Error("Invalid window transfer payload.");
  }
  const paneIds = new Set<string>();
  const tabIds = new Set<string>();
  const sessionIds = new Set<string>();
  const visit = (node: LayoutNode): void => {
    if (!node || typeof node.id !== "string" || !node.id)
      throw new Error("Invalid transferred pane.");
    if (node.type === "leaf") {
      if (node.tabIds && (!Array.isArray(node.tabIds) || !node.tabIds.includes(node.id)))
        throw new Error("Invalid transferred pane group.");
      const ids = node.tabIds ?? [node.id];
      for (const id of ids) {
        if (typeof id !== "string" || !id || paneIds.has(id))
          throw new Error("Duplicate transferred pane.");
        paneIds.add(id);
      }
    } else if (
      node.type === "split" &&
      (node.dir === "right" || node.dir === "down") &&
      Array.isArray(node.children) &&
      node.children.length > 0 &&
      Array.isArray(node.sizes) &&
      node.sizes.length === node.children.length &&
      node.sizes.every((size) => Number.isFinite(size) && size > 0)
    ) {
      node.children.forEach(visit);
    } else throw new Error("Invalid transferred layout.");
  };
  for (const tab of payload.tabs) {
    if (
      !tab ||
      tab.kind !== "session" ||
      typeof tab.id !== "string" ||
      !tab.id ||
      tabIds.has(tab.id) ||
      !Array.isArray(tab.editorPanes) ||
      (tab.terminalPanes !== undefined && !Array.isArray(tab.terminalPanes))
    )
      throw new Error("Invalid transferred tab.");
    tabIds.add(tab.id);
    visit(tab.layout);
    if (typeof tab.focusedId !== "string") throw new Error("Invalid transferred focus.");
  }
  if (!tabIds.has(payload.activeTabId)) throw new Error("Invalid transferred active tab.");
  for (const session of payload.sessions) {
    if (
      !session ||
      typeof session.id !== "string" ||
      sessionIds.has(session.id) ||
      !paneIds.has(session.id) ||
      typeof session.cwd !== "string" ||
      !Array.isArray(session.blocks)
    )
      throw new Error("Invalid transferred conversation.");
    sessionIds.add(session.id);
  }
  for (const tab of payload.tabs) {
    const surfaces = [...tab.editorPanes, ...(tab.terminalPanes ?? [])];
    if (
      surfaces.some(
        (pane) =>
          !pane ||
          !paneIds.has(pane.id) ||
          !Array.isArray(pane.files) ||
          typeof pane.activeFileId !== "string" ||
          pane.files.some(
            (file) => !file || typeof file.id !== "string" || typeof file.path !== "string",
          ),
      )
    )
      throw new Error("Invalid transferred editor.");
    const surfaceIds = new Set(surfaces.map((pane) => pane.id));
    if (leafIds(tab.layout).some((id) => !sessionIds.has(id) && !surfaceIds.has(id)))
      throw new Error("The transferred panel has no content.");
  }
  if (
    payload.dropPoint &&
    (!Number.isFinite(payload.dropPoint.x) ||
      !Number.isFinite(payload.dropPoint.y) ||
      (payload.dropPoint.scaleFactor !== undefined &&
        (!Number.isFinite(payload.dropPoint.scaleFactor) || payload.dropPoint.scaleFactor <= 0)))
  )
    throw new Error("Invalid window drop coordinates.");
  return { ...payload, tabs: payload.tabs.map(normalizeTransferFocus) };
}

/** Receiving a tab must preserve the destination's existing conversations. */
export function mergeWindowTransfer(
  tabs: WorkspaceTab[],
  sessions: Session[],
  projectTerminals: ProjectTerminalDock[],
  incoming: WindowTransferPayload,
  target?: {
    id: string;
    edge: PaneEdge;
    tabPosition?: PaneTabDropPosition;
    targetFileId?: string;
  } | null,
  titleTarget?: { targetTabId: string; position: "before" | "after" } | null,
) {
  const paneIds = new Set(tabs.flatMap((tab) => leafIds(tab.layout)));
  const fileIds = new Set(
    tabs.flatMap((tab) =>
      [...tab.editorPanes, ...(tab.terminalPanes ?? [])].flatMap((pane) =>
        pane.files.map((file) => file.id),
      ),
    ),
  );
  if (
    incoming.tabs.some((tab) =>
      [...tab.editorPanes, ...(tab.terminalPanes ?? [])].some((pane) =>
        pane.files.some((file) => fileIds.has(file.id)),
      ),
    )
  ) {
    throw new Error("This editor tab is already open in the destination window.");
  }
  if (
    incoming.tabs.some(
      (tab) =>
        tabs.some((existing) => existing.id === tab.id) ||
        leafIds(tab.layout).some((id) => paneIds.has(id)),
    ) ||
    incoming.sessions.some((session) => sessions.some((existing) => existing.id === session.id))
  ) {
    throw new Error("This conversation is already open in the destination window.");
  }
  let mergedTabs = [...tabs, ...incoming.tabs];
  let activeTabId = incoming.activeTabId;
  const titleIndex = titleTarget ? tabs.findIndex((tab) => tab.id === titleTarget.targetTabId) : -1;
  if (titleTarget && titleIndex >= 0) {
    const at = titleIndex + (titleTarget.position === "after" ? 1 : 0);
    mergedTabs = [...tabs.slice(0, at), ...incoming.tabs, ...tabs.slice(at)];
  } else if (target && paneIds.has(target.id)) {
    // Each placement anchors on the original target. Insert trailing placements
    // in reverse so a moved group retains its original visual order.
    const paneTabPosition = target.targetFileId ? undefined : target.tabPosition;
    const trailing =
      target.edge === "right" ||
      target.edge === "bottom" ||
      (target.edge === "center" && paneTabPosition === "after");
    for (const tab of trailing ? [...incoming.tabs].reverse() : incoming.tabs) {
      const sourcePane = tab.editorPanes[0];
      const sourceFile = sourcePane?.files[0];
      const singleEditorFile =
        incoming.sessions.length === 0 &&
        incoming.tabs.length === 1 &&
        tab.editorPanes.length === 1 &&
        !tab.terminalPanes?.length &&
        leafIds(tab.layout).length === 1 &&
        sourcePane.files.length === 1 &&
        isFilesystemTab(sourceFile);
      const targetEditor =
        target.edge === "center" &&
        tabs.some((entry) => entry.editorPanes.some((pane) => pane.id === target.id));
      if (singleEditorFile && targetEditor) {
        const placed = applyMoveFileBetweenPanes({
          tabs: mergedTabs,
          fileId: sourceFile.id,
          targetPaneId: target.id,
          targetFileId: target.targetFileId,
          position: target.tabPosition,
        });
        if (placed) {
          mergedTabs = placed.tabs;
          activeTabId = placed.activeTabId;
          continue;
        }
      }
      const placed = applyPlaceTabOnPane({
        tabs: mergedTabs,
        sessions: [...sessions, ...incoming.sessions],
        sourceTabId: tab.id,
        targetId: target.id,
        edge: target.edge,
        tabPosition: paneTabPosition,
        replaceTarget: false,
      });
      if (placed) {
        mergedTabs = placed.tabs;
        activeTabId = placed.activeTabId;
      }
    }
    const focusedId = incoming.tabs.find((tab) => tab.id === incoming.activeTabId)?.focusedId;
    if (focusedId) {
      mergedTabs = mergedTabs.map((tab) =>
        tab.id === activeTabId && leafIds(tab.layout).includes(focusedId)
          ? { ...tab, layout: selectPaneTab(tab.layout, focusedId), focusedId }
          : tab,
      );
    }
  }
  return {
    tabs: mergedTabs,
    activeTabId,
    sessions: [...sessions, ...incoming.sessions],
    projectTerminals: [
      ...projectTerminals,
      ...(incoming.projectTerminals ?? []).filter(
        (dock) => !projectTerminals.some((existing) => existing.projectPath === dock.projectPath),
      ),
    ],
  };
}

/** Undo an unacknowledged docking without discarding destination edits. */
export function removeWindowTransfer(
  tabs: WorkspaceTab[],
  incoming: WindowTransferPayload,
  placement?: { before: WorkspaceTab[]; accepted: WorkspaceTab[] },
): WorkspaceTab[] {
  const incomingTabIds = new Set(incoming.tabs.map((tab) => tab.id));
  const incomingPaneIds = incoming.tabs.flatMap((tab) => leafIds(tab.layout));
  const incomingFileIds = new Set(
    incoming.tabs.flatMap((tab) =>
      [...tab.editorPanes, ...(tab.terminalPanes ?? [])].flatMap((pane) =>
        pane.files.map((file) => file.id),
      ),
    ),
  );
  return tabs
    .filter((tab) => !incomingTabIds.has(tab.id))
    .flatMap((tab) => {
      const before = placement?.before.find((entry) => entry.id === tab.id);
      const accepted = placement?.accepted.find((entry) => entry.id === tab.id);
      // Closing added leaves alone would lose the old ratios and selected group tab.
      // Restore them only when the receiver has not changed this layout meanwhile.
      const unchangedLayout =
        before && accepted && JSON.stringify(tab.layout) === JSON.stringify(accepted.layout);
      let remaining: WorkspaceTab | null = tab;
      for (const id of incomingPaneIds) {
        if (remaining && leafIds(remaining.layout).includes(id))
          remaining = closeLeaf(remaining, id);
      }
      if (!remaining) return [];
      const removeFiles = (panes: WorkspaceTab["editorPanes"]) =>
        panes.flatMap((pane) => {
          const files = pane.files.filter((file) => !incomingFileIds.has(file.id));
          if (files.length === pane.files.length) return [pane];
          if (files.length === 0) {
            if (remaining && leafIds(remaining.layout).includes(pane.id))
              remaining = closeLeaf(remaining, pane.id);
            return [];
          }
          const prior = [...(before?.editorPanes ?? []), ...(before?.terminalPanes ?? [])].find(
            (entry) => entry.id === pane.id,
          );
          const index = pane.files.findIndex((file) => file.id === pane.activeFileId);
          const activeFileId = files.some((file) => file.id === pane.activeFileId)
            ? pane.activeFileId
            : files.some((file) => file.id === prior?.activeFileId)
              ? prior!.activeFileId
              : files[Math.min(Math.max(index, 0), files.length - 1)].id;
          return [{ ...pane, files, activeFileId }];
        });
      const editorPanes = removeFiles(
        remaining.editorPanes.filter((pane) => !incomingPaneIds.includes(pane.id)),
      );
      const terminalPanes = removeFiles(
        (remaining?.terminalPanes ?? []).filter((pane) => !incomingPaneIds.includes(pane.id)),
      );
      return remaining
        ? [
            {
              ...remaining,
              ...(unchangedLayout ? { layout: before.layout } : {}),
              ...(unchangedLayout && tab.focusedId === accepted.focusedId
                ? { focusedId: before.focusedId }
                : {}),
              editorPanes,
              terminalPanes,
            },
          ]
        : [];
    });
}

export function restoreTransferredDrafts(payload: WindowTransferPayload): void {
  for (const session of payload.sessions) {
    const draft = payload.composerDrafts?.[session.id];
    if (!draft) continue;
    setComposerDraft(session.id, draft.text);
    setComposerMcpTags(session.id, draft.mcpTags);
    setComposerAttachments(session.id, draft.attachments);
  }
}

export function collectWindowTransfer(
  tabs: WorkspaceTab[],
  sessions: Session[],
  tabIds: string[],
  activeTabId: string,
  dirtyFiles: Set<string>,
  fallbackCwd: string,
  projectTerminals: ProjectTerminalDock[] = [],
): WindowTransferPayload | null {
  const idSet = new Set(tabIds);
  const movingTabs = tabs.filter((tab) => idSet.has(tab.id)).map(normalizeTransferFocus);
  if (movingTabs.length === 0) return null;

  const sessionIds = new Set<string>();
  for (const tab of movingTabs) {
    for (const id of leafIds(tab.layout)) sessionIds.add(id);
  }

  const movingSessions = sessions.filter((session) => sessionIds.has(session.id));
  const composerDrafts = Object.fromEntries(
    movingSessions.map((session) => [session.id, composerDraftOf(session.id)]),
  );
  const dirtyInTabs = new Set<string>();
  for (const tab of movingTabs) {
    for (const pane of [...tab.editorPanes, ...(tab.terminalPanes ?? [])]) {
      for (const file of pane.files) {
        if (dirtyFiles.has(file.id)) dirtyInTabs.add(file.id);
      }
    }
  }

  const activeTabIdInGroup = idSet.has(activeTabId) ? activeTabId : movingTabs[0].id;

  return {
    tabs: movingTabs,
    sessions: movingSessions,
    activeTabId: activeTabIdInGroup,
    projectCwd: movingSessions[0]?.cwd ?? fallbackCwd,
    dirtyFileIds: [...dirtyInTabs],
    composerDrafts,
    ...(projectTerminals.length > 0 ? { projectTerminals } : {}),
  };
}
