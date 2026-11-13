import { randomUUID } from "node:crypto";
import type {
  PublicFact,
  SocialAccount,
  SocialContact,
  SocialDraft,
  SocialProjectProfile,
  SocialRule,
  SocialThread,
} from "../../../src/features/social/model/social";
import type { SocialInbound } from "../../../src/integrations/social/adapter";
import type { SocialPrincipal } from "../social";
import { socialGenerationPrompt } from "../social-generation";
import type { SocialServiceInternals } from "../core/social-internals";
import { finite, hash, sanitizeSocialError, str, UNASSIGNED_REVIEW } from "../core/social-helpers";
import { linkInboundToPeople } from "../audience/audience-ingest";
import { onInbound } from "../outreach/outreach-ingest";

const OPT_OUT =
  /^(stop|unsubscribe|opt out|iletişimi durdur|mesaj gönderme|abonelikten çık)([.!\s]|$)/iu;
const ESCALATE =
  /complaint|refund|şik[aâ]yet|iade|avukat|lawyer|password|token|system prompt|ignore.{0,30}instructions|talimat.{0,30}unut/iu;

/** Stores inbound events once per event ID, then links people and evaluates rules. */
export async function ingestEvents(
  s: SocialServiceInternals,
  accountId: string,
  events: SocialInbound[],
): Promise<number> {
  const account = await s.get<SocialAccount>("account", accountId);
  let count = 0;
  for (const event of events) {
    const eventId = str(event.eventId, "event", 300);
    const key = `${accountId}:${event.kind}:${str(event.threadId, "thread", 300)}`;
    const saved = await s.transaction(async (): Promise<SocialContact | undefined> => {
      if (
        !Number(
          (
            await s.store.db
              .prepare("INSERT OR IGNORE INTO social_events VALUES (?,?,?)")
              .run(accountId, eventId, s.now())
          ).changes,
        )
      )
        return undefined;
      const projects = Object.keys(account.grants).filter((project) =>
        account.grants[project].includes("read"),
      );
      const linked = event.postId
        ? (
            await s.jobArchive.firstJob(
              "account_id=? AND json_extract(value,'$.platformId')=? AND json_array_length(value,'$.projectIds')=1",
              [accountId, event.postId],
            )
          )?.projectIds[0]
        : undefined;
      const projectId = linked ?? (projects.length === 1 ? projects[0] : undefined);
      let contact = (await s.list<SocialContact>("contact")).find(
        (item) => item.accountId === accountId && item.platformId === event.contactId,
      );
      if (!contact)
        contact = {
          id: randomUUID(),
          accountId,
          platformId: str(event.contactId, "contact identity", 300),
          name: str(event.contactName || event.contactId, "contact name", 300),
          source: "api",
          tags: [],
          projectIds: projectId ? [projectId] : [],
          replyEligible: true,
          commentEligible: false,
          optedOut: false,
          history: [],
        };
      const old = (await s.list<SocialThread>("thread")).find((item) => item.id === key);
      const thread: SocialThread = old ?? {
        id: key,
        accountId,
        platformThreadId: event.threadId,
        kind: event.kind,
        contactId: contact.id,
        projectId,
        lastInboundAt: event.at,
        ...(projectId
          ? {}
          : {
              reviewReason: UNASSIGNED_REVIEW,
            }),
        events: [],
      };
      if (event.postId) thread.platformPostId = event.postId;
      if (event.replyAllowed !== undefined) thread.replyAllowed = event.replyAllowed;
      if (thread.contactId !== contact.id) {
        thread.reviewReason = "Conversation contains multiple recipients. Manual review required.";
        delete thread.projectId;
      }
      thread.lastInboundAt = Math.max(
        thread.lastInboundAt,
        finite(event.at, "event timestamp", 1, s.now() + 60000),
      );
      if (event.replyUntil) thread.replyUntil = Math.max(thread.replyUntil ?? 0, event.replyUntil);
      thread.events.push({
        id: eventId,
        platformId: eventId,
        text: str(event.text || "[Attachment without text]", "inbound content"),
        direction: "inbound",
        at: event.at,
      });
      thread.events.sort((a, b) => a.at - b.at);
      thread.events = thread.events.slice(-500);
      if (thread.projectId)
        contact.projectIds = [...new Set([...contact.projectIds, thread.projectId])];
      contact.history.push({
        operationId: eventId,
        kind: `inbound:${event.kind}`,
        at: event.at,
        platformId: eventId,
      });
      contact.history = contact.history.slice(-1000);
      await s.put("contact", contact.id, contact);
      await s.put("thread", thread.id, thread);
      if (event.optedOut || OPT_OUT.test(event.text)) await s.optOut(contact);
      return contact;
    });
    if (saved) {
      count++;
      await runInboundHooks(s, account, event, saved);
      await applyInboundRules(s, key, event);
    }
  }
  return count;
}

/** Audience and outreach hooks run after the inbound record commits. Failures are logged, never thrown into ingest. */
async function runInboundHooks(
  s: SocialServiceInternals,
  account: SocialAccount,
  event: SocialInbound,
  contact: SocialContact,
): Promise<void> {
  const ctx = { store: s.audience, now: s.now(), decisions: s.decisionModels };
  await Promise.all([
    linkInboundToPeople(ctx, account, [event], [contact]).catch((error) =>
      console.error(
        "Social people linking failed; inbound event kept:",
        sanitizeSocialError(error),
      ),
    ),
    onInbound(ctx, account, [event], [contact]).catch((error) =>
      console.error(
        "Social outreach inbound hook failed; inbound event kept:",
        sanitizeSocialError(error),
      ),
    ),
  ]);
}

async function applyInboundRules(
  s: SocialServiceInternals,
  threadId: string,
  event: SocialInbound,
): Promise<void> {
  const thread = await s.get<SocialThread>("thread", threadId);
  if (
    !thread.projectId ||
    thread.reviewReason ||
    (await s.get<SocialContact>("contact", thread.contactId)).optedOut
  )
    return;
  for (const rule of await s.list<SocialRule>("rule")) {
    if (
      !rule.enabled ||
      rule.accountId !== thread.accountId ||
      rule.projectId !== thread.projectId ||
      rule.trigger !== thread.kind ||
      event.at < (rule.activatedAt ?? Infinity) ||
      thread.events.filter((item) => item.direction === "inbound").at(-1)?.id !== event.eventId
    )
      continue;
    const lower = event.text.toLocaleLowerCase();
    const normalized = lower.replace(/[?!.,]+$/g, "").trim();
    const mappings = rule.answers.filter(
      (answer) => normalized === answer.keyword.replace(/[?!.,]+$/g, "").trim(),
    );
    let reason = ESCALATE.test(event.text)
      ? "Complaint, sensitive or instruction-like content requires human review."
      : mappings.length !== 1
        ? "Ambiguous or outside allowed topics."
        : undefined;
    if (rule.stopWords.some((word) => lower.includes(word.toLocaleLowerCase()))) {
      rule.enabled = false;
      rule.pausedReason = "A configured stop condition matched.";
      await s.put("rule", rule.id, rule);
      reason = rule.pausedReason;
    }
    const day = Math.floor(s.now() / 86_400_000) * 86_400_000;
    const quotaDayStart = Math.floor(s.now() / 86_400_000) * 86_400_000;
    if (
      (await s.jobArchive.jobCount(
        "json_extract(value,'$.ruleId')=? AND json_extract(value,'$.createdAt')>=? AND json_extract(value,'$.createdAt')<? AND status!='cancelled'",
        [rule.id, quotaDayStart, quotaDayStart + 86_400_000],
      )) >= rule.dailyLimit
    )
      reason = "Daily automatic reply limit reached.";
    let fact: PublicFact | undefined;
    if (mappings.length === 1) {
      try {
        fact = (await s.facts([rule.projectId], [mappings[0].factId]))[0];
        if (!fact || !rule.topics.includes(fact.topic)) throw new Error("Verified answer changed.");
      } catch {
        reason =
          "Verified answer is missing or outside the allowed topics. Update the rule before reactivating it.";
        rule.enabled = false;
        rule.pausedReason = reason;
        await s.put("rule", rule.id, rule);
      }
    }
    const account = await s.get<SocialAccount>("account", rule.accountId);
    const policy = await s.policy(account, rule);
    if (
      (await s.list<SocialDraft>("draft")).filter(
        (item) =>
          item.generation?.ruleId === rule.id &&
          item.createdAt >= day &&
          item.createdAt < day + 86_400_000,
      ).length >= rule.dailyLimit
    )
      reason = "Daily AI generation limit reached.";
    if (!reason && !policy.agent) {
      try {
        await s.assertLength(account, thread.kind, fact!.text);
      } catch {
        reason =
          "Verified answer exceeds the effective character limit. Review or shorten the verified fact.";
      }
    }
    const draft: SocialDraft = {
      id: randomUUID(),
      accountId: thread.accountId,
      projectId: thread.projectId,
      contactId: thread.contactId,
      threadId,
      inboundEventId: event.eventId,
      kind: "reply",
      text: reason ? "Human review required." : fact!.text,
      factIds: reason ? [] : [fact!.id],
      createdAt: s.now(),
      ruleId: rule.mode === "automatic" && !reason ? rule.id : undefined,
      ...(reason ? { reviewReason: reason } : {}),
    };
    if (!reason && policy.agent) {
      draft.generation = {
        status: "queued",
        agent: policy.agent,
        ruleId: rule.id,
        policySignature: hash(JSON.stringify(policy)),
        prompt: socialGenerationPrompt({
          policy,
          kind: thread.kind,
          brandVoice:
            (await s.list<SocialProjectProfile>("profile")).find(
              (profile) => profile.projectId === rule.projectId,
            )?.brandVoice ?? "",
          fact: fact!,
          automatic: rule.mode === "automatic",
        }),
      };
      draft.text = "AI draft generation queued.";
      draft.reviewReason =
        "Selected AI agent is preparing this reply. Sending is blocked until validation.";
    }
    await s.put("draft", draft.id, draft);
    if (draft.generation) continue;
    if (rule.mode === "automatic" && !reason) {
      // Internal principal carries exact project/account; never derived from event instructions.
      const principal: SocialPrincipal = {
        kind: "owner",
        actorId: `rule:${rule.id}`,
        projectId: rule.projectId,
        provider: "social-rule",
      };
      try {
        const op = randomUUID();
        await s.sendDraft(principal, draft.id, "replies", op);
        await s.audit(principal, "automatic.reply", op, rule.accountId).catch((error) => {
          console.error("Automatic reply audit failed after queueing", error);
        });
      } catch {
        draft.reviewReason =
          "Reply is no longer eligible. Review account permissions and response window.";
        delete draft.ruleId;
        await s.put("draft", draft.id, draft);
      }
    }
  }
}

/** Generates the first queued AI draft. Callers hold the tick's generation barrier. */
export async function generateQueuedDraftOnce(s: SocialServiceInternals): Promise<boolean> {
  // Only the first queued draft is wanted; SQLite finds it without parsing the rest.
  const row = await s.store.db
    .prepare(
      "SELECT value FROM social_records WHERE kind='draft' AND json_extract(value,'$.generation.status')='queued' ORDER BY rowid LIMIT 1",
    )
    .get();
  const draft = row ? (JSON.parse(String(row.value)) as SocialDraft) : undefined;
  if (!draft?.generation) return false;
  const generation = draft.generation;
  const controller = new AbortController();
  s.generationControllers.set(draft.id, controller);
  const check = async () => {
    const rule = await s.get<SocialRule>("rule", generation.ruleId);
    const thread = await s.get<SocialThread>("thread", draft.threadId!);
    const account = await s.get<SocialAccount>("account", draft.accountId);
    if (
      !rule.enabled ||
      account.paused ||
      (await s.setting("stopped")) === "true" ||
      account.executorId !== s.store.environmentId ||
      !draft.projectId ||
      !account.grants[draft.projectId]?.includes("draft") ||
      (await s.get<SocialContact>("contact", draft.contactId)).optedOut ||
      thread.projectId !== draft.projectId ||
      thread.reviewReason ||
      thread.events.filter((item) => item.direction === "inbound").at(-1)?.id !==
        draft.inboundEventId ||
      hash(JSON.stringify(await s.policy(account, rule))) !== generation.policySignature ||
      controller.signal.aborted
    )
      throw new Error(
        "Generation authorization, policy or incoming event changed. Review a new draft.",
      );
    return { rule, thread, account };
  };
  try {
    await check();
    if (!s.generateText)
      throw new Error(
        "The selected agent's isolated text runner is unavailable on this host. No other provider was substituted.",
      );
    generation.status = "running";
    await s.put("draft", draft.id, draft);
    const timer = setTimeout(() => controller.abort(), 90000);
    let output: string;
    try {
      output = await Promise.race([
        s.generateText(generation.agent, generation.prompt, controller.signal, {
          operationId: `draft:${draft.id}`,
          actorScope: JSON.stringify(["rule", generation.ruleId, draft.projectId, draft.accountId]),
        }),
        new Promise<never>((_, reject) =>
          controller.signal.addEventListener(
            "abort",
            () => reject(new Error("AI generation stopped or timed out.")),
            { once: true },
          ),
        ),
      ]);
    } catch {
      // Provider exceptions may contain credentials or private runtime details.
      throw new Error(
        "AI generation failed or stopped. Check the selected agent/model on this host; no fallback provider was used.",
      );
    } finally {
      clearTimeout(timer);
    }
    const { rule, thread, account } = await check();
    if (typeof output !== "string" || output.length > 30000)
      throw new Error("AI reply has invalid output size.");
    let response: Record<string, unknown>;
    try {
      response = JSON.parse(output);
    } catch {
      throw new Error("AI reply must be a JSON text object; review required.");
    }
    if (
      !response ||
      Array.isArray(response) ||
      Object.keys(response).some((key) => !["text", "review"].includes(key)) ||
      response.review ||
      typeof response.text !== "string" ||
      !response.text.trim()
    )
      throw new Error("AI reply needs human review.");
    draft.text = str(response.text, "AI reply text");
    await s.assertLength(account, thread.kind, draft.text);
    if (
      rule.mode === "automatic" &&
      (!draft.projectId ||
        !(await s.facts([draft.projectId], draft.factIds)).some(
          (fact) => fact.text.trim() === draft.text,
        ))
    )
      throw new Error("AI rewrote the verified answer. Human approval is required before sending.");
    generation.status = "completed";
    delete draft.reviewReason;
    await s.put("draft", draft.id, draft);
    if (rule.mode === "automatic") {
      const principal: SocialPrincipal = {
        kind: "owner",
        actorId: `rule:${rule.id}`,
        projectId: rule.projectId,
        provider: generation.agent.provider,
      };
      const operationId = randomUUID();
      await s.sendDraft(principal, draft.id, "replies", operationId);
      await s.audit(principal, "automatic.reply", operationId, draft.accountId).catch((error) => {
        console.error("Automatic reply audit failed after queueing", error);
      });
    }
  } catch (error) {
    generation.status = "review";
    draft.reviewReason =
      error instanceof Error &&
      /^(Generation |The selected |AI |Social |Invalid AI)/.test(error.message)
        ? error.message
        : "AI generation failed. Check the selected agent/model on this host; no fallback provider was used.";
    delete draft.ruleId;
    await s.put("draft", draft.id, draft);
  } finally {
    s.generationControllers.delete(draft.id);
  }
  return true;
}
