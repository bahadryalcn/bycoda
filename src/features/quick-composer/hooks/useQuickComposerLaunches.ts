import { probeHarnessAvailability } from "../../../integrations/harness/core/availability";
import { refreshHarnessCatalogs } from "../../../integrations/harness/core/registry";
import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, type Event } from "@tauri-apps/api/event";
import { listenWindowAsync } from "../../../platform/tauri/listenWindow";
import { isLeadWindow } from "../../../platform/tauri/workspaceWindows";
import {
  loadQuickComposerEnabled,
  subscribeQuickComposerEnabled,
} from "../../settings/model/settings";
import { launchReceiver } from "../model/launchDelivery";
import { prepareQuickComposerWhenIdle } from "../model/prepareQuickComposer";
import {
  liveQuickCatalog,
  isHarnessId,
  QUICK_COMPOSER_CATALOG_EVENT,
  QUICK_COMPOSER_CATALOG_REQUEST_EVENT,
  QUICK_COMPOSER_LAUNCH_EVENT,
  quickComposerSupported,
  setQuickComposerShortcut,
  type QuickLaunch,
} from "../model/quickComposer";

/**
 * Claims the global shortcut per the setting, answers the panel's requests for
 * model catalogs, and starts sessions handed to this window. The backend keeps
 * each launch until acceptance is acknowledged; mount, focus, and launch events
 * drain the queue through one serialized receiver.
 */
export function useQuickComposerLaunches(
  onLaunch: (launch: QuickLaunch, id: string) => Promise<void>,
) {
  const accepting = useRef(new Map<string, Promise<void>>());
  const accepted = useRef(new Set<string>());
  const onLaunchRef = useRef(onLaunch);
  onLaunchRef.current = onLaunch;

  useEffect(() => {
    if (!quickComposerSupported()) return;
    let disposed = false;
    let stopPreparing: (() => void) | undefined;
    const updatePreparation = () => {
      stopPreparing?.();
      stopPreparing = undefined;
      // There is no independent menu/tray opener here. The shortcut can still
      // build on demand; a visible panel prepares its picker in native show().
      if (!disposed && loadQuickComposerEnabled()) {
        stopPreparing = prepareQuickComposerWhenIdle(loadQuickComposerEnabled);
      }
    };
    const stopWatchingEnabled = subscribeQuickComposerEnabled(updatePreparation);
    // Native preparation checks the registered shortcut, so claim it before
    // scheduling idle work. A failed claim needs no resident hidden webviews.
    void setQuickComposerShortcut(loadQuickComposerEnabled())
      .then(updatePreparation)
      .catch(() => undefined);

    const receive = launchReceiver({
      take: () => invoke("quick_composer_take"),
      accept: (launch, id) => onLaunchRef.current(launch, id),
      ack: (id) => invoke("quick_composer_ack", { id }),
      disposed: () => disposed,
      accepted: accepted.current,
      accepting: accepting.current,
    });
    const take = () =>
      receive().catch((error) => {
        console.error("Quick session delivery failed; session remains queued:", error);
      });
    const onFocus = () => void take();
    const subscriptions: Array<() => void> = [];
    const subscribe = async (event: string, handler: (event: Event<unknown>) => void) => {
      const stop = await listenWindowAsync(event, (message) => {
        if (!disposed) handler(message);
      });
      if (disposed) stop();
      else subscriptions.push(stop);
    };
    void Promise.all([
      subscribe(QUICK_COMPOSER_LAUNCH_EVENT, () => void take()),
      subscribe(QUICK_COMPOSER_CATALOG_REQUEST_EVENT, (event) => {
        const request = event.payload && typeof event.payload === "object"
          ? event.payload as { requestId?: unknown; generation?: unknown; harness?: unknown }
          : undefined;
        const correlated = typeof request?.requestId === "string" && typeof request.generation === "number";
        const harness = correlated ? request?.harness : event.payload;
        const answer = () => correlated
          ? { requestId: request!.requestId, generation: request!.generation, catalog: liveQuickCatalog() }
          : liveQuickCatalog();
        void isLeadWindow()
          .then((lead) => {
            if (!lead || disposed) return false;
            return probeHarnessAvailability().then(() => true);
          })
          .then(async (lead) => {
            if (!lead || disposed || !(await isLeadWindow())) return;
            await emit(QUICK_COMPOSER_CATALOG_EVENT, answer());
            // Only probe the provider the user opened, like the workspace picker.
            if (isHarnessId(harness)) {
              await refreshHarnessCatalogs([harness]);
              if (!disposed && await isLeadWindow()) await emit(QUICK_COMPOSER_CATALOG_EVENT, answer());
            }
          })
          .catch(() => undefined);
      }),
    ])
      .then(() => take())
      .catch(() => undefined);
    window.addEventListener("focus", onFocus);
    return () => {
      disposed = true;
      receive.dispose();
      stopWatchingEnabled();
      stopPreparing?.();
      for (const stop of subscriptions) stop();
      window.removeEventListener("focus", onFocus);
    };
  }, []);
}
