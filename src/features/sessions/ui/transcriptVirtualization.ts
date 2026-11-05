import { createContext, useContext, useSyncExternalStore } from "react";

/** Presentation only; no source bytes, provider effects or approval decisions. */
export class TranscriptVirtualization {
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
  readonly codeFolds = new Map<string, boolean[]>();
  readonly measurements = new Map<string, Map<string, { width: number; height: number }>>();
  readonly rowScroll = new WeakMap<HTMLElement, HTMLElement>();
  adjusted?: (element: HTMLElement) => void;
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
  anchorId(scroll: HTMLElement): string | undefined {
    return this.scrolls.get(scroll)?.anchor.blockId();
  }
  resetAnchors(): void {
    for (const entry of this.scrolls.values()) entry.anchor.reset();
  }
  firstVisibleRow(scroll: HTMLElement): HTMLElement | null {
    return firstVisibleRow(scroll, (node) => this.rowScroll.get(node));
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
          (node) => this.rowScroll.get(node),
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
  private anchor: { node: HTMLElement; top: number } | null = null;
  private frame = 0;
  constructor(
    private scroll: HTMLElement,
    private adjusted: () => void,
    private ownerOf: (node: HTMLElement) => HTMLElement | undefined,
  ) {
    scroll.addEventListener("scroll", this.remember, { passive: true });
    this.remember();
  }
  private remember = () => {
    if (!this.scroll.clientHeight) return;
    const top = this.scroll.getBoundingClientRect().top;
    const candidate = firstVisibleRow(this.scroll, this.ownerOf);
    this.anchor = candidate
      ? { node: candidate, top: candidate.getBoundingClientRect().top - top }
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
      if (anchor?.node.isConnected && this.scroll.contains(anchor.node)) {
        const delta =
          anchor.node.getBoundingClientRect().top -
          this.scroll.getBoundingClientRect().top -
          anchor.top;
        if (Math.abs(delta) > 0.5) {
          this.scroll.scrollTop += delta;
          this.adjusted();
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
function firstVisibleRow(
  scroll: HTMLElement,
  ownerOf: (node: HTMLElement) => HTMLElement | undefined,
): HTMLElement | null {
  const top = scroll.getBoundingClientRect().top;
  const bottom = top + scroll.clientHeight;
  let candidate: HTMLElement | null = null;
  for (const node of scroll.querySelectorAll<HTMLElement>("[data-transcript-virtual-block-id]")) {
    if (ownerOf(node) !== scroll) continue;
    const rect = node.getBoundingClientRect();
    if (rect.bottom <= top || rect.top >= bottom) continue;
    if (!candidate || candidate.contains(node)) candidate = node;
    else if (!node.contains(candidate)) break;
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
