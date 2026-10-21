import { useSyncExternalStore } from "react";
import { usePresentationVisible } from "./presentationVisibility";
import { formatElapsed } from "./useElapsedFrom";

/**
 * One interval for every running agent clock on screen. Each row subscribing
 * to its own timer would start one per subagent; they all read the same tick.
 */
const listeners = new Set<() => void>();
let tickId: ReturnType<typeof setInterval> | undefined;
let now = Date.now();

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) {
    now = Date.now();
    tickId = setInterval(() => {
      now = Date.now();
      listeners.forEach((notify) => notify());
    }, 1000);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      clearInterval(tickId);
      tickId = undefined;
    }
  };
}

const noSubscription = () => () => {};

/** The shared once-a-second clock reading; idle (and free) unless `enabled`. */
export function useSharedNow(enabled: boolean): number {
  return useSyncExternalStore(
    enabled ? subscribe : noSubscription,
    () => (enabled ? now : 0),
    () => 0,
  );
}

/**
 * What a run's clock reads, or null when there is nothing honest to show:
 * - finished (`endedAt` set): the final duration;
 * - running and `live`: time since it started;
 * - otherwise (no start recorded, or a run restored without an end while the
 *   session is idle): nothing, so a clock never counts forever.
 */
export function agentClockLabel(
  startedAt: number | undefined,
  endedAt: number | undefined,
  live: boolean,
  at: number,
): string | null {
  if (startedAt === undefined) return null;
  if (endedAt !== undefined) return formatElapsed(endedAt - startedAt);
  if (!live) return null;
  return formatElapsed(at - startedAt);
}

export function AgentClock({
  startedAt,
  endedAt,
  live,
  className = "",
}: {
  startedAt?: number;
  endedAt?: number;
  /** The run is in flight and the session is busy. */
  live: boolean;
  className?: string;
}) {
  const ticking = live && startedAt !== undefined && endedAt === undefined;
  // Hidden panes keep their rows mounted; they need no once-a-second render.
  const visible = usePresentationVisible();
  const at = useSharedNow(ticking && visible);
  const label = agentClockLabel(startedAt, endedAt, live, ticking ? (visible ? at : Date.now()) : 0);
  if (!label) return null;
  return <span className={`shrink-0 tabular-nums ${className}`}>{label}</span>;
}
