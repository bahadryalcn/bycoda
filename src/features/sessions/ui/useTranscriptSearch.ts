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
  currentTranscriptRange,
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
  prepareReveal: (blockId: string, forSearch: boolean) => boolean;
  findTurn: (blockId: string) => Block[] | undefined;
  onNavigateReady?: (
    navigate: ((blockId: string | null, query?: string) => boolean) | null,
  ) => void;
};

/** Scrolls the current result (or its turn) to just below the scroller's top edge. */
function alignSearchTarget(el: HTMLDivElement, turnId: string, word: Range | null) {
  const target =
    el.querySelector<HTMLElement>('[data-transcript-search-current="true"]') ??
    el.querySelector<HTMLElement>(`[data-transcript-turn="${CSS.escape(turnId)}"]`);
  if (!target) return;
  const wordRect = word?.getBoundingClientRect?.();
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
  prepareReveal,
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
  const background = useRef<{ query: string; matches: Range[] } | null>(null);
  // Streaming changes only the tail; explicit edits to older turns must still
  // refresh their cached find ranges even when the number of turns is unchanged.
  const searchHistory = useStableValue(
    searchQuery ? visibleTurns.slice(0, -1) : [],
    shallowArrayEqual,
  );
  const lastTurnId = turns[turns.length - 1]?.[0]?.id;

  const alignFrame = useRef(0);
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- discard the pending DOM alignment when this transcript unmounts
  useEffect(() => () => cancelAnimationFrame(alignFrame.current), []);
  const navigateToBlock = useStableCallback(
    (blockId: string | null, query: string = ""): boolean => {
      if (!blockId) {
        cancelAnimationFrame(alignFrame.current);
        setSearchCurrent(null);
        setSearchQuery("");
        return true;
      }
      const turn = findTurn(blockId);
      if (!turn) return false;
      const turnId = turn[0].id;
      // Mount the target window, unfold its work and mark the match in one commit
      // before reading its position. Painting an intermediate old window stalls every jump.
      const found = flushSync(() => {
        if (!prepareReveal(blockId, !!query)) return false;
        if (!openWork[turnId]) {
          setOpenWork((current) => (current[turnId] ? current : { ...current, [turnId]: true }));
        }
        setSearchCurrent(blockId);
        setSearchQuery(query);
        return true;
      });
      if (!found) return false;
      const el = scroller.current;
      if (!el) return false;
      el.dispatchEvent(new WheelEvent("wheel", { deltaY: -1 }));
      const word = query ? currentTranscriptRange(el, query) : null;
      if (visible && background.current?.query === query) {
        paintTranscriptHighlights(highlightOwner.current, background.current.matches, word);
      }
      alignSearchTarget(el, turnId, word);
      cancelAnimationFrame(alignFrame.current);
      alignFrame.current = requestAnimationFrame(() => {
        alignSearchTarget(el, turnId, query ? currentTranscriptRange(el, query) : null);
      });
      return true;
    },
  );

  // oxlint-disable-next-line bycoda/effect-names-its-sync -- expose this transcript's navigator to the find panel only while mounted
  useEffect(() => {
    onNavigateReady?.(navigateToBlock);
    return () => onNavigateReady?.(null);
  }, [navigateToBlock, onNavigateReady]);

  // oxlint-disable-next-line bycoda/effect-names-its-sync -- keep the document highlight registry in sync with mounted, changing transcript text
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
    let tail: HTMLElement | null = null;
    let history: Range[] | undefined;
    const paint = (resetHistory = false) => {
      const nextTail = busy
        ? (content?.querySelector<HTMLElement>(".transcript-turn:last-child") ?? null)
        : null;
      if (nextTail !== tail) history = undefined;
      tail = nextTail;
      let result: ReturnType<typeof transcriptWordRanges>;
      if (tail) {
        if (resetHistory || !history) history = transcriptWordRanges(el, searchQuery, tail).matches;
        const live = transcriptWordRanges(tail, searchQuery);
        result = {
          matches: [...history, ...live.matches],
          current: live.current ?? currentTranscriptRange(el, searchQuery, tail),
        };
      } else {
        result = transcriptWordRanges(el, searchQuery);
      }
      background.current = { query: searchQuery, matches: result.matches };
      paintTranscriptHighlights(owner, result.matches, result.current);
    };
    const observer = new MutationObserver((records) => {
      for (const record of records) pending.push(record);
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const changed = pending;
        pending = [];
        if (transcriptMutationNeedsRepaint(changed, searchQuery))
          paint(changed.some((record) => !tail?.contains(record.target)));
      });
    });
    // Folding, paging and rendering Markdown can change matching DOM without changing the query.
    // A streaming edit inside the same tail reuses the history ranges.
    observer.observe(el, { childList: true, characterData: true, subtree: true });
    paint();
    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
      background.current = null;
      clearTranscriptHighlights(owner);
    };
  }, [scroller, visible, searchQuery, visibleTurnCount, searchHistory, lastTurnId, busy]);

  return { searchCurrent };
}
