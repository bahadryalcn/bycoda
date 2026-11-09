import { requestingDeviceName, type RemoteActivityEvent } from "../desktop/remoteActivity";
import type { ServerBindings } from "./bindings";
import type { OwnerRpcRequest } from "./owner-rpc-context";

/** How the main machine's own desktop appears in its Host's device list (`local_device_name` in src-tauri). */
export const LOCAL_DESKTOP_DEVICE_NAME = "This computer (local sync)";

/**
 * Tells the main desktop that another device changed something it shows. The
 * desktop's own requests (it pairs under `LOCAL_DESKTOP_DEVICE_NAME`) never
 * record, so the person does not get a notice for their own click. Call only
 * after the change succeeded; it never throws.
 */
export async function recordRemoteActivity(
  dependencies: Pick<ServerBindings, "engine" | "remoteActivity">,
  request: Pick<OwnerRpcRequest, "token">,
  kind: RemoteActivityEvent["kind"],
  target: { projectId?: unknown; cwd?: string },
): Promise<void> {
  try {
    const requestedBy = await requestingDeviceName(dependencies.engine.store, request.token);
    if (requestedBy === LOCAL_DESKTOP_DEVICE_NAME) return;
    let cwd = target.cwd ?? "";
    if (!cwd && typeof target.projectId === "string" && target.projectId)
      cwd = (await dependencies.engine.store.project(target.projectId)).cwd;
    dependencies.remoteActivity.record({ kind, cwd, ...(requestedBy ? { requestedBy } : {}) });
  } catch {
    // Activity notices are best effort; the change already succeeded.
  }
}
