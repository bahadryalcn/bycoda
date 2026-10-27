import type { ConnectionGeneration } from "../../model/host-contracts";
import { requireBoundedKey, requireSafeCounter } from "./ports";

export type ConnectionFailure = "network" | "auth" | "identity" | "schema";
export type ConnectionState = {
  environmentId: string;
  generation: ConnectionGeneration;
  transport: "idle" | "connecting" | "negotiating" | "ready" | "retry-wait" | "blocked" | "closed";
  content: "unavailable" | "synchronizing" | "fresh" | "stale" | "error";
  hasSnapshot: boolean;
  failure?: ConnectionFailure;
};

export type ConnectionEvent =
  | { type: "attempt"; generation: ConnectionGeneration }
  | { type: "opened"; generation: ConnectionGeneration }
  | { type: "ready"; generation: ConnectionGeneration; environmentId: string }
  | {
      type: "sync-started" | "content-applied" | "content-failed";
      generation: ConnectionGeneration;
    }
  | { type: "failed"; generation: ConnectionGeneration; failure: ConnectionFailure }
  | { type: "inputs-changed" }
  | { type: "close" };

export function initialConnectionState(environmentId: string): ConnectionState {
  requireBoundedKey(environmentId, "environment ID");
  return {
    environmentId,
    generation: 0,
    transport: "idle",
    content: "unavailable",
    hasSnapshot: false,
  };
}

/** Pure policy only. The platform's sole physical connection owner schedules attempts. */
export function reduceConnectionState(
  state: ConnectionState,
  event: ConnectionEvent,
): ConnectionState {
  if (event.type === "close")
    return {
      ...state,
      transport: "closed",
      content: "unavailable",
      hasSnapshot: false,
      failure: undefined,
    };
  if (state.transport === "closed") return state;
  if (event.type === "inputs-changed")
    return state.transport === "blocked"
      ? { ...state, transport: "idle", failure: undefined }
      : state;
  requireSafeCounter(event.generation, "connection generation");
  if (event.type === "attempt") {
    if (state.transport === "blocked" || event.generation <= state.generation) return state;
    return {
      ...state,
      generation: event.generation,
      transport: "connecting",
      content: state.hasSnapshot ? "stale" : "unavailable",
      failure: undefined,
    };
  }
  if (event.generation !== state.generation || state.transport === "blocked") return state;
  if (event.type === "failed") {
    if (!["connecting", "negotiating", "ready"].includes(state.transport)) return state;
    return {
      ...state,
      transport: event.failure === "network" ? "retry-wait" : "blocked",
      content: state.hasSnapshot ? "stale" : "unavailable",
      failure: event.failure,
    };
  }
  if (event.type === "opened")
    return state.transport === "connecting" ? { ...state, transport: "negotiating" } : state;
  if (event.type === "ready") {
    if (state.transport !== "negotiating") return state;
    if (event.environmentId !== state.environmentId)
      return {
        ...state,
        transport: "blocked",
        content: state.hasSnapshot ? "stale" : "unavailable",
        failure: "identity",
      };
    return { ...state, transport: "ready", content: "synchronizing", failure: undefined };
  }
  if (state.transport !== "ready") return state;
  if (event.type === "sync-started") return { ...state, content: "synchronizing" };
  if (event.type === "content-applied") return { ...state, content: "fresh", hasSnapshot: true };
  return { ...state, content: "error" };
}
