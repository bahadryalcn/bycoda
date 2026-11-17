import { afterEach, expect, it, vi } from "vitest";

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../../connections/public/connections", () => ({ remoteRequest: request }));
vi.mock("../../automations/public/hostMachines", () => ({ machineCapabilities: vi.fn() }));
vi.mock("../../connections/public/localSync", () => ({ isLocalSyncMachine: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { catalogModelFacts } from "./modelCatalogFacts";
import { liveCatalogFacts, refreshLiveCatalogFacts, setLiveCatalogFacts } from "./liveCatalogFacts";

afterEach(() => {
  setLiveCatalogFacts([]);
  request.mockReset();
});

it("keeps the researched table alone while nothing is loaded", () => {
  expect(catalogModelFacts("claude-opus-5-5")).toEqual({ score: 92, inputUsd: 4, outputUsd: 20 });
  expect(catalogModelFacts("acme-9")).toBeUndefined();
});

it("takes live prices but the researched score for a known family", () => {
  setLiveCatalogFacts([
    { family: "claude-opus-5-5", inputUsd: 5, outputUsd: 25, intelligenceIndex: 70 },
    { family: "gpt-6-1-sol", inputUsd: 1.5, outputUsd: 9 },
  ]);
  expect(catalogModelFacts("opus-5-5")).toEqual({ score: 92, inputUsd: 5, outputUsd: 25 });
  expect(catalogModelFacts("claude-opus-5-5-20261101")).toEqual({
    score: 92,
    inputUsd: 5,
    outputUsd: 25,
  });
  expect(catalogModelFacts("codex:gpt-6.1-sol")).toEqual({
    score: 90,
    inputUsd: 1.5,
    outputUsd: 9,
  });
});

it("scores an unknown family as 30 plus its intelligence index, capped at 100", () => {
  setLiveCatalogFacts([
    { family: "acme-9", inputUsd: 1, outputUsd: 3, intelligenceIndex: 48 },
    { family: "acme-max", inputUsd: 1, outputUsd: 3, intelligenceIndex: 90 },
    { family: "acme-blind", inputUsd: 1, outputUsd: 3 },
  ]);
  expect(catalogModelFacts("acme-9")).toEqual({ score: 78, inputUsd: 1, outputUsd: 3 });
  expect(catalogModelFacts("acme-max")?.score).toBe(100);
  expect(catalogModelFacts("acme-blind")).toBeUndefined();
});

it("loads the Host answer, notifies subscribers and survives failures", async () => {
  const listener = vi.fn();
  const stop = liveCatalogFacts.subscribe(listener);
  request.mockResolvedValueOnce({
    source: "openrouter",
    fetchedAt: 1,
    models: [{ family: "grok-4-7", inputUsd: 3, outputUsd: 7 }],
  });
  await refreshLiveCatalogFacts("host");
  expect(request).toHaveBeenCalledWith("host", "modelRouting.catalogFacts", {});
  expect(liveCatalogFacts.snapshot().get("grok-4-7")?.inputUsd).toBe(3);
  expect(listener).toHaveBeenCalledTimes(1);

  request.mockRejectedValueOnce(new Error("old host"));
  await expect(refreshLiveCatalogFacts("host")).resolves.toBeUndefined();
  request.mockResolvedValueOnce({ source: "openrouter", models: [], error: "offline" });
  await refreshLiveCatalogFacts("host");
  expect(liveCatalogFacts.snapshot().get("grok-4-7")).toBeDefined();
  stop();
});
