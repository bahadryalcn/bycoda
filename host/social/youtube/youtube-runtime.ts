import type {
  SocialAccount,
  SocialOperation,
  SocialPermission,
} from "../../../src/features/social/model/social";
import { SocialPlatformError } from "../../../src/integrations/social/adapter";
import type { YouTubeAdapter } from "../../../src/integrations/social/youtube";
import type { YouTubeManagementContext } from "../../../src/integrations/social/youtube-manage";
import type { SocialActionContext } from "../core/social-actions";
import type { SocialPrincipal } from "../social";
import type { SocialCredentialStore } from "../social-credentials";
import type { BrowserRecipeContext } from "../social-browser-recipe";

export type YouTubeRuntime = {
  environmentId: string;
  credentials: SocialCredentialStore;
  assertAuthorized(): Promise<void>;
  media(principal: SocialPrincipal, uploadId: string): Promise<Uint8Array>;
  browser?<T>(
    account: SocialAccount,
    run: (ctx: BrowserRecipeContext) => Promise<T>,
    options?: {
      uploads?: readonly string[];
      media?: (id: string) => Promise<Uint8Array>;
      beforeSubmit?: () => Promise<void>;
      outbound?: boolean;
    },
  ): Promise<T>;
};

export function youtubeRuntime(ctx: SocialActionContext): YouTubeRuntime {
  if (!ctx.youtube) throw new SocialPlatformError("unsupported");
  return ctx.youtube;
}

export async function reportYouTubeHumanHandoff(work: () => Promise<unknown>) {
  try {
    return await work();
  } catch (error) {
    if (!(error instanceof SocialPlatformError) || error.code !== "needs_human") throw error;
    return { status: "needs_human", reason: error.detail?.reasonCode ?? "needs_human" };
  }
}

export async function youtubeAccount(
  ctx: SocialActionContext,
  accountId: string,
  permission: SocialPermission = "read",
): Promise<SocialAccount> {
  const account = await ctx.service.access(ctx.principal, accountId, permission);
  if (account.platform !== "youtube" || account.accountType !== "channel")
    throw new SocialPlatformError("unsupported");
  if (!account.connected || !account.accessApproved || !account.platformId || account.paused)
    throw new SocialPlatformError("denied");
  if (account.executorId !== youtubeRuntime(ctx).environmentId)
    throw new Error("Run this operation on the YouTube account's executor computer.");
  return account;
}

export async function youtubeApi(
  ctx: SocialActionContext,
  account: SocialAccount,
  capability?: SocialOperation,
): Promise<YouTubeManagementContext> {
  if (account.connection === "browser") throw new SocialPlatformError("unsupported");
  const adapter = ctx.service.adapterFor(account) as Partial<YouTubeAdapter>;
  if (!adapter?.management) throw new SocialPlatformError("unsupported");
  const credential = await ctx.service.credentialFor(account.id);
  if (capability) ctx.service.capability(await youtubeAccount(ctx, account.id), capability);
  if (!credential?.accessToken) throw new SocialPlatformError("expired");
  return adapter.management(credential.accessToken, account.platformId);
}

export async function youtubeBrowser<T>(
  ctx: SocialActionContext,
  account: SocialAccount,
  capability: SocialOperation,
  run: (recipe: BrowserRecipeContext) => Promise<T>,
  options?: Parameters<NonNullable<YouTubeRuntime["browser"]>>[2],
): Promise<T> {
  const browser = youtubeRuntime(ctx).browser;
  if (!browser || account.connection !== "browser") throw new SocialPlatformError("unsupported");
  ctx.service.capability(account, capability);
  return await browser(account, run, {
    ...options,
    media: (id) => youtubeRuntime(ctx).media(ctx.principal, id),
  });
}
