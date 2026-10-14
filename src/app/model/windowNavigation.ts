import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, emitTo, listen } from "@tauri-apps/api/event";
import { getAllWindows, getCurrentWindow } from "@tauri-apps/api/window";
import type { ToolId } from "./toolWindows";
import type { BackgroundSessionTarget } from "../../features/tasks/model/backgroundSession";
import { pathKey } from "../../shared/lib/paths";
import { restoreWindowFocus } from "./windowFocus";

export type WindowDestination =
  | { kind: "session"; sessionId: string; cwd?: string; background?: BackgroundSessionTarget }
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

async function discover(): Promise<NavigationWindow[]> {
  const label = getCurrentWindow().label;
  const id = crypto.randomUUID();
  const candidates: NavigationWindow[] = [];
  const stop = await getCurrentWindow().listen<{ id: string; window: NavigationWindow }>(
    CANDIDATE,
    ({ payload }) => {
      if (payload.id === id) candidates.push(payload.window);
    },
  );
  try {
    await emit(QUERY, { id, replyTo: label });
    await new Promise((resolve) => setTimeout(resolve, 150));
    const alive = new Set((await getAllWindows()).map((entry) => entry.label));
    return candidates.filter((entry) => alive.has(entry.label));
  } finally {
    stop();
  }
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

async function route(target: WindowDestination, requireSessionWindow: boolean): Promise<boolean> {
  const source = getCurrentWindow().label;
  let owner = chooseNavigationWindow(await discover(), target, source);
  if (
    target.kind === "session" &&
    !requireSessionWindow &&
    !owner?.sessionIds.includes(target.sessionId)
  )
    return false;
  if (!owner && requireSessionWindow && target.kind === "session") {
    await invoke("open_new_window");
    const deadline = Date.now() + 10000;
    while (!owner && Date.now() < deadline)
      owner = chooseNavigationWindow(await discover(), target, source);
    if (!owner)
      throw new Error("The conversation window did not become ready. Retry opening the session.");
  }
  if (!owner) return false;
  if (owner.label === source) return target.kind === "tool" && target.grouped !== undefined;
  const destination = (await getAllWindows()).find((entry) => entry.label === owner.label);
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
    void emitTo(owner.label, OPEN, { id, replyTo: source, target }).catch((cause) =>
      complete(String(cause)),
    );
    await result;
    await restoreWindowFocus(destination);
    return true;
  } finally {
    clearTimeout(timer);
    stop();
  }
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
    ).catch(() => {});
    return () => {
      disposed = true;
      stops.forEach((stop) => stop());
    };
  }, []);
}
