import { useSyncExternalStore } from "react";
import type { RemoteConnectionStatus } from "./remoteConnection";

export type ConnectionPhase = "idle" | "checking" | "restoring" | "ready" | "waiting" | "failed";
export type RemoteFeature = "host" | "changes" | "files" | "git" | "sessions";
export type FeatureHealth = { status: "ready" | "stale" | "failed"; verifiedAt?: number };
export type ConnectionActivity = {
  at: number;
  generation: number;
  attempt: number;
  phase: ConnectionPhase;
  reason?: RemoteConnectionStatus;
};
export type RemoteLifecycle = {
  generation: number;
  attempt: number;
  phase: ConnectionPhase;
  startedAt?: number;
  nextRetryAt?: number;
  paused?: boolean;
  features: Partial<Record<RemoteFeature, FeatureHealth>>;
  activity: readonly ConnectionActivity[];
};
const initial: RemoteLifecycle = {
  generation: 0,
  attempt: 0,
  phase: "idle",
  features: {},
  activity: [],
};
const states = new Map<string, RemoteLifecycle>();
let generationSequence = 0;
const listeners = new Set<() => void>();
const invalidated = new Set<(environmentId: string) => void>();
const machineEnvironments = new Map<string, string>();
export function bindMachineEnvironment(machineId: string, environmentId: string) {
  machineEnvironments.set(machineId, environmentId);
  if (machineEnvironments.size > 256)
    machineEnvironments.delete(machineEnvironments.keys().next().value!);
}
export const environmentForMachine = (machineId: string) => machineEnvironments.get(machineId);
export const subscribeRemoteLifecycle = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const readRemoteLifecycle = (environmentId: string) => states.get(environmentId) ?? initial;
export function captureConnectionGeneration(environmentId: string): number {
  if (!states.has(environmentId))
    write(environmentId, { ...initial, generation: ++generationSequence });
  return readRemoteLifecycle(environmentId).generation;
}
export const useRemoteLifecycle = (environmentId: string) =>
  useSyncExternalStore(
    subscribeRemoteLifecycle,
    () => readRemoteLifecycle(environmentId),
    () => initial,
  );

function write(environmentId: string, state: RemoteLifecycle) {
  if (state.generation === 0) state = { ...state, generation: ++generationSequence };
  states.set(environmentId, state);
  // Keep route generations independent of diagnostic retention: collecting
  // another machine's history must never invalidate a legitimate request.
  listeners.forEach((listener) => listener());
}
export function setConnectionPhase(
  environmentId: string,
  phase: ConnectionPhase,
  reason?: RemoteConnectionStatus,
) {
  const state = readRemoteLifecycle(environmentId);
  if (state.phase === phase) return;
  write(environmentId, {
    ...state,
    phase,
    activity: [
      ...state.activity,
      {
        at: Date.now(),
        generation: state.generation,
        attempt: state.attempt,
        phase,
        ...(reason ? { reason } : {}),
      },
    ].slice(-40),
  });
}
export function beginConnectionAttempt(environmentId: string) {
  captureConnectionGeneration(environmentId);
  const state = readRemoteLifecycle(environmentId);
  write(environmentId, {
    ...state,
    attempt: state.attempt + 1,
    startedAt: Date.now(),
    nextRetryAt: undefined,
    paused: false,
  });
  setConnectionPhase(environmentId, "checking");
  return { generation: state.generation, attempt: state.attempt + 1 };
}
export function isCurrentConnectionAttempt(
  environmentId: string,
  token: { generation: number; attempt: number },
) {
  const state = readRemoteLifecycle(environmentId);
  return state.generation === token.generation && state.attempt === token.attempt;
}
export function setConnectionRetry(environmentId: string, nextRetryAt?: number) {
  const state = readRemoteLifecycle(environmentId);
  if (state.nextRetryAt !== nextRetryAt) write(environmentId, { ...state, nextRetryAt });
}
export function pauseConnectionRecovery(environmentId: string) {
  const state = readRemoteLifecycle(environmentId);
  write(environmentId, { ...state, paused: true, nextRetryAt: undefined });
}
export function recordFeatureHealth(
  environmentId: string,
  feature: RemoteFeature,
  ok: boolean,
  generation?: number,
) {
  captureConnectionGeneration(environmentId);
  const state = readRemoteLifecycle(environmentId);
  if (generation !== undefined && generation !== state.generation) return;
  const previous = state.features[feature];
  write(environmentId, {
    ...state,
    features: {
      ...state.features,
      [feature]: {
        status: ok ? "ready" : "failed",
        verifiedAt: ok ? Date.now() : previous?.verifiedAt,
      },
    },
  });
}
export function markRemoteFeaturesStale(environmentId: string) {
  const state = readRemoteLifecycle(environmentId);
  const features = { ...state.features };
  for (const key of Object.keys(features) as RemoteFeature[])
    if (features[key]?.status === "ready") features[key] = { ...features[key]!, status: "stale" };
  write(environmentId, { ...state, features });
}
export const subscribeConnectionInvalidated = (listener: (environmentId: string) => void) => {
  invalidated.add(listener);
  return () => {
    invalidated.delete(listener);
  };
};
/** Detach old results immediately; only their own native lease may finish cleanup. */
export function invalidateConnection(environmentId: string) {
  const state = readRemoteLifecycle(environmentId);
  write(environmentId, {
    ...initial,
    generation: ++generationSequence,
    attempt: state.attempt,
    activity: state.activity,
  });
  invalidated.forEach((listener) => listener(environmentId));
}
export function remoteFeatureForMethod(
  method: string,
  params?: unknown,
): RemoteFeature | undefined {
  if (method === "machine.changes") return "changes";
  if (/^(files|fs|sftp)\.|^workspace\.(read|list|stat|search)/.test(method)) return "files";
  if (/^git\.|^workspace\.git/.test(method)) return "git";
  if (method.startsWith("sessions.")) return "sessions";
  if (method === "workspace.run" && params && typeof params === "object" && "command" in params) {
    const command = params.command;
    if (typeof command === "string" && command.startsWith("git_")) return "git";
    if (
      typeof command === "string" &&
      /^(browse_dir|read_text_file|search_|stat_|list_|write_text_file)/.test(command)
    )
      return "files";
  }
  return method === "environment.describe" ? "host" : undefined;
}
export const SUPERSEDED_CONNECTION =
  "Connection changed while the request was running. Its outcome is unknown; refresh before retrying an action.";

export function resetRemoteLifecyclesForTests() {
  states.clear();
  machineEnvironments.clear();
}
