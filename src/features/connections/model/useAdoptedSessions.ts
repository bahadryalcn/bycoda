import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, type MutableRefObject } from "react";
import { bindHarnessSession, isLiveHarness } from "../../../integrations/harness/core/registry";
import { sessionWorkCwd, type Session } from "../../sessions/model/session";
import {
  getSession,
  storedSessionUpdatedAt,
  upsertSession,
  upsertSessionIfUnchanged,
} from "../../sessions/data/sessionStore";
import {
  ADOPTED_POLL_HIDDEN_MS,
  ADOPTED_POLL_VISIBLE_MS,
  ADOPTED_SESSION_ADDED,
  adoptedSessionTimes,
  desktopCopyOf,
  mirrorAdoptedSessions,
  refreshAdoptedSession,
  supportsAdoptedSessions,
  type AdoptedEntry,
  type AdoptedMirrorDeps,
  type AdoptedResolution,
} from "./adoptedSessions";
import { loadRemoteCapabilities, loadRemoteSession, remoteRequest } from "./connections";
import { isLocalSyncMachine } from "./localSync";
import type { HostProject, RemoteMachine } from "./protocol";
import type { LocalHostSessionTarget } from "./openLocalHostSession";
import { loadRecents, sameProjectPath } from "../../projects/model/recents";
import { subscribeRemoteRecovered } from "./remoteHealth";
import { DIGESTS_CAPABILITY } from "../../sync/model/conversationHead";
import { adoptedBeatFresh, notifyLocalHostReachable, setAdoptedWaker } from "./hostWake";

const MACHINE_RECHECK_MS = 15_000;
/** While the host's heartbeat reports what moved, this is the only timer: a
 * safety pass for a change no signal showed. */
export const ADOPTED_SAFETY_MS = 60_000;

/** Resolves `true` when the answer to a conflict saved a branch conversation. */
export type RefreshAdoptedSession = (
  sessionId: string,
  target?: LocalHostSessionTarget,
  resolution?: AdoptedResolution,
) => Promise<boolean>;

/** Mirrors sessions the local Bycoda Host adopted from this desktop (another
 * computer continued them there) back into the loaded local sessions.
 * `loadRunning` is handed the ids the host runs that are not loaded here, so
 * they can be loaded and show as working without a tab open on them.
 * Returns whether such a host is reachable: then other computers can watch
 * this desktop's sessions through it. */
export function useAdoptedSessions(
  sessionsRef: MutableRefObject<Session[]>,
  setSessions: (update: (current: Session[]) => Session[]) => void,
  loadRunning?: MutableRefObject<((ids: string[]) => void) | undefined>,
  refreshRef?: MutableRefObject<RefreshAdoptedSession | undefined>,
): MutableRefObject<boolean> {
  const hostReachable = useRef(false);
  useEffect(() => {
    // Anything waiting for the local host (the queue dispatcher) looks again
    // the moment it becomes reachable.
    const setReachable = (value: boolean) => {
      const was = hostReachable.current;
      hostReachable.current = value;
      if (value && !was) notifyLocalHostReachable();
    };
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let running: Promise<boolean | undefined> | undefined;
    let wakeRequested = false;
    let wakeMachineChanged = false;
    /** The host listed a session whose revision this window has not mirrored
     * (busy locally, unreadable, a project not opened here): look again later. */
    let outstanding = false;
    let retries = 0;
    let listed: readonly AdoptedEntry[] = [];
    const refreshes = new Map<string, Promise<boolean>>();
    const mirrored = new Map<string, number>();
    let known: RemoteMachine | undefined;
    let knownAt = 0;

    const perform = async (
      sessionId?: string,
      target?: LocalHostSessionTarget,
      resolution?: AdoptedResolution,
    ): Promise<boolean | undefined> => {
      try {
        if (sessionId || !known || Date.now() - knownAt > MACHINE_RECHECK_MS) {
          const machines = await invoke<RemoteMachine[]>("remote_machines");
          known = (Array.isArray(machines) ? machines : []).find(isLocalSyncMachine);
          knownAt = Date.now();
        }
        const machine = known;
        if (!machine || stopped) {
          setReachable(false);
          if (sessionId) throw new Error("Host unavailable. Check the connection and try again.");
          return;
        }
        if (target && (target.machineId !== machine.id || target.sessionId !== sessionId))
          throw new Error("This conversation is not on this computer's host.");
        const capabilities = await loadRemoteCapabilities(machine.environmentId);
        setReachable(supportsAdoptedSessions(capabilities));
        if (!hostReachable.current || stopped) {
          if (sessionId)
            throw new Error(
              "The host cannot refresh this conversation. Check the connection and host version.",
            );
          return;
        }
        // A host that sends digests lets a copy be compared without its full content.
        const digests = capabilities?.includes(DIGESTS_CAPABILITY) === true;
        let projects: HostProject[] | undefined;
        const deps: AdoptedMirrorDeps = {
          list: async () => {
            const entries = await remoteRequest<AdoptedEntry[]>(machine.id, "sessions.adopted", {});
            listed = entries;
            if (
              target &&
              entries.some(
                (entry) => entry.id === target.sessionId && entry.projectId !== target.projectId,
              )
            )
              throw new Error("This conversation belongs to another project.");
            return entries;
          },
          load: async (sessionId, known) => {
            const host = await loadRemoteSession(machine.id, sessionId, known, { digests });
            if (host.session.id !== sessionId || (target && host.projectId !== target.projectId))
              throw new Error("This conversation belongs to another project.");
            return host;
          },
          local: () => (stopped ? [] : sessionsRef.current),
          mirrored,
          // Only an explicit refresh saves a separate copy, before it replaces
          // the local conversation. A failed backup leaves the original untouched.
          preserve: async (copy) => {
            if (stopped || !(await upsertSession(copy))) return false;
            window.dispatchEvent(
              new CustomEvent<string>(ADOPTED_SESSION_ADDED, {
                detail: copy.cwd,
              }),
            );
            return true;
          },
          onRunning: (running) => {
            if (stopped) return;
            const update = (list: Session[]) => {
              let changed = false;
              const next = list.map((session) => {
                const continuingElsewhere = running.has(session.id) || undefined;
                if (session.continuingElsewhere === continuingElsewhere) return session;
                changed = true;
                return { ...session, continuingElsewhere };
              });
              return changed ? next : list;
            };
            sessionsRef.current = update(sessionsRef.current);
            setSessions(update);
            const loaded = new Set(sessionsRef.current.map((session) => session.id));
            const unloaded = [...running].filter((id) => !loaded.has(id));
            if (unloaded.length > 0) loadRunning?.current?.(unloaded);
          },
          conflict: (current, divergence) => {
            // Flagged once per divergence: the key rides on the session, so it
            // is saved with it and a restart finds the same flag, not a new one.
            if (
              stopped ||
              (current.adoptedSyncConflict &&
                (!divergence || current.adoptedDivergence?.key === divergence.key))
            )
              return;
            const flag = (list: Session[]) =>
              list.map((session) =>
                session.id === current.id
                  ? {
                      ...session,
                      adoptedSyncConflict: true,
                      ...(divergence ? { adoptedDivergence: divergence } : {}),
                    }
                  : session,
              );
            sessionsRef.current = flag(sessionsRef.current);
            setSessions(flag);
          },
          stored: getSession,
          stamp: storedSessionUpdatedAt,
          save: (merged, stamp) =>
            stamp === undefined
              ? upsertSession(merged).then(() => true)
              : upsertSessionIfUnchanged(merged, stamp),
          adopt: async (entry) => {
            projects ??= await remoteRequest<HostProject[]>(machine.id, "projects.list", {});
            const project = projects.find((candidate) => candidate.id === entry.projectId);
            // Only into a project this desktop has; a folder it never opened
            // stays the host's alone.
            if (
              !project ||
              !loadRecents().some((recent) => sameProjectPath(recent.path, project.cwd))
            )
              return false;
            const host = await loadRemoteSession(machine.id, entry.id, undefined, { digests });
            const copy = desktopCopyOf(host, project.cwd, sameProjectPath);
            if (stopped || !(await upsertSession(copy, adoptedSessionTimes(host)))) return false;
            window.dispatchEvent(
              new CustomEvent<string>(ADOPTED_SESSION_ADDED, {
                detail: project.cwd,
              }),
            );
            return true;
          },
          apply: (merged, previous) => {
            if (stopped) return;
            const swap = (list: Session[]) =>
              list.map((session) => (session.id === merged.id ? merged : session));
            sessionsRef.current = swap(sessionsRef.current);
            setSessions(swap);
            if (
              merged.providerSessionId &&
              (merged.providerSessionId !== previous.providerSessionId ||
                merged.harness !== previous.harness) &&
              !merged.worktreeRemoved &&
              isLiveHarness(merged.harness)
            ) {
              bindHarnessSession(
                merged.harness,
                merged.id,
                merged.providerSessionId,
                sessionWorkCwd(merged),
                merged.providerAccountId,
                merged.blocks,
              );
            }
          },
        };
        if (sessionId) return await refreshAdoptedSession(deps, sessionId, resolution);
        await mirrorAdoptedSessions(deps);
        outstanding = listed.some((entry) => mirrored.get(entry.id) !== entry.revision);
      } catch (error) {
        setReachable(false);
        outstanding = true;
        known = undefined;
        if (sessionId) throw error;
        // Host unreachable or too old; the next pass tries again.
      }
    };

    const pass = (
      sessionId?: string,
      target?: LocalHostSessionTarget,
      resolution?: AdoptedResolution,
    ): Promise<boolean | undefined> => {
      if (running && !sessionId) return running.catch(() => undefined);
      const previous = running;
      const next = (async () => {
        if (previous) await previous.catch(() => undefined);
        return perform(sessionId, target, resolution);
      })();
      running = next;
      void next
        .finally(() => {
          if (running !== next) return;
          running = undefined;
          if (wakeRequested && !stopped) {
            wakeRequested = false;
            const machineChanged = wakeMachineChanged;
            wakeMachineChanged = false;
            wake(machineChanged);
          }
        })
        .catch(() => undefined);
      return next;
    };
    const refresh: RefreshAdoptedSession = (sessionId, target, resolution) => {
      const key = JSON.stringify([sessionId, target?.machineId, target?.projectId, resolution]);
      const pending = refreshes.get(key);
      if (pending) return pending;
      const request = pass(sessionId, target, resolution).then((preserved) => !!preserved);
      refreshes.set(key, request);
      void request.finally(() => refreshes.delete(key)).catch(() => undefined);
      return request;
    };
    if (refreshRef) refreshRef.current = refresh;

    /** With the host's heartbeat answering, a pass runs on what it reports; the
     * old timer remains only while the host is unreachable or too old to say. */
    const nextDelay = () => {
      const legacy =
        document.visibilityState === "hidden" ? ADOPTED_POLL_HIDDEN_MS : ADOPTED_POLL_VISIBLE_MS;
      if (!hostReachable.current || !adoptedBeatFresh()) return legacy;
      if (!outstanding) {
        retries = 0;
        return ADOPTED_SAFETY_MS;
      }
      return Math.min(legacy * 2 ** retries++, ADOPTED_SAFETY_MS);
    };
    const schedule = () => {
      if (stopped) return;
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => {
        void pass().finally(schedule);
      }, nextDelay());
    };
    const wake = (machineChanged: boolean) => {
      if (stopped) return;
      if (machineChanged) {
        known = undefined;
        knownAt = 0;
      }
      retries = 0;
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      if (running) {
        wakeRequested = true;
        wakeMachineChanged ||= machineChanged;
        return;
      }
      void pass().finally(schedule);
    };
    const onWake = () => wake(true);
    /** The heartbeat says an adopted session moved on the host. */
    const onBeat = () => wake(false);
    const onVisible = () => {
      if (document.visibilityState !== "hidden") onWake();
    };
    const stopRecovered = subscribeRemoteRecovered((environmentId) => {
      if (!environmentId || !known || known.environmentId === environmentId) onWake();
    });
    setAdoptedWaker(onBeat);
    window.addEventListener("focus", onWake);
    window.addEventListener("online", onWake);
    window.addEventListener("bycoda:remote-machines", onWake);
    document.addEventListener("visibilitychange", onVisible);
    void pass().finally(schedule);
    return () => {
      stopped = true;
      if (refreshRef?.current === refresh) refreshRef.current = undefined;
      if (timer !== undefined) clearTimeout(timer);
      setAdoptedWaker(undefined);
      stopRecovered();
      window.removeEventListener("focus", onWake);
      window.removeEventListener("online", onWake);
      window.removeEventListener("bycoda:remote-machines", onWake);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [sessionsRef, setSessions, loadRunning, refreshRef]);
  return hostReachable;
}
