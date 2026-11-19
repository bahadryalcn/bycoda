import { observeResize } from "../../../shared/lib/observeResize";

type Listener = () => void;
type Kind = "resize" | "mutate";
type Entry = { resize: Set<Listener>; mutate: Set<Listener>; stop: () => void };

const CLASS_OR_STYLE = { attributes: true, attributeFilter: ["class", "style"] };

/**
 * One resize subscription and one mutation observer per watched node, shared by every virtual
 * list of a transcript. A list watches its own element, each ancestor up to its scroller
 * (size, class and style) and the siblings of those ancestors (size), because any of them can
 * move or resize the list. Nested and neighbouring lists share the same ancestors, so a node is
 * observed once however many lists sit under it, and only the lists that watch a changed node
 * are told. Several changes reach a list as one call: sizes in a microtask, class/style flips
 * in the next animation frame, since a flip only matters once styles are recomputed.
 */
export class TranscriptLayoutWatch {
  private entries = new Map<Element, Entry>();
  private pending = new Set<Listener>();
  private mutations: MutationObserver | null = null;
  private staleMutations = false;
  private microtask = false;
  private frame = 0;

  /** Calls `listener` when the layout around `element` may have changed, until the returned
   * function runs. `boundary` is the scroller; the walk also stops at `.agent-transcript`. */
  watch(element: HTMLElement, boundary: HTMLElement | null, listener: Listener): () => void {
    const undo: Array<() => void> = [];
    for (let node: HTMLElement | null = element; node; node = node.parentElement) {
      undo.push(this.add(node, "resize", listener), this.add(node, "mutate", listener));
      const parent: HTMLElement | null = node.parentElement;
      if (parent)
        for (const sibling of parent.children as HTMLCollectionOf<Element>)
          if (sibling !== node) undo.push(this.add(sibling, "resize", listener));
      if (node === boundary || node.classList.contains("agent-transcript")) break;
    }
    return () => {
      this.pending.delete(listener);
      for (const remove of undo) remove();
      if (this.staleMutations) this.rebuildMutations();
      if (!this.entries.size && this.frame) {
        cancelAnimationFrame(this.frame);
        this.frame = 0;
      }
    };
  }

  private add(node: Element, kind: Kind, listener: Listener): () => void {
    let entry = this.entries.get(node);
    if (!entry) {
      const created: Entry = { resize: new Set(), mutate: new Set(), stop: () => {} };
      created.stop = observeResize(node, () => this.mark(created.resize, true));
      this.entries.set(node, created);
      entry = created;
    }
    const owned = entry;
    if (kind === "mutate" && !owned.mutate.size && typeof MutationObserver !== "undefined") {
      this.mutations ??= new MutationObserver((records) => {
        for (const record of records) this.mark(this.entries.get(record.target)?.mutate ?? [], false);
      });
      this.mutations.observe(node, CLASS_OR_STYLE);
    }
    owned[kind].add(listener);
    return () => {
      owned[kind].delete(listener);
      if (kind === "mutate" && !owned.mutate.size) this.staleMutations = true;
      if (owned.resize.size || this.entries.get(node) !== owned) return;
      owned.stop();
      this.entries.delete(node);
    };
  }

  /** A MutationObserver cannot unobserve one node, so it is rebuilt from the nodes still watched. */
  private rebuildMutations(): void {
    this.staleMutations = false;
    const observer = this.mutations;
    if (!observer) return;
    observer.disconnect();
    let any = false;
    for (const [node, entry] of this.entries)
      if (entry.mutate.size) {
        observer.observe(node, CLASS_OR_STYLE);
        any = true;
      }
    if (!any) this.mutations = null;
  }

  private mark(listeners: Iterable<Listener>, soon: boolean): void {
    for (const listener of listeners) this.pending.add(listener);
    if (!this.pending.size) return;
    if (soon) {
      if (this.microtask) return;
      this.microtask = true;
      queueMicrotask(() => {
        this.microtask = false;
        this.flush();
      });
    } else if (!this.frame) {
      this.frame = requestAnimationFrame(() => {
        this.frame = 0;
        this.flush();
      });
    }
  }

  private flush(): void {
    const listeners = [...this.pending];
    this.pending.clear();
    for (const listener of listeners) {
      try {
        listener();
      } catch (error) {
        // One failing list must not starve the others of this batch.
        queueMicrotask(() => {
          throw error;
        });
      }
    }
  }
}
