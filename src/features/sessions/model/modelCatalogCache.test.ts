// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseCachedCatalogs } from "./modelCatalogCache";

const KEY = "bycoda.modelCatalogCache";
const gemini = {
  id: "antigravity:gemini-3.8-flash",
  harness: "antigravity",
  name: "Gemini 3.8 Flash",
  nativeId: "gemini-3.8-flash",
};

describe("model catalog cache", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it("restores only known providers, their own well-formed models and the current version", () => {
    const saved = (v: number, catalogs: unknown) => JSON.stringify({ v, catalogs });
    expect(
      parseCachedCatalogs(
        saved(1, {
          antigravity: [gemini, { id: "x", harness: "codex", name: "X" }, { id: 3 }],
          nope: [{ id: "nope:a", harness: "nope", name: "A" }],
          pi: "broken",
        }),
      ),
    ).toEqual({ antigravity: [gemini] });
    expect(parseCachedCatalogs(saved(0, { antigravity: [gemini] }))).toEqual({});
    expect(() => parseCachedCatalogs("{")).toThrow();
  });

  it("shows the last live list after a restart as provisional until this run probes", async () => {
    const first = await import("./models");
    first.setHarnessModels("antigravity", [gemini as never]);
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({
      v: 1,
      catalogs: { antigravity: [gemini] },
    });

    vi.resetModules();
    const restarted = await import("./models");
    expect(restarted.modelsFor("antigravity").map((model) => model.id)).toEqual([gemini.id]);
    expect(restarted.hasLiveCatalog("antigravity")).toBe(false);
  });

  it("starts from the bundled list when the saved value is corrupt", async () => {
    localStorage.setItem(KEY, "{");
    const models = await import("./models");
    expect(models.hasLiveCatalog("antigravity")).toBe(false);
    expect(models.modelsFor("antigravity").length).toBeGreaterThan(0);
  });
});
