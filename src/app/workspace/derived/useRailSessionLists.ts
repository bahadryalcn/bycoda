import { useMemo, useRef, type MutableRefObject } from "react";
import { type Session } from "../../../features/sessions/model/session";
import { type SessionSummary } from "../../../features/sessions/data/sessionStore";
import {
  liveSessionInfos,
  sameLiveSessionInfos,
  type LiveSessionInfo,
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

/**
 * Per-session rail entry. Session objects are immutable, so a shell change that
 * touches one session re-derives only that one instead of rescanning every
 * transcript. The unseen flag is the only outside input that matters.
 */
const liveInfoCache = new WeakMap<Session, { unseen: boolean; infos: LiveSessionInfo[] }>();
function liveInfosCached(
  sessions: readonly Session[],
  unseenFinishedIds: ReadonlySet<string>,
): LiveSessionInfo[] {
  const infos: LiveSessionInfo[] = [];
  for (const session of sessions) {
    const unseen = unseenFinishedIds.has(session.id);
    let entry = liveInfoCache.get(session);
    if (!entry || entry.unseen !== unseen) {
      entry = {
        unseen,
        infos: liveSessionInfos([session], unseen ? new Set([session.id]) : undefined),
      };
      liveInfoCache.set(session, entry);
    }
    for (const info of entry.infos) infos.push(info);
  }
  return infos;
}

/**
 * Rail and title-tab session lists. `sessions` is the shell view, so streamed
 * text frames never reach this hook; the memos below also keep unrelated App
 * renders from rescanning sessions and tabs.
 */
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
      ...liveInfosCached(sessions, unseenFinishedIds),
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

  const nextTitleTabs = useMemo(() => {
    const tabs: TitleTab[] = deckProjectTabs.map((tab) => ({
      ...toTitleTab(tab, sessions, dirtyFiles, unseenFinishedIds, tab.id in pendingWindowMoves),
      movingWindow: windowTransferPending || movingWindows.has(tab.id),
    }));
    return tabs;
  }, [
    deckProjectTabs,
    sessions,
    dirtyFiles,
    unseenFinishedIds,
    pendingWindowMoves,
    windowTransferPending,
    movingWindows,
  ]);
  tabProjectsRef.current = new Map(nextTitleTabs.map((tab) => [tab.id, tab.project]));
  const titleTabsRef = useRef(nextTitleTabs);
  if (!titleTabsEqual(titleTabsRef.current, nextTitleTabs)) {
    titleTabsRef.current = nextTitleTabs;
  }
  const titleTabs = titleTabsRef.current;

  return { railLiveSessions, recentSessions, titleTabs };
}
