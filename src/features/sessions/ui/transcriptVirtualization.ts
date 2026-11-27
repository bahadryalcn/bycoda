import { createContext, useContext, useSyncExternalStore } from "react";
import { TranscriptLayoutWatch } from "./transcriptLayoutWatch";
import { firstTurnBelow } from "./transcriptScroll";

export type RowScrollOwner = HTMLElement | (() => HTMLElement | null);

/** Presentation only; no source bytes, provider effects or approval decisions. */
export class TranscriptVirtualization {
  /** The one observer set every virtual list of this transcript watches its layout through. */
  readonly layout = new TranscriptLayoutWatch();
  private target: string | null;
  private listeners = new Set<() => void>();
  private workVersion = 0;
  readonly activeBlocks = new Map<string, number>();
  readonly remoteLoads = new Map<string, "idle" | "pending" | "failed">();
  workSnapshot = () => this.workVersion;
  holdBlock(blockId: string): () => void {
    this.activeBlocks.set(blockId, (this.activeBlocks.get(blockId) ?? 0) + 1);
    this.workVersion++;
    for (const listener of this.listeners) listener();
    let held = true;
    return () => {
      if (!held) return;
      held = false;
      const count = (this.activeBlocks.get(blockId) ?? 1) - 1;
      if (count) this.activeBlocks.set(blockId, count);
      else this.activeBlocks.delete(blockId);
      this.workVersion++;
      for (const listener of this.listeners) listener();
    };
  }
  private scrolls = new Map<HTMLElement, { references: number; anchor: ScrollAnchor }>();
  private turnUsers = new Map<HTMLElement, number>();
  readonly disclosures = new Map<string, boolean | null>();
  /** Per list, the code-block fold state of each row that has one, by row id. */
  readonly codeFolds = new Map<string, Map<string, Record<string, boolean>>>();
  readonly measurements = new Map<string, Map<string, { width: number; height: number }>>();
  /** The measured row sizes of one list, created on first use. */
  measurementsFor(listId: string): Map<string, { width: number; height: number }> {
    return listCache(this.measurements, listId);
  }
  /** The code-block fold state of one list's rows, created on first use. */
  codeFoldsFor(listId: string): Map<string, Record<string, boolean>> {
    return listCache(this.codeFolds, listId);
  }
  /** Keeps a mounted list's sizes and fold state here; the release drops them once it unmounts.
   * A newer hold of the same list is not dropped by an older release. */
  holdList(
    listId: string,
    sizes: Map<string, { width: number; height: number }>,
    folds: Map<string, Record<string, boolean>>,
  ): () => void {
    this.measurements.set(listId, sizes);
    this.codeFolds.set(listId, folds);
    return () => {
      if (this.measurements.get(listId) === sizes) this.measurements.delete(listId);
      if (this.codeFolds.get(listId) === folds) this.codeFolds.delete(listId);
    };
  }
  /** Drops the measured sizes and fold state of rows the list no longer has. */
  retainRows(listId: string, retained: ReadonlySet<string>): void {
    dropUnretained(this.measurements.get(listId), retained);
    dropUnretained(this.codeFolds.get(listId), retained);
  }
  readonly rowScroll = new WeakMap<HTMLElement, RowScrollOwner>();
  private readonly scrollForRow = (node: HTMLElement) => {
    const owner = this.rowScroll.get(node);
    return typeof owner === "function" ? (owner() ?? undefined) : owner;
  };
  adjusted?: (element: HTMLElement) => void;
  private shouldAdjust?: (element: HTMLElement) => boolean;
  /** Registers the follow owner's anchoring policy and adjustment notification. */
  setAdjusted(
    handler: ((element: HTMLElement) => void) | undefined,
    shouldAdjust?: (element: HTMLElement) => boolean,
  ): void {
    this.adjusted = handler;
    this.shouldAdjust = shouldAdjust;
  }
  constructor(target: string | null = null) {
    this.target = target;
  }
  snapshot = () => this.target;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  reveal(target: string | null): void {
    for (const entry of this.scrolls.values()) entry.anchor.reset();
    if (this.target === target) return;
    this.target = target;
    for (const listener of this.listeners) listener();
  }
  /** Ends a finished reveal of `target`; a newer target stays. Anchors are untouched. */
  settleReveal(target: string | null | undefined): void {
    if (!target || this.target !== target) return;
    this.target = null;
    for (const listener of this.listeners) listener();
  }
  /** Settles `target` once the navigating caller's own alignment frame has run. */
  settleRevealAfterAlignment(target: string): void {
    requestAnimationFrame(() => requestAnimationFrame(() => this.settleReveal(target)));
  }
  anchorId(scroll: HTMLElement): string | undefined {
    return this.scrolls.get(scroll)?.anchor.blockId();
  }
  resetAnchors(): void {
    for (const entry of this.scrolls.values()) entry.anchor.reset();
  }
  firstVisibleRow(scroll: HTMLElement): HTMLElement | null {
    return firstVisibleRow(scroll, this.scrollForRow);
  }
  acquire(
    scroll: HTMLElement,
    turn: HTMLElement | null,
  ): { changed: () => void; release: () => void } {
    // Inner phase scrollers own only their own geometry; whole-turn anchoring still owns outer layout.
    const managedTurn = scroll.classList.contains("agent-transcript") ? turn : null;
    let entry = this.scrolls.get(scroll);
    if (!entry) {
      entry = {
        references: 0,
        anchor: new ScrollAnchor(
          scroll,
          () => this.adjusted?.(scroll),
          this.scrollForRow,
          () => this.shouldAdjust?.(scroll) ?? true,
        ),
      };
      this.scrolls.set(scroll, entry);
    }
    entry.references++;
    if (managedTurn) {
      this.turnUsers.set(managedTurn, (this.turnUsers.get(managedTurn) ?? 0) + 1);
      managedTurn.dataset.transcriptVirtualizedTurn = "true";
    }
    const retained = entry;
    return {
      changed: () => retained.anchor.changed(),
      release: () => {
        if (--retained.references === 0) {
          retained.anchor.dispose();
          this.scrolls.delete(scroll);
        }
        if (managedTurn) {
          const count = (this.turnUsers.get(managedTurn) ?? 1) - 1;
          if (count) this.turnUsers.set(managedTurn, count);
          else {
            this.turnUsers.delete(managedTurn);
            delete managedTurn.dataset.transcriptVirtualizedTurn;
          }
        }
      },
    };
  }
}
export const TranscriptVirtualizationContext = createContext<TranscriptVirtualization | undefined>(
  undefined,
);
export function useTranscriptRevealTarget(): string | null {
  const owner = useContext(TranscriptVirtualizationContext);
  return useSyncExternalStore(
    owner?.subscribe ?? emptySubscribe,
    owner?.snapshot ?? emptySnapshot,
    emptySnapshot,
  );
}
export function useTranscriptActiveBlocksVersion(): number {
  const owner = useContext(TranscriptVirtualizationContext);
  return useSyncExternalStore(
    owner?.subscribe ?? emptySubscribe,
    owner?.workSnapshot ?? emptyWorkSnapshot,
    emptyWorkSnapshot,
  );
}
const emptyWorkSnapshot = () => 0;
const emptySnapshot = () => null;
const emptySubscribe = () => () => {};

/** One compensation owner per physical scroller, shared by nested virtual lists.
 * Virtualizer size correction and whole-turn correction never run in parallel. */
class ScrollAnchor {
  private anchor: { node: HTMLElement; top: number; scrollTop: number } | null = null;
  private frame = 0;
  constructor(
    private scroll: HTMLElement,
    private adjusted: () => void,
    private ownerOf: (node: HTMLElement) => HTMLElement | undefined,
    private shouldAdjust: () => boolean,
  ) {
    scroll.addEventListener("scroll", this.remember, { passive: true });
    this.remember();
  }
  private remember = () => {
    if (!this.scroll.clientHeight) return;
    const top = this.scroll.getBoundingClientRect().top;
    const candidate = firstVisibleRow(this.scroll, this.ownerOf);
    this.anchor = candidate
      ? {
          node: candidate,
          top: candidate.getBoundingClientRect().top - top,
          scrollTop: this.scroll.scrollTop,
        }
      : null;
  };
  blockId(): string | undefined {
    const node = this.anchor?.node;
    if (!node?.isConnected) return undefined;
    const rect = node.getBoundingClientRect();
    const top = this.scroll.getBoundingClientRect().top;
    return rect.bottom > top && rect.top < top + this.scroll.clientHeight
      ? node.dataset.transcriptVirtualBlockId
      : undefined;
  }
  reset(): void {
    this.anchor = null;
  }
  changed(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      if (!this.scroll.isConnected || !this.scroll.clientHeight) return;
      const anchor = this.anchor;
      const scrollTop = this.scroll.scrollTop;
      // The offset can move before the browser delivers its scroll event.
      if (
        this.shouldAdjust() &&
        anchor?.scrollTop === scrollTop &&
        anchor.node.isConnected &&
        this.scroll.contains(anchor.node)
      ) {
        const top =
          anchor.node.getBoundingClientRect().top - this.scroll.getBoundingClientRect().top;
        const delta = top - anchor.top;
        if (Math.abs(delta) > 0.5) {
          // A live phase can become a nested scroller while its rows stay mounted.
          // Its own scroll does not move the surrounding transcript's layout.
          if (closestScroll(anchor.node) !== this.scroll) {
            this.reset();
            return;
          }
          this.scroll.scrollTop = scrollTop + delta;
          const appliedTop = this.scroll.scrollTop;
          // Consume this change even if the browser rounded or clamped the write.
          this.anchor = {
            node: anchor.node,
            top: top - (appliedTop - scrollTop),
            scrollTop: appliedTop,
          };
          if (appliedTop !== scrollTop) this.adjusted();
          return;
        }
      }
      this.remember();
    });
  }
  dispose(): void {
    cancelAnimationFrame(this.frame);
    this.scroll.removeEventListener("scroll", this.remember);
    this.anchor = null;
  }
}
function listCache<V>(caches: Map<string, Map<string, V>>, listId: string): Map<string, V> {
  let cache = caches.get(listId);
  if (!cache) {
    cache = new Map();
    caches.set(listId, cache);
  }
  return cache;
}
function dropUnretained(cache: Map<string, unknown> | undefined, retained: ReadonlySet<string>) {
  if (cache) for (const key of cache.keys()) if (!retained.has(key)) cache.delete(key);
}
function firstVisibleRow(
  scroll: HTMLElement,
  ownerOf: (node: HTMLElement) => HTMLElement | undefined,
): HTMLElement | null {
  const top = scroll.getBoundingClientRect().top;
  const bottom = top + scroll.clientHeight;
  let candidate: HTMLElement | null = null;
  const rows = scroll.querySelectorAll<HTMLElement>("[data-transcript-virtual-block-id]");
  // This runs on every scroll event. Turns stack in document order, so the rows of
  // the turns above the viewport are skipped by position instead of being measured.
  const turn = scroll.classList.contains("agent-transcript")
    ? firstTurnBelow(scroll.querySelectorAll<HTMLElement>("[data-transcript-turn]"), top)
    : undefined;
  let index = 0;
  for (let end = turn ? rows.length : 0; index < end;) {
    const middle = (index + end) >> 1;
    if (turn!.compareDocumentPosition(rows[middle]) & Node.DOCUMENT_POSITION_PRECEDING)
      index = middle + 1;
    else end = middle;
  }
  for (; index < rows.length; index++) {
    const node = rows[index];
    if (ownerOf(node) !== scroll) continue;
    // Rows are in document order, so the rows nested in the candidate are contiguous right
    // after it. The first owned row outside it can neither replace nor be replaced by the
    // candidate, whether it is visible or not: stop without measuring the rest of the list.
    if (candidate && !candidate.contains(node)) break;
    const rect = node.getBoundingClientRect();
    if (rect.bottom <= top || rect.top >= bottom) continue;
    candidate = node;
  }
  return candidate;
}
export function closestScroll(node: HTMLElement): HTMLElement | null {
  let parent = node.parentElement;
  while (parent) {
    if (
      parent.classList.contains("agent-transcript") ||
      /(auto|scroll)/.test(getComputedStyle(parent).overflowY)
    )
      return parent;
    parent = parent.parentElement;
  }
  return null;
}

/** Native selection pins the complete logical range, including rows newly scrolled into it. */
export function selectedVirtualRange(
  root: HTMLElement,
  owner: string,
  count: number,
): [number, number] | null {
  const selection = root.ownerDocument.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
  const range = selection.getRangeAt(0);
  try {
    if (!range.intersectsNode(root)) return null;
  } catch {
    return null;
  }
  const index = (node: Node) => {
    let element = node instanceof Element ? node : node.parentElement;
    while (element && element !== root) {
      if ((element as HTMLElement).dataset.transcriptVirtualOwner === owner)
        return Number((element as HTMLElement).dataset.index);
      element = element.parentElement;
    }
    return null;
  };
  const first = index(range.startContainer),
    last = index(range.endContainer);
  return [first ?? 0, last ?? count - 1];
}
