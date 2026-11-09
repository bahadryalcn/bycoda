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

/**
 * Loads the accounts, contacts and threads one principal may read. Account visibility comes from
 * `accounts(p)`; thread visibility is the owner's, or the principal's project for everyone else.
 */
export async function loadInboxView(ctx: SocialActionContext): Promise<InboxView> {
  const accounts = await ctx.service.accounts(ctx.principal);
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  // shortcut: full kind scans, as SocialService.visibleThreads already does. Upgrade to an indexed
  // thread query when the audience store exposes one (see the phase 4 done file, requests).
  const contacts = await ctx.store.legacyRecords<SocialContact>("contact");
  const threads = await ctx.store.legacyRecords<SocialThread>("thread");
  return {
    accounts,
    accountById,
    contactById: new Map(contacts.map((contact) => [contact.id, contact])),
    threads: threads.filter(
      (thread) =>
        accountById.has(thread.accountId) &&
        (ctx.principal.kind === "owner" || thread.projectId === ctx.principal.projectId),
    ),
  };
}

/** Unknown and invisible conversations share one message, so a caller cannot probe ids. */
export function findVisibleThread(view: InboxView, threadId: string): SocialThread {
  const thread = view.threads.find((item) => item.id === threadId);
  if (!thread) throw new Error("Conversation not found.");
  return thread;
}

/** The newest event of a conversation, whatever order the events were stored in. */
export function lastEvent(thread: SocialThread): SocialThread["events"][number] | undefined {
  let last: SocialThread["events"][number] | undefined;
  for (const event of thread.events) if (!last || event.at >= last.at) last = event;
  return last;
}
