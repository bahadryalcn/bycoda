import { ConversationWorkspaceTools } from "../conversation/conversation-workspace-tools";
import { AsyncHostNotes } from "../host-notes-async";
import { hostInbox } from "../notes/host-notes";
import { ProviderInboxBridge } from "../providers/provider-inbox";
import type { ServerBindings } from "./bindings";
export function createConversationRuntime(
  dependencies: Pick<
    ServerBindings,
    | "engine"
    | "automations"
    | "projectSessionList"
    | "tasks"
    | "goals"
    | "social"
    | "conversationDesktop"
  >,
) {
  const hostNotes = new AsyncHostNotes();
  const providerInbox = new ProviderInboxBridge(dependencies.engine.store.db);
  const conversationWorkspace = new ConversationWorkspaceTools(
    dependencies.engine.store,
    hostNotes,
    dependencies.automations,
    providerInbox,
    async (projectId, principal) =>
      hostInbox(
        {
          sessions: (await dependencies.projectSessionList(projectId)).list,
          tasks: await dependencies.tasks.list(),
          goals: await dependencies.goals.list(),
          automations: await dependencies.automations.list(),
          threads: (
            await dependencies.social.snapshot({
              ...principal,
              actorId:
                principal.kind === "assistant-thread"
                  ? `thread:${principal.threadId}`
                  : `session:${principal.sessionId}`,
            })
          ).threads,
        },
        projectId,
      ).items,
    async (operation, cwd, principal, authorized) =>
      await dependencies.conversationDesktop.call(
        "inbox.write.authorize",
        { operation },
        cwd,
        principal,
        authorized,
      ),
  );
  return { hostNotes, providerInbox, conversationWorkspace };
}
