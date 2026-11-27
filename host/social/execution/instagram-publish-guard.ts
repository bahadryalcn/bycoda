import type { CampaignVariant } from "../../../src/features/social/model/social";
import { assertSendable } from "../autonomy/suppression";
import type { SocialServiceInternals } from "../core/social-internals";

/** Instagram notifies tagged people and invites collaborators when a post is published. */
export async function assertInstagramPublicationTargets(
  deps: Pick<SocialServiceInternals, "audience" | "get" | "now" | "store">,
  accountId: string,
  options: CampaignVariant["instagram"],
) {
  if (!options) return;
  const names = new Set([
    ...(options.userTags?.map((tag) => tag.username.toLowerCase()) ?? []),
    ...(options.collaborators?.map((name) => name.toLowerCase()) ?? []),
  ]);
  if (!names.size) return;
  const contactIds = deps.store.db.prepare(
    `SELECT id FROM social_records WHERE kind='contact' AND json_extract(value,'$.accountId')=?
      AND (lower(json_extract(value,'$.platformId'))=? OR lower(json_extract(value,'$.name'))=?
        OR rtrim(lower(json_extract(value,'$.profileUrl')), '/')=?)`,
  );
  for (const name of names) {
    await assertSendable(deps, { platform: "instagram", platformId: name }, "mention");
    const contacts = await contactIds.all(
      accountId,
      name,
      name,
      `https://www.instagram.com/${name}`,
    );
    for (const contact of contacts)
      await assertSendable(deps, { contactId: String(contact.id) }, "mention");
  }
}
