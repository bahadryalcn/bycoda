import type { Duplex } from "node:stream";
import { ZodError } from "zod";
import { truncateGraphemes } from "../../../src/shared/lib/text/truncate";
import { RPC_ERROR_CODES } from "../../../src/shared/model/host-contracts";
import type { HostDispatchError } from "../dispatch";
import type { HostReadWorkBudget } from "../read-budget";
import type { HostWsPrincipal } from "./server";

const DISPATCH_ERROR_CODES: Record<HostDispatchError["code"], number> = {
  unauthorized: RPC_ERROR_CODES.unauthorized,
  "wrong-environment": RPC_ERROR_CODES.wrongEnvironment,
  "method-not-found": RPC_ERROR_CODES.methodNotFound,
  "invalid-params": RPC_ERROR_CODES.invalidParams,
  overloaded: RPC_ERROR_CODES.overloaded,
  cancelled: RPC_ERROR_CODES.cancelled,
  "service-unavailable": RPC_ERROR_CODES.internalError,
};

/**
 * A dispatch refusal keeps "invalid-params" as its transport class for old
 * clients, but a refusal with category "conflict" (a busy lease, a changed queue)
 * gets its own code so clients can wait instead of fixing the request.
 */
export function dispatchErrorCode(error: HostDispatchError): number {
  if (error.code === "invalid-params" && error.details?.category === "conflict")
    return RPC_ERROR_CODES.conflict;
  return DISPATCH_ERROR_CODES[error.code];
}

/**
 * Names the rejected method and the fields that failed its schema, so a client
 * built against another contract version can be diagnosed. Field names and
 * issue kinds only: a submitted value is never echoed.
 */
export function invalidRequestMessage(method: unknown, error: unknown): string {
  const base = "Invalid Host RPC request";
  if (!(error instanceof ZodError) || error.issues.length === 0) return `${base}.`;
  const shown = error.issues.slice(0, 4).map((issue) => {
    const path = issue.path.map(String).join(".") || "request";
    return issue.code === "unrecognized_keys"
      ? `${path}: unrecognized ${issue.keys.join(", ")}`
      : `${path}: ${issue.code}`;
  });
  const more = error.issues.length - shown.length;
  const detail = `${shown.join("; ")}${more > 0 ? `; +${more} more` : ""}`;
  const name = typeof method === "string" ? ` ${method}` : "";
  return truncateGraphemes(`${base}:${name} (${detail})`, 400);
}

export function rejectUpgrade(socket: Duplex, status: number): void {
  if (socket.destroyed) return;
  const phrase =
    status === 401
      ? "Unauthorized"
      : status === 429
        ? "Too Many Requests"
        : status === 503
          ? "Service Unavailable"
          : "Bad Request";
  socket.end(`HTTP/1.1 ${status} ${phrase}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`, () =>
    socket.destroy(),
  );
}

export function waitFor<T>(action: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const aborted = () => reject(signal.reason);
    signal.addEventListener("abort", aborted, { once: true });
    void action.then(resolve, reject).finally(() => signal.removeEventListener("abort", aborted));
  });
}

/** The request capabilities a device principal grants, copied onto each dispatch. */
export function principalCapabilities(principal: HostWsPrincipal) {
  return {
    exposeQueueAttachments: principal.exposeQueueAttachments,
    retargetTask: principal.retargetTask,
    devServerAccess: principal.devServerAccess,
    requesterName: principal.requesterName,
    workspaceOwner: principal.workspaceOwner,
    nativeServices: principal.nativeServices,
    nativeDevices: principal.nativeDevices,
    nativeDelivery: principal.nativeDelivery,
  };
}

export type AuthMode = "own" | "shared" | "heartbeat";

/**
 * Request-boundary checks (outside any store scope) share one in-flight check per device. A check
 * made inside a domain transaction runs on its own: joining one that is queued behind that same
 * transaction deadlocks the Host's serialized store scope.
 */
export function authorizeWith(
  budget: HostReadWorkBudget,
  mode: AuthMode,
  principal: HostWsPrincipal,
): Promise<boolean> {
  const check = async () => await principal.authorized();
  return mode === "shared"
    ? budget.runShared(principal.id, check)
    : budget.run(principal.id, check, "control");
}
