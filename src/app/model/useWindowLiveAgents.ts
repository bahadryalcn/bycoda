import { getSessionsRevision } from "../../features/sessions/model/sessionsStore";
import { useEffect, useMemo, useRef, useState } from "react";
import { emit, emitTo, listen } from "@tauri-apps/api/event";
import { getAllWindows, getCurrentWindow } from "@tauri-apps/api/window";
import type { LiveAgent } from "../../features/sessions/model/liveAgents";
import { mergeWindowLiveAgents, type WindowLiveAgents } from "./windowLiveAgents";

const SNAPSHOT = "workspace_live_agents";
const REQUEST = "workspace_live_agents_request";
const FOCUS = "workspace_focus_live_agent";
const GONE = "workspace_live_agents_gone";

/** Rebroadcast and dead-window sweep. A closing window announces itself via
 * `GONE`, so this is only the fallback for crashes and missed events. */
const HEARTBEAT_MS = 30_000;

function shallowEqualRecord(a: object | undefined, b: object | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const left = Object.entries(a);
  if (left.length !== Object.keys(b).length) return false;
  return left.every(([key, value]) => (b as Record<string, unknown>)[key] === value);
}

function sameSummary(
  previous: { local: LiveAgent[]; owned?: Record<string, string> },
  local: LiveAgent[],
  owned?: Record<string, string>,
): boolean {
  return previous.local === local ||
    (previous.local.length === local.length &&
      previous.local.every((agent, index) => shallowEqualRecord(agent, local[index])))
    ? shallowEqualRecord(previous.owned, owned)
    : false;
}

/** Shares only display summaries. Execution, approval callbacks and drafts
 * stay with their owning webview until the transfer protocol finishes. */
export function useWindowLiveAgents(
  local: LiveAgent[],
  ownedSessionKeys?: Record<string, string>,
): LiveAgent[] {
  const label = getCurrentWindow().label;
  const [sourceId] = useState(() => crypto.randomUUID());
  const localRef = useRef(local);
  localRef.current = local;
  const ownedRef = useRef(ownedSessionKeys);
  ownedRef.current = ownedSessionKeys;
  const [snapshots, setSnapshots] = useState<Map<string, WindowLiveAgents>>(() => new Map());
  // Streamed prose does not trigger broadcasts; only changes to the rail do.
  const previousRef = useRef({
    local,
    owned: ownedSessionKeys,
    version: 0,
  });
  if (!sameSummary(previousRef.current, local, ownedSessionKeys)) {
    previousRef.current = {
      local,
      owned: ownedSessionKeys,
      version: previousRef.current.version + 1,
    };
  }
  const signature = previousRef.current.version;
  useEffect(() => {
    let disposed = false;
    const unlisteners: Array<() => void> = [];
    const publish = () =>
      emit(SNAPSHOT, {
        ownerWindowLabel: label,
        sourceId,
        revision: previousRef.current.version,
        sessionsRevision: getSessionsRevision(),
        agents: localRef.current,
        ownedSessionKeys: ownedRef.current,
      });
    const register = async () => {
      await Promise.all(
        [
          listen<WindowLiveAgents>(SNAPSHOT, ({ payload }) => {
            if (disposed || payload.ownerWindowLabel === label) return;
            setSnapshots((previous) => {
              const prior = previous.get(payload.ownerWindowLabel);
              if (
                prior &&
                ((payload.sourceId &&
                  typeof payload.revision === "number" &&
                  prior.sourceId === payload.sourceId &&
                  (prior.revision ?? -1) >= payload.revision) ||
                  ((!payload.sourceId || payload.revision === undefined) &&
                    sameSummary(
                      { local: prior.agents, owned: prior.ownedSessionKeys },
                      payload.agents,
                      payload.ownedSessionKeys,
                    )))
              )
                return previous;
              return new Map(previous).set(payload.ownerWindowLabel, payload);
            });
          }),
          listen<{ ownerWindowLabel?: string }>(GONE, ({ payload }) => {
            const owner = payload?.ownerWindowLabel;
            if (disposed || !owner || owner === label) return;
            setSnapshots((previous) => {
              if (!previous.has(owner)) return previous;
              const next = new Map(previous);
              next.delete(owner);
              return next;
            });
          }),
          listen(REQUEST, () => {
            if (!disposed) void publish().catch(() => {});
          }),
        ].map(async (subscription) => {
          const unlisten = await subscription;
          if (disposed) unlisten();
          else unlisteners.push(unlisten);
        }),
      );
      if (!disposed) {
        await publish();
        await emit(REQUEST);
      }
    };
    void register().catch(() => {});
    const sweep = () =>
      void getAllWindows()
        .then((windows) => {
          if (disposed) return;
          const alive = new Set(windows.map((window) => window.label));
          setSnapshots((previous) => {
            if ([...previous.keys()].every((owner) => alive.has(owner))) return previous;
            return new Map([...previous].filter(([owner]) => alive.has(owner)));
          });
        })
        .catch(() => {});
    const timer = window.setInterval(() => {
      // A hidden window shows no rail: skip the rebroadcast and the window
      // list IPC; returning to view republishes and sweeps immediately.
      if (document.hidden) return;
      void publish().catch(() => {});
      sweep();
    }, HEARTBEAT_MS);
    const onVisible = () => {
      if (document.hidden) return;
      void publish().catch(() => {});
      sweep();
    };
    const onPageHide = () => {
      void emit(GONE, { ownerWindowLabel: label }).catch(() => {});
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pagehide", onPageHide);
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, [label, sourceId]);
  useEffect(() => {
    if (signature === 0) return; // Initial registration publishes once.
    void emit(SNAPSHOT, {
      ownerWindowLabel: label,
      sourceId,
      revision: previousRef.current.version,
      sessionsRevision: getSessionsRevision(),
      agents: localRef.current,
      ownedSessionKeys: ownedRef.current,
    }).catch(() => {});
  }, [label, signature, sourceId]);
  return useMemo(
    () => mergeWindowLiveAgents(localRef.current, [...snapshots.values()], label, ownedRef.current),
    [snapshots, label, signature],
  );
}

export async function focusWindowLiveAgent(agent: LiveAgent): Promise<void> {
  const owner = agent.ownerWindowLabel;
  if (!owner) return;
  const window = (await getAllWindows()).find((entry) => entry.label === owner);
  if (!window) throw new Error("The conversation window has closed.");
  await emitTo(owner, FOCUS, agent.id);
  await window.show();
  await window.unminimize();
  await window.setFocus();
}

export function listenForWindowLiveAgent(onFocus: (id: string) => void) {
  return getCurrentWindow().listen<string>(FOCUS, ({ payload }) => onFocus(payload));
}
