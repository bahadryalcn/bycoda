import {
  inboxOperationWrites,
  parseRemoteInboxOperation,
} from "../../src/features/inbox/model/remoteInbox";
import { hostInbox } from "../notes/host-notes";
import type { ServerBindings } from "./bindings";
import type { OwnerRpcRequest } from "./owner-rpc-context";
export async function handleInboxRpc(
  dependencies: Pick<
    ServerBindings,
    "providerInbox" | "engine" | "projectSessionList" | "tasks" | "goals" | "automations" | "social"
  >,
  request: OwnerRpcRequest,
): Promise<void> {
  switch (request.input.method) {
    case "inbox.provider.status":
      request.result = await dependencies.providerInbox.availability();
      break;

    case "inbox.provider.request": {
      const operation = parseRemoteInboxOperation(
        request.params,
        await dependencies.engine.store.projects(),
      );
      if (
        inboxOperationWrites(operation) &&
        request.params.confirm !==
          (operation.action === "comment"
            ? "SEND_COMMENT"
            : operation.action === "review"
              ? "SUBMIT_PR_REVIEW"
              : operation.action === "jira-board-transition" ||
                  operation.action === "jira-board-move"
                ? "CHANGE_JIRA_BOARD"
                : "CHANGE_PR_STATE")
      )
        throw new Error("This inbox write requires an explicit owner action.");
      request.result = await dependencies.providerInbox.request(
        request.tokenHash,
        request.params.requestId,
        operation,
      );
      break;
    }

    case "inbox.provider.result":
      request.result = await dependencies.providerInbox.result(
        request.tokenHash,
        request.params.requestId,
      );
      break;

    case "inbox.list": {
      const projectId =
        request.params.projectId === undefined ? undefined : String(request.params.projectId);
      const projects = projectId
        ? [await dependencies.engine.store.project(projectId)]
        : await dependencies.engine.store.projects();
      // Bounded fan-out: with 100+ projects an unbounded Promise.all queues every
      // list job (and its desktop read) at once and starves the point reads.
      const lists: Awaited<ReturnType<typeof dependencies.projectSessionList>>[] = [];
      let nextProject = 0;
      await Promise.all(
        Array.from({ length: Math.min(4, projects.length) }, async () => {
          for (;;) {
            const index = nextProject++;
            if (index >= projects.length) return;
            lists[index] = await dependencies.projectSessionList(projects[index].id);
          }
        }),
      );
      const sessions = lists.flatMap((entry) => entry.list);
      if (!(await dependencies.engine.store.authenticated(request.token)))
        throw new Error("Session authority revoked.");
      request.result = hostInbox(
        {
          sessions,
          tasks: await dependencies.tasks.list(),
          goals: await dependencies.goals.list(),
          automations: await dependencies.automations.list(),
          threads: (
            await dependencies.social.snapshot({
              kind: "owner",
              actorId: "device",
              provider: "owner",
            })
          ).threads,
        },
        projectId,
      );
      break;
    }
  }
}
