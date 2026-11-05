import { metaBrowserRecipes } from "./social-browser-meta";
import { messagingBrowserRecipes } from "./social-browser-messaging";
import { publishingBrowserRecipes } from "./social-browser-publishing";
import type { BrowserRecipe } from "./social-browser-recipe";

export const SOCIAL_BROWSER_RECIPES: readonly BrowserRecipe[] = [
  ...metaBrowserRecipes,
  ...messagingBrowserRecipes,
  ...publishingBrowserRecipes,
];
