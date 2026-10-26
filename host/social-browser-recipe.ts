import type {
  SocialAccount,
  SocialJob,
  SocialOperation,
  SocialPlatform,
} from "../src/features/social/model/social";
import type { SocialInbound, SocialSendResult } from "../src/integrations/social/adapter";
import type { BrowserPage } from "./social-browser";

/** A web identity is obtained from the authenticated site's own UI, never the account label. */
export type BrowserIdentity = {
  platformId: string;
  name: string;
  accountType?: SocialAccount["accountType"];
};
export type BrowserRecipeContext = {
  page: BrowserPage;
  account: SocialAccount;
  files: { path: string; kind: "image" | "video" | "document" }[];
  now(): number;
  waitFor<T>(expression: string, timeoutMs?: number): Promise<T | undefined>;
  /** Rechecks the connected web identity; call immediately before every submission and after acknowledgement. */
  verifyIdentity(): Promise<void>;
  /** Call immediately before the final external Post/Send click. Errors after this point are uncertain delivery. */
  markSubmitted?(): void;
};
export type BrowserPollResult = {
  events: SocialInbound[];
  cursor?: string;
  coverage?: import("../src/features/social/model/social").SocialMonitorChannel[];
};
/** Platform modules perform ordinary browser UI actions. Login/verification is owner-assisted. */
export interface BrowserRecipe {
  platform: Exclude<SocialPlatform, "x">;
  loginUrl: string;
  /** Optional explicit organization/channel setup target, validated by the platform recipe. */
  connectionUrl?(account: SocialAccount, target?: string): string;
  operations: readonly SocialOperation[];
  identity(page: BrowserPage, account?: SocialAccount): Promise<BrowserIdentity | undefined>;
  creatorInfo?(
    context: BrowserRecipeContext,
  ): Promise<import("../src/features/social/model/social").TikTokCreatorInfo>;
  send(context: BrowserRecipeContext, job: SocialJob): Promise<SocialSendResult>;
  poll(context: BrowserRecipeContext, posts: string[], cursor?: string): Promise<BrowserPollResult>;
}
