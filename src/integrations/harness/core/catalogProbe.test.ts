import { afterEach, describe, expect, it, vi } from "vitest";
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

  it("replays the latest probe when the session catalog loads after discovery", async () => {
    vi.resetModules();
    const probes = await import("./catalogProbe");
    probes.applyProbedCatalog("codex", [model("older")], false);
    probes.applyProbedCatalog("codex", [model("latest")]);

    const sessionCatalog = await import("../../../features/sessions/model/models");
    expect(sessionCatalog.catalogModelsFor("codex").map((item) => item.id)).toEqual([
      "codex:latest",
    ]);
    expect(sessionCatalog.hasLiveCatalog("codex")).toBe(true);
  });
});
