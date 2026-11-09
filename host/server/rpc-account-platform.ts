import { ACTIVITY_RPC, type ActivityMethod } from "../../src/shared/model/host-contracts/activity";
import {
  SESSION_LIFECYCLE_RPC,
  type SessionLifecycleMethod,
} from "../../src/shared/model/host-contracts/session-lifecycle";
import { handleActivityRpc } from "../activity/activity-rpc";
import type { ServerBindings } from "./bindings";
import type { OwnerRpcRequest } from "./owner-rpc-context";

export async function handleActivityOwnerRpc(
  dependencies: Pick<ServerBindings, "accountPlatform">,
  request: OwnerRpcRequest,
): Promise<void> {
  const method = request.input.method as ActivityMethod;
  if (!(method in ACTIVITY_RPC)) throw new Error("Unsupported activity method");
  request.result = await handleActivityRpc(
    dependencies.accountPlatform.activity,
    method,
    request.params,
  );
}

export async function handleSessionLifecycleRpc(
  dependencies: Pick<ServerBindings, "accountPlatform">,
  request: OwnerRpcRequest,
): Promise<void> {
  const { lifecycle, links } = dependencies.accountPlatform;
  const method = request.input.method as SessionLifecycleMethod;
  const schema = SESSION_LIFECYCLE_RPC[method];
  if (!schema) throw new Error("Unsupported session lifecycle method");
  const params = schema.params.parse(request.params) as Record<string, string | undefined>;
  const settings = params as unknown as { afterDays: number | null };
  const context = request.domainContext;
  switch (method) {
    case "sessions.lifecycle.get":
      request.result = await lifecycle.get(params.sessionId!);
      break;
    case "sessions.lifecycle.list":
      request.result = {
        records: await lifecycle.list(),
        autoSettle: await lifecycle.autoSettleSettings(),
      };
      break;
    case "sessions.lifecycle.settle":
      request.result = await lifecycle.settle(params.sessionId!, context);
      break;
    case "sessions.lifecycle.unsettle":
      request.result = await lifecycle.unsettle(params.sessionId!, context);
      break;
    case "sessions.lifecycle.configure":
      request.result = await lifecycle.configure(settings, context);
      // A shorter window applies now rather than at the next hourly check.
      dependencies.accountPlatform.autoSettle();
      break;
    case "sessions.taskLink.get":
      request.result = { taskId: (await links.taskFor(params.sessionId!)) ?? null };
      break;
    case "sessions.taskLink.link":
      request.result = await links.link(params.sessionId!, params.taskId!);
      break;
    case "sessions.taskLink.unlink":
      request.result = { unlinked: await links.unlink(params.sessionId!) };
      break;
    case "sessions.taskLink.listForTask":
      request.result = { sessionIds: await links.sessionsFor(params.taskId!) };
      break;
  }
}
