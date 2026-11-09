import type { SocialActionModule, SocialActionContext } from "../core/social-actions";
import type { SocialPlatform } from "../../../src/features/social/model/social";
import { readBrowserSettings, writeBrowserSettings } from "./browser-settings";
import { RecipeHealing } from "./healing";
import { NeedsHumanQueue } from "./needs-human";
import type { NeedsHumanItem, NeedsHumanKind, RecipeSuggestion } from "./types";

const ID_MAX = 200;

function requireId(value: unknown): string {
  if (typeof value !== "string" || value.length < 1 || value.length > ID_MAX)
    throw new RangeError("Identifier is invalid.");
  return value;
}

/** Client shape for a waiting item. The URL and job link stay in the Host. */
const REASON: Record<NeedsHumanKind, "challenge" | "verification" | "login" | "unexpected_screen"> =
  {
    captcha: "challenge",
    suspicious_login: "challenge",
    verification: "verification",
    login: "login",
    unexpected: "unexpected_screen",
  };

async function accountPlatforms(
  ctx: SocialActionContext,
  ids: string[],
): Promise<Map<string, SocialPlatform>> {
  const platforms = new Map<string, SocialPlatform>();
  for (const id of new Set(ids)) platforms.set(id, (await ctx.service.account(id)).platform);
  return platforms;
}

function toClientItem(item: NeedsHumanItem, platform: SocialPlatform) {
  return {
    id: item.id,
    accountId: item.accountId,
    platform,
    reason: REASON[item.kind],
    at: item.createdAt,
    ...(item.screenshotId === undefined ? {} : { screenshotRef: item.screenshotId }),
    ...(item.jobId === undefined ? {} : { jobId: item.jobId }),
  };
}

function toClientSuggestion(item: RecipeSuggestion) {
  return {
    id: item.id,
    accountId: item.accountId,
    platform: item.platform,
    summary: `${item.step} via ${item.source}`,
    status: item.status,
  };
}

/** Needs-human queue, browser visibility and recipe suggestions (Phase 4H). */
export const browserLayerActions: SocialActionModule = {
  "browser.needsHuman.list": {
    readOnly: true,
    ownerOnly: false,
    tool: true,
    run: async (ctx) => {
      const items = await new NeedsHumanQueue(ctx.store).list();
      const platforms = await accountPlatforms(
        ctx,
        items.map((item) => item.accountId),
      );
      return {
        items: items.map((item) => toClientItem(item, platforms.get(item.accountId)!)),
      };
    },
  },
  "browser.needsHuman.resolve": {
    readOnly: false,
    ownerOnly: true,
    run: async (ctx, input) => {
      // shortcut: the resumed job (review -> queued) is wired by the Social service; this only records "done".
      await new NeedsHumanQueue(ctx.store).resolve(requireId(input.id), ctx.principal);
      return {};
    },
  },
  "browser.settings.get": {
    readOnly: true,
    ownerOnly: false,
    run: async (ctx, input) => {
      const accountId = requireId(input.accountId);
      await ctx.service.account(accountId);
      return readBrowserSettings(ctx.store, accountId);
    },
  },
  "browser.settings.set": {
    readOnly: false,
    ownerOnly: true,
    run: async (ctx, input) => {
      await ctx.service.account(requireId(input.accountId));
      return writeBrowserSettings(ctx.store, input);
    },
  },
  "browser.recipeSuggestions.list": {
    readOnly: true,
    ownerOnly: false,
    tool: true,
    run: async (ctx) => {
      const items = await new RecipeHealing(ctx.store).list();
      return { items: items.map(toClientSuggestion) };
    },
  },
  "browser.recipeSuggestions.approve": {
    readOnly: false,
    ownerOnly: false,
    run: async (ctx, input) =>
      toClientSuggestion(
        await new RecipeHealing(ctx.store).approve(requireId(input.id), {
          owner: ctx.principal.kind === "owner",
        }),
      ),
  },
  "browser.recipeSuggestions.reject": {
    readOnly: false,
    ownerOnly: false,
    run: async (ctx, input) =>
      toClientSuggestion(
        await new RecipeHealing(ctx.store).reject(requireId(input.id), {
          owner: ctx.principal.kind === "owner",
        }),
      ),
  },
};
