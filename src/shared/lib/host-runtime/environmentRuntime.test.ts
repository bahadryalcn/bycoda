import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EnvironmentRuntime,
  HostCommandUncertainError,
  HostRpcUncertainError,
} from "./environmentRuntime";
import type { ManagedHostConnectionPort, ManagedHostEvent } from "./ports";

const runtimes: EnvironmentRuntime[] = [];
afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.close();
});
async function flush() {
  for (let index = 0; index < 15; index++) await Promise.resolve();
}
function fixture() {
  let listener: ((event: ManagedHostEvent) => void) | undefined;
  let generation = 1;
  const stopListening = vi.fn();
  const port: ManagedHostConnectionPort = {
    listen: vi.fn(async (callback) => {
      listener = callback;
      return stopListening;
    }),
    attach: vi.fn(async () => {
      listener?.({ kind: "state", phase: "ready", environmentId: "env", generation });
      return true;
    }),
    detach: vi.fn(async () => {}),
    cancel: vi.fn(async () => {}),
    bulk: vi.fn(async () => ({ count: 1 })),
    request: vi.fn(async (method, params) => ({
      generation,
      result:
        method === "subscriptions.open"
          ? {
              subscriptionId: (params as { subscriptionId: string }).subscriptionId,
              streamId: "stream",
            }
          : method === "commands.status"
            ? null
            : { accepted: true },
    })),
  };
  const runtime = new EnvironmentRuntime(
    { environmentId: "env", principalId: "device", accessEpoch: "unlocked" },
    port,
  );
  runtimes.push(runtime);
  const ready = (next: number) => {
    generation = next;
    listener?.({ kind: "state", phase: "ready", generation, environmentId: "env" });
  };
  const emit = (
    data: unknown,
    sequence = 1,
    override: Partial<ManagedHostEvent> = {},
    kind: "snapshot" | "resync-required" | "closed" = "snapshot",
    originalId?: string,
  ) => {
    const open = vi
      .mocked(port.request)
      .mock.calls.findLast(([method]) => method === "subscriptions.open");
    listener?.({
      kind: "subscription",
      environmentId: "env",
      generation,
      event: {
        jsonrpc: "2.0",
        method: "subscription.event",
        params: {
          subscriptionId:
            originalId ?? (open?.[1] as { subscriptionId: string })?.subscriptionId ?? "missing",
          streamId: "stream",
          cursor: { epoch: "epoch", sequence },
          kind,
          data,
        },
      },
      ...override,
    } as ManagedHostEvent);
  };
  const calls = (method: string) =>
    vi.mocked(port.request).mock.calls.filter(([name]) => name === method);
  return {
    runtime,
    port,
    ready,
    emit,
    calls,
    stopListening,
    receive: (event: ManagedHostEvent) => listener?.(event),
  };
}

describe("environment logical runtime", () => {
  it("normalizes the explicit goal alias once before dispatch and does not retry its admitted failure", async () => {
    const f = fixture();
    vi.mocked(f.port.request).mockRejectedValue(new Error("fixture rejection"));
    await expect(
      f.runtime.request("goals.final-review.recheck", { goalId: "goal", expectedUpdatedAt: 1 }),
    ).rejects.toMatchObject({
      name: "HostRpcUncertainError",
      method: "goals.finalReview.recheck",
      uncertain: true,
      unsupported: false,
    });
    expect(f.calls("goals.finalReview.recheck")).toHaveLength(1);
    expect(f.calls("goals.final-review.recheck")).toHaveLength(0);
  });
  it.each([
    ["goals.list", {}],
    ["tasks.save", { task: {
      id: "task", title: "Captured owner payload", prompt: "Work", projectId: "p",
      harness: "codex", model: "fixture", runtimeMode: "auto",
    } }],
    ["files.write", { projectId: "p", path: "file", expected: "before", content: "after" }],
    ["devServers.bridgeRead", { projectId: "p", streamId: "bridge" }],
  ] as const)(
    "keeps submitted %s delivery unknown after local cancellation without stopping or replaying it",
    async (method, params) => {
      const f = fixture();
      let cancel!: () => void, finish!: (reply: { generation: number; result: unknown }) => void;
      vi.mocked(f.port.request).mockImplementation(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      const result = f.runtime
        .request(method, params, {
          signal: {
            aborted: false,
            subscribe: (callback) => {
              cancel = callback;
              return () => {};
            },
          },
        })
        .catch((error) => error);
      await flush();
      expect(f.port.request).toHaveBeenCalledOnce();
      const requestId = vi.mocked(f.port.request).mock.calls[0][2].requestId;
      cancel();
      const error = await result;
      expect(error).toBeInstanceOf(HostRpcUncertainError);
      expect(error).toMatchObject({
        method,
        requestId,
        code: "RPC_WS_CANCELLED",
        uncertain: true,
        delivery: "unknown",
        unsupported: false,
      });
      expect(error).not.toHaveProperty("commandId");
      expect(error.message).toBe(
        "The Host operation may have completed. Refresh its state before retrying.",
      );
      expect(f.port.cancel).not.toHaveBeenCalled();
      expect(f.runtime.pendingCount).toBe(0);
      finish({ generation: 1, result: [] });
      await flush();
      expect(f.port.request).toHaveBeenCalledOnce();
    },
  );
  it.each([
    ["projects.list", {}],
    ["subscriptions.open", { subscriptionId: "logical", target: { kind: "environment" } }],
    ["connection.probe", {}],
    ["requests.cancel", { requestId: "other-request" }],
  ] as const)(
    "does not invent provider-work uncertainty for cancelled %s",
    async (method, params) => {
      const f = fixture();
      let cancel!: () => void;
      vi.mocked(f.port.request).mockImplementation(() => new Promise(() => {}));
      const result = f.runtime
        .request(method, params, {
          signal: {
            aborted: false,
            subscribe: (callback) => {
              cancel = callback;
              return () => {};
            },
          },
        })
        .catch((error) => error);
      await flush();
      cancel();
      const error = await result;
      expect(error).not.toBeInstanceOf(HostRpcUncertainError);
      expect(error.uncertain).not.toBe(true);
      expect(f.port.request).toHaveBeenCalledOnce();
    },
  );
  it.each([null, "matching"])(
    "preserves explicit native not-sent evidence before the stateful reply (%s request identity)",
    async (identity) => {
      const f = fixture();
      const failure = Object.assign(new Error("Native validation denied admission"), {
        code: "RPC_WS_VALIDATION",
        uncertain: false,
        unsupported: false,
        requestId: null as string | null,
        commandId: null,
        generation: null,
      });
      vi.mocked(f.port.request).mockImplementation(async (_method, _params, options) => {
        failure.requestId = identity === "matching" ? options.requestId : null;
        throw failure;
      });
      await expect(f.runtime.request("goals.list", {})).rejects.toBe(failure);
      expect(f.port.request).toHaveBeenCalledOnce();
      expect(f.port.cancel).not.toHaveBeenCalled();
    },
  );
  it("does not trust not-sent evidence belonging to another request", async () => {
    const f = fixture();
    vi.mocked(f.port.request).mockRejectedValue(
      Object.assign(new Error("Foreign denial"), {
        code: "RPC_WS_BLOCKED",
        uncertain: false,
        requestId: "another-request",
      }),
    );
    const error = await f.runtime.request("goals.list", {}).catch((error) => error);
    expect(error).toBeInstanceOf(HostRpcUncertainError);
    expect(error.requestId).toBe(vi.mocked(f.port.request).mock.calls[0][2].requestId);
    expect(error.unsupported).toBe(false);
  });
  it("preserves pre-send validation, signal registration and cancellation failures without uncertainty", async () => {
    const f = fixture();
    await expect(f.runtime.request("tasks.save", { unknown: true })).rejects.not.toBeInstanceOf(
      HostRpcUncertainError,
    );
    expect(f.port.attach).not.toHaveBeenCalled();
    const failure = new Error("Signal registration failed");
    await expect(
      f.runtime.request(
        "goals.list",
        {},
        {
          signal: {
            aborted: false,
            subscribe: () => {
              throw failure;
            },
          },
        },
      ),
    ).rejects.toBe(failure);
    await expect(
      f.runtime.request(
        "goals.list",
        {},
        {
          signal: {
            aborted: false,
            subscribe: (callback) => {
              callback();
              return () => {};
            },
          },
        },
      ),
    ).rejects.toMatchObject({ uncertain: false, code: "RPC_WS_CANCELLED" });
    expect(f.port.request).not.toHaveBeenCalled();
    expect(f.port.cancel).not.toHaveBeenCalled();
    expect(f.runtime.pendingCount).toBe(0);
  });
  it("keeps a submitted stateful result unknown after its generation is retired", async () => {
    const f = fixture();
    let finish!: (reply: { generation: number; result: unknown }) => void;
    vi.mocked(f.port.request).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const result = f.runtime.request("goals.list", {}).catch((error) => error);
    await flush();
    f.ready(2);
    finish({ generation: 1, result: [] });
    const error = await result;
    expect(error).toMatchObject({
      name: "HostRpcUncertainError",
      method: "goals.list",
      code: "RPC_WS_INTERRUPTED",
      uncertain: true,
      unsupported: false,
    });
    expect(error).not.toHaveProperty("commandId");
    expect(f.port.request).toHaveBeenCalledOnce();
  });
  it("does not let a secondary bulk not-sent failure erase the original stateful admission", async () => {
    const f = fixture();
    vi.mocked(f.port.request).mockResolvedValue({
      generation: 1,
      result: {
        $bulk: {
          kind: "bulk",
          transferId: "bulk",
          environmentId: "env",
          totalBytes: 2,
          chunkBytes: 2,
          sha256: "a".repeat(64),
          expiresAt: 100,
        },
      },
    });
    const failure = Object.assign(new Error("Bulk negotiation not sent"), {
      code: "RPC_WS_UNSUPPORTED",
      uncertain: false,
      unsupported: true,
      requestId: null,
      commandId: null,
    });
    vi.mocked(f.port.bulk).mockRejectedValue(failure);
    const error = await f.runtime.request("goals.list", {}).catch((error) => error);
    expect(error).toMatchObject({
      name: "HostRpcUncertainError",
      method: "goals.list",
      uncertain: true,
      unsupported: false,
      cause: failure,
    });
    expect(error).not.toHaveProperty("commandId");
    expect(f.port.request).toHaveBeenCalledOnce();
    expect(f.port.bulk).toHaveBeenCalledOnce();
  });
  it("cancels only local waiting during stateful bulk resolution and ignores the later result", async () => {
    const f = fixture();
    let cancel!: () => void, finish!: (value: unknown) => void;
    vi.mocked(f.port.request).mockResolvedValue({
      generation: 1,
      result: {
        $bulk: {
          kind: "bulk",
          transferId: "bulk",
          environmentId: "env",
          totalBytes: 2,
          chunkBytes: 2,
          sha256: "a".repeat(64),
          expiresAt: 100,
        },
      },
    });
    let ioActive = true;
    vi.mocked(f.port.bulk).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = (value) => {
            ioActive = false;
            resolve(value);
          };
        }),
    );
    const result = f.runtime
      .request(
        "goals.list",
        {},
        {
          signal: {
            aborted: false,
            subscribe: (callback) => {
              cancel = callback;
              return () => {};
            },
          },
        },
      )
      .catch((error) => error);
    await flush();
    expect(f.port.bulk).toHaveBeenCalledOnce();
    cancel();
    expect(await result).toMatchObject({
      name: "HostRpcUncertainError",
      method: "goals.list",
      uncertain: true,
      unsupported: false,
    });
    expect(ioActive).toBe(true);
    expect(f.port.cancel).not.toHaveBeenCalled();
    finish([]);
    await flush();
    expect(f.port.request).toHaveBeenCalledOnce();
    expect(f.runtime.pendingCount).toBe(0);
  });
  it.each(["goals.final--review.recheck", "goals.finalReview.unknown", "constructor"])(
    "rejects unknown alias %s before attaching",
    async (method) => {
      const f = fixture();
      await expect(f.runtime.request(method, {})).rejects.toThrow("Unsupported Host RPC method");
      expect(f.port.attach).not.toHaveBeenCalled();
      expect(f.port.request).not.toHaveBeenCalled();
    },
  );
  it("shares target subscriptions, counts consumers, and releases the final demand once", async () => {
    const { runtime, port, calls, stopListening } = fixture();
    const first = runtime.retain(
      { kind: "session", sessionId: "s" },
      { parse: (value) => value, commit: vi.fn() },
    );
    const second = runtime.retain(
      { kind: "session", sessionId: "s" },
      { parse: (value) => value, commit: vi.fn() },
    );
    await flush();
    expect(calls("subscriptions.open")).toHaveLength(1);
    expect(port.attach).toHaveBeenCalledOnce();
    first();
    first();
    await flush();
    expect(calls("subscriptions.close")).toHaveLength(0);
    second();
    second();
    await flush();
    expect(calls("subscriptions.close")).toHaveLength(1);
    expect(runtime.subscriptionCount).toBe(0);
    await runtime.close();
    await runtime.close();
    expect(port.detach).toHaveBeenCalledOnce();
    expect(stopListening).toHaveBeenCalledOnce();
  });
  it("waits for application commit before ACK and resumes from the applied cursor", async () => {
    const { runtime, emit, calls, ready } = fixture();
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    runtime.retain(
      { kind: "session", sessionId: "s" },
      { parse: (value) => value, commit: () => held },
    );
    await flush();
    emit({ count: 1 }, 5);
    await flush();
    expect(calls("subscriptions.ack")).toHaveLength(0);
    release();
    await flush();
    expect(calls("subscriptions.ack")[0]?.[1]).toMatchObject({
      cursor: { epoch: "epoch", sequence: 5 },
    });
    ready(2);
    await flush();
    expect(calls("subscriptions.open")[1]?.[1]).toMatchObject({
      cursor: { epoch: "epoch", sequence: 5 },
    });
  });
  it("fetches bulk natively, validates domain data, then commits and ACKs", async () => {
    const { runtime, port, emit, calls } = fixture();
    const seen: number[] = [];
    runtime.retain(
      { kind: "project", projectId: "p" },
      {
        parse: (value) => {
          if (
            typeof value !== "object" ||
            value === null ||
            !("count" in value) ||
            typeof value.count !== "number"
          )
            throw new Error("Invalid projection");
          return value.count;
        },
        commit: (count) => {
          seen.push(count);
        },
      },
    );
    await flush();
    emit({
      $bulk: {
        kind: "bulk",
        transferId: "t",
        environmentId: "env",
        totalBytes: 11,
        chunkBytes: 11,
        sha256: "a".repeat(64),
        expiresAt: 100,
      },
    });
    await flush();
    expect(port.bulk).toHaveBeenCalledOnce();
    expect(seen).toEqual([1]);
    expect(calls("subscriptions.ack")).toHaveLength(1);
  });
  it("does not ACK malformed bulk descriptors, wrong environments, or failed domain application", async () => {
    const { runtime, port, emit, calls } = fixture();
    const commit = vi.fn();
    const errors = vi.fn();
    runtime.retain(
      { kind: "project", projectId: "p" },
      {
        parse: () => {
          throw new Error("Invalid projection");
        },
        commit,
        onError: errors,
      },
    );
    await flush();
    emit({ $bulk: { kind: "bulk" } });
    await flush();
    emit(
      {
        $bulk: {
          kind: "bulk",
          transferId: "t",
          environmentId: "other",
          totalBytes: 1,
          chunkBytes: 1,
          sha256: "a".repeat(64),
          expiresAt: 100,
        },
      },
      2,
    );
    await flush();
    emit({ count: "invalid" }, 3);
    await flush();
    expect(port.bulk).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
    expect(calls("subscriptions.ack")).toHaveLength(0);
    expect(errors).toHaveBeenCalled();
  });
  it("rejects stale generation/access callbacks while a consumer is awaiting its commit", async () => {
    const { runtime, emit, calls, ready } = fixture();
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const applied = vi.fn();
    runtime.retain(
      { kind: "session", sessionId: "s" },
      {
        parse: (value) => value,
        commit: async (_value, input) => {
          await held;
          if (input.isCurrent()) applied();
        },
      },
    );
    await flush();
    emit({ data: 1 });
    await flush();
    ready(2);
    release();
    await flush();
    expect(applied).not.toHaveBeenCalled();
    expect(calls("subscriptions.ack")).toHaveLength(0);
    emit({ data: 2 }, 2, { environmentId: "wrong" });
    await flush();
    expect(applied).not.toHaveBeenCalled();
  });
  it("applies deletion before a stalled commit settles and never ACKs the old content", async () => {
    const { runtime, emit, calls } = fixture();
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const applied = vi.fn();
    const closed = vi.fn();
    runtime.retain(
      { kind: "session", sessionId: "s" },
      {
        parse: (value) => value,
        commit: async (_value, input) => {
          await held;
          if (input.isCurrent()) applied();
        },
        closed,
      },
    );
    await flush();
    emit({ data: 1 });
    await flush();
    emit(undefined, 2, {}, "closed");
    await flush();
    expect(closed).toHaveBeenCalledOnce();
    expect(runtime.subscriptionCount).toBe(0);
    release();
    await flush();
    expect(applied).not.toHaveBeenCalled();
    expect(calls("subscriptions.ack")).toHaveLength(0);
  });
  it.each(["closed", "resync-required"] as const)(
    "fences an early %s before releasing the opening baseline",
    async (kind) => {
      const { runtime, port, emit, calls } = fixture();
      const original = vi.mocked(port.request).getMockImplementation()!;
      let release!: (reply: { generation: number; result: unknown }) => void;
      const held = new Promise<{ generation: number; result: unknown }>((done) => {
        release = done;
      });
      let first = true;
      vi.mocked(port.request).mockImplementation(async (...args) => {
        if (args[0] === "subscriptions.open" && first) {
          first = false;
          return held;
        }
        return original(...args);
      });
      const commit = vi.fn(),
        closed = vi.fn();
      runtime.retain(
        { kind: "session", sessionId: "s" },
        { parse: (value) => value, commit, closed },
      );
      await flush();
      const id = (calls("subscriptions.open")[0][1] as { subscriptionId: string }).subscriptionId;
      emit({ private: "old baseline" });
      emit(undefined, 2, {}, kind);
      release({ generation: 1, result: { subscriptionId: id, streamId: "stream" } });
      await flush();
      expect(commit).not.toHaveBeenCalled();
      expect(calls("subscriptions.ack")).toHaveLength(0);
      if (kind === "closed") expect(closed).toHaveBeenCalledOnce();
      else {
        expect(calls("subscriptions.open")).toHaveLength(2);
        emit({ fresh: true }, 3);
        await flush();
        expect(commit).toHaveBeenCalledOnce();
      }
    },
  );
  it("resynchronizes a project immediately while its old bulk download is stalled", async () => {
    const { runtime, port, emit, calls } = fixture();
    let release!: (value: unknown) => void;
    vi.mocked(port.bulk).mockImplementation(
      () =>
        new Promise((done) => {
          release = done;
        }),
    );
    const commit = vi.fn();
    runtime.retain({ kind: "project", projectId: "p" }, { parse: (value) => value, commit });
    await flush();
    emit({
      $bulk: {
        kind: "bulk",
        transferId: "t",
        environmentId: "env",
        totalBytes: 1,
        chunkBytes: 1,
        sha256: "a".repeat(64),
        expiresAt: 100,
      },
    });
    await flush();
    emit(undefined, 2, {}, "resync-required");
    await flush();
    expect(calls("subscriptions.open")).toHaveLength(2);
    emit({ sessions: [] }, 3);
    await flush();
    expect(commit).toHaveBeenCalledOnce();
    expect(calls("subscriptions.ack")).toHaveLength(1);
    release({ sessions: ["deleted"] });
    await flush();
    expect(commit).toHaveBeenCalledOnce();
    expect(calls("subscriptions.ack")).toHaveLength(1);
  });
  it("never ACKs an old cursor using a new logical demand created during commit", async () => {
    const { runtime, emit, calls } = fixture();
    let joined = false;
    runtime.retain(
      { kind: "session", sessionId: "s" },
      {
        parse: (value) => value,
        commit: () => {
          if (joined) return;
          joined = true;
          queueMicrotask(() =>
            runtime.retain(
              { kind: "session", sessionId: "s" },
              {
                parse: (value) => value,
                commit: vi.fn(),
              },
            ),
          );
        },
      },
    );
    await flush();
    emit({ data: "old baseline" }, 1);
    await flush();
    expect(calls("subscriptions.open")).toHaveLength(2);
    expect(calls("subscriptions.ack")).toHaveLength(0);
    emit({ data: "fresh baseline" }, 2);
    await flush();
    expect(calls("subscriptions.ack")).toHaveLength(1);
    expect(calls("subscriptions.ack")[0][1]).toMatchObject({ cursor: { sequence: 2 } });
  });
  it("drops a pending bulk snapshot immediately when its stream is deleted", async () => {
    const { runtime, port, emit, calls } = fixture();
    let release!: (value: unknown) => void;
    vi.mocked(port.bulk).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const commit = vi.fn();
    const closed = vi.fn();
    runtime.retain(
      { kind: "session", sessionId: "s" },
      { parse: (value) => value, commit, closed },
    );
    await flush();
    emit({
      $bulk: {
        kind: "bulk",
        transferId: "t",
        environmentId: "env",
        totalBytes: 1,
        chunkBytes: 1,
        sha256: "a".repeat(64),
        expiresAt: 100,
      },
    });
    await flush();
    emit(undefined, 2, {}, "closed");
    await flush();
    expect(closed).toHaveBeenCalledOnce();
    release({ data: 1 });
    await flush();
    expect(commit).not.toHaveBeenCalled();
    expect(calls("subscriptions.ack")).toHaveLength(0);
  });
  it("rejects data when native bulk finishes in a different generation", async () => {
    const { runtime, port, emit, calls, ready } = fixture();
    let release!: (value: unknown) => void;
    vi.mocked(port.bulk).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const commit = vi.fn();
    runtime.retain({ kind: "session", sessionId: "s" }, { parse: (value) => value, commit });
    await flush();
    emit({
      $bulk: {
        kind: "bulk",
        transferId: "t",
        environmentId: "env",
        totalBytes: 1,
        chunkBytes: 1,
        sha256: "a".repeat(64),
        expiresAt: 100,
      },
    });
    await flush();
    ready(2);
    release({ data: 1 });
    await flush();
    expect(commit).not.toHaveBeenCalled();
    expect(calls("subscriptions.ack")).toHaveLength(0);
  });
  it("never replays an uncertain command and retains its original reconciliation ID", async () => {
    const { runtime, port, ready, calls } = fixture();
    vi.mocked(port.request).mockImplementation(async (method) => {
      if (method === "commands.dispatch") throw new Error("lost acknowledgement");
      return { generation: 2, result: null };
    });
    const command = { type: "send", commandId: "original", sessionId: "s", text: "once" };
    await expect(
      runtime.request("commands.dispatch", command, { commandId: "original" }),
    ).rejects.toMatchObject({
      name: "HostCommandUncertainError",
      commandId: "original",
      delivery: "unknown",
    });
    ready(2);
    await flush();
    expect(calls("commands.dispatch")).toHaveLength(1);
    expect(await runtime.request("commands.status", { commandId: "original" })).toBeNull();
    expect(calls("commands.dispatch")).toHaveLength(1);
  });
  it("preserves a matching accepted receipt across a native generation change", async () => {
    const { runtime, port, ready } = fixture();
    vi.mocked(port.request).mockImplementation(async () => {
      ready(2);
      return { generation: 1, result: { commandId: "c", sessionId: "s", revision: 3 } };
    });
    expect(
      await runtime.request("commands.dispatch", {
        type: "send",
        commandId: "c",
        sessionId: "s",
        text: "once",
      }),
    ).toEqual({ commandId: "c", sessionId: "s", revision: 3 });
  });
  it("cancels outstanding queries and ignores late replies on scope release", async () => {
    const { runtime, port } = fixture();
    let release!: (value: { generation: number; result: unknown }) => void;
    vi.mocked(port.request).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const pending = runtime.request("commands.status", { commandId: "c" }).catch((error) => error);
    await flush();
    await runtime.close();
    expect(await pending).toBeInstanceOf(Error);
    expect(port.cancel).toHaveBeenCalledOnce();
    release({ generation: 1, result: null });
    await flush();
    expect(runtime.pendingCount).toBe(0);
  });
  it("does not keep a native listener when a scope closes before listen resolves", async () => {
    const { runtime, port, stopListening } = fixture();
    let release!: (value: () => void) => void;
    vi.mocked(port.listen).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const starting = runtime.start();
    await runtime.close();
    release(stopListening);
    await starting;
    expect(stopListening).toHaveBeenCalledOnce();
    expect(port.attach).not.toHaveBeenCalled();
  });
  it("rejects malformed command metadata without a native request", async () => {
    const { runtime, port } = fixture();
    await expect(
      runtime.request("commands.dispatch", {
        type: "send",
        commandId: "c",
        sessionId: "s",
        text: "hi",
        extra: true,
      }),
    ).rejects.not.toBeInstanceOf(HostCommandUncertainError);
    expect(port.request).not.toHaveBeenCalled();
  });
  it("reserves canonical control capacity when all 64 normal read slots are occupied", async () => {
    const { runtime, port, calls } = fixture();
    vi.mocked(port.request).mockImplementation(() => new Promise(() => {}));
    const normal = Array.from({ length: 64 }, (_, index) =>
      runtime.request("sessions.get", { sessionId: `s-${index}` }).catch((error) => error),
    );
    await flush();
    expect(calls("sessions.get")).toHaveLength(64);
    await expect(runtime.request("sessions.get", { sessionId: "overflow" })).rejects.toThrow(
      "pending read",
    );
    const status = runtime
      .request("commands.status", { commandId: "original" })
      .catch((error) => error);
    const stop = runtime
      .request("commands.dispatch", {
        type: "cancel",
        commandId: "stop",
        sessionId: "s",
        runId: "run",
      })
      .catch((error) => error);
    const cancellation = runtime
      .request("requests.cancel", { requestId: "query" })
      .catch((error) => error);
    await flush();
    expect(calls("commands.status")).toHaveLength(1);
    expect(calls("commands.dispatch")).toHaveLength(1);
    expect(calls("requests.cancel")).toHaveLength(1);
    expect(runtime.pendingCount).toBe(67);
    await runtime.close();
    await Promise.all([...normal, status, stop, cancellation]);
    expect(runtime.pendingCount).toBe(0);
  });
  it("preserves a validated definite native failure instead of changing it into uncertainty", async () => {
    const { runtime, port, calls } = fixture();
    const failure = Object.assign(new Error("RPC_WS_BLOCKED: Device authorization was revoked."), {
      code: "RPC_WS_BLOCKED",
      commandId: "original",
      uncertain: false,
      unsupported: false,
    });
    vi.mocked(port.request).mockRejectedValue(failure);
    await expect(
      runtime.request("commands.dispatch", {
        type: "send",
        commandId: "original",
        sessionId: "s",
        text: "once",
      }),
    ).rejects.toBe(failure);
    expect(calls("commands.dispatch")).toHaveLength(1);
  });
  it("recovers resync-required on a healthy socket with a fresh ID and ignores old replay-gap packets", async () => {
    const { runtime, port, emit, calls } = fixture();
    const commit = vi.fn();
    runtime.retain({ kind: "session", sessionId: "s" }, { parse: (value) => value, commit });
    await flush();
    emit({ value: "old" }, 1);
    await flush();
    const original = calls("subscriptions.open")[0];
    if (!original) throw new Error("Expected an opened subscription");
    const originalId = (original[1] as { subscriptionId: string }).subscriptionId;
    emit(undefined, 2, {}, "resync-required", originalId);
    emit({ value: "late-gap-snapshot" }, 3, {}, "snapshot", originalId);
    await flush();
    expect(port.attach).toHaveBeenCalledOnce();
    expect(port.detach).not.toHaveBeenCalled();
    expect(calls("subscriptions.open")).toHaveLength(2);
    const reopened = calls("subscriptions.open")[1]?.[1] as {
      subscriptionId: string;
      cursor?: unknown;
    };
    expect(reopened.subscriptionId).not.toBe(originalId);
    expect(reopened).not.toHaveProperty("cursor");
    expect(commit).toHaveBeenCalledTimes(1);
    emit({ value: "fresh" }, 4);
    await flush();
    expect(commit.mock.calls.map(([value]) => value)).toEqual([
      { value: "old" },
      { value: "fresh" },
    ]);
    expect(calls("subscriptions.ack")).toHaveLength(2);
    expect(calls("subscriptions.ack")[1]?.[1]).toMatchObject({
      subscriptionId: reopened.subscriptionId,
      cursor: { sequence: 4 },
    });
  });
  it("bounds consecutive healthy-socket resyncs instead of opening a logical retry storm", async () => {
    const { runtime, port, emit, calls } = fixture();
    const errors = vi.fn();
    runtime.retain(
      { kind: "session", sessionId: "s" },
      { parse: (value) => value, commit: vi.fn(), onError: errors },
    );
    await flush();
    for (let sequence = 1; sequence <= 4; sequence++) {
      emit(undefined, sequence, {}, "resync-required");
      await flush();
    }
    expect(calls("subscriptions.open")).toHaveLength(3);
    expect(errors).toHaveBeenCalledOnce();
    expect(port.attach).toHaveBeenCalledOnce();
    expect(port.detach).not.toHaveBeenCalled();
  });
  it("supersedes an application backlog without letting its retired commit overwrite a fresh snapshot", async () => {
    const { runtime, emit, calls } = fixture();
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const applied: unknown[] = [];
    runtime.retain(
      { kind: "session", sessionId: "s" },
      {
        parse: (value) => value,
        commit: async (value, input) => {
          if (value === "held") await held;
          if (input.isCurrent()) applied.push(value);
        },
      },
    );
    await flush();
    emit("held", 1);
    await flush();
    for (let sequence = 2; sequence <= 34; sequence++) emit("queued-old", sequence);
    await flush();
    expect(calls("subscriptions.open")).toHaveLength(2);
    emit("fresh", 35);
    await flush();
    expect(applied).toEqual(["fresh"]);
    release();
    await flush();
    expect(applied).toEqual(["fresh"]);
    expect(calls("subscriptions.ack")).toHaveLength(1);
  });
  it("gives a later consumer a fresh logical snapshot while retaining one physical owner", async () => {
    const { runtime, port, emit, calls } = fixture();
    const later = vi.fn();
    runtime.retain(
      { kind: "project", projectId: "p" },
      { parse: (value) => value, commit: vi.fn() },
    );
    await flush();
    emit({ value: 1 });
    await flush();
    runtime.retain({ kind: "project", projectId: "p" }, { parse: (value) => value, commit: later });
    await flush();
    expect(calls("subscriptions.open")).toHaveLength(2);
    emit({ value: 2 }, 2);
    await flush();
    expect(later).toHaveBeenCalledOnce();
    expect(port.attach).toHaveBeenCalledOnce();
  });
  it("does not submit a command when cancellation arrives during signal registration", async () => {
    const { runtime, port } = fixture();
    const release = vi.fn();
    await expect(
      runtime.request(
        "commands.dispatch",
        { type: "send", commandId: "cancelled-before-send", sessionId: "s", text: "no effect" },
        {
          signal: {
            aborted: false,
            subscribe: (callback) => {
              callback();
              return release;
            },
          },
        },
      ),
    ).rejects.toMatchObject({
      commandId: "cancelled-before-send",
      uncertain: false,
      code: "RPC_WS_CANCELLED",
    });
    expect(port.request).not.toHaveBeenCalled();
    expect(port.cancel).not.toHaveBeenCalled();
    expect(runtime.pendingCount).toBe(0);
    expect(release).toHaveBeenCalledOnce();
  });
  it("marks a retained view unavailable after native authorization is blocked and rejects later data", async () => {
    const { runtime, receive, emit, calls, port } = fixture();
    const errors = vi.fn();
    const commit = vi.fn();
    runtime.retain(
      { kind: "session", sessionId: "s" },
      { parse: (value) => value, commit, onError: errors },
    );
    await flush();
    emit({ data: 1 });
    await flush();
    receive({
      kind: "state",
      environmentId: "env",
      generation: 1,
      phase: "blocked",
      category: "authentication",
    });
    emit({ data: 2 }, 2);
    await flush();
    expect(runtime.state).toMatchObject({
      transport: "blocked",
      content: "stale",
      failure: "auth",
    });
    expect(errors).toHaveBeenCalledOnce();
    expect(commit).toHaveBeenCalledOnce();
    expect(calls("subscriptions.ack")).toHaveLength(1);
    expect(port.attach).toHaveBeenCalledOnce();
  });
});
