import { useEffect, type RefObject } from "react";

const SETTLE_FRAMES = 4;

function outside(node: HTMLElement) {
  const scroller = node.closest<HTMLElement>("[data-continuous-list]");
  if (!scroller) return false;
  const row = node.getBoundingClientRect();
  const view = scroller.getBoundingClientRect();
  return row.top < view.top || row.bottom > view.bottom;
}

/**
 * Keeps the selected library card in view after selection or filter changes.
 * The library is a virtual window whose rows are measured after they mount, so
 * one `scrollIntoView` can land on estimated positions; repeat for a few frames
 * until the card is inside its scroller.
 */
export function useNoteInView(
  container: RefObject<HTMLElement | null>,
  dependencies: readonly unknown[],
) {
  useEffect(() => {
    let frames = 0;
    let frame = 0;
    const reveal = () => {
      const node = container.current?.querySelector<HTMLElement>('[aria-current="true"]');
      if (!node) return;
      if (frames === 0 || outside(node)) node.scrollIntoView?.({ block: "nearest" });
      if (++frames < SETTLE_FRAMES) frame = requestAnimationFrame(reveal);
    };
    reveal();
    return () => cancelAnimationFrame(frame);
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- Callers pass the values that change what is selected or listed.
  }, dependencies);
}
