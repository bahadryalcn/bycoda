import { expect, it } from "vitest";
import { SOCIAL_BROWSER_RECIPES } from "./social-browser-recipes";
import { BROWSER_PLATFORM_OPERATIONS } from "../../src/integrations/social/browserCapabilities";
import { SOCIAL_PLATFORMS } from "../../src/features/social/model/social";

it("keeps renderer capability declarations aligned with the installed host recipes for every browser platform", () => {
  // X runs in its own session class (social-browser.ts), so every other platform has exactly one recipe.
  const browserPlatforms = SOCIAL_PLATFORMS.filter((platform) => platform !== "x").sort();
  expect(SOCIAL_BROWSER_RECIPES.map((recipe) => recipe.platform).sort()).toEqual(browserPlatforms);
  expect(new Set(SOCIAL_BROWSER_RECIPES.map((recipe) => recipe.platform)).size).toBe(
    browserPlatforms.length,
  );
  for (const recipe of SOCIAL_BROWSER_RECIPES) {
    expect([...new Set(recipe.operations)].sort(), recipe.platform).toEqual(
      [...BROWSER_PLATFORM_OPERATIONS[recipe.platform]].sort(),
    );
    expect(new URL(recipe.loginUrl).protocol).toBe("https:");
  }
});

it("declares no operations for the Reddit placeholder recipe", () => {
  const reddit = SOCIAL_BROWSER_RECIPES.find((recipe) => recipe.platform === "reddit");
  expect(reddit?.operations).toEqual([]);
});
