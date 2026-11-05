import type { CampaignVariant, SocialSnapshot } from "./social";

export function socialCampaignCapabilities(snapshot: SocialSnapshot) {
  const accountFor = (variant: CampaignVariant) =>
    snapshot.accounts.find((account) => account.id === variant.accountId);
  const apiLinkedInUpload = (variant: CampaignVariant) => {
    const account = accountFor(variant);
    return (
      account?.platform === "linkedin" &&
      account.accountType === "organization" &&
      account.connection !== "browser" &&
      snapshot.capabilities[account.id]?.some(
        (item) => item.operation === "media" && item.status === "available",
      )
    );
  };
  const apiSnapchatUpload = (variant: CampaignVariant) => {
    const account = accountFor(variant);
    return (
      account?.platform === "snapchat" &&
      account.connection !== "browser" &&
      account.accountType === "public_profile" &&
      account.connected &&
      snapshot.capabilities[account.id]?.some(
        (item) => item.operation === "media" && item.status === "available",
      )
    );
  };
  const apiTelegramChannelUpload = (variant: CampaignVariant) => {
    const account = accountFor(variant);
    return (
      account?.platform === "telegram" &&
      account.accountType === "channel" &&
      account.connection === "token" &&
      account.connected &&
      snapshot.capabilities[account.id]?.some(
        (item) => item.operation === "media" && item.status === "available",
      )
    );
  };
  const browserUpload = (variant: CampaignVariant) => {
    const account = accountFor(variant);
    const capabilities = snapshot.capabilities[variant.accountId] ?? [];
    return (
      account?.connection === "browser" &&
      account.connected &&
      !["youtube", "tiktok"].includes(account.platform) &&
      capabilities.some((item) => item.operation === "media" && item.status === "available") &&
      capabilities.some((item) => item.operation === "publish" && item.status === "available")
    );
  };
  return {
    accountFor,
    apiLinkedInUpload,
    apiSnapchatUpload,
    apiTelegramChannelUpload,
    browserUpload,
  };
}
