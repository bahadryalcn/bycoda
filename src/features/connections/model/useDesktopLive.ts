import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, type MutableRefObject } from "react";
import type { Session } from "../../sessions/model/session";
import {
  DESKTOP_LIVE_MS,
  runDesktopLiveTick,
  supportsDesktopLive,
  type DesktopLiveBeat,
  type DesktopLiveHandlers,
  type DesktopLiveResult,
} from "./desktopLive";
import type { DesktopInboxReply } from "../../inbox/model/remoteInbox";
import { loadRemoteCapabilities, remoteRequest } from "./connections";
import { isLocalSyncMachine } from "./localSync";
import type { RemoteMachine } from "./protocol";
import { buildMobileProjectDirectory } from "../../projects/model/mobileProjectDirectory";
import { withMobileProjectLogos } from "../../projects/model/mobileProjectLogos";

const MACHINE_RECHECK_MS = 15_000;
// One identity per WebView, stable across StrictMode effect remounts.
const desktopClientId = crypto.randomUUID();

/** Tells the local host this desktop is alive and which sessions are busy or
 * waiting on input, and runs the stop/approve/answer commands watchers sent
 * through it. Plain interval: it must keep ticking while the window is hidden. */
export function useDesktopLive(
  sessionsRef: MutableRefObject<Session[]>,
  handlersRef: MutableRefObject<DesktopLiveHandlers>,
  hostReachable: MutableRefObject<boolean>,
): void {
  const state = useRef({
    unacked: new Set<string>(),
    handled: new Set<string>(),
    beat: {} as DesktopLiveBeat,
    inboxResults: new Map<string, DesktopInboxReply>(),
    inboxRunning: new Set<string>(),
    deletions: {
      results: new Map<string, { id: string; error?: string }>(),
      running: new Set<string>(),
    },
  });
  useEffect(() => {
    let stopped = false;
    let running = false;
    let machineId: string | undefined;
    let checkedAt = 0;
    const { unacked, handled, beat, inboxResults, inboxRunning } = state.current;

    const tick = async () => {
      if (running || !hostReachable.current) return;
      running = true;
      try {
        if (!machineId || Date.now() - checkedAt > MACHINE_RECHECK_MS) {
          checkedAt = Date.now();
          machineId = undefined;
          const machines = await invoke<RemoteMachine[]>("remote_machines");
          const machine = (Array.isArray(machines) ? machines : []).find(isLocalSyncMachine);
          if (!machine || stopped) return;
          const capabilities = await loadRemoteCapabilities(machine.environmentId);
          if (!supportsDesktopLive(capabilities) || stopped) return;
          machineId = machine.id;
        }
        const id = machineId;
        await runDesktopLiveTick({
          clientId: desktopClientId,
          request: (payload) =>
            remoteRequest<DesktopLiveResult>(id, "sessions.desktopLive", payload),
          sessions: () => sessionsRef.current,
          projectDirectory: () =>
            withMobileProjectLogos(
              buildMobileProjectDirectory(sessionsRef.current.map((session) => session.cwd)),
            ),
          handlers: {
            delete: (sessionId, cwd) => {
              const handler = handlersRef.current.delete;
              if (!handler) return Promise.reject(new Error("Desktop deletion is unavailable."));
              return handler(sessionId, cwd);
            },
            stop: (sessionId) => handlersRef.current.stop(sessionId),
            approve: (...args) => handlersRef.current.approve(...args),
            answer: (...args) => handlersRef.current.answer(...args),
          },
          unacked,
          handled,
          beat,
          deletions: state.current.deletions,
          inbox: {
            invoke: (command, args) => invoke(command, args),
            list: async (projects, query) => {
              const { listInboxItems } = await import("../../inbox/model/githubTasks");
              return listInboxItems(projects, query, { force: true });
            },
            results: inboxResults,
            running: inboxRunning,
            onNotesChanged: async () => {
              const { invalidateNotes, NOTES_CHANGED_EVENT } = await import("../../notes/notes");
              invalidateNotes();
              window.dispatchEvent(new Event(NOTES_CHANGED_EVENT));
            },
          },
        });
      } catch {
        machineId = undefined; // Host unreachable; the next tick looks again.
        beat.idleAt = undefined;
      } finally {
        running = false;
      }
    };
    const timer = window.setInterval(() => void tick(), DESKTOP_LIVE_MS);
    void tick();
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [sessionsRef, handlersRef, hostReachable]);
}
