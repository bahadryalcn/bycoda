import type { SocialClient } from "../../model/socialClient";
import type { CampaignVariant, Capability, SocialCampaign, SocialMedia } from "../../model/social";
import { defaultProgram, type ProgramConfig } from "../../model/socialProgram";
import type { RepeatDraft } from "./contentDraft";

/** The Host operations this screen calls. Every write carries its own request id. */
export type PublishClient = Pick<SocialClient, "request">;

export type PreviewTarget = {
  accountId: string;
  contentError?: string;
  capability?: Pick<Capability, "status" | "reason" | "reasonCode">;
  approved?: boolean;
};

export type PublishResult = {
  campaign: SocialCampaign;
  /** Targets the Host refused on preview. Nothing was approved or scheduled when non-empty. */
  blocked: PreviewTarget[];
  scheduled: boolean;
};

type CampaignInput = {
  campaignId?: string;
  revision?: number;
  name: string;
  projectIds: string[];
  variants: CampaignVariant[];
};

/** Saves the campaign as a draft. Editing sends the revision the owner last saw. */
export function saveCampaign(client: PublishClient, input: CampaignInput): Promise<SocialCampaign> {
  return client.request<SocialCampaign>("campaigns.create", {
    ...(input.campaignId ? { id: input.campaignId, expectedRevision: input.revision } : {}),
    name: input.name,
    projectIds: input.projectIds,
    variants: input.variants,
  });
}

/**
 * The owner's one-click path: save, check the exact saved revision, approve that revision, then
 * schedule. A preview refusal stops before approval, so nothing is queued. `onSaved` runs as soon
 * as the Host has the campaign, so a later failure leaves the owner's draft pointing at it.
 */
export async function publishCampaign(
  client: PublishClient,
  input: CampaignInput,
  onSaved?: (campaign: SocialCampaign) => void,
): Promise<PublishResult> {
  const campaign = await saveCampaign(client, input);
  onSaved?.(campaign);
  const preview = await client.request<{ campaign: SocialCampaign; targets: PreviewTarget[] }>(
    "campaigns.preview",
    { id: campaign.id },
  );
  const blocked = preview.targets.filter(
    (target) => target.contentError || target.capability?.status !== "available",
  );
  if (blocked.length) return { campaign, blocked, scheduled: false };
  await client.request("campaigns.approveReviewed", {
    id: campaign.id,
    expectedRevision: campaign.revision,
  });
  await client.request("campaigns.schedule", { id: campaign.id });
  return { campaign, blocked: [], scheduled: true };
}

/**
 * Saves a repeating program as paused. The Host keeps it paused until the owner activates it in
 * the program review, so repeating never starts from this screen.
 */
export function saveRepeatProgram(
  client: PublishClient,
  input: {
    projectId: string;
    name: string;
    text: string;
    link?: string;
    accountIds: string[];
    factIds: string[];
    media: SocialMedia[];
    repeat: RepeatDraft;
    startsAt: number;
    language: string;
  },
): Promise<unknown> {
  const base = defaultProgram(input.projectId, input.startsAt);
  const config: ProgramConfig = {
    ...base,
    name: input.name,
    accountIds: input.accountIds,
    brief: {
      ...base.brief,
      topic: input.name,
      title: input.name,
      description: input.text,
      language: input.language,
      cta: "",
      ...(input.link ? { link: input.link } : {}),
      factIds: input.factIds,
    },
    image: {
      ...base.image,
      mode: input.media.length ? "existing" : "none",
      media: input.media,
    },
    strategy: "repeat",
    totalPosts: input.repeat.totalPosts,
    schedule: {
      ...base.schedule,
      mode: "interval",
      startsAt: input.startsAt,
      minIntervalMinutes: input.repeat.minMinutes,
      maxIntervalMinutes: input.repeat.maxMinutes,
    },
  };
  return client.request("programs.configure", { config });
}
