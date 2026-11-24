import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef } from "react";
import { listenWindowAsync } from "../../../platform/tauri/listenWindow";
import { hasActiveOverlay, subscribeActiveOverlay } from "../../../shared/ui/overlay";
import { observeLocalBrowserBounds } from "./observeLocalBrowserBounds";

export type LocalBrowserPage = { id: string; address: string };

export function LocalBrowserSurface({
  page,
  visible,
  onLocation,
  onBlocked,
  onFailure,
}: {
  page: LocalBrowserPage;
  visible: boolean;
  onLocation: (address: string) => void;
  onBlocked: () => void;
  onFailure: () => void;
}) {
  const slot = useRef<HTMLDivElement>(null);
  const syncVisibility = useRef<() => void>(undefined);
  const latest = useRef({ visible, onLocation, onBlocked, onFailure });
  latest.current = { visible, onLocation, onBlocked, onFailure };
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- owns a native child WebView for this page
  useEffect(() => {
    // Reason: the isolated child follows this DOM slot and closes with its owning panel.
    const { id, address } = page;
    let disposed = false;
    let opened = false;
    let updating = false;
    let stopTracking: (() => void) | undefined;
    let layout = "";
    let bounds: { x: number; y: number; width: number; height: number } | null = null;
    let unlistenLocation: (() => void) | undefined;
    let unlistenBlocked: (() => void) | undefined;
    const close = () => invoke<void>("local_browser_preview_close", { id }).catch(() => {});
    const publish = () => {
      if (disposed || !opened || updating) return;
      const key = JSON.stringify(bounds);
      if (key === layout) return;
      layout = key;
      updating = true;
      void invoke<void>("local_browser_preview_layout", { id, bounds })
        .catch(() => {
          if (!disposed) latest.current.onFailure();
        })
        .finally(() => {
          updating = false;
          // Bounds or visibility can change while the preceding IPC is in flight.
          publish();
        });
    };
    const sync = () => {
      if (!opened || disposed) return;
      if (!latest.current.visible || document.hidden || hasActiveOverlay() || !slot.current) {
        stopTracking?.();
        stopTracking = undefined;
        bounds = null;
        publish();
      } else if (!stopTracking) {
        stopTracking = observeLocalBrowserBounds(slot.current, (rect) => {
          const ratio = window.devicePixelRatio;
          bounds =
            rect.width > 0 && rect.height > 0
              ? {
                  x: Math.round(rect.left * ratio),
                  y: Math.round(rect.top * ratio),
                  width: Math.round(rect.width * ratio),
                  height: Math.round(rect.height * ratio),
                }
              : null;
          publish();
        });
      }
    };
    syncVisibility.current = sync;
    const start = async () => {
      unlistenLocation = await listenWindowAsync<[string, string]>(
        "local-browser-preview-url",
        ({ payload }) => {
          if (!disposed && payload[0] === id) latest.current.onLocation(payload[1]);
        },
      );
      if (disposed) return unlistenLocation();
      unlistenBlocked = await listenWindowAsync<string>(
        "local-browser-preview-blocked",
        ({ payload }) => {
          if (!disposed && payload === id) latest.current.onBlocked();
        },
      );
      if (disposed) return unlistenBlocked();
      await invoke<void>("local_browser_preview_open", { id, address });
      if (disposed) return close();
      opened = true;
      sync();
    };
    document.addEventListener("visibilitychange", sync);
    const stopOverlay = subscribeActiveOverlay(sync);
    void start().catch(() => {
      if (!disposed) latest.current.onFailure();
    });
    return () => {
      disposed = true;
      syncVisibility.current = undefined;
      stopTracking?.();
      stopOverlay();
      unlistenLocation?.();
      unlistenBlocked?.();
      document.removeEventListener("visibilitychange", sync);
      if (opened) void close();
    };
  }, [page]);
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- applies tab visibility to the native child WebView
  useEffect(() => {
    // Reason: hide the native child before suspending layout work on an inactive tab.
    syncVisibility.current?.();
  }, [visible]);
  return <div ref={slot} className="host-browser-preview" data-local-browser-preview="" />;
}
