import { describe, expect, it } from "vitest";
import type { SocialActionContext } from "../core/social-actions";
import { browserLayerActions } from "./browser-layer-actions";
import { NeedsHumanQueue } from "./needs-human";
import { RecipeHealing } from "./healing";
import { memorySettings } from "./test-support";

function context(store = memorySettings(), kind: "owner" | "session" = "owner") {
  const service = {
    account: async (id: string) => ({ id, platform: "instagram" }),
  };
  return {
    store,
    ctx: {
      service,
      store,
      now: () => 1,
      principal: { kind, actorId: kind },
      operationId: "op",
    } as unknown as SocialActionContext,
  };
}

describe("browser layer actions", () => {
  it("lists waiting items in the client shape without the page URL", async () => {
    const { store, ctx } = context();
    await new NeedsHumanQueue(
      store,
      () => 3,
      () => "n1",
    ).open({
      accountId: "acc",
      kind: "suspicious_login",
      url: "https://x.example/checkpoint?token=secret",
      screenshotId: "shot",
    });
    const result = (await browserLayerActions["browser.needsHuman.list"]!.run(ctx, {})) as {
      items: Record<string, unknown>[];
    };
    expect(result.items).toEqual([
      {
        id: "n1",
        accountId: "acc",
        platform: "instagram",
        reason: "challenge",
        at: 3,
        screenshotRef: "shot",
      },
    ]);
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("refuses an approval from a non-owner principal", async () => {
    const { store, ctx } = context(memorySettings(), "session");
    await new RecipeHealing(
      store,
      () => 1,
      () => "s1",
    ).suggest({
      accountId: "acc",
      platform: "x",
      step: "send",
      selector: "html > body:nth-child(2)",
      source: "decision",
    });
    await expect(
      browserLayerActions["browser.recipeSuggestions.approve"]!.run(ctx, { id: "s1" }),
    ).rejects.toThrow("Only the owner");
  });

  it("rejects an invalid identifier before touching the store", async () => {
    const { ctx } = context();
    await expect(
      browserLayerActions["browser.needsHuman.resolve"]!.run(ctx, { id: "" }),
    ).rejects.toThrow("Identifier is invalid");
  });
});
