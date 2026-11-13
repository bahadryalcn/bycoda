import type { AssistantNotificationTarget } from "../../../src/shared/model/host-contracts/assistant";
import type {
  SocialAccount,
  SocialContact,
  SocialThread,
} from "../../../src/features/social/model/social";
import type { SocialService } from "../social";
import { truncateGraphemes } from "../../../src/shared/lib/text/truncate";

/** Owner-only Assistant settings discovery on the captured Host; never creates grants or conversations. */
export async function listAssistantTelegramTargets(
  social: SocialService,
  roomThreadId: string | undefined,
): Promise<AssistantNotificationTarget[]> {
  if (!roomThreadId) return [];
  await social.ready;
  const accounts = new Map<string, SocialAccount>();
  for (const account of await social.list<SocialAccount>("account")) {
    const grant = account.assistantGrant;
    if (
      account.platform !== "telegram" ||
      !grant?.permissions.includes("read") ||
      !grant.permissions.includes("draft")
    )
      continue;
    if (
      !(await social.assistantAccountProofsValid(roomThreadId, [
        { accountId: account.id, version: grant.version },
      ]))
    )
      continue;
    try {
      social.capability(account, "message.start");
    } catch {
      continue;
    }
    accounts.set(account.id, account);
  }
  if (accounts.size === 0) return [];
  const rows = await social.store.db
    .prepare(
      "SELECT value FROM social_records WHERE kind='thread' AND json_extract(value,'$.kind')='message' AND json_extract(value,'$.projectId') IS NULL AND json_extract(value,'$.accountId') IN (SELECT value FROM json_each(?)) ORDER BY json_extract(value,'$.lastInboundAt') DESC,id LIMIT 200",
    )
    .all(JSON.stringify([...accounts.keys()]));
  const result: AssistantNotificationTarget[] = [];
  for (const row of rows) {
    const thread = JSON.parse(String(row.value)) as SocialThread;
    const account = accounts.get(thread.accountId);
    if (!account || thread.replyAllowed === false) continue;
    const contact = await social.get<SocialContact>("contact", thread.contactId);
    if (contact.accountId !== account.id || contact.optedOut) continue;
    result.push({
      accountId: account.id,
      accountLabel: truncateGraphemes(account.name, 150),
      conversationId: thread.id,
      conversationLabel: truncateGraphemes(contact.name, 150),
    });
  }
  return result;
}
