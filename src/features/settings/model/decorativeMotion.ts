import { createStore } from "../../../shared/lib/store";
import { useSyncExternalStore } from "react";
import { isTauri } from "@tauri-apps/api/core";
import {
  getWindowState,
  refreshWindowState,
  subscribeWindowState,
} from "../../../platform/tauri/windowState";
import { IS_MAC } from "../../../platform/tauri/platform";
import { readFlag, writeFlag } from "./storageFlags";

export const DECORATIVE_MOTION_KEY = "bycoda.decorativeMotion.v1";
export const DECORATIVE_MOTION_CHANGE_EVENT = "bycoda:decorativemotionchange";
export const DECORATIVE_MOTION_DEFAULT = true;
/** Above this refresh rate every infinite CSS animation composites 120+ frames a second
 * (a 240 Hz display pegged the WebView2 GPU process at 60 % of a core with one working
 * indicator), so decorative motion defaults to off there unless the user chose otherwise. */
export const HIGH_REFRESH_HZ = 120;
const REFRESH_SAMPLE_FRAMES = 24;
/** When on (default), the OS "reduce motion" setting turns decorative and tab animations off. */
export const FOLLOW_SYSTEM_MOTION_KEY = "bycoda.followSystemMotion.v1";
export const FOLLOW_SYSTEM_MOTION_DEFAULT = true;
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

let unsaved: boolean | null = null;
/** Measured display refresh rate; null until the first sample completes. */
let displayRefreshHz: number | null = null;
/** The platform frame scheduler, captured at load so test doubles installed later (and
 * components counting their own frame requests) never see the refresh sampler. */
const nativeFrame =
  typeof window !== "undefined" && typeof window.requestAnimationFrame === "function"
    ? {
        request: window.requestAnimationFrame.bind(window),
        cancel: window.cancelAnimationFrame.bind(window),
      }
    : undefined;
let media: MediaQueryList | null = null;
const listeners = createStore();
let nativeVisible = true;
/** DOM focus: the only focus signal outside Tauri, and before the first native read. */
let domFocused = typeof document === "undefined" || document.hasFocus();
/** What subscribers were last told; unchanged states are not re-announced. */
let published = "";
let releaseLifecycle: (() => void) | undefined;

/** The stored choice stays independent of the system's accessibility setting. */
export function loadDecorativeMotionEnabled(): boolean {
  return unsaved ?? readFlag(DECORATIVE_MOTION_KEY) ?? defaultDecorativeMotion();
}
/** The unsaved default: off on high refresh displays, the product default elsewhere. */
export function defaultDecorativeMotion(): boolean {
  return displayRefreshHz !== null && displayRefreshHz >= HIGH_REFRESH_HZ
    ? false
    : DECORATIVE_MOTION_DEFAULT;
}
/** Records the display refresh rate (frames per second); drives the default above. */
export function noteDisplayRefreshRate(hz: number | null): void {
  if (hz !== null && (!Number.isFinite(hz) || hz <= 0)) return;
  displayRefreshHz = hz;
  notify();
}
/** Samples animation frames once to learn the refresh rate; returns a cancel function. */
function detectDisplayRefreshRate(): () => void {
  if (!nativeFrame) return () => undefined;
  const stamps: number[] = [];
  let handle: number | undefined;
  const sample = (now: number) => {
    handle = undefined;
    stamps.push(now);
    if (stamps.length <= REFRESH_SAMPLE_FRAMES) {
      handle = nativeFrame.request(sample);
      return;
    }
    const intervals = stamps
      .slice(1)
      .map((stamp, index) => stamp - stamps[index])
      .filter((interval) => interval > 0)
      .sort((a, b) => a - b);
    const median = intervals[Math.floor(intervals.length / 2)];
    // Only plausible display rates count; a throttled or synthetic scheduler proves nothing.
    if (median && 1000 / median >= 24 && 1000 / median <= 480)
      noteDisplayRefreshRate(1000 / median);
  };
  handle = nativeFrame.request(sample);
  return () => {
    if (handle !== undefined) nativeFrame.cancel(handle);
  };
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

export function loadFollowSystemMotionEnabled(): boolean {
  return readFlag(FOLLOW_SYSTEM_MOTION_KEY) ?? FOLLOW_SYSTEM_MOTION_DEFAULT;
}

export function saveFollowSystemMotionEnabled(enabled: boolean): void {
  writeFlag(FOLLOW_SYSTEM_MOTION_KEY, enabled);
  notify();
}

function reducedMotionMedia(): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return null;
  }
  return window.matchMedia(REDUCED_MOTION_QUERY);
}

/** The OS reduce-motion request, honored only while "Follow system setting" is on. */
export function prefersReducedMotion(): boolean {
  return loadFollowSystemMotionEnabled() && ((media ?? reducedMotionMedia())?.matches ?? false);
}

export function decorativeMotionEnabled(): boolean {
  return (
    loadDecorativeMotionEnabled() &&
    !prefersReducedMotion() &&
    (typeof document === "undefined" || (!document.hidden && nativeVisible))
  );
}

/**
 * Whether this window has input focus. Each platform trusts the signal that is
 * right there: on macOS the native window state, because WKWebView keeps
 * document.hasFocus() true after the window drops behind another application;
 * elsewhere the page's own focus, because on Windows the native window reports
 * itself unfocused as soon as its WebView2 child takes keyboard focus (tao tracks
 * WM_KILLFOCUS on the top-level window), which is almost always.
 * Decorative CSS motion does not stop on blur; per-frame canvas loops and the
 * `data-window-focus` rules for status dots do.
 */
export function windowHasFocus(): boolean {
  return IS_MAC ? (getWindowState()?.focused ?? domFocused) : domFocused;
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
    loadFollowSystemMotionEnabled(),
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
  listeners.notify();
}

function onStorage(event: StorageEvent): void {
  if (
    event.key !== DECORATIVE_MOTION_KEY &&
    event.key !== FOLLOW_SYSTEM_MOTION_KEY &&
    event.key !== null
  )
    return;
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
    // Focus moving into an iframe (an HTML preview) blurs the window but keeps
    // the document focused; settle on the document's own answer.
    window.setTimeout(() => {
      if (disposed || !document.hasFocus()) return;
      domFocused = true;
      notify();
    }, 0);
  };
  domFocused = typeof document === "undefined" || document.hasFocus();
  window.addEventListener("focus", onFocus);
  window.addEventListener("blur", onBlur);
  document.addEventListener("visibilitychange", visibility);
  const release = native ? subscribeWindowState(fromNative) : undefined;
  const cancelRefreshSample = displayRefreshHz === null ? detectDisplayRefreshRate() : undefined;
  return () => {
    disposed = true;
    cancelRefreshSample?.();
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
  const unsubscribe = listeners.subscribe(subscription);
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
    unsubscribe();
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

export function useFollowSystemMotionEnabled(): boolean {
  return useSyncExternalStore(
    subscribeDecorativeMotion,
    loadFollowSystemMotionEnabled,
    () => FOLLOW_SYSTEM_MOTION_DEFAULT,
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
