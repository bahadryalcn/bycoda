import {
  startTransition,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { flushSync } from "react-dom";
import type { Block } from "../model/session";
import { pinToBottom, syncTranscriptViewport } from "./transcriptScroll";
import { TranscriptRetentionContext } from "./TranscriptPool";

const INITIAL_TURNS = 20;
const FIRST_PAINT_TURNS = 3;
const TURN_PAGE_SIZE = 20;
export const MAX_TRANSCRIPT_WINDOW_TURNS = 60;
type Window = { firstId?: string; offset: number; count: number; tail: boolean };
type Anchor = { id?: string; offset: number; edge: "start" | "end" };
type Options = {
  turns: Block[][];
  blockCount: number;
  openWork: Record<string, boolean>;
  scroller: RefObject<HTMLDivElement | null>;
  stickToBottom: RefObject<boolean>;
  distanceFromBottom: RefObject<number>;
  prependHeight: RefObject<number | null>;
  remoteHistoryHasMore: boolean;
  onLoadRemoteHistory?: () => Promise<number | void> | void;
  onRevealReady?: (reveal: ((blockId: string) => boolean) | null) => void;
};

/** Bounded settled-history window. Model history remains reachable in both directions. */
export function useTranscriptPaging({
  turns,
  blockCount,
  openWork,
  scroller,
  stickToBottom,
  distanceFromBottom,
  prependHeight,
  remoteHistoryHasMore,
  onLoadRemoteHistory,
  onRevealReady,
}: Options) {
  const retention = useContext(TranscriptRetentionContext);
  const retained = retention?.read();
  const [window, setWindow] = useState<Window>(() => {
    const count = Math.min(
      MAX_TRANSCRIPT_WINDOW_TURNS,
      Math.max(FIRST_PAINT_TURNS, retained?.visibleTurnCount ?? FIRST_PAINT_TURNS),
    );
    let first = turns.findIndex((turn) => turn[0]?.id === retained?.firstLoadedTurnId);
    const anchor = turns.findIndex((turn) => turn[0]?.id === retained?.anchorId);
    if (anchor >= 0 && (first < 0 || anchor < first || anchor >= first + count))
      first = Math.max(0, Math.min(anchor - TURN_PAGE_SIZE, turns.length - count));
    return {
      firstId: turns[Math.max(0, first)]?.[0]?.id,
      offset: 0,
      count,
      tail: retained?.bottomFollow !== false,
    };
  });
  const previous = useRef<{ firstId?: string; lastId?: string; count: number } | null>(null);
  let selected = window;
  const lastId = turns[turns.length - 1]?.[0]?.id;
  if (
    window.tail &&
    !stickToBottom.current &&
    previous.current?.lastId &&
    previous.current.lastId !== lastId
  ) {
    selected = {
      firstId: previous.current.firstId,
      offset: 0,
      count: previous.current.count,
      tail: false,
    };
    setWindow(selected);
  }
  const count = Math.min(MAX_TRANSCRIPT_WINDOW_TURNS, selected.count);
  const located = selected.firstId
    ? turns.findIndex((turn) => turn[0]?.id === selected.firstId)
    : 0;
  const firstVisibleTurn = selected.tail
    ? Math.max(0, turns.length - count)
    : Math.max(0, Math.min(turns.length, Math.max(0, located) + selected.offset));
  const lastVisibleTurn = Math.min(turns.length, firstVisibleTurn + count);
  const visibleTurns = turns.slice(firstVisibleTurn, lastVisibleTurn);
  const visibleTurnCount = visibleTurns.length;
  const turnsRef = useRef(turns);
  const rangeRef = useRef({ first: firstVisibleTurn, last: lastVisibleTurn, count });
  const anchorRef = useRef<Anchor | null>(null);
  const loadingRef = useRef(false);
  const navigationRef = useRef(0);
  const [pagingLoading, setPagingLoading] = useState(false);
  const [pagingError, setPagingError] = useState<string | null>(null);
  useLayoutEffect(() => {
    turnsRef.current = turns;
    rangeRef.current = { first: firstVisibleTurn, last: lastVisibleTurn, count };
    previous.current = { firstId: visibleTurns[0]?.[0]?.id, lastId, count };
    retention?.update({
      visibleTurnCount,
      firstLoadedTurnId: visibleTurns[0]?.[0]?.id,
      lastLoadedTurnId: visibleTurns[visibleTurns.length - 1]?.[0]?.id,
      openWork,
    });
  });

  const captureAnchor = useCallback(
    (edge: Anchor["edge"]) => {
      const el = scroller.current;
      const top = el?.getBoundingClientRect().top ?? 0;
      const node =
        el &&
        [...el.querySelectorAll<HTMLElement>("[data-transcript-turn]")].find(
          (turn) => turn.getBoundingClientRect().bottom > top,
        );
      anchorRef.current = {
        id: node?.dataset.transcriptTurn,
        offset: node ? node.getBoundingClientRect().top - top : 0,
        edge,
      };
      prependHeight.current = null;
      stickToBottom.current = false;
    },
    [scroller, prependHeight, stickToBottom],
  );

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const anchor = anchorRef.current;
    if (anchor) {
      anchorRef.current = null;
      const node = [...el.querySelectorAll<HTMLElement>("[data-transcript-turn]")].find(
        (turn) => turn.dataset.transcriptTurn === anchor.id,
      );
      if (node)
        el.scrollTop +=
          node.getBoundingClientRect().top - el.getBoundingClientRect().top - anchor.offset;
      else el.scrollTop = anchor.edge === "end" ? el.scrollHeight - el.clientHeight : 0;
      distanceFromBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight;
      return;
    }
    const previousHeight = prependHeight.current;
    if (previousHeight != null) {
      prependHeight.current = null;
      el.scrollTop += el.scrollHeight - previousHeight;
      distanceFromBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight;
    } else if (stickToBottom.current) {
      syncTranscriptViewport(el);
      pinToBottom(el);
    } else el.scrollTop = el.scrollHeight - el.clientHeight - distanceFromBottom.current;
  }, [
    firstVisibleTurn,
    lastVisibleTurn,
    blockCount,
    scroller,
    stickToBottom,
    distanceFromBottom,
    prependHeight,
  ]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (
      !selected.tail ||
      !el ||
      !el.clientHeight ||
      count >= Math.min(INITIAL_TURNS, turns.length) ||
      el.scrollHeight > el.clientHeight
    )
      return;
    setWindow((current) => ({
      ...current,
      count: Math.min(INITIAL_TURNS, current.count + FIRST_PAINT_TURNS),
    }));
  }, [count, selected.tail, turns.length, scroller]);
  useEffect(() => {
    startTransition(() =>
      setWindow((current) => ({ ...current, count: Math.max(current.count, INITIAL_TURNS) })),
    );
  }, []);

  const moveWindow = useCallback(
    (first: number, nextCount: number, edge: Anchor["edge"]) => {
      const all = turnsRef.current;
      navigationRef.current++;
      captureAnchor(edge);
      setWindow({
        firstId: all[first]?.[0]?.id,
        offset: 0,
        count: Math.min(MAX_TRANSCRIPT_WINDOW_TURNS, nextCount),
        tail: false,
      });
    },
    [captureAnchor],
  );
  const loadEarlier = useCallback(async () => {
    if (loadingRef.current) return;
    const range = rangeRef.current;
    if (range.first > 0) {
      moveWindow(Math.max(0, range.first - TURN_PAGE_SIZE), range.count + TURN_PAGE_SIZE, "start");
      return;
    }
    if (!remoteHistoryHasMore || !onLoadRemoteHistory) return;
    loadingRef.current = true;
    setPagingLoading(true);
    setPagingError(null);
    const firstId = turnsRef.current[0]?.[0]?.id;
    const requestedNavigation = navigationRef.current;
    try {
      await onLoadRemoteHistory();
      if (navigationRef.current !== requestedNavigation) return;
      navigationRef.current++;
      captureAnchor("start");
      setWindow({
        firstId,
        offset: -TURN_PAGE_SIZE,
        count: Math.min(MAX_TRANSCRIPT_WINDOW_TURNS, range.count + TURN_PAGE_SIZE),
        tail: false,
      });
    } catch (error) {
      setPagingError(error instanceof Error ? error.message : String(error));
    } finally {
      loadingRef.current = false;
      setPagingLoading(false);
    }
  }, [captureAnchor, moveWindow, remoteHistoryHasMore, onLoadRemoteHistory]);
  const loadNewer = useCallback(() => {
    const range = rangeRef.current;
    const first = Math.min(
      Math.max(0, turnsRef.current.length - range.count),
      range.first + TURN_PAGE_SIZE,
    );
    moveWindow(first, range.count, "end");
  }, [moveWindow]);
  const jumpLatest = useCallback(() => {
    navigationRef.current++;
    anchorRef.current = null;
    prependHeight.current = null;
    stickToBottom.current = true;
    flushSync(() => setWindow({ offset: 0, count: INITIAL_TURNS, tail: true }));
  }, [prependHeight, stickToBottom]);
  const revealBlock = useCallback(
    (blockId: string): boolean => {
      const all = turnsRef.current;
      const index = all.findIndex((turn) => turn.some((block) => block.id === blockId));
      if (index < 0) return false;
      navigationRef.current++;
      const range = rangeRef.current;
      if (index >= range.first && index < range.last) return true;
      const first = Math.max(
        0,
        Math.min(index - TURN_PAGE_SIZE, all.length - MAX_TRANSCRIPT_WINDOW_TURNS),
      );
      captureAnchor("start");
      flushSync(() =>
        setWindow({
          firstId: all[first]?.[0]?.id,
          offset: 0,
          count: MAX_TRANSCRIPT_WINDOW_TURNS,
          tail: false,
        }),
      );
      return true;
    },
    [captureAnchor],
  );
  const findTurn = useCallback(
    (blockId: string) =>
      turnsRef.current.find((turn) => turn.some((block) => block.id === blockId)),
    [],
  );
  useEffect(() => {
    onRevealReady?.(revealBlock);
    return () => onRevealReady?.(null);
  }, [revealBlock, onRevealReady]);
  return {
    visibleTurnCount,
    firstVisibleTurn,
    lastVisibleTurn,
    visibleTurns,
    loadEarlier,
    loadNewer,
    jumpLatest,
    revealBlock,
    findTurn,
    pagingLoading,
    pagingError,
  };
}
