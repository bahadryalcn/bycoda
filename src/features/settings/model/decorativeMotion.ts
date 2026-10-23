import { useSyncExternalStore } from "react";
import { isTauri } from "@tauri-apps/api/core";
import {
  getWindowState,
  refreshWindowState,
  subscribeWindowState,
} from "../../../platform/tauri/windowState";
import { readFlag, writeFlag } from "./storageFlags";

export const DECORATIVE_MOTION_KEY = "bycoda.decorativeMotion.v1";
export const DECORATIVE_MOTION_CHANGE_EVENT = "bycoda:decorativemotionchange";
export const DECORATIVE_MOTION_DEFAULT = true;
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

let unsaved: boolean | null = null;
let media: MediaQueryList | null = null;
const listeners = new Set<() => void>();
let nativeVisible = true;
/** DOM focus: the only focus signal outside Tauri, and before the first native read. */
let domFocused = typeof document === "undefined" || document.hasFocus();
/** What subscribers were last told; unchanged states are not re-announced. */
let published = "";
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
 * Whether this window has input focus. Native focus is authoritative while the
 * shared window state is live: WKWebView keeps document.hasFocus() true after the
 * window drops behind another application. DOM focus and blur are the fallback.
 * Decorative CSS motion does not stop on blur; per-frame canvas loops and the
 * `data-window-focus` rules for status dots do.
 */
export function windowHasFocus(): boolean {
  return getWindowState()?.focused ?? domFocused;
}

function syncDecorativeMotionAttribute(): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement.dataset;
  root.decorativeMotion = decorativeMotionEnabled() ? "on" : "off";
  root.windowFocus = windowHasFocus() ? "on" : "off";
}

/** Everything the hooks and the root attributes expose, as one comparable value. */
function exposedState(): string {
  return [
    loadDecorativeMotionEnabled(),
    prefersReducedMotion(),
    decorativeMotionEnabled(),
    windowHasFocus(),
  ].join();
}

/** Resize and focus bursts re-read the window often; only a real change wakes subscribers. */
function notify(): void {
  const next = exposedState();
  if (next === published) return;
  published = next;
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
 * and visibilitychange covers WebViews that do expose hide/show to the DOM. The
 * native reads come from the shared window state, which owns the native listeners. */
function installWindowLifecycle(): () => void {
  let disposed = false;
  const native = isTauri();
  nativeVisible = true;
  const report = (error: unknown) =>
    console.warn("Decorative motion window lifecycle unavailable", error);
  const fromNative = () => {
    const state = getWindowState();
    if (disposed || !state) return;
    nativeVisible = state.visible && !state.minimized;
    notify();
  };
  const visibility = () => {
    notify();
    if (native) void refreshWindowState().catch(report);
  };
  const onFocus = () => {
    domFocused = true;
    visibility();
  };
  const onBlur = () => {
    domFocused = false;
    notify();
  };
  domFocused = typeof document === "undefined" || document.hasFocus();
  window.addEventListener("focus", onFocus);
  window.addEventListener("blur", onBlur);
  document.addEventListener("visibilitychange", visibility);
  const release = native ? subscribeWindowState(fromNative) : undefined;
  return () => {
    disposed = true;
    window.removeEventListener("focus", onFocus);
    window.removeEventListener("blur", onBlur);
    document.removeEventListener("visibilitychange", visibility);
    release?.();
    nativeVisible = true;
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
    published = exposedState();
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
