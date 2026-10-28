import {
  useCallback,
  useLayoutEffect,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { flushSync } from "react-dom";
import type { PreparedEditorDraftRestore } from "../../../features/files/data/editorDraftRecovery";
import { parentPath } from "../../../shared/lib/paths";
import {
  newEditorWorkspaceTab,
  newFileTab,
  type FilePaneTab,
  type WorkspaceTab,
} from "../../../features/workspace/model/layout";

/** Locator only: recovered text and disk baselines must never enter layout state. */
export type RecoveredEditorDraftDescriptor = Readonly<
  { version: 1 } & PreparedEditorDraftRestore["target"]
>;

export interface OpenRecoveredEditorDraftDeps {
  tabsRef: MutableRefObject<WorkspaceTab[]>;
  setTabs: (update: WorkspaceTab[] | ((previous: WorkspaceTab[]) => WorkspaceTab[])) => void;
  insertBesideActive: (previous: WorkspaceTab[], tab: WorkspaceTab, cwd?: string) => WorkspaceTab[];
  activateTab: (tabId: string, paneId?: string) => void;
  setActiveTabId: (tabId: string) => void;
  setProjectTerminalFocused: Dispatch<SetStateAction<boolean>>;
  setComposerFocused: Dispatch<SetStateAction<boolean>>;
  /** Synchronously read current local project/path locks; no selected-Host inference. */
  allowPath: (path: string, cwd?: string) => boolean;
}

export interface OpenRecoveredEditorDraft {
  openRecoveredEditorDraft: (prepared: PreparedEditorDraftRestore, cwd?: string) => Promise<void>;
}

export class OpenRecoveredEditorDraftError extends Error {
  constructor(readonly code: "unmounted" | "path-denied" | "target-conflict" | "open-failed") {
    super(`Recovered editor draft could not be opened: ${code}`);
    this.name = "OpenRecoveredEditorDraftError";
  }
}

type RecoveryFile = FilePaneTab & { recoveredEditorDraft?: RecoveredEditorDraftDescriptor };

function exactTarget(file: RecoveryFile, target: RecoveredEditorDraftDescriptor): boolean {
  const source = file.recoveredEditorDraft;
  return (
    !!source &&
    source.version === 1 &&
    source.ownerEpoch === target.ownerEpoch &&
    source.documentId === target.documentId &&
    source.revision === target.revision &&
    source.payloadDigest === target.payloadDigest
  );
}

function existingTarget(tabs: WorkspaceTab[], target: RecoveredEditorDraftDescriptor) {
  let found: { tabId: string; paneId: string } | undefined;
  for (const tab of tabs) {
    for (const pane of [...tab.editorPanes, ...(tab.terminalPanes ?? [])]) {
      for (const file of pane.files) {
        if (file.id !== target.documentId && !exactTarget(file, target)) continue;
        if (
          file.id !== target.documentId ||
          !exactTarget(file, target) ||
          found ||
          !tab.editorPanes.includes(pane)
        ) {
          throw new OpenRecoveredEditorDraftError("target-conflict");
        }
        found = { tabId: tab.id, paneId: pane.id };
      }
    }
  }
  return found;
}

/** Open an already persisted copy. This operation never saves files or retires its source. */
export function useOpenRecoveredEditorDraft(
  deps: OpenRecoveredEditorDraftDeps,
): OpenRecoveredEditorDraft {
  const latest = useRef(deps);
  const mounted = useRef(true);
  useLayoutEffect(() => {
    latest.current = deps;
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, [deps]);

  const openRecoveredEditorDraft = useCallback(
    async (prepared: PreparedEditorDraftRestore, cwd?: string) => {
      if (!mounted.current) throw new OpenRecoveredEditorDraftError("unmounted");
      const current = latest.current;
      const target: RecoveredEditorDraftDescriptor = Object.freeze({
        version: 1,
        ownerEpoch: prepared.target.ownerEpoch,
        documentId: prepared.target.documentId,
        path: prepared.target.path,
        revision: prepared.target.revision,
        payloadDigest: prepared.target.payloadDigest,
      });
      const projectCwd = cwd || undefined;
      // Standalone local documents need a durable nonempty cwd, without assigning
      // their parent directory to whichever project or Host is currently selected.
      const fileCwd = projectCwd ?? parentPath(target.path);
      if (!current.allowPath(target.path, projectCwd))
        throw new OpenRecoveredEditorDraftError("path-denied");
      existingTarget(current.tabsRef.current, target);
      // Built once outside the updater: StrictMode must not generate another identity.
      const file: RecoveryFile = {
        ...newFileTab(target.path, fileCwd),
        id: target.documentId,
        ...(!projectCwd ? { external: true } : {}),
        recoveredEditorDraft: target,
      };
      const created = newEditorWorkspaceTab(file);
      let selected: { tabId: string; paneId?: string } | undefined;
      let failure: unknown;
      flushSync(() =>
        current.setTabs((previous) => {
          selected = undefined;
          failure = undefined;
          try {
            // Recheck at actual state admission; the prepared copy remains retained if denied.
            if (!mounted.current || !latest.current.allowPath(target.path, projectCwd)) {
              failure = new OpenRecoveredEditorDraftError(
                mounted.current ? "path-denied" : "unmounted",
              );
              return previous;
            }
            const existing = existingTarget(previous, target);
            if (existing) {
              selected = existing;
              return previous.map((tab) =>
                tab.id !== existing.tabId
                  ? tab
                  : {
                      ...tab,
                      editorPanes: tab.editorPanes.map((pane) =>
                        pane.id !== existing.paneId
                          ? pane
                          : {
                              ...pane,
                              activeFileId: target.documentId,
                              files: pane.files.map((entry) => {
                                if (entry.id !== target.documentId || !entry.preview) return entry;
                                const { preview: _preview, ...permanent } = entry;
                                return permanent;
                              }),
                            },
                      ),
                    },
              );
            }
            const next = latest.current.insertBesideActive(previous, created, projectCwd);
            if (
              !next.some(
                (tab) =>
                  tab.id === created.id &&
                  tab.editorPanes.some((pane) =>
                    pane.files.some(
                      (entry) => entry.id === target.documentId && exactTarget(entry, target),
                    ),
                  ),
              )
            ) {
              failure = new OpenRecoveredEditorDraftError("open-failed");
              return previous;
            }
            selected = { tabId: created.id };
            return next;
          } catch (error) {
            failure = error;
            return previous;
          }
        }),
      );
      if (failure) throw failure;
      if (!selected) throw new OpenRecoveredEditorDraftError("open-failed");
      if (selected.paneId) current.activateTab(selected.tabId, selected.paneId);
      else current.setActiveTabId(selected.tabId);
      current.setProjectTerminalFocused(false);
      current.setComposerFocused(false);
    },
    [],
  );

  return { openRecoveredEditorDraft };
}
