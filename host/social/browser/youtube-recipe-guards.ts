import type { BrowserRecipeContext } from "../social-browser-recipe";
import { denied, unknown, unsupported } from "../social-browser-publishing-shared";
import { detectChallenge, needsHumanError } from "./challenge";

export const youtubeStudioOrigin = "https://studio.youtube.com";
export const youtubePublicOrigin = "https://www.youtube.com";
export type YouTubeBrowserRecipeContext = BrowserRecipeContext & {
  beforeYouTubeSubmission?(): Promise<void>;
};

export function youtubeBrowserChannel(ctx: BrowserRecipeContext): string {
  const channel = /^web:youtube:(UC[\w-]{22})$/.exec(ctx.account.platformId)?.[1];
  if (ctx.account.platform !== "youtube" || !channel) throw denied();
  return channel;
}

export async function verifyYouTubeBrowser(ctx: BrowserRecipeContext): Promise<void> {
  const hit = await detectChallenge(ctx.page);
  if (hit) throw needsHumanError(hit);
  await ctx.verifyIdentity();
}

export async function youtubeBrowserScreenError(ctx: BrowserRecipeContext): Promise<Error> {
  const hit = await detectChallenge(ctx.page);
  return hit ? needsHumanError(hit) : unsupported();
}

/** A dispatched click without positive acknowledgement has an unknown outcome. */
export async function commitYouTubeBrowser<T>(
  ctx: YouTubeBrowserRecipeContext,
  target: string,
  acknowledge: () => Promise<T | undefined>,
): Promise<T> {
  await verifyYouTubeBrowser(ctx);
  await ctx.beforeYouTubeSubmission?.();
  try {
    ctx.markSubmitted?.();
    await ctx.page.click(target);
    const result = await acknowledge();
    if (result === undefined) throw unknown();
    await verifyYouTubeBrowser(ctx);
    return result;
  } catch {
    throw unknown();
  }
}
