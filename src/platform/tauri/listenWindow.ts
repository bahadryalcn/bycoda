/**
 * Window-scoped Tauri event subscriptions.
 *
 * A plain `listen()` from `@tauri-apps/api/event` registers an `Any` target, which Tauri 2
 * matches against every emit, including `emit_to(label, …)` events that Rust meant for one
 * window. With several workspace windows open, one menu click or control request would then
 * run in all of them. These helpers always pass the current window label as the target, so a
 * window only receives broadcasts and events addressed to it.
 *
 * The returned disposer is synchronous and safe to call before the native registration has
 * resolved (React effects often unmount first): the listener is removed as soon as it exists.
 */
import { listen, once, type EventCallback, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

export type WindowSubscription = () => void;

function currentWindowLabel(): string | null {
  try {
    return getCurrentWebviewWindow().label;
  } catch {
    // Outside a Tauri webview (tests, browser preview) there is no window identity.
    return null;
  }
}

function subscribe<T>(
  register: (event: string, handler: EventCallback<T>, target?: string) => Promise<UnlistenFn>,
  event: string,
  handler: EventCallback<T>,
): WindowSubscription {
  let disposed = false;
  let unlisten: UnlistenFn | undefined;
  const label = currentWindowLabel();
  register(event, handler, label ?? undefined).then(
    (release) => {
      if (disposed) release();
      else unlisten = release;
    },
    (error: unknown) => {
      console.warn(`[bycoda] window listener for "${event}" was not registered`, error);
    },
  );
  return () => {
    disposed = true;
    unlisten?.();
    unlisten = undefined;
  };
}

/** Listen for `event` on this window only. Returns a synchronous disposer. */
export function listenWindow<T = unknown>(
  event: string,
  handler: EventCallback<T>,
): WindowSubscription {
  return subscribe<T>(
    (name, callback, target) =>
      target ? listen<T>(name, callback, { target }) : listen<T>(name, callback),
    event,
    handler,
  );
}

/** Receive `event` once on this window only. Returns a synchronous disposer. */
export function onceWindow<T = unknown>(
  event: string,
  handler: EventCallback<T>,
): WindowSubscription {
  return subscribe<T>(
    (name, callback, target) =>
      target ? once<T>(name, callback, { target }) : once<T>(name, callback),
    event,
    handler,
  );
}

/**
 * Promise form for code that must know the listener is registered before continuing
 * (for example before invoking a command whose reply arrives as an event).
 */
export function listenWindowAsync<T = unknown>(
  event: string,
  handler: EventCallback<T>,
): Promise<UnlistenFn> {
  const label = currentWindowLabel();
  return label ? listen<T>(event, handler, { target: label }) : listen<T>(event, handler);
}
