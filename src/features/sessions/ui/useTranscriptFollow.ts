import { useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { innerScrollerTakes, useLockOverscroll } from "../../../shared/hooks/useLockOverscroll";
import {
  isNearBottom,
  NEAR_BOTTOM_PX,
  pinToBottom,
  scrollClampedToBottom,
  syncTranscriptViewport,
  WHEEL_HOLD_MS,
} from "./transcriptScroll";
import { nextReadingHistory } from "./composerReading";
import { TranscriptRetentionContext } from "./TranscriptPool";
import { useTurnScrollAnchor } from "./useTurnScrollAnchor";

type Options = {
  visible: boolean;
  /** Parking detaches the scroller, which drops its scroll offset. */
  parked: boolean;
  lastUserId: string | undefined;
  /**
   * Runs between the "new prompt pins the end" step and the "tab opened" step
   * of the layout phase, so a prompt animation measures the freshly pinned rows.
   */
  onPromptChange?: (mounting: boolean, scroller: HTMLDivElement | null) => (() => void) | void;
  onJumpToBottomChange?: (show: boolean) => void;
  onJumpToBottomReady?: (jump: (() => void) | null) => void;
  /**
   * The reader is away from the end by their own scrolling, not because content
   * grew or the viewport resized. Latched: it only clears when following resumes.
   */
  onReadingChange?: (reading: boolean) => void;
  onScrollerChange?: (el: HTMLDivElement | null) => void;
};

export type TranscriptFollow = ReturnType<typeof useTranscriptFollow>;

/**
 * Owns the transcript scroller and decides where it sits: following the end of
 * streamed output until the reader scrolls away, pinning on a new prompt or a
 * reopened tab, and reporting the jump-to-bottom state to the pane. The refs
 * are returned so paging and turn rendering cooperate with the same state.
 * A retained position is re-applied by `useTranscriptCheckpointRestore`.
 */
export function useTranscriptFollow({
  visible,
  parked,
  lastUserId,
  onPromptChange,
  onJumpToBottomChange,
  onJumpToBottomReady,
  onReadingChange,
  onScrollerChange,
}: Options) {
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const scroller = useRef<HTMLDivElement>(null);
  const retention = useContext(TranscriptRetentionContext);
  const retained = retention?.read();
  const restoreCheckpoint = useRef(retained?.scrollTop !== undefined ? { ...retained } : undefined);
  const restoringCheckpoint = useRef(retained?.scrollTop !== undefined);
  const stickToBottom = useRef(retained?.bottomFollow ?? true);
  const showJumpRef = useRef(false);
  const readingRef = useRef(false);
  const distanceFromBottom = useRef(0);
  const wheelHold = useRef(0);
  const scrollGeometry = useRef<{
    el: HTMLElement;
    top: number;
    height: number;
    viewport: number;
  } | null>(null);
  const prependHeight = useRef<number | null>(null);
  const wasVisible = useRef(false);
  const [scrollerEl, setScrollerEl] = useState<HTMLDivElement | null>(null);
  const checkpointUserId = useRef(lastUserId);
  const restoreScroll = useRef(false);
  const wasParked = useRef(parked);
  useLayoutEffect(() => {
    if (wasParked.current === parked) return;
    wasParked.current = parked;
    if (parked) restoreScroll.current = true;
  }, [parked]);

  const setShowJump = useCallback(
    (show: boolean) => {
      if (showJumpRef.current === show) return;
      showJumpRef.current = show;
      onJumpToBottomChange?.(show);
    },
    [onJumpToBottomChange],
  );

  // Reading mode follows the reader's intent (`stickToBottom`), latched with a
  // distance gate. It must not follow geometry: the composer resizing because of
  // it would otherwise move the scroll distance and toggle it back.
  const publishReading = useCallback(
    (el: HTMLElement) => {
      const next = nextReadingHistory(readingRef.current, {
        following: stickToBottom.current,
        distance: el.scrollHeight - el.scrollTop - el.clientHeight,
      });
      if (next === readingRef.current) return;
      readingRef.current = next;
      onReadingChange?.(next);
    },
    [onReadingChange],
  );

  const rememberScroll = useCallback(
    (el: HTMLElement) => {
      publishReading(el);
      scrollGeometry.current = {
        el,
        top: el.scrollTop,
        height: el.scrollHeight,
        viewport: el.clientHeight,
      };
      if (!retention || restoringCheckpoint.current || !el.isConnected || !el.clientHeight) return;
      // Following the end restores by pinning to the bottom; skip the per-turn
      // layout reads on every streamed resize while that is all a restore needs.
      if (stickToBottom.current) {
        retention.update({ scrollTop: el.scrollTop, bottomFollow: true });
        return;
      }
      const top = el.getBoundingClientRect().top;
      const anchor = [...el.querySelectorAll<HTMLElement>("[data-transcript-turn]")].find(
        (node) => node.getBoundingClientRect().bottom > top,
      );
      retention.update({
        anchorId: anchor?.dataset.transcriptTurn,
        anchorOffset: anchor ? anchor.getBoundingClientRect().top - top : 0,
        scrollTop: el.scrollTop,
        bottomFollow: stickToBottom.current,
      });
    },
    [publishReading, retention],
  );

  const syncPinned = useCallback(
    (el: HTMLElement) => {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      const previous = scrollGeometry.current;
      // Content growth and folding also queue scroll events. They must not
      // cancel following before ResizeObserver gets a chance to pin the end.
      // A stable layout moving upward also covers scrollbar/touch/keyboard
      // navigation, including movement inside the near-bottom margin.
      const scrolledUp =
        !!previous &&
        previous.el === el &&
        previous.height === el.scrollHeight &&
        previous.viewport === el.clientHeight &&
        el.scrollTop < previous.top;
      // Scrolling up inside the bottom margin is the reader leaving. Pinning
      // again here would snap each streamed chunk back down under the wheel.
      const layoutChanged =
        !!previous &&
        previous.el === el &&
        (previous.height !== el.scrollHeight || previous.viewport !== el.clientHeight);
      const clamped = !!previous && scrollClampedToBottom(el, previous.top);
      const leaving =
        scrolledUp || (!stickToBottom.current && distance > distanceFromBottom.current);
      const near = stickToBottom.current
        ? !scrolledUp
        : !layoutChanged &&
          !clamped &&
          isNearBottom(el) &&
          !leaving &&
          !!previous &&
          el.scrollTop > previous.top;
      stickToBottom.current = near;
      distanceFromBottom.current = distance;
      rememberScroll(el);
      setShowJump(!near);
    },
    [rememberScroll, setShowJump],
  );

  const jumpToBottom = useCallback(() => {
    stickToBottom.current = true;
    distanceFromBottom.current = 0;
    setShowJump(false);
    const el = scroller.current;
    syncTranscriptViewport(el);
    pinToBottom(el);
    if (el) rememberScroll(el);
  }, [rememberScroll, setShowJump]);

  const setScroller = useCallback(
    (el: HTMLDivElement | null) => {
      scroller.current = el;
      setScrollerEl(el);
      lockOverscroll(el);
    },
    [lockOverscroll],
  );

  useEffect(() => {
    onJumpToBottomReady?.(jumpToBottom);
    return () => onJumpToBottomReady?.(null);
  }, [jumpToBottom, onJumpToBottomReady]);

  // A pooled transcript outlives its pane; tell each new owner where it stands.
  useEffect(() => {
    onJumpToBottomChange?.(showJumpRef.current);
  }, [onJumpToBottomChange]);
  useEffect(() => {
    onReadingChange?.(readingRef.current);
    return () => onReadingChange?.(false);
  }, [onReadingChange]);

  useLayoutEffect(() => {
    onScrollerChange?.(scrollerEl);
    return () => onScrollerChange?.(null);
  }, [onScrollerChange, scrollerEl]);

  useEffect(() => {
    if (!visible || !scrollerEl) return;
    syncPinned(scrollerEl);
    const onScroll = () => {
      if (scrollerEl.isConnected && scrollerEl.clientHeight > 0) syncPinned(scrollerEl);
    };
    let release: ReturnType<typeof setTimeout> | undefined;
    const onWheel = (e: WheelEvent) => {
      if (innerScrollerTakes(scrollerEl, e)) return;
      if (e.deltaY < 0) {
        stickToBottom.current = false;
        setShowJump(true);
        publishReading(scrollerEl);
      } else if (e.deltaY > 0) {
        // Already at the very end, there is no scroll event to say the reader
        // came back (a compact composer can leave the position clamped there).
        if (
          !stickToBottom.current &&
          scrollerEl.scrollHeight - scrollerEl.scrollTop - scrollerEl.clientHeight < 1
        ) {
          stickToBottom.current = true;
          distanceFromBottom.current = 0;
          setShowJump(false);
          rememberScroll(scrollerEl);
        }
      } else {
        // A directionless trackpad event can precede an off-thread scroll.
        // Wait for its direction before following new output.
        wheelHold.current = performance.now() + WHEEL_HOLD_MS;
        clearTimeout(release);
        release = setTimeout(() => {
          if (!scrollerEl.isConnected) return;
          syncPinned(scrollerEl);
          if (stickToBottom.current) {
            pinToBottom(scrollerEl);
            rememberScroll(scrollerEl);
          }
        }, WHEEL_HOLD_MS);
      }
    };
    scrollerEl.addEventListener("scroll", onScroll, { passive: true });
    scrollerEl.addEventListener("wheel", onWheel, { passive: true });
    return () => {
      clearTimeout(release);
      scrollerEl.removeEventListener("scroll", onScroll);
      scrollerEl.removeEventListener("wheel", onWheel);
    };
  }, [publishReading, rememberScroll, scrollerEl, setShowJump, syncPinned, visible]);

  useLayoutEffect(() => {
    if (restoreCheckpoint.current && lastUserId === checkpointUserId.current) return;
    restoreCheckpoint.current = undefined;
    restoringCheckpoint.current = false;
    stickToBottom.current = true;
    setShowJump(false);
    const el = scroller.current;
    syncTranscriptViewport(el);
    pinToBottom(el);
    if (el) rememberScroll(el);
  }, [lastUserId, rememberScroll, setShowJump]);

  // Only a new prompt starts the motion; later renders must not replay it.
  const introducedPromptMount = useRef(false);
  useLayoutEffect(() => {
    const mounting = !introducedPromptMount.current;
    introducedPromptMount.current = true;
    return onPromptChange?.(mounting, scroller.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastUserId]);

  useLayoutEffect(() => {
    const opened = visible && !wasVisible.current;
    wasVisible.current = visible;
    if (!opened) return;
    const el = scroller.current;
    if (!el) return;
    syncTranscriptViewport(el);
    const restore = restoreScroll.current;
    restoreScroll.current = false;
    // Previously opened tabs normally retain their scroll position. Only pin
    // when the scroller looks empty after being hidden with `display: none`.
    if (el.scrollHeight <= el.clientHeight + NEAR_BOTTOM_PX) {
      stickToBottom.current = true;
      setShowJump(false);
      pinToBottom(el);
      publishReading(el);
    } else if (restore && stickToBottom.current) {
      pinToBottom(el);
      rememberScroll(el);
    } else if (restore) {
      el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight - distanceFromBottom.current);
    }
  }, [publishReading, rememberScroll, visible, setShowJump]);

  // The one place that follows streamed content to the bottom. Observer
  // callbacks run after layout and before paint, so the pin lands in the same
  // frame as the content and reads geometry the browser has already computed.
  // A layout effect keyed on `blocks` would force a second layout per frame.
  useLayoutEffect(() => {
    const el = scrollerEl;
    const inner = el?.querySelector("[data-transcript-content]");
    if (!visible || !el || !inner) return;
    const onResize = (entries?: ResizeObserverEntry[]) => {
      // A parked transcript's scroller is detached and measures zero.
      if (!el.isConnected) return;
      // The padding only changes with the container, never with its content.
      syncTranscriptViewport(el, !entries || entries.some((entry) => entry.target === el));
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      if (stickToBottom.current) {
        if (performance.now() < wheelHold.current) return;
        pinToBottom(el);
        distanceFromBottom.current = 0;
        rememberScroll(el);
        return;
      }
      distanceFromBottom.current = distance;
      rememberScroll(el);
      setShowJump(!isNearBottom(el));
    };
    const observer = new ResizeObserver(onResize);
    observer.observe(inner);
    observer.observe(el);
    onResize();
    return () => observer.disconnect();
  }, [rememberScroll, scrollerEl, setShowJump, visible]);

  useTurnScrollAnchor(scrollerEl, visible, stickToBottom, rememberScroll);

  return {
    scroller,
    scrollerEl,
    setScroller,
    stickToBottom,
    distanceFromBottom,
    prependHeight,
    wasVisible,
    rememberScroll,
    setShowJump,
    restoreCheckpoint,
    restoringCheckpoint,
  };
}

/**
 * Re-applies the retained scroll position once the rows exist. Declared after
 * paging so it runs last in the layout phase, as the final word on position:
 * it keeps correcting for delayed markdown/highlight layout until the reader
 * takes over or a second passes.
 */
export function useTranscriptCheckpointRestore(
  follow: TranscriptFollow,
  visible: boolean,
  lastUserId: string | undefined,
) {
  const {
    scroller,
    scrollerEl,
    stickToBottom,
    distanceFromBottom,
    rememberScroll,
    setShowJump,
    restoreCheckpoint,
    restoringCheckpoint,
  } = follow;
  useLayoutEffect(() => {
    const checkpoint = restoreCheckpoint.current;
    const el = scroller.current;
    if (!visible || !el || !checkpoint) return;
    let frame = 0;
    const restore = () => {
      if (!el.clientHeight) return;
      stickToBottom.current = checkpoint.bottomFollow ?? true;
      if (stickToBottom.current) pinToBottom(el);
      else {
        const anchor = [...el.querySelectorAll<HTMLElement>("[data-transcript-turn]")].find(
          (node) => node.dataset.transcriptTurn === checkpoint.anchorId,
        );
        el.scrollTop = anchor
          ? el.scrollTop +
            anchor.getBoundingClientRect().top -
            el.getBoundingClientRect().top -
            (checkpoint.anchorOffset ?? 0)
          : (checkpoint.scrollTop ?? 0);
      }
      distanceFromBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight;
      setShowJump(!stickToBottom.current);
      // Save geometry only after the checkpoint has been applied.
      restoringCheckpoint.current = false;
      rememberScroll(el);
    };
    restore();
    frame = requestAnimationFrame(restore);
    const observer = new ResizeObserver(restore);
    const content = el.querySelector("[data-transcript-content]");
    if (content) observer.observe(content);
    const stop = () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
    const finish = () => {
      restoreCheckpoint.current = undefined;
      restoringCheckpoint.current = false;
      stop();
    };
    // Compensate delayed markdown/highlight layout, until the reader takes over.
    const timeout = setTimeout(finish, 1000);
    el.addEventListener("wheel", finish, { passive: true });
    el.addEventListener("pointerdown", finish);
    el.addEventListener("keydown", finish);
    return () => {
      // Activity and StrictMode replay effects. Keep the checkpoint until a
      // completed restore or reader interaction, rather than clearing on replay.
      stop();
      clearTimeout(timeout);
      el.removeEventListener("wheel", finish);
      el.removeEventListener("pointerdown", finish);
      el.removeEventListener("keydown", finish);
    };
  }, [
    lastUserId,
    rememberScroll,
    scroller,
    scrollerEl,
    setShowJump,
    stickToBottom,
    distanceFromBottom,
    restoreCheckpoint,
    restoringCheckpoint,
    visible,
  ]);
}
