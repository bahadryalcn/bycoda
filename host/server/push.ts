import { ApprovalRegistry } from "../approvals/approval-registry";
import { ApprovalStore } from "../approvals/approval-store";
import { AssistantPushLedger } from "../push/push-assistant";
import { createSocialPushSource, SocialPushLedger } from "../push/push-social";
import { PushNotifications } from "../push/push-service";
import { createPushSessionInventory } from "../push/push-session-inventory";
import { PushDeviceStore } from "../push/push-store";
import { tickAssistantTelegram } from "../push/push-telegram";
import type { SocialAccount } from "../../src/features/social/model/social";
import type { ServerBindings } from "./bindings";

export function createPushRuntime(
  dependencies: Pick<
    ServerBindings,
    | "assistant"
    | "engine"
    | "desktop"
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
  const socialLedger = new SocialPushLedger(dependencies.engine.store.db);
  socialLedger
    .prepare()
    .catch((error) => console.error("Social push ledger is unavailable:", error));
  const approvals = new ApprovalRegistry(Date.now, new ApprovalStore(dependencies.engine.store.db));
  // Project lists are re-read only after a store/desktop change or the safety interval.
  const sessionInventory = createPushSessionInventory({
    projectIds: async () => (await dependencies.engine.store.projects()).map((project) => project.id),
    list: async (projectId) => (await dependencies.projectSessionList(projectId)).list,
    watch: (changed) => {
      const unsubscribe = dependencies.engine.store.subscribeChanges(changed);
      // Chained like the subscription hub's own hook, so desktop live changes also reach both.
      const live = dependencies.desktop.live;
      const previous = live.onChange;
      let active = true;
      const handler = (sessionIds: string[]) => {
        previous?.(sessionIds);
        if (active) changed();
      };
      live.onChange = handler;
      return () => {
        active = false;
        unsubscribe();
        if (live.onChange === handler) live.onChange = previous;
      };
    },
  });
  const pushNotifications = new PushNotifications({
    store,
    assistantLedger,
    social: createSocialPushSource(dependencies.social),
    socialLedger,
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
    sessions: () => sessionInventory.read(),
    onStop: () => sessionInventory.close(),
  });
  pushNotifications.start();
  return { pushDevices: store, pushNotifications, approvals };
}
