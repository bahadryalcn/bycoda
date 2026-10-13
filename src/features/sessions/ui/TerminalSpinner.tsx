import { useSyncExternalStore } from "react";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

const TICK_MS = 80;

// One timer for every mounted spinner so they stay in phase and the app has a
// single 80 ms wakeup instead of one per instance; it sleeps while hidden.
export function createSpinnerTicker(frameCount: number, intervalMs: number) {
  const listeners = new Set<() => void>();
  let frame = 0;
  let timer: number | null = null;
  let visibilityBound = false;

  const stopTimer = () => {
    if (timer === null) return;
    window.clearInterval(timer);
    timer = null;
  };

  const sync = () => {
    if (listeners.size > 0 && !document.hidden) {
      if (timer !== null) return;
      timer = window.setInterval(() => {
        frame = (frame + 1) % frameCount;
        for (const listener of [...listeners]) listener();
      }, intervalMs);
    } else {
      stopTimer();
    }
  };

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      if (!visibilityBound) {
        document.addEventListener("visibilitychange", sync);
        visibilityBound = true;
      }
      sync();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          document.removeEventListener("visibilitychange", sync);
          visibilityBound = false;
        }
        sync();
      };
    },
    getSnapshot: () => frame,
  };
}

const ticker = createSpinnerTicker(FRAMES.length, TICK_MS);

export function TerminalSpinner({
  className = "inline-block w-3.5 select-none text-center text-[11px] leading-none",
}: {
  className?: string;
}) {
  const frame = useSyncExternalStore(ticker.subscribe, ticker.getSnapshot, ticker.getSnapshot);

  return (
    <span aria-hidden className={className}>
      {FRAMES[frame]}
    </span>
  );
}
