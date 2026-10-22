import { beforeEach, describe, expect, it, vi } from "vitest";

const transport = vi.hoisted(() => ({
  onWrite: async (_sessionId: string, _line: string): Promise<void> => {},
}));

vi.mock("./child", () => ({
  writeChild: (sessionId: string, line: string) => transport.onWrite(sessionId, line),
}));

import { JsonRpcClient } from "./jsonRpc";
import { DeliveryUnknownError } from "../../../shared/lib/deliveryUnknown";

describe("JsonRpcClient", () => {
  beforeEach(() => {
    transport.onWrite = async () => {};
  });

  it("ignores malformed envelopes without dropping the next valid frame", () => {
    const onNotification = vi.fn();
    const client = new JsonRpcClient("invalid", { onNotification });
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      for (const message of [
        null,
        true,
        1,
        "log",
        [],
        { method: 42 },
        { id: {}, result: true },
        { id: 1, error: "failure" },
      ]) {
        expect(() => client.pushLine(JSON.stringify(message))).not.toThrow();
      }
      client.pushLine(JSON.stringify({ method: "progress", params: { text: "ready" } }));
      expect(onNotification).toHaveBeenCalledExactlyOnceWith("progress", { text: "ready" });
    } finally {
      warning.mockRestore();
    }
  });

  it("ignores late requests and notifications after the client closes", () => {
    const onNotification = vi.fn();
    const onRequest = vi.fn();
    const client = new JsonRpcClient("closed", { onNotification, onRequest });
    client.close();
    client.pushLine(JSON.stringify({ method: "progress" }));
    client.pushLine(JSON.stringify({ id: 1, method: "approval" }));
    expect(onNotification).not.toHaveBeenCalled();
    expect(onRequest).not.toHaveBeenCalled();
  });

  it("accepts a response delivered before the write resolves", async () => {
    let client!: JsonRpcClient;
    transport.onWrite = async (_sessionId, line) => {
      const outbound = JSON.parse(line) as { id: number };
      client.pushLine(
        JSON.stringify({
          jsonrpc: "2.0",
          id: outbound.id,
          result: { ok: true },
        }),
      );
    };
    client = new JsonRpcClient("fast", {});

    await expect(client.request("session/set_mode")).resolves.toEqual({
      ok: true,
    });
  });

  it("rejects and removes a request when writing fails", async () => {
    transport.onWrite = async () => {
      throw new Error("pipe closed");
    };
    const client = new JsonRpcClient("failed", {});

    await expect(client.request("initialize")).rejects.toThrow("pipe closed");
  });

  it("delivers a provider response without waiting for the IPC write acknowledgement", async () => {
    let client!: JsonRpcClient;
    transport.onWrite = (_sessionId, line) => {
      client.pushLine(JSON.stringify({ id: JSON.parse(line).id, result: { ok: true } }));
      return new Promise<void>(() => undefined);
    };
    vi.useFakeTimers();
    try {
      client = new JsonRpcClient("mac-ipc", {});
      await expect(client.request("turn/start")).resolves.toEqual({ ok: true });
      await vi.advanceTimersByTimeAsync(16_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("bounds unanswered requests after a successful write", async () => {
    vi.useFakeTimers();
    try {
      const client = new JsonRpcClient(
        "no-response",
        {},
        { label: "codex", defaultRequestTimeoutMs: 100 },
      );
      const outcome = client.request("initialize").catch((error: Error) => error.message);
      await vi.advanceTimersByTimeAsync(101);
      expect(await outcome).toContain("codex initialize response timed out");
    } finally {
      vi.useRealTimers();
    }
  });

  it("retains a timed-out Steer for late acknowledgement without replaying it", async () => {
    vi.useFakeTimers();
    const writes: { id: number }[] = [];
    transport.onWrite = async (_session, line) => {
      writes.push(JSON.parse(line));
    };
    const client = new JsonRpcClient("late-steer", {}, { defaultRequestTimeoutMs: 100 });
    try {
      const outcome = client.request("turn/steer", {}).catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(101);
      const error = (await outcome) as DeliveryUnknownError;
      expect(error).toBeInstanceOf(DeliveryUnknownError);
      client.pushLine(JSON.stringify({ id: writes[0].id, result: { turnId: "active" } }));
      await expect(error.settlement).resolves.toBe("accepted");
      expect(writes).toHaveLength(1);
    } finally {
      client.close();
      vi.useRealTimers();
    }
  });

  it("keeps a written Steer unknown if its process exits before acknowledgement", async () => {
    vi.useFakeTimers();
    const client = new JsonRpcClient("closed-steer", {}, { defaultRequestTimeoutMs: 100 });
    try {
      const outcome = client.request("turn/steer", {}).catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(101);
      const error = (await outcome) as DeliveryUnknownError;
      client.close();
      await expect(error.settlement).resolves.toBe("unknown");
    } finally {
      client.close();
      vi.useRealTimers();
    }
  });

  it("does not classify process exit before the response deadline as definite non-delivery", async () => {
    const client = new JsonRpcClient(
      "exit-before-deadline",
      {},
      { defaultRequestTimeoutMs: 60_000 },
    );
    const outcome = client.request("turn/steer", {}).catch((error: unknown) => error);
    await Promise.resolve();
    client.close(new Error("Harness process exited"));
    const error = (await outcome) as DeliveryUnknownError;
    expect(error).toBeInstanceOf(DeliveryUnknownError);
    await expect(error.settlement).resolves.toBe("unknown");
  });

  it("identifies a blocked server reply without including its content", async () => {
    vi.useFakeTimers();
    try {
      transport.onWrite = () => new Promise<void>(() => undefined);
      const client = new JsonRpcClient("reply", {}, { label: "codex" });
      client.pushLine(JSON.stringify({ id: 3, method: "currentTime/read" }));
      const outcome = client
        .respond(3, { privateValue: "secret" })
        .catch((error: Error) => error.message);
      await vi.advanceTimersByTimeAsync(16_000);
      expect(await outcome).toContain("reply to currentTime/read write timed out");
      expect(await outcome).not.toContain("secret");
    } finally {
      vi.useRealTimers();
    }
  });

  it("bounds a blocked write instead of outliving the request deadline", async () => {
    vi.useFakeTimers();
    try {
      transport.onWrite = () => new Promise<void>(() => undefined);
      const client = new JsonRpcClient("wedged", {});
      const outcome = client.request("initialize", undefined, 60_000).then(
        () => "resolved",
        (e: Error) => e.message,
      );
      // The 15s write bound fires long before the request's own 60s deadline.
      await vi.advanceTimersByTimeAsync(16_000);
      await expect(outcome).resolves.toMatch(/timed out/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not let a slow request deadline report as unhandled while the write is pending", async () => {
    vi.useFakeTimers();
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      transport.onWrite = () => new Promise<void>(() => undefined);
      const client = new JsonRpcClient("quiet", {});
      const request = client.request("initialize", undefined, 5_000);
      const settled = request.catch((e: Error) => e.message);
      // At 5s the request's own deadline fires while the write stays blocked;
      // the outer promise only settles once the write bound returns it at 15s.
      await vi.advanceTimersByTimeAsync(6_000);
      await expect(settled).resolves.toContain("initialize response timed out");
      await vi.advanceTimersByTimeAsync(15_000);
      await expect(settled).resolves.toMatch(/timed out/);
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
      vi.useRealTimers();
    }
  });
});

it("eşleşmeyen ve eksik RPC yanıtlarını içeriksiz tanılar", () => {
  const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const client = new JsonRpcClient("test", {});
  client.pushLine(JSON.stringify({ id: 99, result: "secret-value" }));
  client.pushLine(JSON.stringify({ id: 100 }));
  expect(warning).toHaveBeenCalledWith(expect.stringContaining("unmatched JSON-RPC response"), {
    id: 99,
  });
  expect(warning).toHaveBeenCalledWith(expect.stringContaining("malformed JSON-RPC response"), {
    id: 100,
  });
  expect(JSON.stringify(warning.mock.calls)).not.toContain("secret-value");
  warning.mockRestore();
});

it("asenkron server request hatasını sır içermeden yakalar", async () => {
  const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const client = new JsonRpcClient("test", {
    onRequest: async () => {
      throw new Error("private-token");
    },
  });
  client.pushLine(JSON.stringify({ id: 1, method: "server/request" }));
  await Promise.resolve();
  await Promise.resolve();
  expect(warning).toHaveBeenCalledWith("[bycoda] rpc server request handler failed");
  expect(JSON.stringify(warning.mock.calls)).not.toContain("private-token");
  warning.mockRestore();
});
