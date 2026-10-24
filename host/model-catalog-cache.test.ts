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
  await vi.advanceTimersByTimeAsync(30_000);
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

it("backs off failed discovery between reads while explicit refresh and binary changes retry immediately", async () => {
  vi.useFakeTimers();
  let binary = "v1";
  const discover = vi.fn(async () => {
    throw new Error("Login required");
  });
  const cache = new ModelCatalogCache(["codex"], async () => binary, discover);
  await cache.read("/project");
  for (let index = 0; index < 20; index++) await cache.read("/project");
  expect(discover).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(30_000);
  await cache.read("/project");
  expect(discover).toHaveBeenCalledTimes(2);
  await cache.read("/project", false, true);
  expect(discover).toHaveBeenCalledTimes(3);
  binary = "v2";
  await cache.read("/project");
  expect(discover).toHaveBeenCalledTimes(4);
});

it("releases settled project catalogs while retaining recently used project results", async () => {
  const discover = vi.fn(async (_provider: string, cwd: string) => [model(cwd)]);
  const cache = new ModelCatalogCache(["codex"], async () => "v1", discover);
  for (let index = 0; index < 40; index++) await cache.read(`/project-${index}`);
  await cache.read("/project-39");
  expect(discover).toHaveBeenCalledTimes(40);
  await cache.read("/project-0");
  expect(discover).toHaveBeenCalledTimes(41);
});

it("shares forced reads with in-flight catalogs even beyond the settled cache limit", async () => {
  vi.useFakeTimers();
  const waiting = Array.from({ length: 40 }, deferred);
  const discover = vi.fn((_provider: string, cwd: string) => waiting[Number(cwd.slice(1))].promise);
  const cache = new ModelCatalogCache(["codex"], async () => "v1", discover);
  const previews = waiting.map((_, index) => cache.read(`/${index}`, true));
  await vi.advanceTimersByTimeAsync(150);
  await Promise.all(previews);
  const forced = cache.read("/0", false, true);
  expect(discover).toHaveBeenCalledTimes(40);
  waiting.forEach((pending, index) => pending.resolve([model(String(index))]));
  expect((await forced).models.codex).toEqual([model("0")]);
  expect(discover).toHaveBeenCalledTimes(40);
});

it("does not retain an oversized settled catalog beyond the shared byte budget", async () => {
  const discover = vi.fn(async () => [model("x".repeat(9 * 1024 * 1024))]);
  const cache = new ModelCatalogCache(["codex"], async () => "v1", discover);
  await cache.read("/large");
  await cache.read("/large");
  expect(discover).toHaveBeenCalledTimes(2);
});
