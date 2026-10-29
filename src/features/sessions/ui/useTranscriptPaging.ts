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
/**
 * Turns built before a transcript first paints. Every turn in the initial
 * window costs markdown work on open, so paint the latest few (more if they
 * leave the viewport short) and build the rest of the window after.
 */
const FIRST_PAINT_TURNS = 3;
const TURN_PAGE_SIZE = 20;

type Options = {
  turns: Block[][];
  /** Length of the whole block list; a change re-settles the scroll offset. */
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

/**
 * The window of turns that is rendered: the latest few at first paint, the
 * rest of the opening window right after, and earlier pages on request. Keeps
 * the reader's place when turns arrive above the viewport.
 */
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
  const [visibleTurnCount, setVisibleTurnCount] = useState(() => {
    const firstIndex = retained?.firstLoadedTurnId
      ? turns.findIndex((turn) => turn[0]?.id === retained.firstLoadedTurnId)
      : -1;
    return Math.max(
      retained?.visibleTurnCount ?? FIRST_PAINT_TURNS,
      firstIndex >= 0 ? turns.length - firstIndex : 0,
    );
  });
  const firstVisibleTurn = Math.max(0, turns.length - visibleTurnCount);
  const visibleTurns = turns.slice(firstVisibleTurn);

  // Callers run after a commit, so the layout phase has already published the
  // latest turns and window size to the stable callbacks below.
  const turnsRef = useRef(turns);
  const visibleTurnCountRef = useRef(visibleTurnCount);
  useLayoutEffect(() => {
    turnsRef.current = turns;
    visibleTurnCountRef.current = visibleTurnCount;
  });

  useLayoutEffect(() => {
    retention?.update({
      visibleTurnCount,
      firstLoadedTurnId: visibleTurns[0]?.[0]?.id,
      lastLoadedTurnId: visibleTurns[visibleTurns.length - 1]?.[0]?.id,
      openWork,
    });
  });

  useLayoutEffect(() => {
    const previousHeight = prependHeight.current;
    const el = scroller.current;
    if (!el) return;
    if (previousHeight == null) {
      // The opening window grows above the screen. Settle the offset in this
      // commit: a scroll event queued by an earlier pin would otherwise read
      // the taller transcript first and unpin it partway up.
      if (stickToBottom.current) {
        syncTranscriptViewport(el);
        pinToBottom(el);
      } else {
        el.scrollTop = el.scrollHeight - el.clientHeight - distanceFromBottom.current;
      }
      return;
    }
    prependHeight.current = null;
    el.scrollTop += el.scrollHeight - previousHeight;
    distanceFromBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight;
  }, [visibleTurnCount, blockCount, scroller, stickToBottom, distanceFromBottom, prependHeight]);

  // Short turns can leave the first paint with empty space above them, and
  // the rest of the window arriving later would then push everything down.
  // Top up before painting until the viewport is covered.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || el.clientHeight === 0) return;
    if (visibleTurnCount >= Math.min(INITIAL_TURNS, turns.length)) return;
    if (el.scrollHeight > el.clientHeight) return;
    setVisibleTurnCount((count) => Math.min(INITIAL_TURNS, count + FIRST_PAINT_TURNS));
  }, [visibleTurnCount, turns.length, scroller]);

  useEffect(() => {
    // Interruptible, so switching away before it finishes costs nothing.
    startTransition(() => setVisibleTurnCount((count) => Math.max(count, INITIAL_TURNS)));
  }, []);

  const prepareToPrepend = useCallback(() => {
    const el = scroller.current;
    if (el) prependHeight.current = el.scrollHeight;
    stickToBottom.current = false;
  }, [scroller, prependHeight, stickToBottom]);

  const loadEarlier = async () => {
    prepareToPrepend();
    if (firstVisibleTurn > 0) {
      setVisibleTurnCount((count) => Math.min(turns.length, count + TURN_PAGE_SIZE));
      return;
    }
    if (remoteHistoryHasMore && onLoadRemoteHistory) {
      const count = await onLoadRemoteHistory();
      setVisibleTurnCount((current) => current + Math.max(1, Number(count) || TURN_PAGE_SIZE));
    }
  };

  /** Renders the turn that holds a block. The render completes before it returns. */
  const revealBlock = useCallback(
    (blockId: string): boolean => {
      const all = turnsRef.current;
      const index = all.findIndex((turn) => turn.some((block) => block.id === blockId));
      if (index < 0) return false;
      const needed = all.length - index;
      if (needed <= visibleTurnCountRef.current) return true;
      prepareToPrepend();
      // Synchronous. The caller finds the turn in the DOM after this call.
      flushSync(() => setVisibleTurnCount(needed));
      return true;
    },
    [prepareToPrepend],
  );

  const findTurn = useCallback(
    (blockId: string): Block[] | undefined =>
      turnsRef.current.find((turn) => turn.some((block) => block.id === blockId)),
    [],
  );

  useEffect(() => {
    onRevealReady?.(revealBlock);
    return () => onRevealReady?.(null);
  }, [revealBlock, onRevealReady]);

  return { visibleTurnCount, firstVisibleTurn, visibleTurns, loadEarlier, revealBlock, findTurn };
}
