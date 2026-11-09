import { dirname } from "node:path";
import { version } from "../../package.json";
import { DIAGNOSTICS_LOGS_RPC } from "../../src/shared/model/host-contracts/diagnostics-logs";
import { readHostLogReport } from "../diagnostics/log-report";
import type { ServerBindings } from "./bindings";
import type { OwnerRpcRequest } from "./owner-rpc-context";

/** Same authority as `resources.read`: the dispatcher only runs for an authenticated paired device. */
export async function handleDiagnosticsLogsRpc(
  dependencies: Pick<ServerBindings, "engine">,
  request: OwnerRpcRequest,
): Promise<void> {
  if (request.input.method !== "diagnostics.logs.read") return;
  DIAGNOSTICS_LOGS_RPC["diagnostics.logs.read"].params.parse(request.params ?? {});
  request.result = await readHostLogReport({
    dataDir: dirname(dependencies.engine.store.attachmentDir),
    version,
  });
}
