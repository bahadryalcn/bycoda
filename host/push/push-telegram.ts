import { createHash } from "node:crypto";
import type { HostAssistant } from "../assistant/service";
import type { BackgroundEffectActor } from "../assistant/native/assistant-background-effect";
import type {
  BackgroundEffectStatus,
  BackgroundEffectSource,
} from "../assistant/native/assistant-background-effect";
import type { AssistantNotification } from "../../src/shared/model/host-contracts/assistant";
import type { SocialService } from "../social/social";
import { prepareAssistantTelegramDelivery } from "../social/notifications/assistant-telegram-delivery";
import { AssistantPushLedger } from "./push-assistant";
import { hostWarnDeduped } from "../diagnostics/log-dedupe";

export type TelegramBackgroundEffect = (input: {
  operationId: string;
  operation: { action: "social.send"; input: Record<string, unknown> };
  execute: (actor: BackgroundEffectActor) => Promise<unknown>;
}) => Promise<unknown>;

/** Telegram uses the same durable occurrence policy; Native alone admits the outbound effect. */
export async function tickAssistantTelegram(input: {
  assistant: HostAssistant;
  social: SocialService;
  ledger: AssistantPushLedger;
  execute: TelegramBackgroundEffect;
  status: (source: BackgroundEffectSource) => Promise<BackgroundEffectStatus>;
  withSources: <T>(
    notification: AssistantNotification,
    threadId: string,
    accountId: string,
    effect: (valid: () => boolean) => Promise<T>,
  ) => Promise<T>;
  now?: () => number;
}): Promise<void> {
  const { assistant, social, ledger } = input;
  const profile = await assistant.profile();
  const target = profile.notificationTelegram;
  const room = await assistant.globalRoomBinding();
  if (
    !profile.enabled ||
    !profile.setupComplete ||
    !target ||
    !(await assistant.notificationDeliveryActive())
  )
    return;
  const channel = `telegram:${createHash("sha256").update(JSON.stringify(target)).digest("hex")}`;
  for (const notification of await assistant.notifications(profile)) {
    // Telegram has no phone-specific quiet override. Current Host quiet/DND and privacy verdicts apply.
    if (!notification.eligible) continue;
    try {
      const unconfirmed = await ledger.unconfirmed(channel, notification.id);
      let retrySource: BackgroundEffectSource | null = null;
      if (unconfirmed !== null) {
        const original = await ledger.operation(channel, notification.id, unconfirmed);
        // Older reservations without a captured envelope cannot establish a known-zero outcome.
        if (!original) continue;
        const status = await input.status(original);
        if (status.state === "completed") {
          if ((status.result as { accepted?: unknown } | null)?.accepted === true)
            await ledger.accept(channel, notification.id, unconfirmed);
          continue;
        }
        if (
          status.state === "unknown" ||
          status.state === "denied" ||
          (status.state === "prepared" && status.expiresAt > (input.now ?? Date.now)())
        )
          continue;
        retrySource = original;
      }
      if (!room) continue;
      await input.withSources(notification, room.id, target.accountId, async (sourceValid) => {
        const current = async () => {
          if (!sourceValid()) return false;
          const saved = await assistant.profile();
          if (
            !saved.enabled ||
            !saved.setupComplete ||
            !(await assistant.notificationDeliveryActive()) ||
            JSON.stringify(saved.notificationTelegram) !== JSON.stringify(target) ||
            (await assistant.globalRoomBinding())?.id !== room.id
          )
            return false;
          const pending = (await assistant.notifications(saved)).find(
            (item) => item.id === notification.id,
          );
          return (
            sourceValid() &&
            !!pending?.eligible &&
            pending.title === notification.title &&
            pending.body === notification.body
          );
        };
        const text = [notification.title, notification.body].filter(Boolean).join("\n\n");
        // Source validation happens before reserving: disconnected or revoked accounts cannot consume an occurrence.
        const identity = createHash("sha256")
          .update(JSON.stringify([channel, notification.id]))
          .digest("hex");
        const preliminary = await prepareAssistantTelegramDelivery(
          social,
          {
            operationId: identity,
            notificationId: notification.id,
            ...target,
            text,
            threadId: room.id,
          },
          current,
        );
        if (retrySource && unconfirmed !== null) {
          // A retry keeps the original operation and Room. Fresh source authority may narrow it, never replace it.
          if (
            retrySource.environmentId !== social.store.environmentId ||
            retrySource.threadId !== room.id ||
            retrySource.action !== preliminary.operation.action ||
            JSON.stringify(retrySource.input) !== JSON.stringify(preliminary.operation.input)
          )
            return;
          await ledger.releaseUnsent(channel, notification.id, unconfirmed);
        }
        const occurrence = await ledger.reserve(channel, notification, (input.now ?? Date.now)());
        if (occurrence === null) return;
        const operationId = `assistant-notification:${identity}:${occurrence}`;
        await ledger.saveOperation(channel, notification.id, occurrence, {
          environmentId: social.store.environmentId,
          threadId: room.id,
          operationId,
          action: preliminary.operation.action,
          input: preliminary.operation.input,
        });
        await input.execute({
          operationId,
          operation: preliminary.operation,
          execute: async (actor) => {
            if (!(await actor.authorized()) || !(await current()))
              throw new Error("Assistant notification authority changed.");
            const plan = await prepareAssistantTelegramDelivery(
              social,
              {
                operationId,
                notificationId: notification.id,
                ...target,
                text,
                threadId: room.id,
              },
              current,
            );
            if (JSON.stringify(plan.operation) !== JSON.stringify(preliminary.operation))
              throw new Error("Assistant Telegram source changed after Native admission.");
            const result = await plan.execute(actor);
            if (result.accepted) await ledger.accept(channel, notification.id, occurrence);
            return result;
          },
        });
      });
    } catch {
      hostWarnDeduped(
        `Assistant Telegram notification ${notification.id} remains pending; its delivery receipt is retained.`,
      );
    }
  }
}
