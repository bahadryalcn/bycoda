import type { HostProject } from "../../connections/model/protocol";
import type {
  SocialContact,
  SocialDraft,
  SocialPolicy,
  SocialSnapshot,
  SocialThread,
} from "../model/social";
import type { SocialClient } from "../model/socialClient";
import { t } from "../../../shared/i18n";
import { socialCharacterCount, socialLimit } from "../model/socialPolicy";

export type BulkKind = "reply" | "message" | "comment";
export type BulkTarget = { key: string; accountId: string; contactId: string; threadId?: string };
export type BulkOptions = {
  targets: BulkTarget[];
  kind: BulkKind;
  text: string;
  projectId: string;
  postIds: Record<string, string>;
  factIds?: string[];
};
export type BulkPlan = {
  target: BulkTarget;
  name: string;
  projectId: string;
  limit?: number;
  reason: string;
};
export type BulkResult = BulkPlan & {
  status: "queued" | "running" | "succeeded" | "skipped" | "failed";
  requestId: string;
  draft?: SocialDraft;
};
export const contactTarget = (contact: SocialContact): BulkTarget => ({
  key: `contact:${contact.id}`,
  accountId: contact.accountId,
  contactId: contact.id,
});
export const threadTarget = (thread: SocialThread): BulkTarget => ({
  key: `thread:${thread.id}`,
  accountId: thread.accountId,
  contactId: thread.contactId,
  threadId: thread.id,
});

/** Eligibility is shown before preparation; the host remains the final authority. */
export function planBulkDrafts(
  options: BulkOptions,
  snapshot: SocialSnapshot,
  projects: HostProject[],
  policies: Record<string, SocialPolicy>,
  policyErrors: Record<string, string> = {},
  now = Date.now(),
): BulkPlan[] {
  const contacts = new Map(
    [...(snapshot.related?.contacts ?? []), ...snapshot.contacts].map((item) => [item.id, item]),
  );
  const accounts = new Map(snapshot.accounts.map((item) => [item.id, item]));
  const threads = new Map(
    [...(snapshot.related?.threads ?? []), ...snapshot.threads].map((item) => [item.id, item]),
  );
  return [...new Map(options.targets.map((target) => [target.key, target])).values()].map(
    (target) => {
      const contact = contacts.get(target.contactId);
      const account = accounts.get(target.accountId);
      const thread = target.threadId ? threads.get(target.threadId) : undefined;
      const projectId = options.kind === "reply" ? (thread?.projectId ?? "") : options.projectId;
      const operation =
        options.kind === "message"
          ? "message.start"
          : options.kind === "comment"
            ? "comment"
            : thread?.kind === "message"
              ? "message.reply"
              : "reply";
      const capability = snapshot.capabilities[target.accountId]?.find(
        (item) => item.operation === operation,
      );
      const policy = policies[target.accountId];
      const limit = policy
        ? socialLimit(
            policy,
            options.kind === "message" || (options.kind === "reply" && thread?.kind === "message")
              ? "message"
              : "comment",
          )
        : undefined;
      let reason = "";
      if (!snapshot.hostOnline) reason = t("The host is not connected.");
      else if (!contact || contact.accountId !== target.accountId)
        reason = t("This contact is not linked to this account.");
      else if (contact.optedOut) reason = t("This contact has opted out of contact.");
      else if (!account?.connected || account.paused)
        reason = t("The account is not connected or is paused.");
      else if (account.expiresAt !== undefined && account.expiresAt <= now)
        reason = t("The account connection has expired.");
      else if (!projectId || !projects.some((project) => project.id === projectId))
        reason = t("Select an accessible project.");
      else if (!contact.projectIds.includes(projectId))
        reason = t("This contact is not linked to the selected project.");
      else if (!account.grants[projectId]?.includes("draft"))
        reason = t("There is no draft permission for this project.");
      else if (
        options.kind === "reply" &&
        (!thread || thread.accountId !== target.accountId || thread.contactId !== target.contactId)
      )
        reason = t("The conversation match is invalid.");
      else if (options.kind === "reply" && thread?.reviewReason)
        reason = t("Review the conversation's project match.");
      else if (
        options.kind === "reply" &&
        (!contact.replyEligible || thread?.replyAllowed === false)
      )
        reason = t("Replying to this conversation is not allowed.");
      else if (
        options.kind === "reply" &&
        account.connection !== "browser" &&
        thread?.replyUntil &&
        thread.replyUntil <= now
      )
        reason = t("The reply window has expired.");
      else if (
        options.kind === "reply" &&
        thread?.kind === "message" &&
        account.connection !== "browser" &&
        (account.platform === "instagram" || account.platform === "facebook") &&
        !thread.replyUntil
      )
        reason = t("There is no valid reply window.");
      else if (
        options.kind === "reply" &&
        !thread?.hasInbound &&
        !thread?.events.some((event) => event.direction === "inbound")
      )
        reason = t("There is no inbound message to reply to.");
      else if (
        options.kind === "message" &&
        (!contact.consent?.allowed || !contact.consent.source || !contact.consent.at)
      )
        reason = t("There is no recorded contact consent for a new message.");
      else if (options.kind === "comment" && !contact.commentEligible)
        reason = t("Comment eligibility has not been verified.");
      else if (capability?.status !== "available")
        reason = capability?.reason || t("The account does not support this operation.");
      else if (options.kind === "comment" && !options.postIds[target.key]?.trim())
        reason = t("Enter the ID of the post to comment on.");
      else if (policyErrors[target.accountId]) reason = policyErrors[target.accountId];
      else if (!policy) reason = t("Account limits are loading.");
      else if (
        options.factIds?.some(
          (id) =>
            !snapshot.profiles
              .find((profile) => profile.projectId === projectId)
              ?.facts.some((fact) => fact.id === id),
        )
      )
        reason = t("The source fact was not found in this project.");
      else if (!options.text.trim()) reason = t("Write the content.");
      else if (limit !== undefined && socialCharacterCount(options.text) > limit)
        reason = t("The text exceeds the {p0} character limit.", { p0: limit });
      return { target, name: contact?.name ?? t("Contact not found"), projectId, limit, reason };
    },
  );
}

export async function readBulkPolicies(client: SocialClient, targets: BulkTarget[]) {
  const policies: Record<string, SocialPolicy> = {};
  const errors: Record<string, string> = {};
  await Promise.all(
    [...new Set(targets.map((target) => target.accountId))].map(async (accountId) => {
      try {
        const result = await client.request<{ effective: SocialPolicy }>("policy.get", {
          accountId,
        });
        if (!result?.effective || typeof result.effective !== "object")
          throw new Error("Invalid policy response");
        policies[accountId] = result.effective;
      } catch {
        errors[accountId] = t("Account limits could not be loaded. Try again.");
      }
    }),
  );
  return { policies, errors };
}

/** Retrying preserves successful rows and request IDs, including a lost response. */
export async function prepareBulkDrafts(
  client: SocialClient,
  options: BulkOptions,
  snapshot: SocialSnapshot,
  projects: HostProject[],
  previous: BulkResult[] = [],
  onResult?: (rows: BulkResult[]) => void,
): Promise<BulkResult[]> {
  const { policies, errors } = await readBulkPolicies(client, options.targets);
  const plan = planBulkDrafts(options, snapshot, projects, policies, errors);
  let rows: BulkResult[] = plan.map((item) => {
    const before = previous.find((row) => row.target.key === item.target.key);
    if (before && before.status !== "failed") return before;
    return {
      ...item,
      requestId: before?.requestId ?? crypto.randomUUID(),
      status: item.reason ? "skipped" : "queued",
    };
  });
  const publish = () => onResult?.([...rows]);
  publish();
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    if (row.status !== "queued") continue;
    rows[index] = { ...row, status: "running" };
    publish();
    try {
      const draft = await client.request<SocialDraft>(
        `${options.kind === "reply" ? "replies" : options.kind === "message" ? "messages" : "comments"}.draft`,
        options.kind === "reply"
          ? { threadId: row.target.threadId, text: options.text, factIds: options.factIds ?? [] }
          : {
              accountId: row.target.accountId,
              contactId: row.target.contactId,
              projectId: row.projectId,
              text: options.text,
              ...(options.kind === "comment" ? { postId: options.postIds[row.target.key] } : {}),
            },
        row.requestId,
      );
      rows[index] = { ...row, status: "succeeded", draft };
    } catch (error) {
      rows[index] = {
        ...row,
        status: "failed",
        reason: error instanceof Error ? error.message : t("The draft could not be prepared."),
      };
    }
    publish();
  }
  return rows;
}
