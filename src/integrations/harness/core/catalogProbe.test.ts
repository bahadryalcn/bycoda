import { afterEach, describe, expect, it } from "vitest";
import {
  catalogModelsFor,
  hasLiveCatalog,
  resetHarnessModelOverlays,
  type AgentModel,
} from "../../../features/sessions/model/models";
import { applyProbedCatalog, EmptyCatalogProbeError } from "./catalogProbe";

const model = (nativeId: string): AgentModel => ({
  id: `codex:${nativeId}`,
  harness: "codex",
  name: nativeId,
  nativeId,
});

describe("applyProbedCatalog", () => {
  afterEach(() => resetHarnessModelOverlays());

  it("publishes a listed catalog as live", () => {
    applyProbedCatalog("codex", [model("a")]);
    expect(catalogModelsFor("codex").map((item) => item.id)).toEqual(["codex:a"]);
    expect(hasLiveCatalog("codex")).toBe(true);
  });

  it("rejects an empty answer and keeps the last good list", () => {
    applyProbedCatalog("codex", [model("a")]);
    expect(() => applyProbedCatalog("codex", [])).toThrow(EmptyCatalogProbeError);
    expect(() => applyProbedCatalog("codex", [])).toThrow("codex reported no models.");
    expect(catalogModelsFor("codex").map((item) => item.id)).toEqual(["codex:a"]);
    expect(hasLiveCatalog("codex")).toBe(true);
  });

  it("does not turn a stand-in list into a live one", () => {
    applyProbedCatalog("codex", [model("a")], false);
    expect(hasLiveCatalog("codex")).toBe(false);
  });
});
