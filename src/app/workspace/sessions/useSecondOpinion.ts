import { type Dispatch, type MutableRefObject, type SetStateAction, useCallback } from "react";
import { formatSessionTitle, newSession, sessionWorkCwd, type Block, type ModelTarget, type Session } from "../../../features/sessions/model/session";
import { type setSessions } from "../../../features/sessions/model/sessionsStore";
import { leafIds, newTab, splitPane, type WorkspaceTab } from "../../../features/workspace/model/layout";
import { type Submit } from "../helpers/types";
import { SECOND_OPINION_TITLE, buildSecondOpinionRequest, harnessForTurn } from "../../../features/sessions/model/secondOpinion";
import { mergeModelSettings, resolveModel } from "../../../features/sessions/model/models";
export interface SecondOpinionDeps {
  sessionsRef: MutableRefObject<Session[]>;
  setSessions: typeof setSessions;
  tabsRef: MutableRefObject<WorkspaceTab[]>;
  setTabs: (update: WorkspaceTab[] | ((previous: WorkspaceTab[]) => WorkspaceTab[])) => void;
  activeTabIdRef: MutableRefObject<string>;
  setActiveTabId: (id: string) => void;
  setProjectTerminalFocused: Dispatch<SetStateAction<boolean>>;
  setComposerFocused: Dispatch<SetStateAction<boolean>>;
  appendTab: (tab: WorkspaceTab, cwd?: string) => void;
  onSubmit: (...args: Parameters<Submit>) => unknown;
}

export type OpenSessionBeside = (
  sourceId: string,
  session: Session,
  cwd: string,
  focusComposer?: boolean,
) => void;

/** Opens a session beside its source and starts the second-opinion turn. */
export function useSecondOpinion({
  sessionsRef,
  setSessions,
  tabsRef,
  setTabs,
  activeTabIdRef,
  setActiveTabId,
  setProjectTerminalFocused,
  setComposerFocused,
  appendTab,
  onSubmit,
}: SecondOpinionDeps) {
  const openSessionBeside = useCallback(
    (sourceId: string, session: Session, cwd: string, focusComposer = false) => {
      const nextSessions = [...sessionsRef.current, session];
      sessionsRef.current = nextSessions;
      setSessions(nextSessions);

      const tab = tabsRef.current.find((entry) => leafIds(entry.layout).includes(sourceId));
      if (tab) {
        const nextTabs = tabsRef.current.map((entry) =>
          entry.id === tab.id
            ? {
                ...entry,
                layout: splitPane(entry.layout, sourceId, "right", session.id),
                focusedId: session.id,
                diffFocused: false,
              }
            : entry,
        );
        tabsRef.current = nextTabs;
        setTabs(nextTabs);
        if (tab.id !== activeTabIdRef.current) setActiveTabId(tab.id);
      } else {
        const nextTab = newTab(session.id);
        appendTab(nextTab, cwd);
        setActiveTabId(nextTab.id);
      }

      setProjectTerminalFocused(false);
      setComposerFocused(focusComposer);
    },
    [appendTab],
  );

  const onSecondOpinion = useCallback(
    (sourceId: string, target: ModelTarget, turn: Block[]) => {
      const source = sessionsRef.current.find((session) => session.id === sourceId);
      if (!source || source.worktreeRemoved) return;
      const { harness, model, modelSettings } = target;
      const cwd = sessionWorkCwd(source);
      const from = harnessForTurn(source.blocks, turn, source.harness);
      const request = buildSecondOpinionRequest({
        from,
        to: harness,
        turn,
        cwd,
      });
      const session = {
        ...newSession(harness, source.cwd, model, source.runtimeMode),
        worktreeCwd: source.worktreeCwd,
        branch: source.branch,
        modelSettings: mergeModelSettings(resolveModel(harness, model), modelSettings),
        title: formatSessionTitle(harness, SECOND_OPINION_TITLE),
      };
      openSessionBeside(sourceId, session, source.cwd);
      onSubmit(session.id, request.prompt, [], request.options);
    },
    [onSubmit, openSessionBeside],
  );
  return { openSessionBeside, onSecondOpinion };
}
