import type { BrowserRecipe } from "./social-browser-recipe";
import { linkedinBrowserRecipe } from "./social-browser-linkedin";
import { snapchatBrowserRecipe } from "./social-browser-snapchat";
import { tiktokBrowserRecipe } from "./social-browser-tiktok";
import { youtubeBrowserRecipe } from "./social-browser-youtube";

/** Compatibility shim: platform recipes live in social-browser-<platform>.ts. */
export { linkedInBrowserConnectionUrl, linkedInCreatedId } from "./social-browser-linkedin";
export { snapchatBrowserConnectionUrl } from "./social-browser-snapchat";
export {
  tiktokCommentCreatedId,
  tiktokCommentRows,
  tiktokVideoCreatedId,
} from "./social-browser-tiktok";
export { youtubeCommentCreatedId } from "./social-browser-youtube";

/** These recipes are guarded UI paths, not a claim that an unknown current layout was live accepted. */
export const publishingBrowserRecipes: BrowserRecipe[] = [
  linkedinBrowserRecipe,
  youtubeBrowserRecipe,
  tiktokBrowserRecipe,
  snapchatBrowserRecipe,
];
