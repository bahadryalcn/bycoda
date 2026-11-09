import type {
  SocialAccount,
  SocialContact,
  SocialPlatform,
} from "../../../src/features/social/model/social";
import type {
  ContactHandle,
  PersonStage,
  SocialPerson,
} from "../../../src/features/social/model/audience";
import { isSuppressed } from "../autonomy/suppression";
import { hash } from "../core/social-helpers";
import type { SocialAudienceStore } from "../store/social-audience-store";

/** Stable person ID for one platform identity, so concurrent first sightings converge on one record. */
export const personIdFor = (accountId: string, platformId: string) =>
  `person-${hash(`${accountId}\u0000${platformId}`).slice(0, 32)}`;

/** Deterministic interaction ID: the same source event never creates a second interaction. */
export const interactionId = (parts: string[]) => `int-${hash(parts.join("\u0000")).slice(0, 40)}`;

/** Turkish recipients need an IYS status; the Host records it as unknown until checked. */
export const isTurkish = (language?: string) => !!language && /^tr(\b|-)/iu.test(language);

export type PersonOrigin = {
  source: SocialPerson["source"];
  basis: SocialPerson["consent"]["basis"];
  stage?: PersonStage;
};

export function handleFor(
  account: Pick<SocialAccount, "id" | "platform">,
  contact: Pick<SocialContact, "id" | "platformId" | "profileUrl">,
): ContactHandle {
  return {
    accountId: account.id,
    platform: account.platform,
    platformId: contact.platformId,
    contactId: contact.id,
    ...(contact.profileUrl ? { profileUrl: contact.profileUrl } : {}),
  };
}

export function newPerson(input: {
  id: string;
  name: string;
  handles: ContactHandle[];
  language?: string;
  projectIds: string[];
  origin: PersonOrigin;
  now: number;
}): SocialPerson {
  return {
    id: input.id,
    name: input.name,
    handles: input.handles,
    emails: [],
    tags: [],
    notes: "",
    stage: input.origin.stage ?? "new",
    source: input.origin.source,
    ...(input.language ? { language: input.language } : {}),
    projectIds: input.projectIds,
    consent: { basis: input.origin.basis },
    ...(isTurkish(input.language) ? { commercialConsent: { iys: "unknown" as const } } : {}),
    createdAt: input.now,
    updatedAt: input.now,
  };
}

/** The person behind a platform identity. Created with the handle on first sight; existing people are returned unchanged. */
export async function ensurePerson(
  store: SocialAudienceStore,
  account: Pick<SocialAccount, "id" | "platform">,
  contact: SocialContact,
  origin: PersonOrigin,
  now: number,
  projectIds?: string[],
): Promise<{ person: SocialPerson; created: boolean }> {
  const existing = await store.findPersonByHandle(account.id, contact.platformId);
  if (existing) return { person: existing, created: false };
  const person = await store.putPerson(
    newPerson({
      id: personIdFor(account.id, contact.platformId),
      name: contact.name,
      handles: [handleFor(account, contact)],
      ...(contact.language ? { language: contact.language } : {}),
      projectIds: projectIds ?? contact.projectIds,
      origin,
      now,
    }),
  );
  return { person, created: true };
}

/**
 * True when any given identity or the person itself is suppressed for direct messages. Lists and
 * collection use this check: a suppressed person never enters a list.
 */
export async function identityBlocked(
  store: SocialAudienceStore,
  handles: { platform: SocialPlatform; platformId: string }[],
  personId?: string,
): Promise<boolean> {
  if (personId && (await isSuppressed({ audience: store }, { personId }, "dm"))) return true;
  for (const handle of handles)
    if (
      await isSuppressed(
        { audience: store },
        { platform: handle.platform, platformId: handle.platformId },
        "dm",
      )
    )
      return true;
  return false;
}
