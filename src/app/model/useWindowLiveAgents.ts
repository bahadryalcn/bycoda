import { useEffect, useMemo, useRef, useState } from "react";
import { emit, emitTo, listen } from "@tauri-apps/api/event";
import { getAllWindows, getCurrentWindow } from "@tauri-apps/api/window";
import type { LiveAgent } from "../../features/sessions/model/liveAgents";
import { mergeWindowLiveAgents, type WindowLiveAgents } from "./windowLiveAgents";

const SNAPSHOT = "workspace_live_agents";
const REQUEST = "workspace_live_agents_request";
const FOCUS = "workspace_focus_live_agent";

const HIDDEN_SWEEP_EVERY = 6;

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
        agents: localRef.current,
        ownedSessionKeys: ownedRef.current,
      });
    const register = async () => {
      await Promise.all(
        [
          listen<WindowLiveAgents>(SNAPSHOT, ({ payload }) => {
            if (disposed || payload.ownerWindowLabel === label) return;
            setSnapshots((previous) => {
              if (
                JSON.stringify(previous.get(payload.ownerWindowLabel)) === JSON.stringify(payload)
              )
                return previous;
              return new Map(previous).set(payload.ownerWindowLabel, payload);
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
    let tick = 0;
    const timer = window.setInterval(() => {
      tick += 1;
      // A hidden window skips the periodic rebroadcast and sweeps dead
      // windows less often; returning to view republishes immediately.
      if (document.hidden && tick % HIDDEN_SWEEP_EVERY !== 0) return;
      if (!document.hidden) void publish().catch(() => {});
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
    }, 5_000);
    const onVisible = () => {
      if (!document.hidden) void publish().catch(() => {});
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, [label]);
  useEffect(() => {
    void emit(SNAPSHOT, {
      ownerWindowLabel: label,
      agents: localRef.current,
      ownedSessionKeys: ownedRef.current,
    }).catch(() => {});
  }, [label, signature]);
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
