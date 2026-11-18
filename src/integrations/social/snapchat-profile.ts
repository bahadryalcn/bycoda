export type SnapchatProfileState = {
  hasPublicProfile: boolean;
  profileId?: string;
  name?: string;
  bio?: string;
  avatarUrl?: string;
  website?: string;
  category?: string;
};

export type SnapchatProfilePatch = Partial<
  Pick<SnapchatProfileState, "name" | "bio" | "website" | "category">
> & { avatarUploadId?: string };

export type SnapchatMonetizationStatus = {
  status: "eligible" | "ineligible" | "unknown" | "unavailable";
  dailyRewardsEligible?: boolean;
};
