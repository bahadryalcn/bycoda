import type { SocialAccount, SocialPlatform } from "./social";

export const ACCOUNT_REQUEST_STATUSES = ["pending", "approved", "dismissed", "fulfilled"] as const;
export type AccountRequestStatus = (typeof ACCOUNT_REQUEST_STATUSES)[number];
/** "create" opens the platform signup; "signin" connects an account the owner already has. */
export type AccountRequestMode = "create" | "signin";

/** A project's ask for a platform account it lacks. It creates nothing until the owner approves it. */
export type SocialAccountRequest = {
  id: string;
  projectId: string;
  /** Read-time project name from the Host; absent on the stored record. */
  projectName?: string;
  platform: SocialPlatform;
  accountType: SocialAccount["accountType"];
  reason: string;
  suggestedName?: string;
  suggestedUsername?: string;
  requestedBy: { provider: string; actorId: string; sessionId?: string };
  status: AccountRequestStatus;
  mode?: AccountRequestMode;
  /** Existing LinkedIn account referenced by a reconnect request, before owner approval. */
  requestedAccountId?: string;
  /** Account authorized on approval. A reconnect keeps its existing record. */
  accountId?: string;
  createdAt: number;
  updatedAt: number;
};

export type AccountRequestApproveInput = {
  id: string;
  mode: AccountRequestMode;
  /** Local label for the account record; defaults to the suggestion or the platform and project. */
  name?: string;
};
