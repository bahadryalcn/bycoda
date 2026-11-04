import { commonHostSessionExecutionClient } from "../../../shared/lib/host-runtime/session-execution";
import type { SessionExecutionClient } from "../../../shared/model/host-contracts/session-execution";
import type { SessionAccess } from "./sessionAccess";
import { flushHostSessionBindings } from "./sessionExecutionBinding";
import {
  SessionsPageResultSchema,
  SessionSyncResponseSchema,
} from "../../../shared/model/host-contracts/session-reads";

/** Thin desktop adapter; local and remote Hosts share execution policy. */
export function sessionExecutionClient(
  environmentId: string,
  access: SessionAccess,
): SessionExecutionClient {
  return commonHostSessionExecutionClient(environmentId, {
    list: (params) => access.list(params.projectId, params.known),
    page: async (params) =>
      SessionsPageResultSchema.parse(
        await access.page(
          params.sessionId,
          params.before,
          params.revision,
          params.digests,
          params.preview,
        ),
      ),
    sync: async ({ sessionId, ...params }) =>
      SessionSyncResponseSchema.parse(await access.sync(sessionId, params)),
    dispatch: async (command) => {
      // Stop retains its independent safety path when storage is unavailable.
      if (command.type !== "cancel" && command.type !== "stopItem")
        await flushHostSessionBindings();
      return access.dispatch(command);
    },
    status: (commandId) => access.status(commandId),
  });
}
