import { invoke } from "@tauri-apps/api/core";
import { traceHostRpc } from "../../diagnostics";

/** Methods whose fixed sub-operation name is needed to attribute a failure. */
const SUB_OPERATION: Readonly<Record<string, string>> = {
  "social.request": "action",
  "workspace.run": "command",
};

/**
 * The breadcrumb name of one request: the method, plus the operation name of a multiplexing
 * method (`social.request:browser.needsHuman.list`). Operation names are fixed program text;
 * only a short identifier-shaped value is kept, never params or user data.
 */
export function traceName(method: string, args: Record<string, unknown>): string {
  const key = SUB_OPERATION[method];
  const params = args.params as Record<string, unknown> | undefined;
  const operation = key ? params?.[key] : undefined;
  return typeof operation === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(operation)
    ? `${method}:${operation}`
    : method;
}

/** `invoke` for one Host request; a failure leaves a method, error code and duration breadcrumb. */
export function invokeHostRequest<T>(method: string, args: Record<string, unknown>): Promise<T> {
  return traceHostRpc(traceName(method, args), invoke<T>("remote_request", args));
}
