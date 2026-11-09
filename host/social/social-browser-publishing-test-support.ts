import { Window } from "happy-dom";
import { vi } from "vitest";
import type { SocialAccount, SocialJob } from "../../src/features/social/model/social";
import { SocialPlatformError } from "../../src/integrations/social/adapter";
import type { BrowserPage } from "./social-browser";
import type { BrowserRecipe, BrowserRecipeContext } from "./social-browser-recipe";
import { publishingBrowserRecipes } from "./social-browser-publishing";

/** Shared fixtures for the publishing recipe tests (split per platform). */
export const now = Date.parse("2026-10-26T10:00:00Z");
export const recipe = (platform: SocialAccount["platform"]) =>
  publishingBrowserRecipes.find((item) => item.platform === platform)!;
export const account = (
  platform: SocialAccount["platform"],
  platformId: string,
  accountType: SocialAccount["accountType"] = "member",
): SocialAccount => ({
  id: "synthetic",
  platform,
  platformId,
  name: "Bycoda",
  accountType,
  scopes: [],
  connected: true,
  accessApproved: true,
  connection: "browser",
  paused: false,
  executorId: "synthetic-host",
  grants: {},
  createdAt: 1,
});
export const job = (
  kind: SocialJob["kind"] = "publish",
  payload: Partial<SocialJob["payload"]> = {},
): SocialJob => ({
  id: "job",
  operationId: "operation",
  dedupeKey: "key",
  accountId: "synthetic",
  projectIds: [],
  provider: "owner",
  actorId: "owner",
  kind,
  payload: { text: "A Bycoda update", media: [], ...payload },
  status: "running",
  scheduledAt: now,
  attempts: 1,
  createdAt: now,
});

export function fixture(
  target: BrowserRecipe,
  own: SocialAccount,
  html: string,
  options: {
    render?(url: string): string;
    click?(element: Element): void;
    response?: string;
  } = {},
) {
  const window = new Window({ url: target.loginUrl });
  window.document.body.innerHTML = html;
  Object.defineProperty(window.HTMLElement.prototype, "getClientRects", {
    configurable: true,
    value() {
      return [{ width: 100, height: 30 }];
    },
  });
  const page: BrowserPage = {
    goto: vi.fn(async (url) => {
      window.location.href = url;
      if (options.render) window.document.body.innerHTML = options.render(url);
    }),
    evaluate: vi.fn(async (expression: string) => window.eval(expression)),
    click: vi.fn(async (selector) => {
      const element = window.document.querySelector(selector);
      if (!element) throw new Error("Missing unique control");
      options.click?.(element as unknown as Element);
    }),
    fill: vi.fn(async (selector, value) => {
      const element = window.document.querySelector(selector);
      if (!element) throw new Error("Missing editor");
      element.textContent = value;
    }),
    insertText: vi.fn(async () => {}),
    setFiles: vi.fn(async () => {}),
    cookies: vi.fn(async () => {
      throw new Error("No credential reads allowed");
    }),
    watchResponse: vi.fn((_path, accept) => ({
      body: vi.fn(async () =>
        options.response && (!accept || accept(options.response)) ? options.response : undefined,
      ),
      stop: vi.fn(),
    })),
  };
  const ctx: BrowserRecipeContext = {
    page,
    account: own,
    files: [],
    now: () => now,
    waitFor: async <T>(expression: string) => await page.evaluate<T>(expression),
    verifyIdentity: vi.fn(async () => {
      if ((await target.identity(page, own))?.platformId !== own.platformId)
        throw new SocialPlatformError("denied");
    }),
    markSubmitted: vi.fn(),
  };
  return { page, ctx, window };
}
