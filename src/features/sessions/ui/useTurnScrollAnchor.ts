import { useLayoutEffect, type RefObject } from "react";
import { deferDuringResize, resizeGestureActive } from "../../../shared/lib/resizeGesture";
import { firstTurnBelow, scrollClampedToBottom } from "./transcriptScroll";

/** How long after the transcript changes width the reader's row is held in place. */
const WIDTH_SETTLE_MS = 500;

/** Finds the first visible row of the virtualized turns, finer than a whole turn. */
type ReaderRows = { firstVisibleRow(el: HTMLElement): HTMLElement | null };

const classTokens = (value: string | null) => new Set((value ?? "").split(/\s+/).filter(Boolean));

// React rewrites `class` with the same names in a different order or with no
// change at all. Such a write cannot move content, so it keeps the turn contained.
function unchangedClassList(record: MutationRecord) {
  if (
    record.type !== "attributes" ||
    record.attributeName !== "class" ||
    !(record.target instanceof Element)
  )
    return false;
  const before = classTokens(record.oldValue);
  const after = classTokens(record.target.getAttribute("class"));
  return before.size === after.size && [...before].every((token) => after.has(token));
}

/**
 * Hold the reader's place when loaded turns above the viewport change height
 * (images, expanded work or Markdown). Native scroll anchoring is disabled;
 * compensate only the changed turns that were wholly above the reader.
 *
 * A width change (a pane beside the chat opening or closing) reflows every turn, and when
 * the content gets shorter the browser clamps the offset, which already moves the view.
 * Adding each turn's height change on top of that counted the shrink twice and threw the
 * reader far up. After a width change the reader's first visible row is put back instead.
 */
export function useTurnScrollAnchor(
  el: HTMLDivElement | null,
  enabled: boolean,
  stickToBottom: RefObject<boolean>,
  onAdjust: (el: HTMLElement) => void,
  rows?: ReaderRows,
) {
  useLayoutEffect(() => {
    const inner = el?.querySelector("[data-transcript-content]");
    if (!enabled || !el || !inner) return;
    // The reader's place: the first visible row, its offset from the top of the view and its
    // height, with the offset and width of the scroller when it was taken.
    let place: {
      node: HTMLElement;
      offset: number;
      height: number;
      top: number;
      width: number;
    } | null = null;
    let scrollerWidth = 0;
    let settleUntil = 0;
    let settleFrame = 0;
    const locate = () => {
      if (stickToBottom.current || !el.clientHeight) {
        place = null;
        return;
      }
      const top = el.getBoundingClientRect().top;
      const node =
        rows?.firstVisibleRow(el) ??
        firstTurnBelow(inner.querySelectorAll<HTMLElement>("[data-transcript-turn]"), top);
      const rect = node?.getBoundingClientRect();
      place =
        node && rect
          ? {
              node,
              offset: rect.top - top,
              height: rect.height,
              top: el.scrollTop,
              width: el.clientWidth,
            }
          : null;
    };
    const restorePlace = () => {
      if (!place?.node.isConnected || stickToBottom.current) return;
      const rect = place.node.getBoundingClientRect();
      // A row that starts above the view (a long reply) reflows too: keep the same share of
      // it above the top, so the reader stays at the same point in its text.
      const target =
        place.offset < 0 && place.height > 0
          ? (place.offset * rect.height) / place.height
          : place.offset;
      const delta = rect.top - el.getBoundingClientRect().top - target;
      if (Math.abs(delta) < 0.5) return;
      el.scrollTop += delta;
      onAdjust(el);
    };
    const endSettle = () => {
      if (!settleUntil) return;
      settleUntil = 0;
      cancelAnimationFrame(settleFrame);
      settleFrame = 0;
      locate();
    };
    // Rows re-measure over the next frames (virtualized rows, contained turns); keep putting
    // the reader's row back until the layout has settled or the reader takes over.
    const settleStep = () => {
      settleFrame = 0;
      restorePlace();
      if (performance.now() < settleUntil) settleFrame = requestAnimationFrame(settleStep);
      else endSettle();
    };
    const settle = () => {
      settleUntil = performance.now() + WIDTH_SETTLE_MS;
      if (!settleFrame) settleFrame = requestAnimationFrame(settleStep);
    };
    const onScroll = () => {
      // A reflow to a new width, or a shorter layout, clamps the offset before the observer
      // runs; that is not the reader moving, so the place from before the change is kept.
      if (
        settleUntil ||
        (place && (el.clientWidth !== place.width || scrollClampedToBottom(el, place.top)))
      )
        return;
      locate();
    };
    let observed = new WeakSet<Element>();
    const heights = new WeakMap<Element, number>();
    const widths = new WeakMap<Element, number>();
    const resetTurn = (turn: Element) => {
      const node = turn as HTMLElement;
      node.style.removeProperty("content-visibility");
      node.style.removeProperty("contain-intrinsic-block-size");
      // A new observation reports the real content even when the old placeholder
      // happened to have the same height. Never invent a height for loaded history.
      resize.unobserve?.(turn);
      resize.observe(turn);
    };
    // Turns whose width changed during a live resize. Un-containing them each frame would lay out
    // every retained turn at every width, so they keep their stale placeholder (the scroll
    // height holds) and are measured once when the resize ends.
    const owed = new Set<Element>();
    const settleOwed = deferDuringResize(() => {
      const turns = [...owed];
      owed.clear();
      for (const turn of turns) if (turn.isConnected && observed.has(turn)) resetTurn(turn);
    });
    const resize = new ResizeObserver((entries) => {
      // A parked transcript's scroller is detached and measures zero.
      if (!el.isConnected) return;
      const viewportTop = el.getBoundingClientRect().top;
      let shift = 0;
      let precedingDelta = 0;
      const remeasure = new Set<Element>();
      const scroller = entries.find((entry) => entry.target === el);
      if (scroller) {
        const width = scroller.contentRect.width;
        // A hidden or detached scroller measures zero; showing it again is not a reflow.
        if (scrollerWidth > 0 && width > 0 && Math.abs(width - scrollerWidth) > 0.5 && place)
          settle();
        scrollerWidth = width;
      }
      // ResizeObserver order is not DOM order. Only sort changed turns so
      // preceding height corrections retain the same anchoring semantics.
      const ordered = entries
        .filter((entry) => entry.target !== el)
        .sort((a, b) =>
          a.target.compareDocumentPosition(b.target) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
        );
      for (const entry of ordered) {
        const width = entry.contentRect.width;
        const previousWidth = widths.get(entry.target);
        widths.set(entry.target, width);
        if (
          previousWidth !== undefined &&
          previousWidth !== width &&
          (entry.target as HTMLElement).style.contentVisibility === "auto"
        ) {
          remeasure.add(entry.target);
          if (resizeGestureActive()) {
            owed.add(entry.target);
            settleOwed();
          } else resetTurn(entry.target);
          continue;
        }
        const height = entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height;
        const previous = heights.get(entry.target);
        heights.set(entry.target, height);
        if (
          previous === undefined ||
          stickToBottom.current ||
          (entry.target as HTMLElement).dataset.transcriptVirtualizedTurn === "true"
        )
          continue;
        // Only turns that sat wholly above the view. A turn the reader is
        // looking at grows downward from where they are reading.
        const top = entry.target.getBoundingClientRect().top - precedingDelta;
        if (top + previous <= viewportTop) shift += height - previous;
        precedingDelta += height - previous;
      }
      // While a width change settles, putting the reader's row back covers every turn above it.
      if (settleUntil) restorePlace();
      else if (shift) {
        el.scrollTop += shift;
        onAdjust(el);
      }
      // All reads/anchor corrections finish before applying containment. Actual
      // measured content heights preserve the scroll range during upward gestures;
      // estimated `auto 200px` fallbacks previously caused that range to jump.
      for (const entry of ordered) {
        const turn = entry.target as HTMLElement;
        if (
          remeasure.has(turn) ||
          entry.contentRect.height <= 0 ||
          turn.classList.contains("transcript-turn-live") ||
          turn.classList.contains("transcript-turn-anchor")
        )
          continue;
        const width = widths.get(turn);
        if (width !== entry.contentRect.width || !heights.has(turn)) continue;
        // Under page zoom an offscreen turn lays its placeholder out a fraction smaller than
        // written. Writing that back shrank it every frame and the followed transcript crept
        // with it, so a sub-pixel difference keeps the placeholder. Content changes reset it.
        const placeholder = Number.parseFloat(turn.style.containIntrinsicBlockSize);
        if (Math.abs(placeholder - entry.contentRect.height) < 1) continue;
        turn.style.containIntrinsicBlockSize = `${entry.contentRect.height}px`;
        turn.style.contentVisibility = "auto";
      }
    });
    const observeTurns = () => {
      for (const turn of inner.children) {
        if (observed.has(turn) || !turn.classList.contains("transcript-turn")) continue;
        observed.add(turn);
        resize.observe(turn);
      }
    };
    let liveTurn = inner.querySelector(".transcript-turn-live");
    const mutations = new MutationObserver((records) => {
      if (
        !liveTurn ||
        !liveTurn.classList.contains("transcript-turn-live") ||
        records.some((record) => record.target === inner)
      )
        liveTurn = inner.querySelector(".transcript-turn-live");
      const relevant = records.filter(
        (record) =>
          !unchangedClassList(record) &&
          (!liveTurn?.contains(record.target) ||
            (record.target === liveTurn &&
              record.type === "attributes" &&
              record.attributeName === "class")),
      );
      if (!relevant.length) return;
      const listChanged = relevant.some(
        (record) => record.target === inner && record.type === "childList",
      );
      // Removal is rare (a rewind or edit), so start over rather than hold
      // detached turns. Re-observed turns report the height already stored.
      if (relevant.some((record) => record.target === inner && record.removedNodes.length > 0)) {
        resize.disconnect();
        observed = new WeakSet();
        resize.observe(el);
      }
      const changed = new Set<Element>();
      for (const record of relevant) {
        const target =
          record.target instanceof Element ? record.target : record.target.parentElement;
        const turn = target?.closest(".transcript-turn");
        if (turn && observed.has(turn) && !turn.classList.contains("transcript-turn-live"))
          changed.add(turn);
      }
      for (const turn of changed) resetTurn(turn);
      // Tail text/word-fade mutations must not enumerate every retained turn.
      if (listChanged) observeTurns();
    });
    mutations.observe(inner, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeOldValue: true,
      attributeFilter: [
        "class",
        "data-collapsed",
        "data-fold-state",
        "src",
        "width",
        "height",
        "open",
      ],
    });
    const resourceChanged = (event: Event) => {
      const turn =
        event.target instanceof Element ? event.target.closest(".transcript-turn") : null;
      if (turn && observed.has(turn) && !turn.classList.contains("transcript-turn-live"))
        resetTurn(turn);
    };
    inner.addEventListener("load", resourceChanged, true);
    inner.addEventListener("error", resourceChanged, true);
    const fontSignature = () => {
      const turn = inner.querySelector(".transcript-turn");
      if (!turn) return "";
      const style = getComputedStyle(turn);
      return [
        style.fontFamily,
        style.fontSize,
        style.fontWeight,
        style.lineHeight,
        style.letterSpacing,
      ].join("|");
    };
    let font = fontSignature();
    const refreshHeights = () => {
      for (const turn of inner.children) if (observed.has(turn)) resetTurn(turn);
    };
    // Root style/class writes arrive in bursts (settings, CSS variables). Check
    // the font once per frame, before paint, instead of once per mutation record.
    let appearanceFrame = 0;
    // The font read forces a style recalculation, so it waits out a live resize.
    const checkFont = deferDuringResize(() => {
      const next = fontSignature();
      if (next === font) return;
      font = next;
      refreshHeights();
    });
    const checkAppearance = () => {
      appearanceFrame = 0;
      checkFont();
    };
    const appearance = new MutationObserver(() => {
      if (!appearanceFrame) appearanceFrame = requestAnimationFrame(checkAppearance);
    });
    // Fonts inherit from these roots. `data-control-density` sets the root font
    // scale in the stylesheets; the other root attributes do not affect type.
    appearance.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style", "data-control-density"],
    });
    appearance.observe(document.body, { attributes: true, attributeFilter: ["class", "style"] });
    document.fonts?.addEventListener("loadingdone", refreshHeights);
    observeTurns();
    resize.observe(el);
    locate();
    el.addEventListener("scroll", onScroll, { passive: true });
    // The reader taking over ends a settle, like a retained position restore.
    for (const type of ["wheel", "pointerdown", "touchstart", "keydown"] as const)
      el.addEventListener(type, endSettle, { passive: true });
    return () => {
      cancelAnimationFrame(settleFrame);
      el.removeEventListener("scroll", onScroll);
      for (const type of ["wheel", "pointerdown", "touchstart", "keydown"] as const)
        el.removeEventListener(type, endSettle);
      mutations.disconnect();
      appearance.disconnect();
      cancelAnimationFrame(appearanceFrame);
      checkFont.cancel();
      settleOwed.cancel();
      document.fonts?.removeEventListener("loadingdone", refreshHeights);
      resize.disconnect();
      inner.removeEventListener("load", resourceChanged, true);
      inner.removeEventListener("error", resourceChanged, true);
      for (const turn of inner.children) {
        (turn as HTMLElement).style.removeProperty("content-visibility");
        (turn as HTMLElement).style.removeProperty("contain-intrinsic-block-size");
      }
    };
  }, [el, enabled, stickToBottom, onAdjust, rows]);
}
