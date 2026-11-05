import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { withTimeout } from "../../../shared/lib/withTimeout";

let registrationWork = Promise.resolve();
let registrationSequence = 0;
type Registration = {
  threadId: string;
  environmentId: string;
  users: number;
  interactive: number;
  background: number;
  legacyActive: boolean;
  timer?: ReturnType<typeof setInterval>;
  status: "pending" | "registered" | "unavailable";
  listeners: Set<(status: "pending" | "registered" | "unavailable") => void>;
};
const registrations = new Map<string, Registration>();
const sourceWaiters = new Map<string, Set<() => void>>();
function notifySource(key: string) {
  sourceWaiters.get(key)?.forEach((notify) => notify());
}

/** Wait for the actual native registration ACK for this exact Room and Host. */
export function waitForAssistantControlSource(
  threadId: string,
  environmentId: string,
  current: () => boolean,
  timeoutMs = 12_000,
): Promise<void> {
  const key = JSON.stringify([threadId, environmentId]);
  return new Promise((resolve, reject) => {
    const listeners = sourceWaiters.get(key) ?? new Set<() => void>();
    sourceWaiters.set(key, listeners);
    const finish = (error?: Error) => {
      clearTimeout(timer);
      listeners.delete(check);
      if (!listeners.size) sourceWaiters.delete(key);
      if (error) reject(error);
      else resolve();
    };
    const check = () => {
      if (!current()) return finish(new Error("Assistant Room source changed."));
      const source = registrations.get(key);
      if (source?.users && source.status === "registered") finish();
      else if (source?.status === "unavailable")
        finish(new Error("Assistant Room registration unavailable."));
    };
    const timer = setTimeout(
      () => finish(new Error("Assistant Room registration timed out.")),
      timeoutMs,
    );
    listeners.add(check);
    check();
  });
}

function register(
  source: Registration,
  active: boolean,
  role: "interactive" | "background" = "interactive",
) {
  registrationWork = registrationWork
    .then(async () => {
      if (active && source.users === 0) return;
      const send = async (command: string, desiredActive: boolean, withRole: boolean) =>
        withTimeout(
          invoke(command, {
            threadId: source.threadId,
            environmentId: source.environmentId,
            active: desiredActive,
            sequence: ++registrationSequence,
            ...(withRole ? { role } : {}),
          }),
          10_000,
          "Assistant Room registration",
        );
      if (source.legacyActive && (!active || role === "background")) {
        await send("control_assistant_source", false, false);
        source.legacyActive = false;
        if (!active) return;
      }
      try {
        await send("control_assistant_source_v2", active, true);
      } catch (error) {
        if (
          !active ||
          role !== "interactive" ||
          !/command.*control_assistant_source_v2.*not found/i.test(String(error))
        )
          throw error;
        await send("control_assistant_source", true, false);
        source.legacyActive = true;
      }
      if (active && source.users > 0) {
        source.status = "registered";
        source.listeners.forEach((listener) => listener(source.status));
        notifySource(JSON.stringify([source.threadId, source.environmentId]));
      }
    })
    .catch(() => {
      // Failed registration grants no authority; the validated operation relay reports it.
      if (active && source.users > 0) {
        source.status = "unavailable";
        source.listeners.forEach((listener) => listener(source.status));
        notifySource(JSON.stringify([source.threadId, source.environmentId]));
      }
    });
}

/** Registers a real Room source; background ownership yields to interactive windows. */
export function useAssistantControlSource(
  threadId: string | undefined,
  environmentId: string | undefined,
  role: "interactive" | "background" = "interactive",
) {
  const [state, setState] = useState<{ key: string; status: Registration["status"] }>({
    key: "",
    status: "pending",
  });
  const selectedKey = threadId && environmentId ? JSON.stringify([threadId, environmentId]) : "";
  useEffect(() => {
    if (!threadId || !environmentId) return;
    const key = JSON.stringify([threadId, environmentId]);
    let source = registrations.get(key);
    if (!source) {
      source = {
        threadId,
        environmentId,
        users: 0,
        interactive: 0,
        background: 0,
        legacyActive: false,
        status: "pending",
        listeners: new Set(),
      };
      const captured = source;
      source.timer = setInterval(
        () => register(captured, true, captured.interactive ? "interactive" : "background"),
        15_000,
      );
      registrations.set(key, source);
    }
    const previousRole = source.interactive
      ? "interactive"
      : source.background
        ? "background"
        : undefined;
    source.users++;
    source[role]++;
    const listener = (status: Registration["status"]) => setState({ key, status });
    source.listeners.add(listener);
    listener(source.status);
    const currentRole = source.interactive ? "interactive" : "background";
    if (!previousRole || previousRole !== currentRole) register(source, true, currentRole);
    const captured = source;
    return () => {
      captured.listeners.delete(listener);
      captured.users--;
      captured[role]--;
      if (captured.users > 0) {
        const nextRole = captured.interactive ? "interactive" : "background";
        if (nextRole !== currentRole) register(captured, true, nextRole);
        return;
      }
      clearInterval(captured.timer);
      registrations.delete(key);
      notifySource(key);
      register(captured, false);
    };
  }, [threadId, environmentId, role]);
  return selectedKey && state.key === selectedKey ? state.status : "pending";
}
