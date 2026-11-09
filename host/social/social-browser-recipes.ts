import { metaBrowserRecipes } from "./social-browser-meta";
import { messagingBrowserRecipes } from "./social-browser-messaging";
import { publishingBrowserRecipes } from "./social-browser-publishing";
import { redditBrowserRecipe } from "./social-browser-reddit";
import { snapchatCollectAudience } from "./social-browser-snapchat-audience";
import { tiktokCollectAudience } from "./social-browser-tiktok";
import type { BrowserRecipe } from "./social-browser-recipe";

/** Attaches the audience readers that exist for a platform. Other recipes keep no reader. */
function withAudienceReader(recipe: BrowserRecipe): BrowserRecipe {
  if (recipe.platform === "snapchat")
    return {
      ...recipe,
      collectAudience: (context, source) => snapchatCollectAudience(context, source),
    };
  if (recipe.platform === "tiktok")
    return {
      ...recipe,
      // shortcut: TikTok comments are read per post; the source names one post, so a bulk list is not built here.
      collectAudience: (context, source, cursor) =>
        tiktokCollectAudience(
          context,
          source.kind === "own_post_comments" && source.postRef ? [source.postRef] : [],
          cursor,
        ),
    };
  return recipe;
}

export const SOCIAL_BROWSER_RECIPES: readonly BrowserRecipe[] = [
  ...metaBrowserRecipes,
  ...messagingBrowserRecipes,
  ...publishingBrowserRecipes,
  redditBrowserRecipe,
].map(withAudienceReader);
