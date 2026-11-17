import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createCatalogFacts, parseOpenRouterModels } from "./catalog-facts";

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "catalog-facts-"));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

const PAYLOAD = {
  data: [
    {
      id: "anthropic/claude-opus-5.5",
      pricing: { prompt: "0.000004", completion: "0.00002" },
      benchmarks: { artificial_analysis: { intelligence_index: 61.5 } },
    },
    { id: "openai/gpt-6.1-sol", pricing: { prompt: "0.000002", completion: "0.00001" } },
    { id: "x-ai/grok-4.7", pricing: { prompt: "0.000002", completion: "0.000006" } },
    { id: "z-ai/glm-5.3:free", pricing: { prompt: "0", completion: "0" } },
    { id: "openai/gpt-6.1-sol:batch", pricing: { prompt: "0.000001", completion: "0.000005" } },
    { id: "foo/bar-legal", pricing: { prompt: "0.000001", completion: "0.000001" } },
    { id: "~anthropic/claude-opus-latest", pricing: { prompt: "0.000004", completion: "0.00002" } },
    { id: "openai/gpt-6-pro", pricing: { prompt: "0.00003", completion: "0.00018" } },
    { id: "openrouter/auto", pricing: { prompt: "-1", completion: "-1" } },
    { id: "foo/broken", pricing: { prompt: "abc", completion: "1" } },
    {
      id: "foo/bad-index",
      pricing: { prompt: "0.000001", completion: "0.000002" },
      benchmarks: { artificial_analysis: { intelligence_index: null } },
    },
  ],
};

const respond = (body: unknown) =>
  vi.fn(async () => new Response(typeof body === "string" ? body : JSON.stringify(body)));

it("normalizes families and prices and skips variants", () => {
  expect(parseOpenRouterModels(PAYLOAD)).toEqual([
    { family: "claude-opus-5-5", inputUsd: 4, outputUsd: 20, intelligenceIndex: 61.5 },
    { family: "gpt-6-1-sol", inputUsd: 2, outputUsd: 10 },
    { family: "grok-4-7", inputUsd: 2, outputUsd: 6 },
    { family: "bad-index", inputUsd: 1, outputUsd: 2 },
  ]);
});

it("fetches, caches to disk and serves the fresh cache without another request", async () => {
  const fetchMock = respond(PAYLOAD);
  const facts = createCatalogFacts({ directory, fetch: fetchMock, now: () => 1000 });
  const first = await facts.read();
  expect(first.error).toBeUndefined();
  expect(first.fetchedAt).toBe(1000);
  expect(first.models).toHaveLength(4);
  expect(JSON.parse(await readFile(join(directory, "catalog-facts.json"), "utf8")).fetchedAt).toBe(
    1000,
  );
  const again = createCatalogFacts({ directory, fetch: fetchMock, now: () => 2000 });
  expect((await again.read()).models).toHaveLength(4);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("reports bad JSON with an empty list when nothing is cached", async () => {
  const facts = createCatalogFacts({ directory, fetch: respond("not json"), now: () => 1 });
  const result = await facts.read();
  expect(result.models).toEqual([]);
  expect(result.error).toBeTruthy();
  expect(result.fetchedAt).toBeUndefined();
});

it("serves the stale cache when a refresh times out", async () => {
  await createCatalogFacts({ directory, fetch: respond(PAYLOAD), now: () => 0 }).read();
  const hang = vi.fn(
    (_url: unknown, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      }),
  );
  const stale = createCatalogFacts({
    directory,
    fetch: hang as unknown as typeof fetch,
    now: () => 7 * 60 * 60 * 1000,
    deadlineMs: 20,
  });
  const result = await stale.read();
  expect(result.models).toHaveLength(4);
  expect(result.fetchedAt).toBe(0);
  expect(result.error).toBeTruthy();
  // The failure is remembered, so an immediate second read does not hit the network again.
  await stale.read();
  expect(hang).toHaveBeenCalledTimes(1);
});

it("refuses an oversized catalog and survives a corrupt cache file", async () => {
  await writeFile(join(directory, "catalog-facts.json"), "{broken");
  const big = vi.fn(
    async () => new Response("x", { headers: { "content-length": String(6 * 1024 * 1024) } }),
  );
  const result = await createCatalogFacts({ directory, fetch: big, now: () => 1 }).read();
  expect(result.models).toEqual([]);
  expect(result.error).toMatch(/too large/);
});
