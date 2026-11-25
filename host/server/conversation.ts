import { ConversationWorkspaceTools } from "../conversation/conversation-workspace-tools";
import { AsyncHostNotes } from "../host-notes-async";
import { hostInbox } from "../notes/host-notes";
import { ProviderInboxBridge } from "../providers/provider-inbox";
import type { ServerBindings } from "./bindings";
import { sessionFullAccessCoversInbox } from "./management";
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
    | "featureMeta"
    | "assistant"
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
        // Native skips its prompt only on this answer; the session mode is the Host's own record.
        principal.kind === "session"
          ? async () =>
              (await dependencies.featureMeta(principal.sessionId)).session.runtimeMode ===
                "full-access" &&
              (await sessionFullAccessCoversInbox(operation, () =>
                dependencies.assistant.profile(),
              ))
          : undefined,
      ),
  );
  return { hostNotes, providerInbox, conversationWorkspace };
}
