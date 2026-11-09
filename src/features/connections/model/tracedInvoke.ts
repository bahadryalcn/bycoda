import { invoke } from "@tauri-apps/api/core";
import { traceHostRpc } from "../../diagnostics";

/** `invoke` for one Host request; a failure leaves a method, error code and duration breadcrumb. */
export function invokeHostRequest<T>(method: string, args: Record<string, unknown>): Promise<T> {
  return traceHostRpc(method, invoke<T>("remote_request", args));
}
