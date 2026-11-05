import { invoke } from "@tauri-apps/api/core";
import { hostSessionBinding } from "./sessionExecutionBinding";
import { remoteProjectFor } from "./remoteProjects";
import { liveTurnHarness } from "../../sessions/public/messageQueue";
import { sessionWorkCwd, type Session } from "../../sessions/public/session";
import { orchestrator } from "../../orchestration/model/orchestration";
import { useEffect, useRef, type MutableRefObject } from "react";

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
import { desktopInstanceId } from "./desktopInstance";
import { heldRunLeases, noteRunLeases } from "./runLeaseClient";
import { adoptedBeatFailed, noteAdoptedBeat } from "./hostWake";
import {
  heldSharedQueueLeases,
  noteSharedQueueLeases,
  wakeSharedLocalQueues,
} from "./useSharedLocalQueues";
import type { RemoteMachine } from "./protocol";
import { buildMobileProjectDirectory } from "../../projects/public/mobileProjectDirectory";
import { withMobileProjectLogos } from "../../projects/public/mobileProjectLogos";
import {
  retainedHarnessWriters,
  retireHarnessWriter,
  captureHarnessControlTurn,
} from "../../../integrations/harness/core/registry";
import { captureChildProcess } from "../../../integrations/harness/core/child";
import { nativeControlTurnReceipt } from "../../../integrations/harness/core/controlTurn";

const MACHINE_RECHECK_MS = 15_000;
// One identity per WebView, stable across StrictMode remounts and app restarts:
// the host knows this desktop's queue leases by it.
const desktopClientId = desktopInstanceId();

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
    let approvalOccurrenceSupported = false;
    let checkedAt = 0;
    const { unacked, handled, beat, inboxResults, inboxRunning } = state.current;

    let directoryInputs: { id: string; cwd: string }[] = [];
    let directoryPaths: string[] = [];
    const projectDirectory = () => {
      const sessions = sessionsRef.current;
      if (
        !directoryInputs.length ||
        sessions.length !== directoryInputs.length ||
        sessions.some(
          (session, i) =>
            session.id !== directoryInputs[i]?.id || session.cwd !== directoryInputs[i]?.cwd,
        )
      ) {
        directoryInputs = sessions.map(({ id, cwd }) => ({ id, cwd }));
        directoryPaths = sessions.map((session) => session.cwd);
      }
      // The builder also tracks stored privacy/layout inputs, and logos may finish
      // loading without a session change. Their caches retain object identity.
      return withMobileProjectLogos(buildMobileProjectDirectory(directoryPaths));
    };
    const tick = async () => {
      if (running || !hostReachable.current) return;
      running = true;
      try {
        if (!machineId || Date.now() - checkedAt > MACHINE_RECHECK_MS) {
          checkedAt = Date.now();
          machineId = undefined;
          approvalOccurrenceSupported = false;
          const machines = await invoke<RemoteMachine[]>("remote_machines");
          const machine = (Array.isArray(machines) ? machines : []).find(isLocalSyncMachine);
          if (!machine || stopped) return;
          const capabilities = await loadRemoteCapabilities(machine.environmentId);
          if (!supportsDesktopLive(capabilities) || stopped) return;
          approvalOccurrenceSupported =
            capabilities?.includes("sessions.approvalOccurrence.v1") === true;
          machineId = machine.id;
        }
        const id = machineId;
        await runDesktopLiveTick({
          approvalOccurrenceSupported,
          clientId: desktopClientId,
          controlGuard: {
            pageToken: () => invoke<string>("desktop_control_page_token"),
            verify: (token) => invoke<void>("desktop_control_page_verify", { token }),
            capture: (session) => {
              try {
                if (hostSessionBinding(session) || remoteProjectFor(session.cwd)) return undefined;
                const run = orchestrator.forSession(session.id);
                const orchestration = run
                  ? orchestrator.captureDesktopControl(session.id)
                  : undefined;
                if (run && !orchestration) return undefined;
                const process = captureChildProcess(session.id);
                const turn = captureHarnessControlTurn(session.id, process);
                if (!process || !turn) return undefined;
                const receipt = nativeControlTurnReceipt(turn);
                const harness = liveTurnHarness(session);
                const cwd = sessionWorkCwd(session);
                return {
                  receipt,
                  question: session.pendingQuestion,
                  ...(orchestration
                    ? { ready: orchestration.ready, stopOrchestration: orchestration.stop }
                    : {}),
                  current: () => {
                    const now = sessionsRef.current.find((entry) => entry.id === session.id);
                    return (
                      !!now &&
                      !hostSessionBinding(now) &&
                      !remoteProjectFor(now.cwd) &&
                      (orchestration
                        ? orchestration.current()
                        : !orchestrator.forSession(now.id)) &&
                      sessionWorkCwd(now) === cwd &&
                      liveTurnHarness(now) === harness &&
                      captureChildProcess(now.id) === process &&
                      captureHarnessControlTurn(now.id, process) === turn
                    );
                  },
                };
              } catch {
                return undefined;
              }
            },
          },
          request: (payload) =>
            remoteRequest<DesktopLiveResult>(id, "sessions.desktopLive", payload),
          sessions: () => sessionsRef.current.filter((session) => !hostSessionBinding(session)),
          writers: retainedHarnessWriters,
          projectDirectory,
          handlers: {
            retireWriter: retireHarnessWriter,
            delete: (sessionId, cwd) => {
              const handler = handlersRef.current.delete;
              if (!handler) return Promise.reject(new Error("Desktop deletion is unavailable."));
              return handler(sessionId, cwd);
            },
            stop: (sessionId, current) => handlersRef.current.stop(sessionId, current),
            captureApproval: (...args) => handlersRef.current.captureApproval?.(...args),
            approvalDispatchStarted: (...args) =>
              handlersRef.current.approvalDispatchStarted?.(...args) ?? false,
            approve: (...args) => handlersRef.current.approve(...args),
            answer: (...args) => handlersRef.current.answer(...args),
          },
          unacked,
          handled,
          onQueuesChanged: wakeSharedLocalQueues,
          onAdopted: (change) => noteAdoptedBeat(change),
          queueLeases: {
            held: heldSharedQueueLeases,
            answered: noteSharedQueueLeases,
          },
          runLeases: { held: heldRunLeases, answered: noteRunLeases },
          beat,
          deletions: state.current.deletions,
          inbox: {
            jira: async (operation, deadline) =>
              (await import("../../inbox/model/jiraMobileBridge")).executeRemoteJiraBoard(
                operation,
                deadline,
              ),
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
        approvalOccurrenceSupported = false;
        beat.idleAt = undefined;
        adoptedBeatFailed();
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
