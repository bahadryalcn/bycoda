import {
  startTransition,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import { flushSync } from "react-dom";
import { useStableCallback } from "../../../shared/hooks/useStableCallback";
import { useGracedFailure } from "../../connections/public/transientFailure";
import type { Block } from "../model/session";
import { pinToBottom, syncTranscriptViewport } from "./transcriptScroll";
import { TranscriptRetentionContext } from "./TranscriptPool";
import { useReleasedTail } from "./useReleasedTail";

const INITIAL_TURNS = 20;
const FIRST_PAINT_TURNS = 3;
const TURN_PAGE_SIZE = 20;
/** Earlier turns mounted by the first commit of a page; the rest of the page follows in a transition. */
const PAGE_FIRST_TURNS = 8;
const EARLIER_SCROLL_THRESHOLD = 320;
export const MAX_TRANSCRIPT_WINDOW_TURNS = 60;
export type Window = { firstId?: string; offset: number; count: number; tail: boolean };
type Anchor = {
  /** The navigation and session it was taken for; a later one makes it stale. */
  navigation: number;
  sessionId?: string;
  /** Where the reader was when the anchor was taken; a page that commits later honors any scrolling since. */
  scrollTop: number;
  id?: string;
  offset: number;
  row?: { id: string; offset: number };
  edge: "start" | "end";
};
type Options = {
  sessionId?: string;
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

/**
 * The remote history request and what must run however it ends; kept out of the hook for the compiler.
 * A load that added nothing failed and reported it itself, so the window, cursor and scroll stay put.
 */
export async function runRemoteLoad({
  load,
  stale,
  apply,
  loadingRef,
  setPagingLoading,
  setPagingFailure,
}: {
  load: () => Promise<number | void> | void;
  stale: () => boolean;
  apply: () => void;
  loadingRef: { current: boolean };
  setPagingLoading: (loading: boolean) => void;
  setPagingFailure: (error: unknown) => void;
}): Promise<void> {
  try {
    const added = await load();
    if (stale()) return;
    if (added !== 0) apply();
    setPagingFailure(undefined);
  } catch (error) {
    if (!stale()) setPagingFailure(error);
  } finally {
    loadingRef.current = false;
    setPagingLoading(false);
  }
}

/** The part of an earlier page still to mount, and the navigation and session it belongs to. */
type Remainder = { window: Window; navigation: number; sessionId?: string };

/** The window once the rest of a page is mounted; unchanged when the reader has moved on since. */
export function pageRemainder(
  current: Window,
  rest: Remainder,
  live: { navigation: number; sessionId?: string },
): Window {
  return live.navigation === rest.navigation && live.sessionId === rest.sessionId
    ? rest.window
    : current;
}

/**
 * A window whose first turn no longer exists (rewound, regrouped or reloaded)
 * re-anchors on the turn now at its last committed position, instead of
 * falling back to the oldest turns; with no committed position it follows the tail.
 */
function useSurvivingFirstTurn(
  window: Window,
  setWindow: Dispatch<SetStateAction<Window>>,
  turns: Block[][],
  previousRef: RefObject<{ first?: number } | null>,
): Window {
  if (window.tail || !window.firstId || !turns.length) return window;
  if (turns.some((turn) => turn[0]?.id === window.firstId)) return window;
  const first = previousRef.current?.first;
  const count = Math.min(MAX_TRANSCRIPT_WINDOW_TURNS, window.count);
  const next: Window =
    first === undefined
      ? { ...window, firstId: undefined, offset: 0, tail: true }
      : {
          ...window,
          firstId: turns[Math.min(first, Math.max(0, turns.length - count))][0]?.id,
          offset: 0,
        };
  setWindow(next);
  return next;
}

/** Bounded settled-history window. Model history remains reachable in both directions. */
export function useTranscriptPaging({
  sessionId,
  turns,
  blockCount,
  openWork,
  scroller: scrollerRef,
  stickToBottom: stickToBottomRef,
  distanceFromBottom: distanceFromBottomRef,
  prependHeight: prependHeightRef,
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
  const previous = useRef<{
    firstId?: string;
    lastId?: string;
    count: number;
    first?: number;
  } | null>(null);
  const lastId = turns[turns.length - 1]?.[0]?.id;
  const selected = useSurvivingFirstTurn(
    useReleasedTail(window, setWindow, lastId, stickToBottomRef, previous),
    setWindow,
    turns,
    previous,
  );
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
  const firstBlockRef = useRef<string | undefined | null>(null);
  const loadingRef = useRef(false);
  const navigationRef = useRef(0);
  const sessionRef = useRef(sessionId);
  const [pagingLoading, setPagingLoading] = useState(false);
  const [failure, setFailure] = useState<{ sessionId?: string; cause: unknown } | null>(null);
  const previousScrollTop = useRef<number | undefined>(undefined);
  // The part of an earlier page not yet mounted, valid until the next navigation.
  const restRef = useRef<Remainder | null>(null);
  useLayoutEffect(() => {
    sessionRef.current = sessionId;
    turnsRef.current = turns;
    rangeRef.current = { first: firstVisibleTurn, last: lastVisibleTurn, count };
    previous.current = {
      firstId: visibleTurns[0]?.[0]?.id,
      lastId,
      count,
      first: firstVisibleTurn,
    };
    retention?.update({
      visibleTurnCount,
      firstLoadedTurnId: visibleTurns[0]?.[0]?.id,
      lastLoadedTurnId: visibleTurns[visibleTurns.length - 1]?.[0]?.id,
      openWork,
    });
  });

  const captureAnchor = useCallback(
    (edge: Anchor["edge"]) => {
      const el = scrollerRef.current;
      const top = el?.getBoundingClientRect().top ?? 0;
      const node =
        el &&
        [...el.querySelectorAll<HTMLElement>("[data-transcript-turn]")].find(
          (turn) => turn.getBoundingClientRect().bottom > top,
        );
      // A page can extend the first turn and change its key. An existing message
      // in that turn still identifies the reader's position.
      const row =
        node &&
        [...node.querySelectorAll<HTMLElement>("[data-transcript-virtual-block-id]")].find(
          (block) => block.getBoundingClientRect().bottom > top,
        );
      const rowId = row?.dataset.transcriptVirtualBlockId;
      anchorRef.current = {
        navigation: navigationRef.current,
        sessionId,
        scrollTop: el?.scrollTop ?? 0,
        id: node?.dataset.transcriptTurn,
        offset: node ? node.getBoundingClientRect().top - top : 0,
        row:
          row && rowId ? { id: rowId, offset: row.getBoundingClientRect().top - top } : undefined,
        edge,
      };
      prependHeightRef.current = null;
      stickToBottomRef.current = false;
    },
    [scrollerRef, prependHeightRef, stickToBottomRef, sessionId],
  );

  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    let anchor = anchorRef.current;
    // A reveal that needed no window move, or another session, outdates an anchor still waiting.
    if (anchor && (anchor.navigation !== navigationRef.current || anchor.sessionId !== sessionId)) {
      anchorRef.current = null;
      anchor = null;
    }
    if (anchor) {
      anchorRef.current = null;
      firstBlockRef.current = previous.current?.firstId;
      const row =
        anchor.row &&
        el.querySelector<HTMLElement>(
          `[data-transcript-virtual-block-id="${CSS.escape(anchor.row.id)}"]`,
        );
      const node =
        row ??
        [...el.querySelectorAll<HTMLElement>("[data-transcript-turn]")].find(
          (turn) => turn.dataset.transcriptTurn === anchor.id,
        );
      // The prepend does not move the scroller (overflow-anchor is none), so a scrollTop that
      // differs from the capture is the reader's own scrolling. A clamped scroller cannot tell.
      const moved =
        anchor.scrollTop <= el.scrollHeight - el.clientHeight ? el.scrollTop - anchor.scrollTop : 0;
      if (node)
        el.scrollTop +=
          node.getBoundingClientRect().top -
          el.getBoundingClientRect().top -
          ((row ? anchor.row!.offset : anchor.offset) - moved);
      else el.scrollTop = anchor.edge === "end" ? el.scrollHeight - el.clientHeight : 0;
      distanceFromBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight;
      return;
    }
    const firstBlockId = previous.current?.firstId;
    const prepended = firstBlockRef.current !== firstBlockId;
    firstBlockRef.current = firstBlockId;
    if (stickToBottomRef.current) {
      syncTranscriptViewport(el);
      pinToBottom(el);
    } else if (prepended)
      el.scrollTop = el.scrollHeight - el.clientHeight - distanceFromBottomRef.current;
  }, [
    firstVisibleTurn,
    lastVisibleTurn,
    blockCount,
    scrollerRef,
    stickToBottomRef,
    distanceFromBottomRef,
    sessionId,
  ]);

  useLayoutEffect(() => {
    const el = scrollerRef.current;
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
  }, [count, selected.tail, turns.length, scrollerRef]);
  useEffect(() => {
    startTransition(() =>
      setWindow((current) =>
        current.count >= INITIAL_TURNS ? current : { ...current, count: INITIAL_TURNS },
      ),
    );
  }, []);

  /** Mounts a page of earlier turns: the nearest ones now, the rest once they are painted. */
  const showEarlierPage = useStableCallback((first: Window, rest?: Window) => {
    navigationRef.current++;
    captureAnchor("start");
    setWindow(first);
    restRef.current = rest ? { window: rest, navigation: navigationRef.current, sessionId } : null;
  });
  // Mounting a whole page in one commit blocks input for as long as its markdown takes. Reads
  // the page's remainder after the first commit, as a time-sliced update anchored like any page.
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- anchors the remainder on the scroller DOM that the page's first commit just painted, which exists only after that commit
  useEffect(() => {
    const rest = restRef.current;
    restRef.current = null;
    if (!rest || rest.navigation !== navigationRef.current) return;
    startTransition(() => {
      captureAnchor("start");
      // The update renders later: a navigation or session change since then outdates it.
      setWindow((current) =>
        pageRemainder(current, rest, {
          navigation: navigationRef.current,
          sessionId: sessionRef.current,
        }),
      );
    });
  }, [selected.firstId, selected.offset, selected.count, captureAnchor]);
  const moveWindow = useCallback(
    (first: number, nextCount: number, edge: Anchor["edge"]) => {
      const all = turnsRef.current;
      navigationRef.current++;
      setFailure(null);
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
      const all = turnsRef.current;
      const page = (turns: number): Window => ({
        firstId: all[range.first - turns]?.[0]?.id,
        offset: 0,
        count: Math.min(MAX_TRANSCRIPT_WINDOW_TURNS, range.count + turns),
        tail: false,
      });
      const turns = Math.min(TURN_PAGE_SIZE, range.first);
      setFailure(null);
      showEarlierPage(
        page(Math.min(turns, PAGE_FIRST_TURNS)),
        turns > PAGE_FIRST_TURNS ? page(turns) : undefined,
      );
      return;
    }
    if (!remoteHistoryHasMore || !onLoadRemoteHistory) return;
    loadingRef.current = true;
    setPagingLoading(true);
    const firstId = turnsRef.current[0]?.[0]?.id;
    const requestedNavigation = navigationRef.current;
    await runRemoteLoad({
      load: onLoadRemoteHistory,
      stale: () =>
        sessionRef.current !== sessionId || navigationRef.current !== requestedNavigation,
      apply: () => {
        const page = (turns: number): Window => ({
          firstId,
          offset: -turns,
          count: Math.min(MAX_TRANSCRIPT_WINDOW_TURNS, range.count + turns),
          tail: false,
        });
        showEarlierPage(page(PAGE_FIRST_TURNS), page(TURN_PAGE_SIZE));
      },
      loadingRef,
      setPagingLoading,
      setPagingFailure: (cause) => setFailure(cause === undefined ? null : { sessionId, cause }),
    });
  }, [showEarlierPage, remoteHistoryHasMore, onLoadRemoteHistory, sessionId]);
  const { visibleError, pending } = useGracedFailure({
    error: remoteHistoryHasMore && failure?.sessionId === sessionId ? failure?.cause : undefined,
    retry: loadEarlier,
    scope: sessionId,
  });
  const pagingError = visibleError ?? null;
  const onHistoryScroll = (scrollTop: number, directInput = false, readerMoved = true) => {
    const previousTop = previousScrollTop.current;
    previousScrollTop.current = scrollTop;
    if (
      !readerMoved ||
      pagingError ||
      pending ||
      loadingRef.current ||
      scrollTop > EARLIER_SCROLL_THRESHOLD
    )
      return;
    if (directInput || (previousTop !== undefined && scrollTop < previousTop)) void loadEarlier();
  };
  const loadNewer = useCallback(() => {
    const range = rangeRef.current;
    // A search jump mounts a smaller window. Keep its next page contiguous.
    const count = Math.max(range.count, TURN_PAGE_SIZE);
    const first = Math.min(
      Math.max(0, turnsRef.current.length - count),
      Math.min(range.last, range.first + TURN_PAGE_SIZE),
    );
    moveWindow(first, count, "end");
  }, [moveWindow]);
  const jumpLatest = useCallback(() => {
    navigationRef.current++;
    setFailure(null);
    anchorRef.current = null;
    prependHeightRef.current = null;
    stickToBottomRef.current = true;
    flushSync(() => setWindow({ offset: 0, count: INITIAL_TURNS, tail: true }));
  }, [prependHeightRef, stickToBottomRef]);
  const revealBlock = useCallback(
    (blockId: string, forSearch = false): boolean => {
      const all = turnsRef.current;
      const index = all.findIndex((turn) => turn.some((block) => block.id === blockId));
      if (index < 0) return false;
      navigationRef.current++;
      setFailure(null);
      const range = rangeRef.current;
      if (index >= range.first && index < range.last) return true;
      // Find moves repeatedly between distant blocks. Mount its target and nearby
      // context in the first paint; normal paging can extend in both directions.
      const count = forSearch ? PAGE_FIRST_TURNS : MAX_TRANSCRIPT_WINDOW_TURNS;
      const first = Math.max(
        0,
        Math.min(index - (forSearch ? 2 : TURN_PAGE_SIZE), all.length - count),
      );
      captureAnchor("start");
      setWindow({ firstId: all[first]?.[0]?.id, offset: 0, count, tail: false });
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
    onRevealReady?.((id) => flushSync(() => revealBlock(id)));
    return () => onRevealReady?.(null);
  }, [revealBlock, onRevealReady]);
  return {
    visibleTurnCount,
    firstVisibleTurn,
    lastVisibleTurn,
    visibleTurns,
    loadEarlier,
    onHistoryScroll,
    loadNewer,
    jumpLatest,
    revealBlock,
    findTurn,
    pagingLoading: pagingLoading || pending,
    pagingError,
  };
}
