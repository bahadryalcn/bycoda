import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { IS_WIN } from "./platform";

interface Queued {
  target?: boolean;
  result: Promise<boolean>;
}

/** Settles when the most recently scheduled transition has finished, whatever its outcome. */
let tail: Promise<unknown> = Promise.resolve();
/** The next transition, while it has not started yet; later requests coalesce into it. */
let queued: Queued | undefined;

/**
 * All app fullscreen entry/exit paths share one serialized transition queue.
 * A request made during a transition runs after it, so the opposite target is never dropped.
 */
export function setNativeFullscreen(fullscreen?: boolean): Promise<boolean> {
  if (queued) {
    queued.target = fullscreen;
    return queued.result;
  }
  const entry: Queued = { target: fullscreen, result: tail.then(() => start(entry)) };
  queued = entry;
  tail = entry.result.catch(() => undefined);
  return entry.result;
}

function start(entry: Queued): Promise<boolean> {
  if (queued === entry) queued = undefined;
  return transition(entry.target);
}

async function transition(requested?: boolean): Promise<boolean> {
  const win = getCurrentWindow();
  const current = await win.isFullscreen();
  const next = requested ?? !current;
  if (current === next) return current;

  // Windows fixes client-area calculation natively, preserving maximize state.
  // Do not fall back to unmaximizing: that produces a visible shrink/grow jump.
  if (IS_WIN) await invoke("set_window_fullscreen", { fullscreen: next });
  else await win.setFullscreen(next);
  return next;
}
