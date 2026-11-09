import { describe, expect, it, vi } from "vitest";
import type { BrowserPage } from "../social-browser";
import { BrowserTracker, runLayered, visibilityOf } from "./wiring";
import type { LayerStep, LayeredBrowserDriver } from "./types";
import { SOCIAL_BROWSER_RECIPES } from "../social-browser-recipes";

const page = { goto: vi.fn() } as unknown as BrowserPage;
const session = (name: string) => ({
  page: { ...page, name } as unknown as BrowserPage,
  closed: new Promise<void>(() => {}),
  close: vi.fn(async () => {}),
});

describe("browser layer wiring", () => {
  it("runs the recipe directly when no layers are wired", async () => {
    const recipe = vi.fn(async () => "value");
    await expect(runLayered({}, "acc", { name: "poll", recipe })).resolves.toBe("value");
    expect(recipe).toHaveBeenCalledOnce();
  });

  it("hands the step to the layered driver when one is wired", async () => {
    const run = vi.fn(async () => "from-layer");
    const layers: LayeredBrowserDriver = { run: run as LayeredBrowserDriver["run"] };
    const recipe = vi.fn(async () => "direct");
    const step: LayerStep<string> = { name: "send", recipe, outreach: false, jobId: "job" };
    await expect(runLayered({ layers }, "acc", step)).resolves.toBe("from-layer");
    expect(run).toHaveBeenCalledWith("acc", step);
    expect(recipe).not.toHaveBeenCalled();
  });

  it("defaults the visibility of an account browser to hidden", async () => {
    await expect(visibilityOf({}, "acc")).resolves.toBe("hidden");
    await expect(visibilityOf({ visibility: async () => "visible" }, "acc")).resolves.toBe(
      "visible",
    );
  });

  it("tracks the live page of an open session and forgets it on release", () => {
    const tracker = new BrowserTracker();
    const first = session("first");
    const release = tracker.track("acc", first);
    expect(tracker.page("acc")).toBe(first.page);
    release();
    expect(tracker.page("acc")).toBeUndefined();
  });

  it("does not let a stale release remove a newer session's page", () => {
    const tracker = new BrowserTracker();
    const first = session("first");
    const second = session("second");
    const releaseFirst = tracker.track("acc", first);
    tracker.track("acc", second);
    releaseFirst();
    expect(tracker.page("acc")).toBe(second.page);
  });

  it("gives audience readers only to the recipes that have one", () => {
    const readers = Object.fromEntries(
      SOCIAL_BROWSER_RECIPES.map((recipe) => [
        recipe.platform,
        typeof recipe.collectAudience === "function",
      ]),
    );
    expect(readers.snapchat).toBe(true);
    expect(readers.tiktok).toBe(true);
    expect(readers.whatsapp).not.toBe(true);
    expect(readers.x).toBeUndefined();
  });
});
