import { useEffect, type MutableRefObject } from "react";
import type { useHarnessEventQueue } from "../sessions/useHarnessEventQueue";
import type { ProjectTerminalDockState } from "../terminal/useProjectTerminalDockState";
import {
  isLiveHarness,
  probeHarnessAvailability,
  refreshHarnessCatalogs,
  startHarnessBridge,
} from "../../../integrations/harness";
import { mergeModelSettings, resolveModel } from "../../../features/sessions/model/models";
import type { Session } from "../../../features/sessions/model/session";
import { sessionsRef, setSessions } from "../../../features/sessions/model/sessionsStore";
import type { WorkspaceTab } from "../../../features/workspace/model/layout";
import type { ProjectReturnMemory } from "../../../features/projects/model/projectReturn";
import {
  bindResumedSessions,
  isAppQuitting,
  persistQuitState,
  reapUnloadRuntime,
  type ResumedWorkspace,
} from "../../model/appLifecycle";
import { sameSettings } from "../helpers/appHelpers";

export interface HarnessLifecycleDeps {
  resumed: ResumedWorkspace | null;
  harnessQueue: ReturnType<typeof useHarnessEventQueue>["harnessQueue"];
  tabsRef: MutableRefObject<WorkspaceTab[]>;
  activeTabIdRef: MutableRefObject<string>;
  projectCwdRef: MutableRefObject<string>;
  projectTerminalsRef: ProjectTerminalDockState["projectTerminalsRef"];
  lastDockSideRef: ProjectTerminalDockState["lastDockSideRef"];
  keepWorkspaceTab: (tab: WorkspaceTab) => boolean;
  readProjectReturnMemory: () => ProjectReturnMemory;
}

/** Harness bridge start/stop, the unload persist on pagehide/beforeunload, and the boot harness probe. */
export function useHarnessLifecycle({
  resumed,
  harnessQueue,
  tabsRef,
  activeTabIdRef,
  projectCwdRef,
  projectTerminalsRef,
  lastDockSideRef,
  keepWorkspaceTab,
  readProjectReturnMemory,
}: HarnessLifecycleDeps): void {
  useEffect(() => {
    if (resumed?.sessions.length) bindResumedSessions(resumed.sessions);
    const stopBridge = startHarnessBridge();
    const reap = () => {
      if (isAppQuitting()) return;
      void persistQuitState(
        sessionsRef.current,
        tabsRef.current,
        activeTabIdRef.current,
        projectCwdRef.current,
        readProjectReturnMemory(),
        "unload",
        projectTerminalsRef.current,
        lastDockSideRef.current ?? undefined,
        keepWorkspaceTab,
      )
        .finally(() => {
          void reapUnloadRuntime(sessionsRef.current).catch((error) =>
            console.warn("Unloading runtime failed", error),
          );
        })
        .catch((error) => console.warn("Persisting unload state failed", error));
    };
    window.addEventListener("pagehide", reap);
    window.addEventListener("beforeunload", reap);
    return () => {
      window.removeEventListener("pagehide", reap);
      window.removeEventListener("beforeunload", reap);
      stopBridge();
      harnessQueue.cancelScheduled();
    };
  }, [resumed, readProjectReturnMemory]);

  useEffect(() => {
    void probeHarnessAvailability();
    // Only the harnesses already in this window. Probing every installed CLI
    // at boot left unused agents (especially Pi) running in the background.
    const harnesses = [...new Set(sessionsRef.current.map((session) => session.harness))];
    void refreshHarnessCatalogs(harnesses).then(() => {
      setSessions((prev) =>
        prev.map((session) => {
          if (!isLiveHarness(session.harness)) return session;
          const resolved = resolveModel(session.harness, session.model);
          const modelSettings = mergeModelSettings(resolved, session.modelSettings);
          if (resolved.id === session.model && sameSettings(modelSettings, session.modelSettings)) {
            return session;
          }
          return { ...session, model: resolved.id, modelSettings };
        }),
      );
    });
  }, []);
}

/** Probe the active session's harness for its live model catalog whenever
 * the active harness changes. Catalogs load lazily (probing spawns a CLI
 * process) and the boot refresh runs before restored sessions land, so a
 * fresh session would otherwise show only the built-in fallback model
 * until the picker happened to be opened. Idempotent: refreshHarnessCatalogs
 * dedupes via hasLiveCatalog and its inflight map. */
export function useActiveHarnessCatalogRefresh(activeHarness: Session["harness"] | undefined): void {
  useEffect(() => {
    if (!activeHarness || !isLiveHarness(activeHarness)) return;
    void refreshHarnessCatalogs([activeHarness]);
  }, [activeHarness]);
}
