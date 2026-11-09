import { parsePullRequestWatchInput } from "../pull-request-watch/pull-request-watch-tools";
import type { ServerBindings } from "./bindings";
import type { OwnerRpcRequest } from "./owner-rpc-context";

const ID = /^[A-Za-z0-9._:-]{1,200}$/;

function id(value: unknown, name: string): string {
  if (typeof value !== "string" || !ID.test(value)) throw new Error(`${name} is required.`);
  return value;
}

/**
 * Links a GitHub pull request to a session for the phone: the Host watches it and wakes the
 * session on changes, the same service the `pullRequests.watch` agent tool uses.
 */
export async function handlePullRequestsRpc(
  dependencies: Pick<ServerBindings, "pullRequestWatch" | "engine">,
  request: OwnerRpcRequest,
): Promise<void> {
  const { params } = request;
  const sessionId = id(params.sessionId, "sessionId");
  const projectId = id(params.projectId, "projectId");
  const session = await dependencies.engine.store.session(sessionId);
  if (session.projectId !== projectId) throw new Error("Session belongs to another project.");
  switch (request.input.method) {
    case "pullRequests.link":
      request.result = await dependencies.pullRequestWatch.watch(
        { sessionId, projectId },
        parsePullRequestWatchInput(params),
      );
      break;
    case "pullRequests.unlink":
      request.result = {
        removed: await dependencies.pullRequestWatch.unwatch(sessionId, id(params.watchId, "watchId")),
      };
      break;
    case "pullRequests.linked":
      request.result = { watches: await dependencies.pullRequestWatch.list(sessionId) };
      break;
  }
}
