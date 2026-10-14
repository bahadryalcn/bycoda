import { useSyncExternalStore } from "react";
import { readFlag, writeFlag } from "./storageFlags";

export const DECORATIVE_MOTION_KEY = "bycoda.decorativeMotion.v1";
export const DECORATIVE_MOTION_CHANGE_EVENT = "bycoda:decorativemotionchange";
export const DECORATIVE_MOTION_DEFAULT = true;
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

let unsaved: boolean | null = null;
let media: MediaQueryList | null = null;
const listeners = new Set<() => void>();

/** The stored choice stays independent of the system's accessibility setting. */
export function loadDecorativeMotionEnabled(): boolean {
  return unsaved ?? readFlag(DECORATIVE_MOTION_KEY) ?? DECORATIVE_MOTION_DEFAULT;
}

export function saveDecorativeMotionEnabled(enabled: boolean): void {
  writeFlag(DECORATIVE_MOTION_KEY, enabled);
  unsaved = readFlag(DECORATIVE_MOTION_KEY) === enabled ? null : enabled;
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
  return loadDecorativeMotionEnabled() && !prefersReducedMotion();
}

function notify(): void {
  for (const listener of listeners) listener();
}

function onStorage(event: StorageEvent): void {
  if (event.key !== DECORATIVE_MOTION_KEY && event.key !== null) return;
  unsaved = null;
  notify();
}

/** All consumers share one set of window and system-preference listeners. */
export function subscribeDecorativeMotion(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  // Wrap callbacks so subscribing the same callback twice remains independent.
  const subscription = () => listener();
  listeners.add(subscription);
  if (listeners.size === 1) {
    media = reducedMotionMedia();
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
