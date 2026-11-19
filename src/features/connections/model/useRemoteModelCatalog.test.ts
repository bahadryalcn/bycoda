// @vitest-environment happy-dom
import { act, createElement, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HostModelCatalog } from "./protocol";
import { reloadRemoteModelCatalogStoreForTests } from "./remoteModelCatalogStore";

const host = vi.hoisted(() => ({
  capabilities: undefined as string[] | undefined,
  runtimeAvailable: true,
  released: 0,
  retains: [] as {
    target: unknown;
    consumer: {
      parse(data: unknown): unknown;
      commit(value: unknown, input: { isCurrent(): boolean }): void;
      closed?(): void;
      onError?(error: unknown): void;
    };
  }[],
}));

vi.mock("./connections", () => ({
  cachedRemoteCapabilities: () => host.capabilities,
  subscribeRemoteCapabilities: () => () => {},
}));
vi.mock("./remoteMachineChannel", () => ({
  acquireRemoteHostRuntime: () =>
    host.runtimeAvailable
      ? {
          runtime: {
            retain: (target: unknown, consumer: (typeof host.retains)[number]["consumer"]) => {
              host.retains.push({ target, consumer });
              return () => void host.released++;
            },
          },
          release: () => {},
        }
      : undefined,
}));
import {
  forgetRemoteModelCatalogMemoryForTests,
  remoteModelCatalogScopeKey,
  resetRemoteModelCatalogCacheForTests,
  useRemoteModelCatalog,
  type RemoteModelCatalogScope,
} from "./useRemoteModelCatalog";

type Result = ReturnType<typeof useRemoteModelCatalog>;
type Request = <T>(method: string, params?: unknown) => Promise<T>;

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const asRequest = (fn: unknown) => fn as Request;

const scopeA: RemoteModelCatalogScope = {
  machineId: "machine",
  environmentId: "env",
  projectId: "project-a",
};
const scopeB: RemoteModelCatalogScope = {
  machineId: "machine",
  environmentId: "env",
  projectId: "project-b",
};

const catalog = (id: string, pending?: HostModelCatalog["pending"]): HostModelCatalog => ({
  models: { codex: [{ id, label: id }] as never },
  errors: {},
  ...(pending ? { pending } : {}),
});

const projectOf = (params: unknown) => (params as { projectId: string }).projectId;

let container: HTMLDivElement;
let root: Root;
let latest: Result;

function Probe(props: {
  scope: RemoteModelCatalogScope;
  enabled: boolean;
  hostEnvironmentId?: string;
  request: Request;
}) {
  const probed = useRemoteModelCatalog({
    scope: props.scope,
    enabled: props.enabled,
    hostEnvironmentId: props.hostEnvironmentId,
    request: props.request,
  });
  // Publish the committed value to the test after render, not during it.
  useLayoutEffect(() => {
    latest = probed;
  });
  return null;
}

async function render(props: Parameters<typeof Probe>[0]) {
  await act(async () => {
    root.render(createElement(Probe, props));
  });
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

const ids = (value: HostModelCatalog | undefined) => value?.models.codex?.map((model) => model.id);

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  resetRemoteModelCatalogCacheForTests();
  host.capabilities = undefined;
  host.runtimeAvailable = true;
  host.released = 0;
  host.retains = [];
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useRemoteModelCatalog", () => {
  it("keys scopes by machine, environment and project", () => {
    expect(remoteModelCatalogScopeKey(scopeA)).not.toBe(remoteModelCatalogScopeKey(scopeB));
    expect(remoteModelCatalogScopeKey({ ...scopeA, environmentId: "other" })).not.toBe(
      remoteModelCatalogScopeKey(scopeA),
    );
    expect(remoteModelCatalogScopeKey({ ...scopeA, machineId: "other" })).not.toBe(
      remoteModelCatalogScopeKey(scopeA),
    );
    expect(remoteModelCatalogScopeKey(scopeA)).toBe(remoteModelCatalogScopeKey({ ...scopeA }));
  });

  it("reads the progressive catalog for the project and exposes it", async () => {
    const request = vi.fn(async () => catalog("a1"));
    await render({ scope: scopeA, enabled: true, request: asRequest(request) });
    await flush();
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith("models.list", {
      projectId: "project-a",
      progressive: true,
    });
    expect(ids(latest.catalog)).toEqual(["a1"]);
    expect(latest.error).toBe("");
  });

  it("does not read while disabled and reads once enabled", async () => {
    const request = vi.fn(async () => catalog("a1"));
    await render({ scope: scopeA, enabled: false, request: asRequest(request) });
    await flush();
    expect(request).not.toHaveBeenCalled();
    expect(latest.catalog).toBeUndefined();

    await render({ scope: scopeA, enabled: true, request: asRequest(request) });
    await flush();
    expect(request).toHaveBeenCalledTimes(1);
    expect(ids(latest.catalog)).toEqual(["a1"]);
  });

  it("drops a read that finishes after the pane was disabled", async () => {
    const pending = deferred<HostModelCatalog>();
    const request = vi.fn(() => pending.promise);
    await render({ scope: scopeA, enabled: true, request: asRequest(request) });
    await render({ scope: scopeA, enabled: false, request: asRequest(request) });
    pending.resolve(catalog("late"));
    await flush();
    expect(latest.catalog).toBeUndefined();
  });

  it("never shows scope A's catalog in scope B when A's read resolves late", async () => {
    const readA = deferred<HostModelCatalog>();
    const readB = deferred<HostModelCatalog>();
    const request = vi.fn((_method: string, params?: unknown) =>
      projectOf(params) === "project-a" ? readA.promise : readB.promise,
    );

    await render({ scope: scopeA, enabled: true, request: asRequest(request) });
    await render({ scope: scopeB, enabled: true, request: asRequest(request) });
    expect(request).toHaveBeenCalledTimes(2);
    expect(latest.catalog).toBeUndefined();

    readA.resolve(catalog("from-a"));
    await flush();
    expect(latest.catalog).toBeUndefined();
    expect(latest.error).toBe("");

    readB.resolve(catalog("from-b"));
    await flush();
    expect(ids(latest.catalog)).toEqual(["from-b"]);
  });

  it("does not leak scope A's catalog or error into B while B is still loading", async () => {
    const readB = deferred<HostModelCatalog>();
    const request = vi.fn((_method: string, params?: unknown) =>
      projectOf(params) === "project-a" ? Promise.resolve(catalog("from-a")) : readB.promise,
    );
    await render({ scope: scopeA, enabled: true, request: asRequest(request) });
    await flush();
    expect(ids(latest.catalog)).toEqual(["from-a"]);

    await render({ scope: scopeB, enabled: true, request: asRequest(request) });
    expect(latest.catalog).toBeUndefined();
    expect(latest.error).toBe("");
  });

  it("does not leak scope A's read error into B", async () => {
    const readA = deferred<HostModelCatalog>();
    const readB = deferred<HostModelCatalog>();
    const request = vi.fn((_method: string, params?: unknown) =>
      projectOf(params) === "project-a" ? readA.promise : readB.promise,
    );
    await render({ scope: scopeA, enabled: true, request: asRequest(request) });
    await render({ scope: scopeB, enabled: true, request: asRequest(request) });
    readA.reject(new Error("a failed"));
    await flush();
    expect(latest.error).toBe("");
    expect(latest.catalog).toBeUndefined();
  });

  it("surfaces a read error for the active scope and keeps its previous catalog", async () => {
    let fail = false;
    const request = vi.fn(async () => {
      if (fail) throw new Error("host down");
      return catalog("a1");
    });
    await render({ scope: scopeA, enabled: true, request: asRequest(request) });
    await flush();
    fail = true;
    await act(async () => latest.refresh());
    await flush();
    expect(latest.error).toContain("host down");
    expect(ids(latest.catalog)).toEqual(["a1"]);
  });

  it("reports loading from a refresh until its read answers or fails", async () => {
    let finish: (value: HostModelCatalog) => void = () => {};
    let hang = false;
    const request = vi.fn(async () => {
      if (hang) return new Promise<HostModelCatalog>((resolve) => (finish = resolve));
      throw new Error("host down");
    });
    await render({ scope: scopeA, enabled: true, request: asRequest(request) });
    await flush();
    expect(latest.error).toContain("host down");
    expect(latest.loading).toBe(false);
    hang = true;
    await act(async () => latest.refresh());
    // The earlier error stays visible while the retry is in flight.
    expect(latest.loading).toBe(true);
    expect(latest.error).toContain("host down");
    await act(async () => finish(catalog("a1")));
    await flush();
    expect(latest.loading).toBe(false);
    expect(latest.error).toBe("");
  });

  it("returning to scope A uses its cache immediately", async () => {
    const request = vi.fn(async (_method: string, params?: unknown) =>
      projectOf(params) === "project-a" ? catalog("from-a") : catalog("from-b"),
    );
    await render({ scope: scopeA, enabled: true, request: asRequest(request) });
    await flush();
    await render({ scope: scopeB, enabled: true, request: asRequest(request) });
    await flush();
    expect(ids(latest.catalog)).toEqual(["from-b"]);

    // The next read for A never settles: the cached catalog must show meanwhile.
    const never = deferred<HostModelCatalog>();
    const stalled = vi.fn(() => never.promise);
    await render({ scope: scopeA, enabled: true, request: asRequest(stalled) });
    expect(ids(latest.catalog)).toEqual(["from-a"]);
  });

  it("a new hook instance starts from the cached catalog of its scope", async () => {
    const first = vi.fn(async () => catalog("cached"));
    await render({ scope: scopeA, enabled: true, request: asRequest(first) });
    await flush();
    await act(async () => root.unmount());
    root = createRoot(container);
    const never = deferred<HostModelCatalog>();
    await render({ scope: scopeA, enabled: true, request: asRequest(() => never.promise) });
    expect(ids(latest.catalog)).toEqual(["cached"]);
  });

  describe("pending re-poll", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    it("re-polls after 1000ms while pending and stops once pending is empty", async () => {
      const responses = [catalog("p1", ["codex"]), catalog("p2", ["claude"]), catalog("done", [])];
      let calls = 0;
      const request = vi.fn(async () => responses[Math.min(calls++, responses.length - 1)]);
      await render({ scope: scopeA, enabled: true, request: asRequest(request) });
      await flush();
      expect(request).toHaveBeenCalledTimes(1);
      expect(ids(latest.catalog)).toEqual(["p1"]);

      await advance(999);
      expect(request).toHaveBeenCalledTimes(1);

      await advance(1);
      expect(request).toHaveBeenCalledTimes(2);
      expect(ids(latest.catalog)).toEqual(["p2"]);

      // The next wait doubles: 2 s.
      await advance(1999);
      expect(request).toHaveBeenCalledTimes(2);
      await advance(1);
      expect(request).toHaveBeenCalledTimes(3);
      expect(ids(latest.catalog)).toEqual(["done"]);

      await advance(10_000);
      expect(request).toHaveBeenCalledTimes(3);
    });

    it("backs off while pending, caps the wait at 30 s and stops after ten re-reads", async () => {
      const request = vi.fn(async () => catalog("slow", ["codex"]));
      await render({ scope: scopeA, enabled: true, request: asRequest(request) });
      await flush();
      const waits = [1000, 2000, 4000, 8000, 16_000, 30_000, 30_000, 30_000, 30_000, 30_000];
      for (const [index, wait] of waits.entries()) {
        await advance(wait - 1);
        expect(request).toHaveBeenCalledTimes(index + 1);
        await advance(1);
        expect(request).toHaveBeenCalledTimes(index + 2);
      }
      await advance(120_000);
      expect(request).toHaveBeenCalledTimes(waits.length + 1);
      expect(ids(latest.catalog)).toEqual(["slow"]);

      // A refresh starts over with a fresh budget.
      await act(async () => latest.refresh());
      await flush();
      expect(request).toHaveBeenCalledTimes(waits.length + 2);
      await advance(1000);
      expect(request).toHaveBeenCalledTimes(waits.length + 3);
    });

    it("retries a failed read with backoff, keeps the last catalog and recovers", async () => {
      let calls = 0;
      const request = vi.fn(async () => {
        calls++;
        if (calls === 1) return catalog("good", ["codex"]);
        if (calls <= 3) throw new Error("blip");
        return catalog("recovered", []);
      });
      await render({ scope: scopeA, enabled: true, request: asRequest(request) });
      await flush();
      await advance(1000);
      expect(latest.error).toContain("blip");
      expect(ids(latest.catalog)).toEqual(["good"]);
      expect(latest.stale).toBe(true);

      // First retry after 1 s fails again, the second waits 2 s and succeeds.
      await advance(1000);
      expect(request).toHaveBeenCalledTimes(3);
      expect(latest.error).toContain("blip");
      await advance(1999);
      expect(request).toHaveBeenCalledTimes(3);
      await advance(1);
      expect(request).toHaveBeenCalledTimes(4);
      expect(latest.error).toBe("");
      expect(ids(latest.catalog)).toEqual(["recovered"]);
      expect(latest.stale).toBe(false);

      await advance(60_000);
      expect(request).toHaveBeenCalledTimes(4);
    });

    it("gives up retrying a failing read after eight retries until refresh", async () => {
      const request = vi.fn(async () => {
        throw new Error("host down");
      });
      await render({ scope: scopeA, enabled: true, request: asRequest(request) });
      await flush();
      await advance(300_000);
      expect(request).toHaveBeenCalledTimes(9);
      expect(latest.error).toContain("host down");

      await act(async () => latest.refresh());
      await flush();
      expect(request).toHaveBeenCalledTimes(10);
      await advance(1000);
      expect(request).toHaveBeenCalledTimes(11);
    });

    it("holds a due read while the window is hidden and runs it when shown", async () => {
      const request = vi.fn(async () => catalog("p", ["codex"]));
      await render({ scope: scopeA, enabled: true, request: asRequest(request) });
      await flush();
      Object.defineProperty(document, "hidden", { configurable: true, value: true });
      try {
        await advance(60_000);
        expect(request).toHaveBeenCalledTimes(1);
        Object.defineProperty(document, "hidden", { configurable: true, value: false });
        await act(async () => {
          document.dispatchEvent(new Event("visibilitychange"));
        });
        await flush();
        expect(request).toHaveBeenCalledTimes(2);
        // Showing the window again without a held read starts nothing.
        await act(async () => {
          document.dispatchEvent(new Event("visibilitychange"));
        });
        expect(request).toHaveBeenCalledTimes(2);
      } finally {
        Reflect.deleteProperty(document, "hidden");
      }
    });

    it("does not re-poll when pending is absent", async () => {
      const request = vi.fn(async () => catalog("a1"));
      await render({ scope: scopeA, enabled: true, request: asRequest(request) });
      await flush();
      await advance(5000);
      expect(request).toHaveBeenCalledTimes(1);
    });

    it("cancels a scheduled re-poll when the scope changes or the pane is disabled", async () => {
      const request = vi.fn(async (_method: string, params?: unknown) =>
        projectOf(params) === "project-a" ? catalog("a-pending", ["codex"]) : catalog("b-done"),
      );
      await render({ scope: scopeA, enabled: true, request: asRequest(request) });
      await flush();
      expect(request).toHaveBeenCalledTimes(1);

      await render({ scope: scopeB, enabled: true, request: asRequest(request) });
      await flush();
      expect(request).toHaveBeenCalledTimes(2);
      await advance(5000);
      // Neither A's timer nor a B re-poll fired.
      expect(request).toHaveBeenCalledTimes(2);

      await render({ scope: scopeA, enabled: true, request: asRequest(request) });
      await flush();
      expect(request).toHaveBeenCalledTimes(3);
      await render({ scope: scopeA, enabled: false, request: asRequest(request) });
      await advance(5000);
      expect(request).toHaveBeenCalledTimes(3);
    });

    it("refresh() restarts the read, and the restart resumes the pending poll", async () => {
      let pending = false;
      let calls = 0;
      const request = vi.fn(async () => catalog(`r${++calls}`, pending ? ["codex"] : []));
      await render({ scope: scopeA, enabled: true, request: asRequest(request) });
      await flush();
      expect(request).toHaveBeenCalledTimes(1);

      pending = true;
      await act(async () => latest.refresh());
      await flush();
      expect(request).toHaveBeenCalledTimes(2);
      expect(ids(latest.catalog)).toEqual(["r2"]);

      await advance(1000);
      expect(request).toHaveBeenCalledTimes(3);
    });

    it("refresh() discards the in-flight read of the replaced effect", async () => {
      const first = deferred<HostModelCatalog>();
      const second = deferred<HostModelCatalog>();
      const reads = [first, second];
      let calls = 0;
      const request = vi.fn(() => reads[calls++]!.promise);
      await render({ scope: scopeA, enabled: true, request: asRequest(request) });
      await act(async () => latest.refresh());
      expect(request).toHaveBeenCalledTimes(2);

      first.resolve(catalog("stale-first"));
      await flush();
      expect(latest.catalog).toBeUndefined();

      second.resolve(catalog("fresh-second"));
      await flush();
      expect(ids(latest.catalog)).toEqual(["fresh-second"]);
    });

    it("a replaced Host environment restarts the read", async () => {
      let calls = 0;
      const request = vi.fn(async () => catalog(`h${++calls}`));
      await render({
        scope: scopeA,
        enabled: true,
        hostEnvironmentId: "env-1",
        request: asRequest(request),
      });
      await flush();
      expect(request).toHaveBeenCalledTimes(1);
      await render({
        scope: scopeA,
        enabled: true,
        hostEnvironmentId: "env-2",
        request: asRequest(request),
      });
      await flush();
      expect(request).toHaveBeenCalledTimes(2);
      expect(ids(latest.catalog)).toEqual(["h2"]);
    });

    it("uses the latest request function without restarting the read", async () => {
      const first = vi.fn(async () => catalog("first", ["codex"]));
      const second = vi.fn(async () => catalog("second", []));
      await render({ scope: scopeA, enabled: true, request: asRequest(first) });
      await flush();
      await render({ scope: scopeA, enabled: true, request: asRequest(second) });
      expect(first).toHaveBeenCalledTimes(1);
      expect(second).not.toHaveBeenCalled();

      await advance(1000);
      expect(first).toHaveBeenCalledTimes(1);
      expect(second).toHaveBeenCalledTimes(1);
      expect(ids(latest.catalog)).toEqual(["second"]);
    });
  });

  describe("persisted seed and stale flag", () => {
    it("seeds from the persisted catalog after a restart and is stale until a response", async () => {
      const first = vi.fn(async () => catalog("saved"));
      await render({ scope: scopeA, enabled: true, request: asRequest(first) });
      await flush();
      expect(latest.stale).toBe(false);
      await act(async () => root.unmount());
      // Simulate a restart: memory caches are gone, storage remains.
      reloadRemoteModelCatalogStoreForTests();
      forgetRemoteModelCatalogMemoryForTests();
      root = createRoot(container);
      const never = deferred<HostModelCatalog>();
      await render({ scope: scopeA, enabled: true, request: asRequest(() => never.promise) });
      expect(ids(latest.catalog)).toEqual(["saved"]);
      expect(latest.stale).toBe(true);
      never.resolve(catalog("live"));
      await flush();
      expect(ids(latest.catalog)).toEqual(["live"]);
      expect(latest.stale).toBe(false);
    });

    it("is stale again after a read error and not stale without a catalog", async () => {
      let fail = false;
      const request = vi.fn(async () => {
        if (fail) throw new Error("down");
        return catalog("a1");
      });
      await render({ scope: scopeA, enabled: true, request: asRequest(request) });
      expect(latest.stale).toBe(false);
      await flush();
      fail = true;
      await act(async () => latest.refresh());
      await flush();
      expect(latest.error).toContain("down");
      expect(latest.stale).toBe(true);
    });
  });

  describe("stream mode", () => {
    beforeEach(() => {
      host.capabilities = ["models.catalog.stream.v1"];
    });

    it("retains a models target, applies snapshots and does not poll", async () => {
      const request = vi.fn(async () => catalog("polled"));
      await render({ scope: scopeA, enabled: true, request: asRequest(request) });
      expect(request).not.toHaveBeenCalled();
      expect(host.retains).toHaveLength(1);
      expect(host.retains[0]!.target).toEqual({ kind: "models", projectId: "project-a" });
      const { consumer } = host.retains[0]!;
      await act(async () =>
        consumer.commit(consumer.parse(catalog("pushed")), { isCurrent: () => true }),
      );
      expect(ids(latest.catalog)).toEqual(["pushed"]);
      expect(latest.stale).toBe(false);
      await act(async () =>
        consumer.commit(consumer.parse(catalog("pushed2")), { isCurrent: () => true }),
      );
      expect(ids(latest.catalog)).toEqual(["pushed2"]);
      expect(request).not.toHaveBeenCalled();
    });

    it("rejects a malformed snapshot at the parse boundary", async () => {
      await render({ scope: scopeA, enabled: true, request: asRequest(vi.fn()) });
      const { consumer } = host.retains[0]!;
      expect(() => consumer.parse({ models: "nope", errors: {} })).toThrow();
      expect(() => consumer.parse(null)).toThrow();
    });

    it("releases the stream when disabled", async () => {
      await render({ scope: scopeA, enabled: true, request: asRequest(vi.fn()) });
      await render({ scope: scopeA, enabled: false, request: asRequest(vi.fn()) });
      expect(host.released).toBe(1);
    });

    it("falls back to polling when the stream errors or closes", async () => {
      const request = vi.fn(async () => catalog("polled"));
      await render({ scope: scopeA, enabled: true, request: asRequest(request) });
      await act(async () => host.retains[0]!.consumer.onError?.(new Error("ws down")));
      await flush();
      expect(request).toHaveBeenCalledWith("models.list", {
        projectId: "project-a",
        progressive: true,
      });
      expect(ids(latest.catalog)).toEqual(["polled"]);
      expect(latest.error).toBe("");
      expect(host.retains).toHaveLength(1);

      // A refresh tries the stream again.
      await act(async () => latest.refresh());
      expect(host.retains).toHaveLength(2);
    });

    it("polls when no WS runtime is available", async () => {
      host.runtimeAvailable = false;
      const request = vi.fn(async () => catalog("polled"));
      await render({ scope: scopeA, enabled: true, request: asRequest(request) });
      await flush();
      expect(host.retains).toHaveLength(0);
      expect(ids(latest.catalog)).toEqual(["polled"]);
    });
  });

  it("polls when the Host lacks the stream capability", async () => {
    host.capabilities = ["transport.ws.sessions.v2"];
    const request = vi.fn(async () => catalog("polled"));
    await render({ scope: scopeA, enabled: true, request: asRequest(request) });
    await flush();
    expect(host.retains).toHaveLength(0);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("bounds the cache and evicts the least recently used scope", async () => {
    const request = vi.fn(async (_method: string, params?: unknown) => catalog(projectOf(params)));
    // 65 distinct scopes: the oldest (p0) must be evicted, p64 kept.
    for (let index = 0; index < 65; index++) {
      await render({
        scope: { ...scopeA, projectId: `p${index}` },
        enabled: true,
        request: asRequest(request),
      });
      await flush();
    }
    const never = deferred<HostModelCatalog>();
    const stalled = asRequest(() => never.promise);
    await render({ scope: { ...scopeA, projectId: "p0" }, enabled: true, request: stalled });
    expect(latest.catalog).toBeUndefined();
    await render({ scope: { ...scopeA, projectId: "p64" }, enabled: true, request: stalled });
    expect(ids(latest.catalog)).toEqual(["p64"]);
  });
});
