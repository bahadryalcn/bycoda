import { expect, it } from "vitest";
import { SOCIAL_BROWSER_RECIPES } from "./social-browser-recipes";
import { BROWSER_PLATFORM_OPERATIONS } from "../src/integrations/social/browserCapabilities";

it("keeps renderer capability declarations aligned with the installed host recipes for all eight platforms", () => {
  expect(new Set(SOCIAL_BROWSER_RECIPES.map((recipe) => recipe.platform)).size).toBe(8);
  expect(SOCIAL_BROWSER_RECIPES.map((recipe) => recipe.platform).sort()).toEqual(
    Object.keys(BROWSER_PLATFORM_OPERATIONS).sort(),
  );
  for (const recipe of SOCIAL_BROWSER_RECIPES) {
    expect([...new Set(recipe.operations)].sort(), recipe.platform).toEqual(
      [...BROWSER_PLATFORM_OPERATIONS[recipe.platform]].sort(),
    );
    expect(new URL(recipe.loginUrl).protocol).toBe("https:");
  }
});
