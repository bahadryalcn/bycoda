import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import { flushSync } from "react-dom";
import { shallowArrayEqual } from "../model/stableBlocks";
import {
  clearTranscriptHighlights,
  paintTranscriptHighlights,
  transcriptMutationNeedsRepaint,
  transcriptWordRanges,
} from "../model/transcriptHighlights";
import type { Block } from "../model/session";
import { useStableCallback } from "../../../shared/hooks/useStableCallback";
import { useStableValue } from "../../../shared/hooks/useStableValue";

type Options = {
  scroller: RefObject<HTMLDivElement | null>;
  visible: boolean;
  /** Parking drops the find state along with the scroller. */
  parked: boolean;
  busy: boolean;
  turns: Block[][];
  visibleTurns: Block[][];
  visibleTurnCount: number;
  openWork: Record<string, boolean>;
  setOpenWork: Dispatch<SetStateAction<Record<string, boolean>>>;
  revealBlock: (blockId: string) => boolean;
  findTurn: (blockId: string) => Block[] | undefined;
  onNavigateReady?: (
    navigate: ((blockId: string | null, query?: string) => boolean) | null,
  ) => void;
};

/** Scrolls the current result (or its turn) to just below the scroller's top edge. */
function alignSearchTarget(el: HTMLDivElement, turnId: string, query: string) {
  const target =
    el.querySelector<HTMLElement>('[data-transcript-search-current="true"]') ??
    el.querySelector<HTMLElement>(`[data-transcript-turn="${CSS.escape(turnId)}"]`);
  if (!target) return;
  const wordRect = query
    ? transcriptWordRanges(el, query).current?.getBoundingClientRect?.()
    : null;
  const targetTop =
    wordRect && wordRect.height > 0 ? wordRect.top : target.getBoundingClientRect().top;
  const delta = targetTop - el.getBoundingClientRect().top - 42;
  if (Math.abs(delta) > 2) el.scrollTop += delta;
}

/**
 * Find-in-conversation for the transcript: scrolls a result into view (opening
 * the folded work that holds it) and paints the matching words with the CSS
 * highlight API, keeping them current while the reply streams.
 */
export function useTranscriptSearch({
  scroller,
  visible,
  parked,
  busy,
  turns,
  visibleTurns,
  visibleTurnCount,
  openWork,
  setOpenWork,
  revealBlock,
  findTurn,
  onNavigateReady,
}: Options) {
  const [searchCurrent, setSearchCurrent] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [wasParked, setWasParked] = useState(parked);
  if (wasParked !== parked) {
    setWasParked(parked);
    if (parked) {
      setSearchCurrent(null);
      setSearchQuery("");
    }
  }
  const highlightOwner = useRef(Symbol("transcript-search"));
  // Streaming changes only the tail; explicit edits to older turns must still
  // refresh their cached find ranges even when the number of turns is unchanged.
  const searchHistory = useStableValue(
    searchQuery ? visibleTurns.slice(0, -1) : [],
    shallowArrayEqual,
  );
  const lastTurnId = turns[turns.length - 1]?.[0]?.id;

  const alignFrame = useRef(0);
  useEffect(() => () => cancelAnimationFrame(alignFrame.current), []);
  const navigateToBlock = useStableCallback(
    (blockId: string | null, query: string = ""): boolean => {
      if (!blockId) {
        setSearchCurrent(null);
        setSearchQuery("");
        return true;
      }
      const turn = findTurn(blockId);
      if (!turn || !revealBlock(blockId)) return false;
      const turnId = turn[0].id;
      // A result inside folded work needs its row rendered before measuring it.
      flushSync(() => {
        setOpenWork((current) => (current[turnId] ? current : { ...current, [turnId]: true }));
        setSearchCurrent(blockId);
        setSearchQuery(query);
      });
      const el = scroller.current;
      if (!el) return false;
      el.dispatchEvent(new WheelEvent("wheel", { deltaY: -1 }));
      const align = () => alignSearchTarget(el, turnId, query);
      align();
      cancelAnimationFrame(alignFrame.current);
      alignFrame.current = requestAnimationFrame(align);
      return true;
    },
  );

  useEffect(() => {
    onNavigateReady?.(navigateToBlock);
    return () => onNavigateReady?.(null);
  }, [navigateToBlock, onNavigateReady]);

  useEffect(() => {
    const el = scroller.current;
    const owner = highlightOwner.current;
    if (!el || !visible || !searchQuery) {
      clearTranscriptHighlights(owner);
      return;
    }
    let frame = 0;
    let pending: MutationRecord[] = [];
    const content = el.querySelector("[data-transcript-content]");
    const tail = content?.querySelector<HTMLElement>(".transcript-turn:last-child");
    let history: ReturnType<typeof transcriptWordRanges> | undefined;
    const paint = (resetHistory = false) => {
      if (!busy || !tail) {
        const { matches, current } = transcriptWordRanges(el, searchQuery);
        paintTranscriptHighlights(owner, matches, current);
        return;
      }
      if (resetHistory || !history) history = transcriptWordRanges(el, searchQuery, tail);
      const live = transcriptWordRanges(tail, searchQuery);
      paintTranscriptHighlights(
        owner,
        [...history.matches, ...live.matches],
        history.current ?? live.current,
      );
    };
    const observer = new MutationObserver((records) => {
      for (const record of records) pending.push(record);
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const changed = pending;
        pending = [];
        if (transcriptMutationNeedsRepaint(changed, searchQuery))
          paint(changed.some((record) => record.target === content));
      });
    });
    // Completed turns are immutable while streaming. Structural turn changes
    // reconnect this effect; do not watch every historical Markdown subtree.
    if (!busy) observer.observe(el, { childList: true, characterData: true, subtree: true });
    else if (tail)
      observer.observe(tail, {
        childList: true,
        characterData: true,
        subtree: true,
      });
    if (content) observer.observe(content, { childList: true });
    paint();
    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
      clearTranscriptHighlights(owner);
    };
  }, [
    scroller,
    visible,
    searchQuery,
    searchCurrent,
    visibleTurnCount,
    openWork,
    searchHistory,
    lastTurnId,
    busy,
  ]);

  return { searchCurrent };
}
