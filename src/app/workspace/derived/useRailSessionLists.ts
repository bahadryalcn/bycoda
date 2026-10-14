import { useMemo, useRef, type MutableRefObject } from "react";
import { type Session } from "../../../features/sessions/model/session";
import { type SessionSummary } from "../../../features/sessions/data/sessionStore";
import {
  liveSessionInfos,
  sameLiveSessionInfos,
} from "../../../features/sessions/model/recentSessions";
import { remoteLiveSessionInfos } from "../../../features/connections/model/remoteRailSessions";
import { type WorkspaceTab } from "../../../features/workspace/model/layout";
import { type PendingWindowMoves } from "../../model/windowTransferPopout";
import { type Tab as TitleTab } from "../../shell/TitleBar";
import { titleTabsEqual, toTitleTab } from "../helpers/tabHelpers";
import { type useUnseenFinishedIds } from "./useSessionStatusSets";

export interface RailSessionListsDeps {
  sessions: Session[];
  unseenFinishedIds: ReturnType<typeof useUnseenFinishedIds>;
  unopenedRemote: Parameters<typeof remoteLiveSessionInfos>[0];
  history: SessionSummary[];
  onPinHistorySession: (sessionId: string, pinned: boolean) => Promise<void>;
  deckProjectTabs: WorkspaceTab[];
  dirtyFiles: Set<string>;
  pendingWindowMoves: PendingWindowMoves;
  windowTransferPending: boolean;
  movingWindows: Set<string>;
  tabProjectsRef: MutableRefObject<Map<string, string>>;
}

export interface RailSessionLists {
  railLiveSessions: ReturnType<typeof liveSessionInfos>;
  recentSessions: {
    history: SessionSummary[];
    live: ReturnType<typeof liveSessionInfos>;
    onPin: (sessionId: string, pinned: boolean) => Promise<void>;
  };
  titleTabs: TitleTab[];
}

/** Rail and title-tab session lists. Memos and render-synced refs only. */
export function useRailSessionLists(deps: RailSessionListsDeps): RailSessionLists {
  const {
    sessions,
    unseenFinishedIds,
    unopenedRemote,
    history,
    onPinHistorySession,
    deckProjectTabs,
    dirtyFiles,
    pendingWindowMoves,
    windowTransferPending,
    movingWindows,
    tabProjectsRef,
  } = deps;
  const liveSessionInfoRef = useRef<ReturnType<typeof liveSessionInfos>>([]);
  const railLiveSessions = useMemo(() => {
    const next = [
      ...liveSessionInfos(sessions, unseenFinishedIds),
      ...remoteLiveSessionInfos(unopenedRemote),
    ];
    if (sameLiveSessionInfos(liveSessionInfoRef.current, next)) {
      return liveSessionInfoRef.current;
    }
    liveSessionInfoRef.current = next;
    return next;
  }, [sessions, unseenFinishedIds, unopenedRemote]);
  const recentSessions = useMemo(
    () => ({
      history,
      live: railLiveSessions,
      onPin: onPinHistorySession,
    }),
    [history, railLiveSessions, onPinHistorySession],
  );

  const nextTitleTabs: TitleTab[] = deckProjectTabs.map((tab) => ({
    ...toTitleTab(tab, sessions, dirtyFiles, unseenFinishedIds, tab.id in pendingWindowMoves),
    movingWindow: windowTransferPending || movingWindows.has(tab.id),
  }));
  tabProjectsRef.current = new Map(nextTitleTabs.map((tab) => [tab.id, tab.project]));
  const titleTabsRef = useRef(nextTitleTabs);
  if (!titleTabsEqual(titleTabsRef.current, nextTitleTabs)) {
    titleTabsRef.current = nextTitleTabs;
  }
  const titleTabs = titleTabsRef.current;

  return { railLiveSessions, recentSessions, titleTabs };
}
