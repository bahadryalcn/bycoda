import { useLayoutEffect, type RefObject } from "react";

/**
 * Hold the reader's place when loaded turns above the viewport change height
 * (images, expanded work or Markdown). Native scroll anchoring is disabled;
 * compensate only the changed turns that were wholly above the reader.
 */
export function useTurnScrollAnchor(
  el: HTMLDivElement | null,
  enabled: boolean,
  stickToBottom: RefObject<boolean>,
  onAdjust: (el: HTMLElement) => void,
) {
  useLayoutEffect(() => {
    const inner = el?.querySelector("[data-transcript-content]");
    if (!enabled || !el || !inner) return;
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
    const resize = new ResizeObserver((entries) => {
      // A parked transcript's scroller is detached and measures zero.
      if (!el.isConnected) return;
      const viewportTop = el.getBoundingClientRect().top;
      let shift = 0;
      let precedingDelta = 0;
      const remeasure = new Set<Element>();
      // ResizeObserver order is not DOM order. Only sort changed turns so
      // preceding height corrections retain the same anchoring semantics.
      const ordered = [...entries].sort((a, b) =>
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
          resetTurn(entry.target);
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
      if (shift) {
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
        turn.style.containIntrinsicBlockSize = `${entry.contentRect.height}px`;
        turn.style.contentVisibility = "auto";
      }
    });
    let observed = new WeakSet<Element>();
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
          !liveTurn?.contains(record.target) ||
          (record.target === liveTurn &&
            record.type === "attributes" &&
            record.attributeName === "class"),
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
    const appearance = new MutationObserver(() => {
      const next = fontSignature();
      if (next === font) return;
      font = next;
      refreshHeights();
    });
    appearance.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style"],
    });
    appearance.observe(document.body, { attributes: true, attributeFilter: ["class", "style"] });
    document.fonts?.addEventListener("loadingdone", refreshHeights);
    observeTurns();
    return () => {
      mutations.disconnect();
      appearance.disconnect();
      document.fonts?.removeEventListener("loadingdone", refreshHeights);
      resize.disconnect();
      inner.removeEventListener("load", resourceChanged, true);
      inner.removeEventListener("error", resourceChanged, true);
      for (const turn of inner.children) {
        (turn as HTMLElement).style.removeProperty("content-visibility");
        (turn as HTMLElement).style.removeProperty("contain-intrinsic-block-size");
      }
    };
  }, [el, enabled, stickToBottom, onAdjust]);
}
