import {
  cloneElement,
  memo,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
  type ReactElement,
} from "react";
import { createPortal } from "react-dom";
import { PresentationVisibility } from "./presentationVisibility";
import type { Block } from "../model/session";

/** Transcripts kept mounted after their pane closes, so a revisit skips the rebuild. */
export const TRANSCRIPT_POOL_LIMIT = 12;
export const TRANSCRIPT_POOL_MAX_BYTES = 24 * 1024 * 1024;
const blockWeights = new WeakMap<Block, number>();
export function transcriptPoolWeight(blocks: readonly Block[] = []): number {
  let bytes = 1024;
  for (const block of blocks) {
    let weight = blockWeights.get(block);
    if (weight === undefined) {
      weight = 512 + block.text.length * 2;
      for (const attachment of block.attachments ?? [])
        weight += 256 + (attachment.data?.length ?? 0) * 2;
      blockWeights.set(block, weight);
    }
    bytes += weight;
  }
  return bytes;
}

type PooledProps = { visible?: boolean; parked?: boolean; blocks?: Block[] };

export type TranscriptPoolEntry = {
  id: string;
  container: HTMLDivElement;
  element: ReactElement<PooledProps>;
  onMouseDown?: () => void;
  host: HTMLElement | null;
  weight: number;
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
  private snapshot: TranscriptPoolEntry[] = [];

  constructor(
    private readonly limit = TRANSCRIPT_POOL_LIMIT,
    private readonly maxBytes = TRANSCRIPT_POOL_MAX_BYTES,
  ) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = () => this.snapshot;

  show(
    id: string,
    host: HTMLElement,
    element: ReactElement<PooledProps>,
    onMouseDown?: () => void,
  ) {
    const previous = this.entries.get(id);
    const container = previous?.container ?? createContainer();
    // Attach before the pane's passive effects run, so anything that looks
    // for the transcript in the pane already finds a revisited one.
    if (container.parentElement !== host) host.appendChild(container);
    if (
      previous?.host === host &&
      previous.onMouseDown === onMouseDown &&
      sameElement(previous.element, element)
    )
      return;
    // Re-inserting keeps the map in least-recently-shown order.
    this.entries.delete(id);
    this.entries.set(id, {
      id,
      container,
      element,
      onMouseDown,
      host,
      weight:
        previous && previous.element.props.blocks === element.props.blocks
          ? previous.weight
          : transcriptPoolWeight(element.props.blocks),
    });
    this.trim();
    this.emit();
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
    });
    this.trim();
    this.emit();
  }

  private trim() {
    let parked = 0;
    let bytes = 0;
    for (const entry of this.entries.values())
      if (!entry.host) {
        parked += 1;
        bytes += entry.weight;
      }
    for (const entry of [...this.entries.values()]) {
      if (parked <= this.limit && bytes <= this.maxBytes) break;
      if (entry.host) continue;
      this.entries.delete(entry.id);
      parked -= 1;
      bytes -= entry.weight;
    }
  }

  private emit() {
    this.snapshot = [...this.entries.values()];
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
  const entries = useSyncExternalStore(pool.subscribe, pool.getSnapshot, pool.getSnapshot);
  return entries.map((entry) => <PooledEntry key={entry.id} entry={entry} />);
});

const PooledEntry = memo(function PooledEntry({ entry }: { entry: TranscriptPoolEntry }) {
  // React events bubble through the portal's owner, not the pane. Forward the
  // one the pane listens for so clicking the transcript still focuses it.
  return createPortal(
    <div className="contents" onMouseDown={entry.onMouseDown}>
      <PresentationVisibility.Provider
        value={!!entry.host && entry.element.props.visible !== false}
      >
        {entry.element}
      </PresentationVisibility.Provider>
    </div>,
    entry.container,
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
