import { createHash } from "node:crypto";
import type {
  SocialAccount,
  SocialContact,
  SocialPlatform,
} from "../../../src/features/social/model/social";
import type { OutreachChannel, Suppression } from "../../../src/features/social/model/outreach";
import type { SocialServiceInternals } from "../core/social-internals";

/** Who a send targets. A contactId is resolved to its platform identity and person. */
export type SendTarget = {
  contactId?: string;
  personId?: string;
  platform?: SocialPlatform;
  platformId?: string;
  email?: string;
};

type Resolved = Omit<SendTarget, "contactId">;

type SuppressionDeps = Pick<SocialServiceInternals, "audience" | "get" | "now">;

/** A contact's send target: its handle on the account plus any person linked to that handle. */
export async function resolveSendTarget(s: SuppressionDeps, target: SendTarget): Promise<Resolved> {
  const resolved: Resolved = { ...target };
  delete (resolved as SendTarget).contactId;
  if (target.contactId) {
    const contact = await s.get<SocialContact>("contact", target.contactId);
    const account = await s.get<SocialAccount>("account", contact.accountId);
    resolved.platform ??= account.platform;
    resolved.platformId ??= contact.platformId;
    resolved.personId ??= (
      await s.audience.findPersonByHandle(contact.accountId, contact.platformId)
    )?.id;
  }
  return resolved;
}

/** True when a suppression on any matching key covers this channel ("all" covers every channel). */
export async function isSuppressed(
  s: Pick<SocialServiceInternals, "audience">,
  target: Resolved,
  channel: OutreachChannel,
): Promise<boolean> {
  const keys: Resolved = {};
  if (target.personId !== undefined) keys.personId = target.personId;
  if (target.platform !== undefined && target.platformId !== undefined) {
    keys.platform = target.platform;
    keys.platformId = target.platformId;
  }
  if (target.email !== undefined) keys.email = target.email;
  if (!Object.keys(keys).length) return false;
  const rows = await s.audience.findSuppressions(keys);
  return rows.some((row) => row.channel === "all" || row.channel === channel);
}

/**
 * The single send gate for every outbound path (single, bulk, rules, AI tools, execution).
 * Throws before anything leaves the Host; the caller decides whether the job is cancelled.
 */
export async function assertSendable(
  s: SuppressionDeps,
  target: SendTarget,
  channel: OutreachChannel,
): Promise<void> {
  const resolved = await resolveSendTarget(s, target);
  if (await isSuppressed(s, resolved, channel))
    throw new Error("Recipient is suppressed for this channel. Nothing was sent.");
}

export type SuppressInput = {
  personId?: string;
  handle?: { platform: SocialPlatform; platformId: string };
  email?: string;
  channel: "all" | OutreachChannel;
  reason: Suppression["reason"];
  source: string;
};

/** Idempotent: the same person/handle/email and channel always map to one record. */
export async function suppress(
  s: Pick<SocialServiceInternals, "audience" | "now">,
  input: SuppressInput,
): Promise<Suppression> {
  const email = input.email?.trim().toLowerCase();
  if (!input.personId && !input.handle && !email)
    throw new Error("Suppression needs a person, handle or email.");
  const id = `sup-${createHash("sha256")
    .update(
      JSON.stringify([input.personId ?? null, input.handle ?? null, email ?? null, input.channel]),
    )
    .digest("hex")
    .slice(0, 40)}`;
  return await s.audience.putSuppression({
    id,
    ...(input.personId ? { personId: input.personId } : {}),
    ...(input.handle ? { handle: input.handle } : {}),
    ...(email ? { email } : {}),
    channel: input.channel,
    reason: input.reason,
    source: input.source,
    at: s.now(),
  });
}

/** Owner-only at the action layer; removes one suppression record by ID. */
export async function unsuppress(
  s: Pick<SocialServiceInternals, "audience">,
  id: string,
): Promise<boolean> {
  return await s.audience.deleteSuppression(id);
}

/**
 * Opt-out of one contact suppresses the person on every channel, and the contact's handle on
 * its platform everywhere (other accounts included), so a second account cannot reach them.
 */
export async function suppressContact(
  s: SuppressionDeps,
  contact: SocialContact,
  source: string,
): Promise<void> {
  const account = await s.get<SocialAccount>("account", contact.accountId);
  const person = await s.audience.findPersonByHandle(contact.accountId, contact.platformId);
  const handles = [
    { platform: account.platform, platformId: contact.platformId },
    ...(person?.handles ?? []).map((handle) => ({
      platform: handle.platform,
      platformId: handle.platformId,
    })),
  ];
  const seen = new Set<string>();
  for (const handle of handles) {
    const key = `${handle.platform}:${handle.platformId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    await suppress(s, { personId: person?.id, handle, channel: "all", reason: "opt_out", source });
  }
  if (person) await suppress(s, { personId: person.id, channel: "all", reason: "opt_out", source });
}
