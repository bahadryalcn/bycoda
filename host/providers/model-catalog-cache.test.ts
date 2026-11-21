import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodexCatalogStore } from "./codex-catalog-store";
import { ModelCatalogCache } from "./model-catalog-cache";
import type { AgentModel } from "../../src/features/sessions/model/models";

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

it("restores a Codex snapshot after Host restart and clears it on a successful empty result", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bycoda-codex-catalog-"));
  const file = join(directory, "catalog.json");
  const previous = [{ ...model("codex:known"), harness: "codex" as const }];
  const makeCache = (
    discover: () => Promise<AgentModel[]>,
    identity = "account-a",
    environment = "host-a",
  ) =>
    new ModelCatalogCache(["codex"], async () => "v1", discover, undefined, {
      store: new CodexCatalogStore(file, environment),
      identity: async () => identity,
    });
  try {
    await makeCache(async () => previous).read("/project");

    const refresh = deferred();
    const restarted = makeCache(() => refresh.promise);
    expect(await restarted.read("/project", true)).toMatchObject({
      models: { codex: previous },
      pending: ["codex"],
    });
    const complete = restarted.read("/project");
    refresh.reject(new Error("initialize timeout"));
    expect(await complete).toMatchObject({
      models: { codex: previous },
      errors: { codex: "initialize timeout" },
    });

    const offline = () => Promise.reject(new Error("offline"));
    expect((await makeCache(offline).read("/elsewhere")).models.codex).toEqual([]);
    expect((await makeCache(offline, "account-b").read("/project")).models.codex).toEqual([]);
    expect((await makeCache(offline, "account-a", "host-b").read("/project")).models.codex).toEqual(
      [],
    );
    expect((await makeCache(async () => []).read("/project")).models.codex).toEqual([]);
    expect((await makeCache(offline).read("/project")).models.codex).toEqual([]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("does not publish a late result after the default Codex profile changes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bycoda-codex-catalog-"));
  try {
    let identity = "account-a";
    const old = deferred();
    let beginOld!: () => void;
    const started = new Promise<void>((resolve) => (beginOld = resolve));
    const store = new CodexCatalogStore(join(directory, "catalog.json"), "host");
    const replacement = [{ ...model("codex:new"), harness: "codex" as const }];
    const cache = new ModelCatalogCache(
      ["codex"],
      async () => "v1",
      async () => {
        if (identity === "account-a") {
          beginOld();
          return old.promise;
        }
        return replacement;
      },
      undefined,
      { store, identity: async () => identity },
    );
    const previous = cache.read("/project");
    await started;
    identity = "account-b";
    expect((await cache.read("/project")).models.codex).toEqual(replacement);
    old.resolve([{ ...model("codex:old"), harness: "codex" }]);
    expect((await previous).models.codex).toEqual([]);
    expect(await store.read("/project", "account-a")).toBeUndefined();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

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

it("calls onChange only when the catalog differs from what was last read", async () => {
  vi.useFakeTimers();
  const slow = deferred();
  const onChange = vi.fn();
  const cache = new ModelCatalogCache(
    ["codex", "pi"],
    async () => "v1",
    (provider) => (provider === "codex" ? Promise.resolve([model("codex:a")]) : slow.promise),
    onChange,
  );
  const read = cache.read("/p", true);
  await vi.advanceTimersByTimeAsync(150);
  expect((await read).pending).toEqual(["pi"]);
  const before = onChange.mock.calls.length;
  slow.resolve([model("pi:a")]);
  await vi.advanceTimersByTimeAsync(0);
  expect(onChange.mock.calls.length).toBeGreaterThan(before);
  expect((await cache.read("/p", true)).pending).toBeUndefined();
  // A fresh entry revalidates silently: the re-read neither shows pending nor notifies.
  const settled = onChange.mock.calls.length;
  await vi.advanceTimersByTimeAsync(0);
  expect(onChange).toHaveBeenCalledTimes(settled);
  cache.clear();
  expect(onChange).toHaveBeenCalledTimes(settled + 1);
});

it("lets a subscriber that re-reads on every change settle instead of looping", async () => {
  let cache!: ModelCatalogCache;
  let reloads = 0;
  const discover = vi.fn(async () => [model("codex:a")]);
  cache = new ModelCatalogCache(
    ["codex"],
    async () => "v1",
    discover,
    () => {
      reloads++;
      if (reloads < 50) void cache.read("/p", true).catch(() => {});
    },
  );
  await cache.read("/p");
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(reloads).toBeLessThan(5);
  expect(discover).toHaveBeenCalledTimes(1);
});

it("keeps reading when the onChange listener throws", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const cache = new ModelCatalogCache(
    ["codex"],
    async () => "v1",
    async () => [model("codex:a")],
    () => {
      throw new Error("boom");
    },
  );
  expect((await cache.read("/p")).models.codex).toEqual([model("codex:a")]);
  warn.mockRestore();
});
