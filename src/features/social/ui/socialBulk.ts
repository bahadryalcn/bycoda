import type { HostProject } from "../../connections/model/protocol";
import type {
  SocialContact,
  SocialDraft,
  SocialPolicy,
  SocialSnapshot,
  SocialThread,
} from "../model/social";
import type { SocialClient } from "../model/socialClient";
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
      if (!snapshot.hostOnline) reason = "Host bağlantısı yok.";
      else if (!contact || contact.accountId !== target.accountId)
        reason = "Kişi bu hesaba bağlı değil.";
      else if (contact.optedOut) reason = "Bu kişi iletişim istemiyor.";
      else if (!account?.connected || account.paused) reason = "Hesap bağlı değil veya durduruldu.";
      else if (account.expiresAt !== undefined && account.expiresAt <= now)
        reason = "Hesap bağlantısının süresi doldu.";
      else if (!projectId || !projects.some((project) => project.id === projectId))
        reason = "Erişilebilir bir proje seçin.";
      else if (!contact.projectIds.includes(projectId))
        reason = "Kişi seçilen projeye bağlı değil.";
      else if (!account.grants[projectId]?.includes("draft"))
        reason = "Bu proje için taslak izni yok.";
      else if (
        options.kind === "reply" &&
        (!thread || thread.accountId !== target.accountId || thread.contactId !== target.contactId)
      )
        reason = "Konuşma eşleşmesi geçersiz.";
      else if (options.kind === "reply" && thread?.reviewReason)
        reason = "Konuşmanın proje eşleşmesini inceleyin.";
      else if (
        options.kind === "reply" &&
        (!contact.replyEligible || thread?.replyAllowed === false)
      )
        reason = "Bu konuşmaya yanıt izni yok.";
      else if (options.kind === "reply" && thread?.replyUntil && thread.replyUntil <= now)
        reason = "Yanıt süresi doldu.";
      else if (
        options.kind === "reply" &&
        thread?.kind === "message" &&
        (account.platform === "instagram" || account.platform === "facebook") &&
        !thread.replyUntil
      )
        reason = "Geçerli bir yanıt süresi yok.";
      else if (
        options.kind === "reply" &&
        !thread?.hasInbound && !thread?.events.some((event) => event.direction === "inbound")
      )
        reason = "Yanıtlanacak gelen ileti yok.";
      else if (
        options.kind === "message" &&
        (!contact.consent?.allowed || !contact.consent.source || !contact.consent.at)
      )
        reason = "Yeni mesaj için kayıtlı iletişim izni yok.";
      else if (options.kind === "comment" && !contact.commentEligible)
        reason = "Yorum uygunluğu doğrulanmadı.";
      else if (capability?.status !== "available")
        reason =
          account.connection === "browser" && options.kind !== "comment"
            ? "X tarayıcı bağlantısı mesajları ve gelen yorumları okuyamaz. Resmî API bağlantısı gerekli."
            : capability?.reason || "Hesap bu işlemi desteklemiyor.";
      else if (options.kind === "comment" && !options.postIds[target.key]?.trim())
        reason = "Yorum yapılacak gönderi kimliğini girin.";
      else if (policyErrors[target.accountId]) reason = policyErrors[target.accountId];
      else if (!policy) reason = "Hesap sınırları yükleniyor.";
      else if (
        options.factIds?.some(
          (id) =>
            !snapshot.profiles
              .find((profile) => profile.projectId === projectId)
              ?.facts.some((fact) => fact.id === id),
        )
      )
        reason = "Kaynak bilgi bu projede bulunamadı.";
      else if (!options.text.trim()) reason = "İçerik yazın.";
      else if (limit !== undefined && socialCharacterCount(options.text) > limit)
        reason = `Metin ${limit} karakter sınırını aşıyor.`;
      return { target, name: contact?.name ?? "Kişi bulunamadı", projectId, limit, reason };
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
        errors[accountId] = "Hesap sınırları alınamadı. Yeniden deneyin.";
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
        reason: error instanceof Error ? error.message : "Taslak hazırlanamadı.",
      };
    }
    publish();
  }
  return rows;
}
