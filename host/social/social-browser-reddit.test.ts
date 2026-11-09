import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Window } from "happy-dom";
import { expect, it } from "vitest";
import { SocialPlatformError } from "../../src/integrations/social/adapter";
import type { BrowserPage } from "./social-browser";
import { detectChallenge, needsHumanError } from "./browser/challenge";
import { redditBrowserRecipe } from "./social-browser-reddit";

/**
 * Reddit page fixtures are synthetic (no live Reddit page was recorded). They exercise the shared
 * challenge probe on Reddit-shaped markup. The probe is read-only: the page offers no interaction.
 */
async function fixturePage(name: string, url: string): Promise<BrowserPage> {
  const html = await readFile(
    fileURLToPath(new URL(`./fixtures/reddit/${name}`, import.meta.url)),
    "utf8",
  );
  const window = new Window({ url });
  window.document.body.innerHTML = html.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? "";
  Object.defineProperty(window.HTMLElement.prototype, "getClientRects", {
    configurable: true,
    value() {
      return [{ width: 100, height: 30 }];
    },
  });
  return {
    evaluate: async <T>(expression: string): Promise<T> => window.eval(expression) as T,
  } as unknown as BrowserPage;
}

it("keeps the Reddit recipe free of operations so no browser session opens", () => {
  expect(redditBrowserRecipe.operations).toEqual([]);
});

it("recognizes the synthetic login page as a login screen without interacting", async () => {
  const page = await fixturePage("login.html", "https://www.reddit.com/login/");
  await expect(detectChallenge(page)).resolves.toEqual({
    kind: "login",
    url: "https://www.reddit.com/login/",
  });
});

it("recognizes a robot check as captcha and maps it to needs_human", async () => {
  const page = await fixturePage("captcha.html", "https://www.reddit.com/login/");
  const hit = await detectChallenge(page);
  expect(hit?.kind).toBe("captcha");
  const error = needsHumanError(hit!);
  expect(error).toBeInstanceOf(SocialPlatformError);
  expect(error.code).toBe("needs_human");
});

it("recognizes a one-time code field as verification", async () => {
  const page = await fixturePage("verification.html", "https://www.reddit.com/login/");
  await expect(detectChallenge(page)).resolves.toMatchObject({ kind: "verification" });
});

it("returns no challenge for an ordinary subreddit listing", async () => {
  const page = await fixturePage("subreddit.html", "https://www.reddit.com/r/bycodatest/");
  await expect(detectChallenge(page)).resolves.toBeNull();
});
