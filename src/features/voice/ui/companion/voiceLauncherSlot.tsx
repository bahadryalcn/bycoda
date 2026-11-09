import { useSyncExternalStore } from "react";
import styles from "../VoiceCompanion.module.css";

/**
 * Docking spot for the closed voice companion in the sidebar footer, beside Settings. Several
 * footers can be mounted at once (the project rail keeps a wide and a compact copy and hides one
 * with a container query), so every slot registers and the first one that is rendered wins. With
 * no visible slot the launcher floats in the window corner instead.
 */
const slots = new Map<HTMLElement, ResizeObserver | undefined>();
const listeners = new Set<() => void>();
let active: HTMLElement | null = null;

function rendered(element: HTMLElement) {
  return element.isConnected && element.getClientRects().length > 0;
}

function update() {
  const next = [...slots.keys()].find(rendered) ?? null;
  if (next === active) return;
  active?.removeAttribute("data-active");
  next?.setAttribute("data-active", "");
  active = next;
  for (const listener of listeners) listener();
}

function register(element: HTMLElement | null) {
  if (!element) return;
  // The parent row has a real size; it changes when a container query shows or hides this copy.
  const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(update);
  observer?.observe(element.parentElement ?? element);
  slots.set(element, observer);
  update();
  return () => {
    observer?.disconnect();
    slots.delete(element);
    if (active === element) {
      element.removeAttribute("data-active");
      active = null;
    }
    update();
  };
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The visible footer slot the launcher docks into, or null to float. */
export function useVoiceLauncherSlot(): HTMLElement | null {
  return useSyncExternalStore(
    subscribe,
    () => active,
    () => null,
  );
}

/** Render once in each sidebar footer, after Settings. `compact` docks an orb-only button. */
export function VoiceLauncherSlot({ compact = false }: { compact?: boolean }) {
  return (
    <div
      ref={register}
      data-voice-launcher-slot=""
      data-compact={compact || undefined}
      className={styles.launcherSlot}
    />
  );
}
