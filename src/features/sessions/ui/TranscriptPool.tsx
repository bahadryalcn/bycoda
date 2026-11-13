import {
  cloneElement,
  createContext,
  memo,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactElement,
} from "react";
import { Portal } from "../../../shared/ui/Portal";
import { PresentationVisibility } from "./presentationVisibility";
import type { Block } from "../model/session";
import { hasPendingApproval } from "../model/session";
import { streamingTextUpdate } from "../model/stableBlocks";

export const TRANSCRIPT_IDLE_TTL_MS = 3 * 60 * 1000;
export const TRANSCRIPT_WARM_COUNT = 2;

/** Small presentation-only checkpoint; never owns session or composer data. */
export type TranscriptUiState = {
  anchorId?: string;
  anchorOffset?: number;
  virtualAnchorBlockId?: string;
  virtualAnchorOffset?: number;
  scrollTop?: number;
  bottomFollow?: boolean;
  visibleTurnCount?: number;
  firstLoadedTurnId?: string;
  lastLoadedTurnId?: string;
  openWork?: Record<string, boolean>;
  disclosures?: Record<string, boolean | null>;
};
type TranscriptCheckpoint = {
  read: () => TranscriptUiState;
  update: (patch: Partial<TranscriptUiState>) => void;
  setDisclosure: (key: string, value: boolean | null) => void;
};
function createCheckpoint(): TranscriptCheckpoint {
  const state: TranscriptUiState = {};
  return {
    read: () => state,
    update: (patch) => {
      Object.assign(state, patch);
    },
    setDisclosure: (key, value) => {
      (state.disclosures ??= {})[key] = value;
    },
  };
}
export const TranscriptRetentionContext = createContext<TranscriptCheckpoint | undefined>(
  undefined,
);

/** Transcripts kept mounted after their pane closes, so a revisit skips the rebuild. */
export const TRANSCRIPT_POOL_LIMIT = 12;
export const TRANSCRIPT_POOL_MAX_BYTES = 24 * 1024 * 1024;
const blockWeights = new WeakMap<Block, number>();
const arrayWeights = new WeakMap<readonly Block[], number>();
function retainedPayloadWeight(value: unknown): number {
  let bytes = 0;
  const pending = [value];
  const seen = new WeakSet<object>();
  while (pending.length) {
    const current = pending.pop();
    if (typeof current === "string") {
      bytes += current.length * 2;
    } else if (current && typeof current === "object" && !seen.has(current)) {
      seen.add(current);
      bytes += 64;
      if (Array.isArray(current)) {
        bytes += current.length * 8;
        for (const entry of current) pending.push(entry);
      } else {
        for (const key in current) {
          if (Object.prototype.hasOwnProperty.call(current, key))
            pending.push((current as Record<string, unknown>)[key]);
        }
      }
    }
  }
  return bytes;
}
function blockWeight(block: Block): number {
  let weight = blockWeights.get(block);
  if (weight === undefined) {
    // Include tool details/previews, delegated steps, shell output and inline data
    // without serializing/copying their potentially large strings.
    weight = 512 + retainedPayloadWeight(block);
    // Generated images also keep their blob; its bytes are not string properties.
    if (block.image) weight += block.image.size || 0;
    blockWeights.set(block, weight);
  }
  return weight;
}

/** The single block a streamed-text frame changed between two arrays, if that is all. */
function streamedIndex(previous: readonly Block[] | undefined, next: readonly Block[]) {
  if (!previous || previous === next || previous.length !== next.length) return undefined;
  return streamingTextUpdate(previous as Block[], next as Block[]);
}

/**
 * Estimated retained size. A streamed frame only changes one block's text, so
 * with the previous array it costs one block instead of the whole transcript.
 */
export function transcriptPoolWeight(
  blocks: readonly Block[] = [],
  previous?: readonly Block[],
): number {
  let bytes = arrayWeights.get(blocks);
  if (bytes !== undefined) return bytes;
  const index = streamedIndex(previous, blocks);
  const base = previous && arrayWeights.get(previous);
  if (index !== undefined && base !== undefined && previous)
    bytes = base - blockWeight(previous[index]) + blockWeight(blocks[index]);
  else {
    bytes = 1024;
    for (const block of blocks) bytes += blockWeight(block);
  }
  arrayWeights.set(blocks, bytes);
  return bytes;
}

/** Streaming, running or awaiting approval; text-only frames keep the answer. */
const activeBlocks = new WeakMap<readonly Block[], boolean>();
function blocksActive(blocks: readonly Block[], previous?: readonly Block[]): boolean {
  let active = activeBlocks.get(blocks);
  if (active !== undefined) return active;
  const known = previous && activeBlocks.get(previous);
  active =
    known !== undefined && streamedIndex(previous, blocks) !== undefined
      ? known
      : blocks.some((block) => block.streaming || block.tool?.status === "in_progress") ||
        hasPendingApproval(blocks as Block[]);
  activeBlocks.set(blocks, active);
  return active;
}

type PooledProps = {
  visible?: boolean;
  parked?: boolean;
  blocks?: Block[];
  busy?: boolean;
  pendingQuestion?: boolean;
  pendingOwnerApproval?: boolean;
  questionBehavior?: "blocking" | "nonBlocking";
  backgroundTasks?: string[];
  backgroundAgents?: number;
};

export type TranscriptPoolEntry = {
  id: string;
  container: HTMLDivElement;
  /** The pane's latest element; its props drive retention decisions. */
  element: ReactElement<PooledProps>;
  /**
   * What the portal renders. A pane that stays hidden keeps updating `element`
   * (a streaming session changes it ~10 times a second) but not this, so a
   * hidden transcript does not re-render until it is shown again.
   */
  rendered: ReactElement<PooledProps>;
  onMouseDown?: () => void;
  host: HTMLElement | null;
  weight: number;
  mounted: boolean;
  hiddenAt: number | null;
  uiState: TranscriptUiState;
  checkpoint: TranscriptCheckpoint;
};

/**
 * Owns one mounted transcript per recently shown session. A pane lends it a
 * host element; the transcript renders into a container that moves between
 * hosts, so switching back to a session reuses its parsed, laid-out DOM
 * instead of mounting every turn and markdown block again.
 */
export class TranscriptPool {
  private entries = new Map<string, TranscriptPoolEntry>();
  private listeners = new Set<() => void>();
  private snapshot: TranscriptPoolEntry[] | undefined = [];
  private outletSnapshot: string[] = [];
  private outletListeners = new Set<() => void>();
  private entryStores = new Map<string, Set<() => void>>();
  private recent: string[] = [];
  private protectedIds = new Set<string>();
  private knownIds: Set<string> | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private nextExpiry = Infinity;
  private states = new Map<string, TranscriptCheckpoint>();

  constructor(
    private readonly limit = TRANSCRIPT_POOL_LIMIT,
    private readonly maxBytes = TRANSCRIPT_POOL_MAX_BYTES,
    private readonly ttlMs = TRANSCRIPT_IDLE_TTL_MS,
    private readonly warmCount = TRANSCRIPT_WARM_COUNT,
  ) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    this.schedule();
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size && !this.outletListeners.size) clearTimeout(this.timer);
    };
  };

  getSnapshot = () => this.snapshot || (this.snapshot = [...this.entries.values()]);
  getOutletSnapshot = () => this.outletSnapshot;
  subscribeOutlet = (listener: () => void) => {
    this.outletListeners.add(listener);
    this.schedule();
    return () => {
      this.outletListeners.delete(listener);
      if (!this.listeners.size && !this.outletListeners.size) clearTimeout(this.timer);
    };
  };
  getEntryStore(id: string) {
    return {
      read: () => this.entries.get(id),
      subscribe: (listener: () => void) => {
        let listeners = this.entryStores.get(id);
        if (!listeners) this.entryStores.set(id, (listeners = new Set()));
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
          if (!listeners.size && this.entryStores.get(id) === listeners)
            this.entryStores.delete(id);
        };
      },
    };
  }

  /** Host-running mirrors may be busy even when their last transcript is idle. */
  setProtectedIds(ids: Iterable<string>, knownIds?: Iterable<string>) {
    this.protectedIds = new Set(ids);
    this.knownIds = knownIds ? new Set(knownIds) : undefined;
    this.pruneStates();
    let changed = false;
    for (const entry of this.entries.values()) {
      if (!entry.mounted && this.protectedEntry(entry)) {
        this.entries.set(entry.id, {
          ...entry,
          rendered: entry.element,
          mounted: true,
          hiddenAt: Date.now(),
        });
        changed = true;
      }
    }
    this.expire();
    if (changed) this.emit();
    this.schedule();
  }

  /**
   * Checkpoints outlive their pooled entry so a revisit keeps scroll and
   * disclosure state. Once a session is gone from the workspace and no entry
   * holds it, its checkpoint can go too.
   */
  private pruneStates() {
    if (!this.knownIds) return;
    for (const id of this.states.keys())
      if (!this.knownIds.has(id) && !this.entries.has(id)) this.states.delete(id);
  }

  private protectedEntry(entry: TranscriptPoolEntry) {
    // Closed panes no longer refresh their props. Prefer current session activity
    // over a parked element's stale busy flag when the workspace knows the id.
    if (!entry.host && this.knownIds?.has(entry.id)) return this.protectedIds.has(entry.id);
    const p = entry.element.props;
    return (
      this.protectedIds.has(entry.id) ||
      p.busy ||
      p.pendingQuestion ||
      p.pendingOwnerApproval ||
      !!p.backgroundTasks?.length ||
      !!p.backgroundAgents ||
      (!!p.blocks && blocksActive(p.blocks))
    );
  }

  private expire = () => {
    let changed = false;
    for (const entry of this.entries.values()) {
      if (
        !entry.mounted ||
        entry.hiddenAt === null ||
        this.protectedEntry(entry) ||
        this.recent.includes(entry.id) ||
        Date.now() - entry.hiddenAt < this.ttlMs
      )
        continue;
      // Keep the pane, callbacks and checkpoint. Only release the rendered tree.
      this.entries.set(entry.id, { ...entry, mounted: false });
      changed = true;
    }
    if (changed) this.emit();
    this.schedule();
  };

  private schedule() {
    clearTimeout(this.timer);
    let next = Infinity;
    for (const entry of this.entries.values()) {
      if (
        entry.mounted &&
        entry.hiddenAt !== null &&
        !this.recent.includes(entry.id) &&
        !this.protectedEntry(entry)
      )
        next = Math.min(next, entry.hiddenAt + this.ttlMs);
    }
    this.nextExpiry = next;
    if ((this.listeners.size || this.outletListeners.size) && next !== Infinity)
      this.timer = setTimeout(this.expire, Math.max(0, next - Date.now()));
  }

  show(
    id: string,
    host: HTMLElement,
    element: ReactElement<PooledProps>,
    onMouseDown?: () => void,
  ) {
    const previous = this.entries.get(id);
    let checkpoint = this.states.get(id);
    if (!checkpoint) this.states.set(id, (checkpoint = createCheckpoint()));
    const visible = element.props.visible !== false;
    const wasVisible = !!previous?.host && previous.element.props.visible !== false;
    if (visible && !wasVisible)
      this.recent = [id, ...this.recent.filter((key) => key !== id)].slice(0, this.warmCount);
    const container = previous?.container ?? createContainer();
    // First seen while hidden (a restored background tab): wait until shown,
    // unless it needs to stay live. Mounting every restored transcript at boot
    // was the largest startup cost with many tabs.
    const mounted = visible || !!previous?.mounted || this.protectedIds.has(id);
    // Attach before the pane's passive effects run, so anything that looks
    // for the transcript in the pane already finds a revisited one.
    if (container.parentElement !== host) host.appendChild(container);
    if (
      previous?.host === host &&
      previous.onMouseDown === onMouseDown &&
      sameElement(previous.element, element)
    )
      return;
    const next: TranscriptPoolEntry = {
      id,
      container,
      element,
      rendered: element,
      onMouseDown,
      host,
      mounted,
      hiddenAt: visible ? null : (previous?.hiddenAt ?? Date.now()),
      checkpoint,
      uiState: checkpoint.read(),
      weight:
        previous && previous.element.props.blocks === element.props.blocks
          ? previous.weight
          : transcriptPoolWeight(element.props.blocks, previous?.element.props.blocks),
    };
    // Seed the activity answer from the previous frame before retention reads it.
    if (element.props.blocks) blocksActive(element.props.blocks, previous?.element.props.blocks);
    if (!next.mounted && this.protectedEntry(next)) next.mounted = true;
    if (
      previous &&
      !visible &&
      !wasVisible &&
      previous.host === host &&
      previous.onMouseDown === onMouseDown &&
      previous.mounted === next.mounted
    ) {
      // Still hidden in the same pane: refresh what retention reads, keep the
      // rendered tree as it is and skip the outlet update.
      this.entries.set(id, { ...next, rendered: previous.rendered });
      this.schedule();
      return;
    }
    // Re-inserting keeps the map in least-recently-shown order.
    this.entries.delete(id);
    this.entries.set(id, next);
    // A visible pane cannot affect parked budgets or hidden expiry deadlines.
    const sameVisibleOwner = previous?.host === host && visible && wasVisible;
    if (!sameVisibleOwner) this.trim();
    if (sameVisibleOwner) this.emitEntry(id);
    else this.emit();
    if (!sameVisibleOwner || Date.now() >= this.nextExpiry) this.expire();
  }

  park(id: string, host: HTMLElement) {
    const entry = this.entries.get(id);
    if (!entry || entry.host !== host) return;
    entry.container.remove();
    this.entries.set(id, {
      ...entry,
      host: null,
      onMouseDown: undefined,
      element: cloneElement(entry.element, { visible: false, parked: true }),
      rendered: cloneElement(entry.element, { visible: false, parked: true }),
      hiddenAt: Date.now(),
    });
    this.trim();
    this.emit();
    this.schedule();
  }

  private trim() {
    let parked = 0;
    let bytes = 0;
    for (const entry of this.entries.values())
      if (!entry.host) {
        parked += 1;
        bytes += entry.weight;
      }
    for (const entry of this.entries.values()) {
      if (parked <= this.limit && bytes <= this.maxBytes) break;
      if (entry.host || this.protectedEntry(entry)) continue;
      this.entries.delete(entry.id);
      this.recent = this.recent.filter((id) => id !== entry.id);
      if (this.knownIds && !this.knownIds.has(entry.id)) this.states.delete(entry.id);
      parked -= 1;
      bytes -= entry.weight;
    }
  }

  private emit() {
    this.snapshot = [...this.entries.values()];
    this.outletSnapshot = this.snapshot.map((entry) => entry.id);
    for (const listener of this.outletListeners) listener();
    for (const listeners of this.entryStores.values()) for (const listener of listeners) listener();
    for (const listener of this.listeners) listener();
  }

  private emitEntry(id: string) {
    // Most frames update one portal. Materialize the public LRU snapshot only on demand.
    this.snapshot = undefined;
    for (const listener of this.entryStores.get(id) || []) listener();
    for (const listener of this.listeners) listener();
  }
}

function sameElement(previous: ReactElement<PooledProps>, next: ReactElement<PooledProps>) {
  if (previous === next) return true;
  if (previous.type !== next.type || previous.key !== next.key) return false;
  const before = previous.props as Record<string, unknown>;
  const after = next.props as Record<string, unknown>;
  const keys = Object.keys(before);
  return (
    keys.length === Object.keys(after).length &&
    keys.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(after, key) && Object.is(before[key], after[key]),
    )
  );
}

function createContainer() {
  const node = document.createElement("div");
  node.className = "contents";
  return node;
}

/** Renders every pooled transcript into its current container. */
export const TranscriptPoolOutlet = memo(function TranscriptPoolOutlet({
  pool,
}: {
  pool: TranscriptPool;
}) {
  const ids = useSyncExternalStore(
    pool.subscribeOutlet,
    pool.getOutletSnapshot,
    pool.getOutletSnapshot,
  );
  return ids.map((id) => <PooledEntry key={id} pool={pool} id={id} />);
});

const PooledEntry = memo(function PooledEntry({ pool, id }: { pool: TranscriptPool; id: string }) {
  // State preserves subscription identity even without the React Compiler.
  const [store, setStore] = useState(() => ({ pool, id, ...pool.getEntryStore(id) }));
  if (store.pool !== pool || store.id !== id) setStore({ pool, id, ...pool.getEntryStore(id) });
  const { subscribe, read } = store;
  const entry = useSyncExternalStore(subscribe, read, read);
  if (!entry?.mounted) return null;
  // React events bubble through the portal's owner, not the pane. Forward the
  // one the pane listens for so clicking the transcript still focuses it.
  // Pane-hosted portal: the transcript DOM moves between pane slots, not an overlay.
  return (
    <Portal target={entry.container}>
      <div className="contents" onMouseDown={entry.onMouseDown}>
        <PresentationVisibility.Provider
          value={!!entry.host && entry.rendered.props.visible !== false}
        >
          <TranscriptRetentionContext.Provider value={entry.checkpoint}>
            {entry.rendered}
          </TranscriptRetentionContext.Provider>
        </PresentationVisibility.Provider>
      </div>
    </Portal>
  );
});

/**
 * Where a pane shows its transcript. Without a pool (tests, the inbox, which
 * keeps its panes mounted) the transcript renders in place as before.
 */
export function PooledTranscript({
  pool,
  sessionId,
  onMouseDown,
  children,
}: {
  pool?: TranscriptPool;
  sessionId: string;
  onMouseDown?: () => void;
  children: ReactElement<PooledProps>;
}) {
  const host = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const node = host.current;
    if (!pool || !node) return;
    return () => pool.park(sessionId, node);
  }, [pool, sessionId]);

  useLayoutEffect(() => {
    if (pool && host.current) {
      pool.show(sessionId, host.current, children, onMouseDown);
    }
  }, [pool, sessionId, children, onMouseDown]);

  if (!pool) return children;
  return <div ref={host} className="contents" />;
}
