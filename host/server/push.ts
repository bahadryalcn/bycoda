import type { HostSessionSummary } from "../../src/features/connections/model/protocol";
import { ApprovalRegistry } from "../approvals/approval-registry";
import { ApprovalStore } from "../approvals/approval-store";
import { AssistantPushLedger } from "../push/push-assistant";
import { PushNotifications } from "../push/push-service";
import { PushDeviceStore } from "../push/push-store";
import { tickAssistantTelegram } from "../push/push-telegram";
import type { SocialAccount } from "../../src/features/social/model/social";
import type { ServerBindings } from "./bindings";

export function createPushRuntime(
  dependencies: Pick<
    ServerBindings,
    | "assistant"
    | "engine"
    | "projectSessionList"
    | "social"
    | "assistantPorts"
    | "executeBackgroundEffect"
    | "assistantBackgroundEffect"
  >,
) {
  const store = new PushDeviceStore(dependencies.engine.store.db);
  // Lazy DDL on the first push read would count as a data mutation in the middle of a read-only call.
  store.prepare().catch((error) => console.error("Push device table is unavailable:", error));
  const assistantLedger = new AssistantPushLedger(dependencies.engine.store.db);
  assistantLedger
    .prepare()
    .catch((error) => console.error("Assistant push ledger is unavailable:", error));
  const approvals = new ApprovalRegistry(Date.now, new ApprovalStore(dependencies.engine.store.db));
  const pushNotifications = new PushNotifications({
    store,
    assistantLedger,
    approvals,
    telegram: () =>
      tickAssistantTelegram({
        assistant: dependencies.assistant,
        social: dependencies.social,
        ledger: assistantLedger,
        execute: (input) => dependencies.executeBackgroundEffect(input),
        status: (source) => dependencies.assistantBackgroundEffect.status(source),
        withSources: async (notification, threadId, accountId, effect) => {
          const disclose = dependencies.assistantPorts.withSummarySourceDisclosure;
          if (!disclose) throw new Error("Native notification source disclosure is unavailable.");
          const account = await dependencies.social.get<SocialAccount>("account", accountId);
          if (!account.assistantGrant)
            throw new Error("Telegram Assistant account access is unavailable.");
          const projects = await Promise.all(
            [
              ...new Set([
                ...(notification.projectIds ?? []),
                ...(notification.projectId ? [notification.projectId] : []),
              ]),
            ].map(async (projectId) => ({
              projectId,
              cwd: (await dependencies.engine.store.project(projectId)).cwd,
            })),
          );
          return disclose(
            threadId,
            projects,
            [{ accountId, version: account.assistantGrant.version }],
            effect,
          );
        },
      }),
    assistant: async () => {
      const assistant = dependencies.assistant;
      return assistant.notifications(await assistant.profile());
    },
    environmentId: dependencies.engine.store.environmentId,
    sessions: async () => {
      const projects = await dependencies.engine.store.projects();
      // Bounded fan-out, as in `inbox.list`: each list may read desktop state.
      const lists: HostSessionSummary[][] = [];
      let next = 0;
      await Promise.all(
        Array.from({ length: Math.min(4, projects.length) }, async () => {
          for (;;) {
            const index = next++;
            if (index >= projects.length) return;
            lists[index] = (await dependencies.projectSessionList(projects[index].id)).list;
          }
        }),
      );
      return lists.flat();
    },
  });
  pushNotifications.start();
  return { pushDevices: store, pushNotifications, approvals };
}
