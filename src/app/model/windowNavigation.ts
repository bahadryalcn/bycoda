import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, emitTo, listen } from "@tauri-apps/api/event";
import { getAllWindows, getCurrentWindow } from "@tauri-apps/api/window";
import type { ToolId } from "./toolWindows";
import type { BackgroundSessionTarget } from "../../features/tasks/model/backgroundSession";
import { pathKey } from "../../shared/lib/paths";
import { listenWindowAsync } from "../../platform/tauri/listenWindow";
import { restoreWindowFocus } from "./windowFocus";

export type WindowDestination =
  | {
      kind: "session";
      sessionId: string;
      cwd?: string;
      background?: BackgroundSessionTarget;
      requireOwned?: boolean;
      inspectSessionId?: string;
    }
  | { kind: "tool"; tool: ToolId; cwd: string; grouped?: boolean };
export type NavigationWindow = {
  label: string;
  tools: boolean;
  grouped: boolean;
  activeTool: ToolId | null;
  cwd: string;
  sessionIds: string[];
};
const QUERY = "workspace_navigation_query";
const CANDIDATE = "workspace_navigation_candidate";
const OPEN = "workspace_navigation_open";
const RESULT = "workspace_navigation_result";
const READY = "workspace_navigation_ready";
/** Upper bound for discovery; it ends early once every open window has answered. */
const DISCOVERY_BOUND_MS = 150;
/** Upper bound for a new conversation window to announce that it is listening. */
const WINDOW_READY_TIMEOUT_MS = 10000;
const samePath = (a: string, b: string) => pathKey(a) === pathKey(b);

/** Existing conversation owners win. Tools never become conversation windows. */
export function chooseNavigationWindow(
  windows: NavigationWindow[],
  target: WindowDestination,
  source: string,
) {
  const eligible = windows.filter((entry) =>
    target.kind === "session"
      ? !entry.tools
      : samePath(entry.cwd, target.cwd) &&
        (target.grouped === undefined
          ? entry.activeTool === target.tool || (entry.tools && entry.grouped)
          : entry.tools &&
            entry.grouped === target.grouped &&
            (entry.grouped || entry.activeTool === target.tool)),
  );
  const score = (entry: NavigationWindow) =>
    target.kind === "session"
      ? (entry.sessionIds.includes(target.sessionId) ? 100 : 0) +
        (target.cwd && samePath(entry.cwd, target.cwd) ? 10 : 0) +
        (entry.label === "main" ? 2 : 0)
      : entry.activeTool === target.tool
        ? 10
        : 0;
  return eligible.sort(
    (a, b) =>
      score(b) - score(a) ||
      Number(b.label === source) - Number(a.label === source) ||
      a.label.localeCompare(b.label),
  )[0];
}

/**
 * Asks every window to reply. Resolves as soon as each window open at the start has answered;
 * the bound only matters for a window that has no navigation listener.
 */
async function discover(): Promise<NavigationWindow[]> {
  const label = getCurrentWindow().label;
  const id = crypto.randomUUID();
  const candidates: NavigationWindow[] = [];
  const expected = (await getAllWindows()).map((entry) => entry.label);
  let everyoneAnswered!: () => void;
  const answered = new Promise<void>((resolve) => {
    everyoneAnswered = resolve;
  });
  const stop = await getCurrentWindow().listen<{ id: string; window: NavigationWindow }>(
    CANDIDATE,
    ({ payload }) => {
      if (payload.id !== id) return;
      candidates.push(payload.window);
      if (expected.every((name) => candidates.some((entry) => entry.label === name)))
        everyoneAnswered();
    },
  );
  let bound: ReturnType<typeof setTimeout> | undefined;
  try {
    await emit(QUERY, { id, replyTo: label });
    await Promise.race([
      answered,
      new Promise<void>((resolve) => {
        bound = setTimeout(resolve, DISCOVERY_BOUND_MS);
      }),
    ]);
    const alive = new Set((await getAllWindows()).map((entry) => entry.label));
    return candidates.filter((entry) => alive.has(entry.label));
  } finally {
    clearTimeout(bound);
    stop();
  }
}

/**
 * Opens a conversation window and waits for its READY announcement (sent once its navigation
 * listeners are registered), then discovers once. The timeout keeps the previous ceiling: if the
 * announcement never comes, one last discovery decides.
 */
async function openSessionWindow(
  target: WindowDestination,
  source: string,
): Promise<NavigationWindow | undefined> {
  const known = new Set((await getAllWindows()).map((entry) => entry.label));
  let announced!: () => void;
  const ready = new Promise<void>((resolve) => {
    announced = resolve;
  });
  const stop = await listenWindowAsync<{ label: string }>(READY, ({ payload }) => {
    if (!known.has(payload.label)) announced();
  });
  let ceiling: ReturnType<typeof setTimeout> | undefined;
  try {
    await invoke("open_new_window");
    await Promise.race([
      ready,
      new Promise<void>((resolve) => {
        ceiling = setTimeout(resolve, WINDOW_READY_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(ceiling);
    stop();
  }
  return chooseNavigationWindow(await discover(), target, source);
}

const pending = new Map<string, Promise<boolean>>();
export function routeWindowDestination(
  target: WindowDestination,
  requireSessionWindow = false,
): Promise<boolean> {
  const key = JSON.stringify([target, requireSessionWindow]);
  const existing = pending.get(key);
  if (existing) return existing;
  const result = route(target, requireSessionWindow).finally(() => pending.delete(key));
  pending.set(key, result);
  return result;
}

export async function focusSessionWindow(
  ownerLabel: string,
  sessionId: string,
  inspectSessionId?: string,
): Promise<void> {
  const target: WindowDestination = {
    kind: "session",
    sessionId,
    requireOwned: true,
    inspectSessionId,
  };
  await deliverWindowDestination(ownerLabel, target);
}

async function deliverWindowDestination(
  ownerLabel: string,
  target: WindowDestination,
): Promise<void> {
  const source = getCurrentWindow().label;
  const destination = (await getAllWindows()).find((entry) => entry.label === ownerLabel);
  if (!destination) throw new Error("The destination window has closed. Retry opening it.");
  const id = crypto.randomUUID();
  let complete!: (error?: string) => void;
  const result = new Promise<void>((resolve, reject) => {
    complete = (error) => (error ? reject(new Error(error)) : resolve());
  });
  const stop = await getCurrentWindow().listen<{ id: string; error?: string }>(
    RESULT,
    ({ payload }) => {
      if (payload.id === id) complete(payload.error);
    },
  );
  const timer = setTimeout(
    () => complete("The destination window did not respond. Retry opening it."),
    15000,
  );
  try {
    void emitTo(ownerLabel, OPEN, { id, replyTo: source, target }).catch((cause) =>
      complete(String(cause)),
    );
    await result;
    await restoreWindowFocus(destination);
  } finally {
    clearTimeout(timer);
    stop();
  }
}

async function route(target: WindowDestination, requireSessionWindow: boolean): Promise<boolean> {
  const source = getCurrentWindow().label;
  let owner: NavigationWindow | undefined = chooseNavigationWindow(await discover(), target, source);
  if (
    target.kind === "session" &&
    !requireSessionWindow &&
    !owner?.sessionIds.includes(target.sessionId)
  )
    return false;
  if (!owner && requireSessionWindow && target.kind === "session") {
    owner = await openSessionWindow(target, source);
    if (!owner)
      throw new Error("The conversation window did not become ready. Retry opening the session.");
  }
  if (!owner) return false;
  if (owner.label === source) return target.kind === "tool" && target.grouped !== undefined;
  await deliverWindowDestination(owner.label, target);
  return true;
}

/** Query current state on demand, avoiding persisted or stale window ownership. */
export function useWindowNavigation(
  state: Omit<NavigationWindow, "label">,
  open: (target: WindowDestination) => void | Promise<void>,
) {
  const current = useRef({ state, open });
  current.current = { state, open };
  useEffect(() => {
    const label = getCurrentWindow().label;
    let disposed = false;
    const stops: Array<() => void> = [];
    void Promise.all(
      [
        listen<{ id: string; replyTo: string }>(QUERY, ({ payload }) => {
          if (!disposed)
            void emitTo(payload.replyTo, CANDIDATE, {
              id: payload.id,
              window: { ...current.current.state, label },
            }).catch(() => {});
        }),
        getCurrentWindow().listen<{ id: string; replyTo: string; target: WindowDestination }>(
          OPEN,
          async ({ payload }) => {
            if (disposed) return;
            let error: string | undefined;
            try {
              const own = { ...current.current.state, label };
              if (payload.target.kind === "session" && payload.target.requireOwned) {
                if (
                  !own.sessionIds.includes(payload.target.sessionId) ||
                  !(await invoke<boolean>("verify_session_window_owner", {
                    sessionId: payload.target.sessionId,
                  }))
                )
                  throw new Error(
                    "The conversation is no longer open in this window. Retry opening it.",
                  );
              }
              if (!chooseNavigationWindow([own], payload.target, label))
                throw new Error("The destination changed. Retry opening it.");
              await current.current.open(payload.target);
            } catch (cause) {
              error = String(cause);
            }
            await emitTo(payload.replyTo, RESULT, { id: payload.id, error }).catch(() => {});
          },
        ),
      ].map(async (subscription) => {
        const stop = await subscription;
        if (disposed) stop();
        else stops.push(stop);
      }),
    )
      // Listeners are registered: tell whichever window opened this one that it can be routed to.
      .then(() => {
        if (!disposed) return emit(READY, { label });
      })
      .catch(() => {});
    return () => {
      disposed = true;
      stops.forEach((stop) => stop());
    };
  }, []);
}
