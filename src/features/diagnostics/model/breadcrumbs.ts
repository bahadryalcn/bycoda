import { elapsedSince, monotonicNow } from "../../../shared/lib/time/timestamps";
import { recordUiLog } from "./uiLogBuffer";

/** Screen changes: the view name and, for Settings, the section. Never titles or paths. */
export function recordNavigation(view: string, detail?: string): void {
  recordUiLog("info", "ui.nav", view, detail ? { section: detail } : undefined);
}

/** A Host connection status change, as the connections feature classifies it. */
export function recordHostConnection(status: string, previous?: string): void {
  recordUiLog(status === "connected" ? "info" : "warn", "ui.host", `connection ${status}`, {
    status,
    ...(previous ? { from: previous } : {}),
  });
}

const CODE = /^[A-Za-z0-9_.:-]{1,48}$/;

/** A short machine-readable reason: an error code, else its class name, never its message. */
export function rpcErrorCode(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const { code, name } = error as { code?: unknown; name?: unknown };
    for (const candidate of [code, name]) {
      const text = typeof candidate === "number" ? String(candidate) : candidate;
      if (typeof text === "string" && CODE.test(text)) return text;
    }
  }
  return typeof error === "string" ? "string" : "error";
}

/**
 * Passes `request` through and records a failed Host call: the method name, an error code and the
 * duration. Params, results and error messages are never recorded.
 */
export function traceHostRpc<T>(method: string, request: Promise<T>): Promise<T> {
  const startedAt = monotonicNow();
  request.catch((error: unknown) => {
    recordUiLog("warn", "ui.rpc", "request failed", {
      method,
      code: rpcErrorCode(error),
      ms: Math.round(elapsedSince(startedAt)),
    });
  });
  return request;
}
