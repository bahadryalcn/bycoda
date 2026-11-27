/** A file whose diff body is loaded on demand. */
export type LazyDiffItem = {
  /** Identity of the file in the view; never changes for the same file. */
  id: string;
  /**
   * What the list says about the file (counts, status, flags). A loaded body
   * is current while its item still carries the signature it was loaded for.
   */
  signature: string;
};

export type LazyDiffLoaderOptions<Item extends LazyDiffItem, Loaded> = {
  /** Bodies loading at once. */
  concurrency: number;
  /** Leading items loaded without waiting to be seen: the first screenful. */
  eagerCount: number;
  /**
   * Ids that are expanded and near the viewport. Owned by the view so it
   * outlives a loader that is replaced; call `pump()` after it grows.
   */
  needed: ReadonlySet<string>;
  /** Loads one body. `previous` is the body on screen, for identity reuse. */
  load: (item: Item, previous: Loaded | undefined) => Promise<Loaded>;
  /** The body shown for a file whose load threw. */
  failure: (caught: unknown) => Loaded;
  /** Receives a fresh snapshot, at most once per frame however many loads finished. */
  onChange: (loaded: Map<string, Loaded>) => void;
  /** Runs `flush` later and returns a canceller. Default: next animation frame. */
  schedule?: (flush: () => void) => () => void;
};

export type LazyDiffLoader<Item extends LazyDiffItem> = {
  /**
   * The files the view lists, in display order. Bodies of files that left the
   * list are dropped; `refresh` marks every loaded body stale (the change did
   * not say what it touched) so it is fetched again once it is needed.
   */
  setItems: (items: readonly Item[], options?: { refresh?: boolean }) => void;
  /** Loads this file before the others that are still waiting. */
  setFocus: (id: string | undefined) => void;
  /** Starts the loads that are needed and not yet current. */
  pump: () => void;
  dispose: () => void;
};

function scheduleFrame(flush: () => void): () => void {
  if (typeof requestAnimationFrame === "function") {
    const handle = requestAnimationFrame(flush);
    return () => cancelAnimationFrame(handle);
  }
  const handle = setTimeout(flush, 16);
  return () => clearTimeout(handle);
}

/**
 * Loads diff bodies only for the files a reader can see (`needed`) and the
 * first `eagerCount`, with bounded concurrency, and reports results in
 * per-frame batches. A failed body stays failed until the next `setItems`.
 */
export function createLazyDiffLoader<Item extends LazyDiffItem, Loaded>(
  options: LazyDiffLoaderOptions<Item, Loaded>,
): LazyDiffLoader<Item> {
  const { concurrency, eagerCount, needed, load, failure, onChange } = options;
  const schedule = options.schedule ?? scheduleFrame;
  let disposed = false;
  let listed: readonly Item[] = [];
  let ordered: readonly Item[] = [];
  let focusId: string | undefined;
  let cancelFlush: (() => void) | null = null;
  const loaded = new Map<string, Loaded>();
  // The signature each loaded body was loaded for.
  const loadedFor = new Map<string, string>();
  const dirty = new Set<string>();
  const inFlight = new Set<string>();
  const failed = new Set<string>();

  const reorder = () => {
    const focused = focusId === undefined ? undefined : listed.find((item) => item.id === focusId);
    ordered = focused ? [focused, ...listed.filter((item) => item !== focused)] : listed;
  };

  const markChanged = () => {
    if (cancelFlush || disposed) return;
    cancelFlush = schedule(() => {
      cancelFlush = null;
      if (!disposed) onChange(new Map(loaded));
    });
  };

  const run = async (item: Item) => {
    let result: Loaded;
    let ok = true;
    try {
      result = await load(item, loaded.get(item.id));
    } catch (caught: unknown) {
      ok = false;
      result = failure(caught);
    }
    inFlight.delete(item.id);
    if (disposed) return;
    // A file that left the list meanwhile has nothing to show.
    if (listed.some((candidate) => candidate.id === item.id)) {
      if (ok) {
        loadedFor.set(item.id, item.signature);
      } else {
        loadedFor.delete(item.id);
        failed.add(item.id);
      }
      if (loaded.get(item.id) !== result) {
        loaded.set(item.id, result);
        markChanged();
      }
    }
    pump();
  };

  function pump() {
    if (disposed) return;
    for (let index = 0; index < ordered.length; index++) {
      if (inFlight.size >= concurrency) return;
      const item = ordered[index];
      if (inFlight.has(item.id) || failed.has(item.id)) continue;
      if (index >= eagerCount && !needed.has(item.id)) continue;
      if (loadedFor.get(item.id) === item.signature && !dirty.has(item.id)) continue;
      inFlight.add(item.id);
      // A change that lands while this load runs marks it dirty again.
      dirty.delete(item.id);
      void run(item).catch(() => {
        // `run` settles its own failures; this only frees the slot if that broke.
        inFlight.delete(item.id);
      });
    }
  }

  return {
    setItems(items, itemOptions) {
      if (disposed) return;
      listed = items;
      reorder();
      const kept = new Set(items.map((item) => item.id));
      let dropped = false;
      for (const id of loaded.keys()) {
        if (kept.has(id)) continue;
        loaded.delete(id);
        loadedFor.delete(id);
        dropped = true;
      }
      for (const id of dirty) if (!kept.has(id)) dirty.delete(id);
      if (itemOptions?.refresh) for (const id of loaded.keys()) dirty.add(id);
      // A refresh retries what failed before.
      failed.clear();
      if (dropped) markChanged();
      pump();
    },
    setFocus(id) {
      if (focusId === id) return;
      focusId = id;
      reorder();
      pump();
    },
    pump,
    dispose() {
      disposed = true;
      cancelFlush?.();
      cancelFlush = null;
    },
  };
}

/** Bodies loading at once in the commit and session reviews. */
export const LAZY_DIFF_CONCURRENCY = 4;
/** Bodies loaded without waiting for their section to be seen: the first screenful. */
export const LAZY_DIFF_EAGER = 10;
