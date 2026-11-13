import { createHash } from "node:crypto";
import type {
  SocialAccount,
  SocialContact,
  SocialJob,
  SocialThread,
} from "../../../src/features/social/model/social";
import type { BackgroundEffectActor } from "../../assistant/native/assistant-background-effect";
import { checkEligibility } from "../execution/social-eligibility";
import { assertContactSendable } from "../execution/social-job-gates";
import type { SocialService } from "../social";

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export type AssistantTelegramDelivery = {
  operationId: string;
  notificationId: string;
  accountId: string;
  conversationId: string;
  text: string;
  threadId: string;
};

/** Canonical Social records bind the Native exact-effect request. No owner principal or grant is fabricated. */
export async function prepareAssistantTelegramDelivery(
  social: SocialService,
  input: AssistantTelegramDelivery,
  current: () => Promise<boolean>,
) {
  await social.ready;
  const read = async () => {
    if (!(await current())) throw new Error("Assistant notification was withdrawn.");
    const account = await social.get<SocialAccount>("account", input.accountId);
    const thread = await social.get<SocialThread>("thread", input.conversationId);
    const contact = await social.get<SocialContact>("contact", thread.contactId);
    const grant = account.assistantGrant;
    if (
      account.platform !== "telegram" ||
      !account.connected ||
      account.paused ||
      account.executorId !== social.store.environmentId ||
      thread.accountId !== account.id ||
      thread.kind !== "message" ||
      thread.projectId ||
      thread.replyAllowed === false ||
      contact.accountId !== account.id ||
      !grant?.permissions.includes("read") ||
      !grant.permissions.includes("draft") ||
      (await social.setting("stopped")) === "true" ||
      (await social.setting("sending")) !== "true" ||
      !(await social.assistantAccountProofsValid(input.threadId, [
        { accountId: account.id, version: grant.version },
      ])) ||
      !social.roomSendSourceAdmission ||
      !(await social.roomSendSourceAdmission({
        threadId: input.threadId,
        accountId: account.id,
        accountGrantVersion: grant.version,
        projectId: null,
        projectCwd: null,
      }))
    )
      throw new Error("Assistant Telegram source is unavailable or changed.");
    checkEligibility(social, account, contact, "message", thread, true);
    await assertContactSendable(social, contact.id, "telegram", "message", thread);
    await social.assertLength(account, "message", input.text);
    const policy = await social.policy(account);
    if (!(await current())) throw new Error("Assistant notification was withdrawn.");
    return { account, thread, contact, policy };
  };
  const snapshot = await read();
  const snapshotHash = digest(snapshot);
  return {
    operation: {
      action: "social.send" as const,
      input: {
        accountId: input.accountId,
        conversationId: input.conversationId,
        notificationId: input.notificationId,
        bodyDigest: digest(input.text),
        snapshotHash,
      },
    },
    /** Called only by the authenticated Native callback while its consent/revocation lease remains held. */
    execute: async (actor: BackgroundEffectActor) => {
      const check = async () => {
        if (
          !(await actor.authorized()) ||
          digest(await read()) !== snapshotHash ||
          !(await actor.authorized())
        )
          throw new Error("Assistant Telegram authority or source changed.");
      };
      await check();
      const credential = await social.credentialFor(snapshot.account.id);
      if (
        !credential ||
        (credential.expiresAt !== undefined && credential.expiresAt <= social.now())
      )
        throw new Error("Telegram account credentials expired.");
      await check();
      const id = `assistant-notification:${digest(input.operationId)}`;
      const job: SocialJob = {
        id,
        operationId: input.operationId,
        dedupeKey: id,
        accountId: input.accountId,
        projectIds: [],
        provider: "assistant",
        actorId: `assistant-thread:${input.threadId}`,
        kind: "message",
        contactId: snapshot.contact.id,
        payload: {
          text: input.text,
          media: [],
          recipientId: snapshot.contact.platformId,
          threadId: snapshot.thread.platformThreadId,
        },
        status: "review",
        reviewReason: "needs_human",
        scheduledAt: social.now(),
        attempts: 1,
        dispatchedAt: social.now(),
        createdAt: social.now(),
      };
      await social.transaction(async () => {
        if (await social.store.db.prepare("SELECT id FROM social_jobs_all WHERE id=?").get(id))
          throw new Error("Assistant Telegram occurrence already dispatched; inspect its receipt.");
        await check();
        await social.writeJob(job);
      });
      try {
        await check();
        const result = await social.adapterFor(snapshot.account).send(
          snapshot.account,
          job,
          credential.accessToken,
          async () => {
            throw new Error("Assistant notifications contain no media.");
          },
          undefined,
          check,
        );
        if (!result.platformId) throw new Error("Telegram delivery receipt is unknown.");
        job.status = "succeeded";
        job.platformId = result.platformId;
        delete job.reviewReason;
        await social.writeJob(job);
        return { accepted: true, jobId: id };
      } catch {
        job.error = "Telegram delivery receipt is unknown. Review before another send.";
        await social.writeJob(job);
        return { accepted: false, jobId: id };
      }
    },
  };
}
