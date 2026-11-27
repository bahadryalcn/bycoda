import type {
  SocialAccount,
  SocialContact,
  SocialThread,
} from "../../../src/features/social/model/social";
import type { SocialActionContext } from "../core/social-actions";

export type InboxView = {
  accounts: SocialAccount[];
  accountById: Map<string, SocialAccount>;
  contactById: Map<string, SocialContact>;
  /** Threads the principal may see. Same rule as SocialService.visibleThreads. */
  threads: SocialThread[];
};

/** Account visibility comes from `accounts(p)`; thread visibility is the owner's, or the principal's project. */
function threadVisible(
  ctx: SocialActionContext,
  accountById: Map<string, SocialAccount>,
  thread: SocialThread,
): boolean {
  return (
    accountById.has(thread.accountId) &&
    (ctx.principal.kind === "owner" || thread.projectId === ctx.principal.projectId)
  );
}

/**
 * Loads the accounts, contacts and threads one principal may read.
 * shortcut: full kind scans, as SocialService.visibleThreads does, for the unified list only.
 * Upgrade to a paged, SQL-filtered list query; per-conversation operations use `loadThread` and
 * `loadPersonThreads`.
 */
export async function loadInboxView(ctx: SocialActionContext): Promise<InboxView> {
  const accounts = await ctx.service.accounts(ctx.principal);
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const contacts = await ctx.store.legacyRecords<SocialContact>("contact");
  const threads = await ctx.store.legacyRecords<SocialThread>("thread");
  return {
    accounts,
    accountById,
    contactById: new Map(contacts.map((contact) => [contact.id, contact])),
    threads: threads.filter((thread) => threadVisible(ctx, accountById, thread)),
  };
}

/**
 * Reads one conversation and its account by id, with the same visibility rule as the full view.
 * Unknown and invisible conversations share one message, so a caller cannot probe ids.
 */
export async function loadThread(
  ctx: SocialActionContext,
  threadId: string,
): Promise<{ thread: SocialThread; account: SocialAccount }> {
  const accounts = await ctx.service.accounts(ctx.principal);
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const thread = await ctx.store.getThread(threadId);
  const account =
    thread && threadVisible(ctx, accountById, thread)
      ? accountById.get(thread.accountId)
      : undefined;
  if (!thread || !account) throw new Error("Conversation not found.");
  return { thread, account };
}

/**
 * Readable conversations whose contact is one of `handles`, each with its contact and account.
 * Fetches only those rows, so cost follows the person, not the whole inbox.
 */
export async function loadPersonThreads(
  ctx: SocialActionContext,
  accounts: readonly SocialAccount[],
  handles: readonly { accountId: string; platformId: string }[],
): Promise<{ thread: SocialThread; contact: SocialContact; account: SocialAccount }[]> {
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const platformIdsByAccount = new Map<string, string[]>();
  for (const handle of handles) {
    if (!accountById.has(handle.accountId)) continue;
    platformIdsByAccount.set(handle.accountId, [
      ...(platformIdsByAccount.get(handle.accountId) ?? []),
      handle.platformId,
    ]);
  }
  const result: { thread: SocialThread; contact: SocialContact; account: SocialAccount }[] = [];
  for (const [accountId, platformIds] of platformIdsByAccount)
    for (const { thread, contact } of await ctx.store.threadsForHandles(accountId, platformIds)) {
      const account = accountById.get(thread.accountId);
      if (account && threadVisible(ctx, accountById, thread))
        result.push({ thread, contact, account });
    }
  return result;
}

/** The newest event of a conversation, whatever order the events were stored in. */
export function lastEvent(thread: SocialThread): SocialThread["events"][number] | undefined {
  let last: SocialThread["events"][number] | undefined;
  for (const event of thread.events) if (!last || event.at >= last.at) last = event;
  return last;
}
