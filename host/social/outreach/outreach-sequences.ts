import { createHash, randomUUID } from "node:crypto";
import type { SocialList, SocialPerson } from "../../../src/features/social/model/audience";
import type {
  OutreachChannel,
  Sequence,
  SequenceStep,
} from "../../../src/features/social/model/outreach";
import type { SocialServiceApi } from "../core/social-service-api";
import { finite, str } from "../core/social-helpers";
import type { SocialPrincipal } from "../social";
import type { SocialAudienceStore } from "../store/social-audience-store";
import { channelInput, HOUR_MS, splitEmailTemplate } from "./outreach-input";
import { startedSettingKey } from "./outreach-pacing";

export const MAX_STEPS = 10;
/** shortcut: one start call enrolls at most this many members; start again to continue. Upgrade: background paging. */
export const MAX_ENROLL_SCAN = 5000;

/** Deterministic id: a person joins a sequence at most once, even when start runs again. */
export function enrollmentId(sequenceId: string, personId: string): string {
  return `enr-${createHash("sha256").update(`${sequenceId}\n${personId}`).digest("hex").slice(0, 40)}`;
}

/** Personal WhatsApp runs through the browser and is not allowed for bulk outreach (bug B11). */
export function isPersonalWhatsApp(account: { platform: string; connection?: string }): boolean {
  return account.platform === "whatsapp" && account.connection === "browser";
}

/** Validates a sequence save. Editing is refused while the sequence runs. */
export async function parseSequence(
  input: Record<string, unknown>,
  deps: {
    store: SocialAudienceStore;
    service: SocialServiceApi;
    principal: SocialPrincipal;
    now: number;
    existing?: Sequence;
  },
): Promise<Sequence> {
  const { store, service, principal, existing } = deps;
  if (existing?.status === "active") throw new Error("Pause the sequence before editing it.");
  const name = str(input.name, "name", 120);
  const listId = str(input.listId, "audience list", 200);
  if (!(await store.getList(listId))) throw new Error("Audience list not found.");
  if (!Array.isArray(input.steps) || input.steps.length < 1 || input.steps.length > MAX_STEPS)
    throw new Error(`Add 1-${MAX_STEPS} steps.`);
  const steps: SequenceStep[] = [];
  for (const raw of input.steps as unknown[])
    steps.push(await parseStep(raw, { store, service, principal }));
  const pacing = input.pacing;
  if (!pacing || typeof pacing !== "object" || Array.isArray(pacing))
    throw new Error("Invalid pacing.");
  const record = pacing as Record<string, unknown>;
  const parsedPacing = {
    perHour: integer(record.perHour, "hourly limit", 1, 500),
    perDay: integer(record.perDay, "daily limit", 1, 5000),
    warmupDays: integer(record.warmupDays, "warm-up days", 0, 90),
  };
  // Only start (not save) moves a sequence to "active"; save may choose draft or paused.
  const requested = input.status as string | undefined;
  if (requested !== undefined && requested !== "draft" && requested !== "paused")
    throw new Error("A sequence is saved as draft or paused; start it to run.");
  const status: Sequence["status"] =
    requested === "paused" || requested === "draft" ? requested : (existing?.status ?? "draft");
  return {
    id: existing?.id ?? randomUUID(),
    name,
    listId,
    steps,
    status,
    stopOnReply: true,
    pacing: parsedPacing,
    createdAt: existing?.createdAt ?? deps.now,
  };
}

function integer(value: unknown, field: string, minimum: number, maximum: number): number {
  const parsed = finite(value, field, minimum, maximum);
  if (!Number.isInteger(parsed)) throw new Error(`Invalid ${field}.`);
  return parsed;
}

/** An email step needs a saved account with an unsubscribe link: every outbound email carries one. */
export async function requireEmailStepAccount(
  store: SocialAudienceStore,
  accountId: string | undefined,
): Promise<void> {
  const account = accountId ? await store.getRecord("email-account", accountId) : undefined;
  if (!account) throw new Error("Email account not found.");
  if (!account.unsubscribeUrl)
    throw new Error("Add an unsubscribe link to this email account before sending.");
}

async function parseStep(
  raw: unknown,
  deps: { store: SocialAudienceStore; service: SocialServiceApi; principal: SocialPrincipal },
): Promise<SequenceStep> {
  const { store, service, principal } = deps;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid step.");
  const step = raw as Record<string, unknown>;
  const channel: OutreachChannel = channelInput(step.channel);
  const template = str(step.template, "message template", 4000);
  if (channel === "email") splitEmailTemplate(template);
  const accountId = str(step.accountId, "account", 200);
  if (channel === "email") {
    await requireEmailStepAccount(store, accountId);
  } else {
    // A non-owner may only plan sends from accounts the caller can read.
    if (principal.kind !== "owner") await service.access(principal, accountId, "read");
    const account = await service.account(accountId);
    if (channel === "whatsapp" || channel === "telegram") {
      if (account.platform !== channel) throw new Error("This channel needs a matching account.");
    }
    if (isPersonalWhatsApp(account))
      throw new Error("Personal WhatsApp accounts cannot run outreach.");
  }
  if (step.personalize !== undefined && typeof step.personalize !== "boolean")
    throw new Error("Invalid personalize flag.");
  const delayHours = step.delayHours === undefined ? 0 : finite(step.delayHours, "delay", 0, 720);
  return {
    id: typeof step.id === "string" && step.id ? str(step.id, "step id", 80) : randomUUID(),
    channel,
    accountId,
    delayHours,
    template,
    ...(Array.isArray(step.variants) ? { variants: parseVariants(step.variants) } : {}),
    personalize: step.personalize === true,
  };
}

function parseVariants(raw: unknown[]): { id: string; text: string }[] {
  if (raw.length > 5) throw new Error("Use at most 5 variants per step.");
  const ids = new Set<string>();
  return raw.map((item) => {
    const variant = (item ?? {}) as Record<string, unknown>;
    const id = str(variant.id, "variant id", 60);
    if (ids.has(id)) throw new Error("Variant ids must be unique.");
    ids.add(id);
    return { id, text: str(variant.text, "variant text", 4000) };
  });
}

/** Members of a static list (membership table) or a dynamic list (its filter), one page at a time. */
async function memberPage(
  store: SocialAudienceStore,
  list: SocialList,
  cursor?: string,
): Promise<{ ids: string[]; next?: string }> {
  if (list.kind === "static") {
    const page = await store.listMembers(list.id, { cursor, limit: 200 });
    return { ids: page.personIds, ...(page.next ? { next: page.next } : {}) };
  }
  const page = await store.listPeople({ filter: list.filter ?? {}, cursor, limit: 200 });
  return {
    ids: page.items.map((person: SocialPerson) => person.id),
    ...(page.next ? { next: page.next } : {}),
  };
}

/**
 * Enrolls the list's members. A person already enrolled (any status) is skipped. A person with a
 * suppression on all channels is enrolled as "suppressed" and never receives a step.
 */
export async function enrollMembers(
  deps: { store: SocialAudienceStore; now: number },
  sequence: Sequence,
  list: SocialList,
): Promise<number> {
  const first = sequence.steps[0];
  let cursor: string | undefined;
  let enrolled = 0;
  let scanned = 0;
  do {
    const page = await memberPage(deps.store, list, cursor);
    for (const personId of page.ids) {
      if (++scanned > MAX_ENROLL_SCAN) return enrolled;
      const id = enrollmentId(sequence.id, personId);
      if (await deps.store.getEnrollment(id)) continue;
      const blocked = (await deps.store.findSuppressions({ personId })).some(
        (row) => row.channel === "all",
      );
      await deps.store.putEnrollment({
        id,
        sequenceId: sequence.id,
        personId,
        stepIndex: 0,
        status: blocked ? "suppressed" : "active",
        ...(blocked ? {} : { nextAt: deps.now + first.delayHours * HOUR_MS }),
        updatedAt: deps.now,
      });
      enrolled++;
    }
    cursor = page.next;
  } while (cursor);
  return enrolled;
}

/** Records the first start time (warm-up anchor). Pause and resume keep the original anchor. */
export async function recordStart(
  store: SocialAudienceStore,
  sequenceId: string,
  now: number,
): Promise<void> {
  if ((await store.getSetting(startedSettingKey(sequenceId))) === undefined)
    await store.putSetting(startedSettingKey(sequenceId), String(now));
}
