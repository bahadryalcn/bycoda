import { focusManager } from "@tanstack/react-query";

const INACTIVE_MS = 60_000;
const INACTIVE_MULTIPLIER = 4;
const inputEvents = ["pointerdown", "pointermove", "keydown", "wheel"] as const;
const listeners = new Set<(wake: boolean) => void>();
let native: { shown: boolean; focused: boolean } | undefined;
let shown = true;
let focused = true;
let inactive = false;
let lastActivity = 0;
let shownAt = -Infinity;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
let release: (() => void) | undefined;

export function foregroundPollsVisible() {
  return (
    native?.shown ??
    ((typeof document === "undefined" || !document.hidden) && focusManager.isFocused())
  );
}

/** The existing Tauri query lifecycle supplies the authoritative native window signals. */
export function setNativePollingWindow(state?: { shown: boolean; focused: boolean }) {
  native = state;
  if (release) syncWindow();
}

function notify(wake = false) {
  for (const listener of listeners) listener(wake);
}

function checkIdle() {
  idleTimer = undefined;
  const remaining = INACTIVE_MS - (Date.now() - lastActivity);
  if (remaining > 0) idleTimer = setTimeout(checkIdle, remaining);
  else {
    inactive = true;
    notify();
  }
}

function recordActivity(announce = true) {
  if (!shown || typeof window === "undefined") return;
  lastActivity = Date.now();
  if (idleTimer === undefined) idleTimer = setTimeout(checkIdle, INACTIVE_MS);
  if (!inactive) return;
  inactive = false;
  if (announce) notify();
}
const activity = () => recordActivity();

function syncWindow() {
  const nextShown = foregroundPollsVisible();
  const nextFocused = native?.focused ?? focused;
  const justShown = nextShown && !shown;
  const justFocused = nextShown && !focused && nextFocused;
  const changed = shown !== nextShown;
  shown = nextShown;
  focused = nextFocused;
  if (!shown) {
    clearTimeout(idleTimer);
    idleTimer = undefined;
  }
  if (justShown) {
    shownAt = Date.now();
    recordActivity(false);
    notify(true);
  } else if (justFocused) resumeFocus();
  else if (changed) notify();
}

function resumeFocus() {
  // Browsers and Tauri commonly report focus immediately after showing the window.
  if (Date.now() - shownAt < 250) return;
  recordActivity(false);
  notify(true);
}

export function subscribeForegroundPolling(listener: (wake: boolean) => void) {
  if (!release) {
    shown = foregroundPollsVisible();
    focused = native?.focused ?? true;
    inactive = false;
    shownAt = -Infinity;
    activity();
    const onFocus = () => {
      if (native) return; // Native focus arrives via the query lifecycle.
      focused = true;
      syncWindow();
      if (shown) resumeFocus();
    };
    const offFocus = focusManager.subscribe(syncWindow);
    const page = typeof document !== "undefined" ? document : undefined;
    const windowEvents = typeof window !== "undefined" ? window : undefined;
    if (page) {
      document.addEventListener("visibilitychange", syncWindow);
      for (const event of inputEvents)
        document.addEventListener(event, activity, { passive: true });
    }
    windowEvents?.addEventListener("focus", onFocus);
    release = () => {
      offFocus();
      if (page) {
        page.removeEventListener("visibilitychange", syncWindow);
        for (const event of inputEvents) page.removeEventListener(event, activity);
      }
      windowEvents?.removeEventListener("focus", onFocus);
      clearTimeout(idleTimer);
      idleTimer = undefined;
      release = undefined;
    };
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) release?.();
  };
}

export function foregroundPollingDelay(period: number, urgent = false) {
  return period * (inactive && !urgent ? INACTIVE_MULTIPLIER : 1);
}

/** One interval per purpose. An async read already running absorbs periodic ticks. */
export function startForegroundPolling(
  refresh: (wake: boolean) => unknown,
  period: number,
  options: { immediate?: boolean; urgent?: boolean } = {},
) {
  let urgent = options.urgent ?? false;
  let timer: ReturnType<typeof setInterval> | undefined;
  let armedPeriod = 0;
  let running = false;
  let queued = false;
  let stopped = false;
  const run = (wake: boolean) => {
    if (stopped) return;
    if (!foregroundPollsVisible()) {
      syncWindow();
      return;
    }
    if (running) {
      queued ||= wake;
      return;
    }
    const finish = () => {
      running = false;
      if (!queued) return;
      queued = false;
      run(true);
    };
    const failed = (error: unknown) => console.warn("Foreground poll failed", error);
    try {
      running = true;
      const result = refresh(wake);
      if (result && typeof (result as PromiseLike<unknown>).then === "function")
        void Promise.resolve(result).then(finish, (error: unknown) => {
          failed(error);
          finish();
        });
      else finish();
    } catch (error) {
      failed(error);
      finish();
    }
  };
  const schedule = (wake = false) => {
    const nextPeriod = shown ? foregroundPollingDelay(period, urgent) : 0;
    if (armedPeriod !== nextPeriod) {
      clearInterval(timer);
      armedPeriod = nextPeriod;
      timer = nextPeriod ? setInterval(() => run(false), nextPeriod) : undefined;
    }
    if (wake) run(true);
  };
  const unsubscribe = subscribeForegroundPolling(schedule);
  schedule(options.immediate !== false);
  return {
    refresh: () => run(true),
    setPeriod: (next: number, nextUrgent = urgent) => {
      period = next;
      urgent = nextUrgent;
      schedule();
    },
    stop: () => {
      stopped = true;
      clearInterval(timer);
      unsubscribe();
    },
  };
}
