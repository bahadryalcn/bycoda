import {
  LIVE_STREAM_MAX_ACCOUNTS,
  liveStreamOrientation,
  type LiveStreamLiveAccount,
  type LiveStreamLiveDestination,
} from "../../../shared/model/host-contracts/live-stream";

/** Sentinel selection key for the OBS server the owner configured by hand; it excludes every account. */
export const CONFIGURED_OBS = "__configured-obs__";

export const platformNames: Record<LiveStreamLiveAccount["platform"], string> = {
  youtube: "YouTube",
  tiktok: "TikTok",
  instagram: "Instagram",
  facebook: "Facebook",
  linkedin: "LinkedIn",
  x: "X",
};

export type AccountGroups = {
  horizontal: LiveStreamLiveAccount[];
  vertical: LiveStreamLiveAccount[];
};

/** Splits accounts by canvas, keeping the Host order inside each group. */
export function groupAccounts(accounts: readonly LiveStreamLiveAccount[]): AccountGroups {
  const groups: AccountGroups = { horizontal: [], vertical: [] };
  for (const account of accounts) groups[liveStreamOrientation(account.platform)].push(account);
  return groups;
}

/**
 * Toggles one key in the selection. The configured OBS server is a single exclusive choice: picking it
 * drops every account, picking an account drops it. Accounts stop at the Host limit.
 */
export function toggleSelection(selected: readonly string[], key: string): string[] {
  if (key === CONFIGURED_OBS) return selected.includes(key) ? [] : [key];
  const accounts = selected.filter((entry) => entry !== CONFIGURED_OBS);
  if (accounts.includes(key)) return accounts.filter((entry) => entry !== key);
  return accounts.length >= LIVE_STREAM_MAX_ACCOUNTS ? accounts : [...accounts, key];
}

/** Selected accounts in the order the list shows them, ignoring ids that no longer exist. */
export function selectedAccounts(
  selected: readonly string[],
  accounts: readonly LiveStreamLiveAccount[],
) {
  return accounts.filter((account) => selected.includes(account.accountId));
}

export function hasVerticalAccount(accounts: readonly LiveStreamLiveAccount[]) {
  return accounts.some((account) => liveStreamOrientation(account.platform) === "vertical");
}

export type DestinationTone = "running" | "done" | "failed" | "idle";

export function destinationTone(state: LiveStreamLiveDestination["state"]): DestinationTone {
  switch (state) {
    case "starting":
      return "running";
    case "streaming":
      return "done";
    case "failed":
      return "failed";
    case "ended":
      return "idle";
  }
}
