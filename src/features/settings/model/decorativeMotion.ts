import { useSyncExternalStore } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { retainAsyncSubscription } from "../../../shared/lib/asyncSubscription";
import { readFlag, writeFlag } from "./storageFlags";

export const DECORATIVE_MOTION_KEY = "bycoda.decorativeMotion.v1";
export const DECORATIVE_MOTION_CHANGE_EVENT = "bycoda:decorativemotionchange";
export const DECORATIVE_MOTION_DEFAULT = true;
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

let unsaved: boolean | null = null;
let media: MediaQueryList | null = null;
const listeners = new Set<() => void>();
let nativeVisible = true;
// Tracked from Tauri's focus event: WKWebView keeps document.hasFocus() true
// after the window drops behind another application.
let windowFocused = typeof document === "undefined" || document.hasFocus();
let releaseLifecycle: (() => void) | undefined;

/** The stored choice stays independent of the system's accessibility setting. */
export function loadDecorativeMotionEnabled(): boolean {
  return unsaved ?? readFlag(DECORATIVE_MOTION_KEY) ?? DECORATIVE_MOTION_DEFAULT;
}

export function saveDecorativeMotionEnabled(enabled: boolean): void {
  writeFlag(DECORATIVE_MOTION_KEY, enabled);
  unsaved = readFlag(DECORATIVE_MOTION_KEY) === enabled ? null : enabled;
  syncDecorativeMotionAttribute();
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent<boolean>(DECORATIVE_MOTION_CHANGE_EVENT, { detail: enabled }),
    );
  }
}

function reducedMotionMedia(): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return null;
  }
  return window.matchMedia(REDUCED_MOTION_QUERY);
}

export function prefersReducedMotion(): boolean {
  return (media ?? reducedMotionMedia())?.matches ?? false;
}

export function decorativeMotionEnabled(): boolean {
  return (
    loadDecorativeMotionEnabled() &&
    !prefersReducedMotion() &&
    (typeof document === "undefined" || (!document.hidden && nativeVisible))
  );
}

/**
 * Whether this window has input focus. Decorative CSS motion keeps running in
 * an unfocused window; canvas loops that repaint every frame pause on it.
 */
export function windowHasFocus(): boolean {
  return windowFocused;
}

function syncDecorativeMotionAttribute(): void {
  if (typeof document !== "undefined")
    document.documentElement.dataset.decorativeMotion = decorativeMotionEnabled() ? "on" : "off";
}

function notify(): void {
  syncDecorativeMotionAttribute();
  for (const listener of listeners) listener();
}

function onStorage(event: StorageEvent): void {
  if (event.key !== DECORATIVE_MOTION_KEY && event.key !== null) return;
  unsaved = null;
  notify();
}

/** Losing input focus does not mean the window is hidden.
 * Tauri has no public occlusion/visibility event: resize covers minimize/restore,
 * and visibilitychange covers WebViews that do expose hide/show to the DOM. */
function installWindowLifecycle(): () => void {
  let disposed = false;
  let revision = 0;
  const releases: Array<() => void> = [];
  const native = isTauri() ? getCurrentWindow() : null;
  nativeVisible = true;
  windowFocused = document.hasFocus();
  const report = (error: unknown) =>
    console.warn("Decorative motion window lifecycle unavailable", error);
  const refreshNative = async () => {
    if (!native) return;
    const current = ++revision;
    const [shown, minimized, focused] = await Promise.all([
      native.isVisible(),
      native.isMinimized(),
      native.isFocused(),
    ]);
    if (disposed || current !== revision) return;
    nativeVisible = shown && !minimized;
    windowFocused = focused;
    notify();
  };
  const visibility = () => {
    ++revision;
    notify();
    void refreshNative().catch(report);
  };
  const onFocus = () => {
    windowFocused = true;
    visibility();
  };
  const onBlur = () => {
    windowFocused = false;
    ++revision;
    notify();
  };
  window.addEventListener("focus", onFocus);
  window.addEventListener("blur", onBlur);
  document.addEventListener("visibilitychange", visibility);
  if (native) {
    releases.push(
      retainAsyncSubscription(
        native.onFocusChanged((event) => {
          if (disposed) return;
          windowFocused = event.payload;
          visibility();
        }),
        report,
      ),
    );
    releases.push(
      retainAsyncSubscription(
        native.onResized(() => {
          void refreshNative().catch(report);
        }),
        report,
      ),
    );
    void refreshNative().catch(report);
  }
  return () => {
    disposed = true;
    ++revision;
    window.removeEventListener("focus", onFocus);
    window.removeEventListener("blur", onBlur);
    document.removeEventListener("visibilitychange", visibility);
    releases.forEach((release) => release());
    nativeVisible = true;
    windowFocused = true;
  };
}

/** All consumers share one set of window and system-preference listeners. */
export function subscribeDecorativeMotion(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  // Wrap callbacks so subscribing the same callback twice remains independent.
  const subscription = () => listener();
  listeners.add(subscription);
  if (listeners.size === 1) {
    media = reducedMotionMedia();
    releaseLifecycle = installWindowLifecycle();
    syncDecorativeMotionAttribute();
    media?.addEventListener("change", notify);
    window.addEventListener(DECORATIVE_MOTION_CHANGE_EVENT, notify);
    window.addEventListener("storage", onStorage);
  }
  let subscribed = true;
  return () => {
    if (!subscribed) return;
    subscribed = false;
    listeners.delete(subscription);
    if (listeners.size !== 0) return;
    media?.removeEventListener("change", notify);
    media = null;
    releaseLifecycle?.();
    releaseLifecycle = undefined;
    window.removeEventListener(DECORATIVE_MOTION_CHANGE_EVENT, notify);
    window.removeEventListener("storage", onStorage);
  };
}

export function useDecorativeMotionPreference(): boolean {
  return useSyncExternalStore(
    subscribeDecorativeMotion,
    loadDecorativeMotionEnabled,
    () => DECORATIVE_MOTION_DEFAULT,
  );
}

export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribeDecorativeMotion, prefersReducedMotion, () => false);
}

/** Use for decorative effects only; game availability is a separate setting. */
export function useDecorativeMotionEnabled(): boolean {
  return useSyncExternalStore(subscribeDecorativeMotion, decorativeMotionEnabled, () => false);
}

// Bootstrap CSS consumers before React subscribes; the shared listener keeps it current.
syncDecorativeMotionAttribute();
