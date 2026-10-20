import { afterEach, expect, it, vi } from "vitest";
import { ModelCatalogCache } from "./model-catalog-cache";
import type { AgentModel } from "../src/features/sessions/model/models";

afterEach(() => vi.useRealTimers());
const model = (id: string): AgentModel => ({ id, name: id });
const deferred = () => {
  let resolve!: (models: AgentModel[]) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<AgentModel[]>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

it("publishes a fast provider within 150ms while sharing a slow discovery across callers", async () => {
  vi.useFakeTimers();
  const slow = deferred();
  const discover = vi.fn((provider: string) =>
    provider === "codex" ? Promise.resolve([model("codex:fast")]) : slow.promise,
  );
  const cache = new ModelCatalogCache(["codex", "pi"], async () => "v1", discover);
  const first = cache.read("/project", true);
  const second = cache.read("/project", true);
  await vi.advanceTimersByTimeAsync(150);
  expect(await first).toEqual({
    models: { codex: [model("codex:fast")] },
    errors: {},
    pending: ["pi"],
  });
  expect(await second).toEqual(await first);
  expect(discover).toHaveBeenCalledTimes(2);
  // A caller needing the complete catalog still waits for the same discovery.
  const complete = cache.read("/project");
  slow.resolve([model("pi:slow")]);
  expect((await complete).models.pi).toEqual([model("pi:slow")]);
  expect((await cache.read("/project", true)).pending).toBeUndefined();
  expect(discover).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
});

it("bounds the initial binary lookup too, without starting duplicate work", async () => {
  vi.useFakeTimers();
  let ready!: (value: string) => void;
  const fingerprint = vi.fn(
    () =>
      new Promise<string>((resolve) => {
        ready = resolve;
      }),
  );
  const discover = vi.fn(async () => [model("codex:test")]);
  const cache = new ModelCatalogCache(["codex"], fingerprint, discover);
  const preview = cache.read("/project", true);
  await vi.advanceTimersByTimeAsync(150);
  expect(await preview).toEqual({ models: {}, errors: {}, pending: ["codex"] });
  const complete = cache.read("/project");
  ready("v1");
  expect((await complete).models.codex).toHaveLength(1);
  expect(fingerprint).toHaveBeenCalledTimes(1);
});

it("keeps usable cached models during refresh and retries only the failed provider", async () => {
  vi.useFakeTimers();
  const slow = deferred();
  let version = "v1";
  const discover = vi.fn(async (provider: string) => [model(`${provider}:${version}`)]);
  const cache = new ModelCatalogCache(["codex", "pi"], async () => version, discover);
  await cache.read("/project");
  version = "v2";
  discover.mockImplementation((provider) =>
    provider === "pi" ? slow.promise : Promise.resolve([model("codex:v2")]),
  );
  const preview = cache.read("/project", true);
  await vi.advanceTimersByTimeAsync(150);
  expect((await preview).models).toEqual({ codex: [model("codex:v2")], pi: [model("pi:v1")] });
  const complete = cache.read("/project");
  slow.reject(new Error("Login required"));
  expect((await complete).errors.pi).toBe("Login required");
  discover.mockResolvedValue([model("pi:v2")]);
  expect((await cache.read("/project")).models.pi).toEqual([model("pi:v2")]);
  expect(discover.mock.calls.map(([provider]) => provider)).toEqual([
    "codex",
    "pi",
    "codex",
    "pi",
    "pi",
  ]);
});

it("refreshes after the TTL and isolates project caches and explicit invalidation", async () => {
  vi.useFakeTimers();
  const discover = vi.fn(async (_provider: string, cwd: string) => [model(cwd)]);
  const cache = new ModelCatalogCache(["codex"], async () => "v1", discover);
  await cache.read("/a");
  await vi.advanceTimersByTimeAsync(4 * 60_000);
  await cache.read("/a");
  await cache.read("/b");
  expect(discover).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(60_000);
  await cache.read("/a");
  expect(discover).toHaveBeenCalledTimes(3);
  cache.clear();
  await cache.read("/a");
  expect(discover).toHaveBeenCalledTimes(4);
});
