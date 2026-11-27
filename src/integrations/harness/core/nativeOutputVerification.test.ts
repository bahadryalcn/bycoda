import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import vectors from "./nativeOutputDelivery.fixture.json";
import {
  checkedOutputFrame,
  verifyOutputItems,
  type VerificationChannel,
} from "./nativeOutputVerification";

class VerificationWorker {
  static instances: VerificationWorker[] = [];
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() {
    VerificationWorker.instances.push(this);
  }
  reply(data: unknown) {
    this.onmessage?.({ data } as MessageEvent<unknown>);
  }
}
beforeEach(() => {
  vi.resetModules();
  VerificationWorker.instances = [];
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("Worker", VerificationWorker);
});
afterEach(() => {
  for (const worker of VerificationWorker.instances) worker.onerror?.();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("matches independent Unicode/BOM/empty/channel wire goldens through the full verifier", async () => {
  for (const vector of vectors.cases) {
    const channel = vector.channel as VerificationChannel;
    expect(
      Buffer.from(checkedOutputFrame(channel, vector.items, vector.utf8Bytes)).toString("hex"),
    ).toBe(vector.frameHex);
    await expect(verifyOutputItems(channel, vector.items, vector.utf8Bytes)).resolves.toBe(
      vector.sha256,
    );
  }
  await expect(verifyOutputItems("stdout", ["\ud800"], 3)).rejects.toThrow("invalid-payload");
  await expect(verifyOutputItems("stdout", ["漢"], 1)).rejects.toThrow("invalid-payload");
  await expect(verifyOutputItems("stdout", ["x".repeat(1_048_577)], 1_048_576)).rejects.toThrow(
    "invalid-payload",
  );
});

it("posts one immutable bounded payload without main-thread UTF8 work and coalesces only that exact prepared job", async () => {
  const { prepareOutputVerification } = await import("./nativeOutputVerificationClient");
  const encode = vi.spyOn(TextEncoder.prototype, "encode");
  const items = ["漢"];
  const start = prepareOutputVerification("stdout", items, 3);
  const first = start();
  expect(start()).toBe(first);
  const worker = VerificationWorker.instances[0];
  expect(worker.postMessage).toHaveBeenCalledTimes(1);
  const sent = worker.postMessage.mock.calls[0][0];
  items[0] = "changed";
  expect(sent.items).toEqual(["漢"]);
  expect(Object.isFrozen(sent.items)).toBe(true);
  expect(encode).not.toHaveBeenCalled();
  worker.reply({ id: sent.id + 1, digest: "0".repeat(64) });
  let completed = false;
  void first.then(
    () => {
      completed = true;
    },
    () => {
      completed = true;
    },
  );
  await Promise.resolve();
  expect(completed).toBe(false);
  worker.reply({ id: sent.id, digest: "a".repeat(64) });
  await expect(first).resolves.toBe("a".repeat(64));
});

it("revalidates exact snapshotted bytes after worker failure and ignores late proof", async () => {
  const { prepareOutputVerification } = await import("./nativeOutputVerificationClient");
  const vector = vectors.cases[0];
  const items = [...vector.items];
  const result = prepareOutputVerification(
    vector.channel as VerificationChannel,
    items,
    vector.utf8Bytes,
  )();
  const worker = VerificationWorker.instances[0];
  const sent = worker.postMessage.mock.calls[0][0];
  items[0] = "mutated";
  worker.onerror?.();
  worker.reply({ id: sent.id, digest: "0".repeat(64) });
  await expect(result).resolves.toBe(vector.sha256);
  expect(worker.terminate).toHaveBeenCalledTimes(1);
  expect(() => prepareOutputVerification("stdout", ["\ud800"], 3)).toThrow(
    "NATIVE_OUTPUT_INVALID_UTF8",
  );
});

it("keeps at most 32 worker requests in flight and queues the rest for the worker instead of hashing inline", async () => {
  const { prepareOutputVerification } = await import("./nativeOutputVerificationClient");
  const results = Array.from({ length: 40 }, () => prepareOutputVerification("stdout", ["x"], 1)());
  const worker = VerificationWorker.instances[0];
  expect(worker.postMessage).toHaveBeenCalledTimes(32);
  for (let index = 0; index < 8; index += 1)
    worker.reply({ id: worker.postMessage.mock.calls[index][0].id, digest: "d".repeat(64) });
  expect(worker.postMessage).toHaveBeenCalledTimes(40);
  for (let index = 8; index < 40; index += 1)
    worker.reply({ id: worker.postMessage.mock.calls[index][0].id, digest: "d".repeat(64) });
  // A digest only the fake worker can produce proves no job was hashed on the calling thread.
  expect(new Set(await Promise.all(results))).toEqual(new Set(["d".repeat(64)]));
  expect(VerificationWorker.instances).toHaveLength(1);
  expect(worker.terminate).not.toHaveBeenCalled();
});

it("revalidates every in-flight and queued job inline when the worker fails", async () => {
  const { prepareOutputVerification } = await import("./nativeOutputVerificationClient");
  const results = Array.from({ length: 40 }, () => prepareOutputVerification("stdout", ["x"], 1)());
  const worker = VerificationWorker.instances[0];
  expect(worker.postMessage).toHaveBeenCalledTimes(32);
  worker.onerror?.();
  const actual = await Promise.all(results);
  expect(new Set(actual)).toEqual(new Set([await verifyOutputItems("stdout", ["x"], 1)]));
  expect(worker.postMessage).toHaveBeenCalledTimes(32);
  expect(worker.terminate).toHaveBeenCalledTimes(1);
});

it("recreates the worker after a recoverable failure once the backoff elapses", async () => {
  vi.useFakeTimers();
  const { prepareOutputVerification } = await import("./nativeOutputVerificationClient");
  const expected = await verifyOutputItems("stdout", ["x"], 1);
  const first = prepareOutputVerification("stdout", ["x"], 1)();
  VerificationWorker.instances[0].onerror?.();
  await expect(first).resolves.toBe(expected);
  await expect(prepareOutputVerification("stdout", ["x"], 1)()).resolves.toBe(expected);
  expect(VerificationWorker.instances).toHaveLength(1);
  vi.advanceTimersByTime(1_000);
  const next = prepareOutputVerification("stdout", ["x"], 1)();
  expect(VerificationWorker.instances).toHaveLength(2);
  const worker = VerificationWorker.instances[1];
  worker.reply({ id: worker.postMessage.mock.calls[0][0].id, digest: "b".repeat(64) });
  await expect(next).resolves.toBe("b".repeat(64));
});

it("backs off exponentially up to a cap and resets after a verified worker reply", async () => {
  vi.useFakeTimers();
  const { prepareOutputVerification } = await import("./nativeOutputVerificationClient");
  prepareOutputVerification("stdout", ["x"], 1);
  for (let failure = 1; failure <= 7; failure += 1) {
    const delay = Math.min(30_000, 1_000 * 2 ** (failure - 1));
    VerificationWorker.instances.at(-1)?.onerror?.();
    vi.advanceTimersByTime(delay - 1);
    prepareOutputVerification("stdout", ["x"], 1);
    expect(VerificationWorker.instances).toHaveLength(failure);
    vi.advanceTimersByTime(1);
    prepareOutputVerification("stdout", ["x"], 1);
    expect(VerificationWorker.instances).toHaveLength(failure + 1);
  }
  const live = VerificationWorker.instances.at(-1) as VerificationWorker;
  const done = prepareOutputVerification("stdout", ["x"], 1)();
  live.reply({ id: live.postMessage.mock.calls[0][0].id, digest: "e".repeat(64) });
  await expect(done).resolves.toBe("e".repeat(64));
  live.onerror?.();
  const count = VerificationWorker.instances.length;
  vi.advanceTimersByTime(1_000);
  prepareOutputVerification("stdout", ["x"], 1);
  expect(VerificationWorker.instances).toHaveLength(count + 1);
});

it("retries worker construction after a backoff instead of latching inline hashing", async () => {
  vi.useFakeTimers();
  let attempts = 0;
  vi.stubGlobal(
    "Worker",
    class extends VerificationWorker {
      constructor() {
        if (attempts++ === 0) throw new Error("transient worker failure");
        super();
      }
    },
  );
  const { prepareOutputVerification } = await import("./nativeOutputVerificationClient");
  const expected = await verifyOutputItems("stdout", ["x"], 1);
  await expect(prepareOutputVerification("stdout", ["x"], 1)()).resolves.toBe(expected);
  expect(VerificationWorker.instances).toHaveLength(0);
  vi.advanceTimersByTime(1_000);
  const next = prepareOutputVerification("stdout", ["x"], 1)();
  expect(VerificationWorker.instances).toHaveLength(1);
  const worker = VerificationWorker.instances[0];
  worker.reply({ id: worker.postMessage.mock.calls[0][0].id, digest: "f".repeat(64) });
  await expect(next).resolves.toBe("f".repeat(64));
});

it("fails only the job that misses its deadline, keeps the worker and ignores its late proof", async () => {
  vi.useFakeTimers();
  const { prepareOutputVerification } = await import("./nativeOutputVerificationClient");
  const slow = prepareOutputVerification("stdout", ["x"], 1)();
  const worker = VerificationWorker.instances[0];
  vi.advanceTimersByTime(15_000);
  const healthy = prepareOutputVerification("stdout", ["y"], 1)();
  vi.advanceTimersByTime(15_000);
  await expect(slow).resolves.toBe(await verifyOutputItems("stdout", ["x"], 1));
  expect(worker.terminate).not.toHaveBeenCalled();
  worker.reply({ id: worker.postMessage.mock.calls[0][0].id, digest: "0".repeat(64) });
  worker.reply({ id: worker.postMessage.mock.calls[1][0].id, digest: "c".repeat(64) });
  await expect(healthy).resolves.toBe("c".repeat(64));
  const after = prepareOutputVerification("stdout", ["z"], 1)();
  expect(worker.postMessage).toHaveBeenCalledTimes(3);
  worker.reply({ id: worker.postMessage.mock.calls[2][0].id, digest: "9".repeat(64) });
  await expect(after).resolves.toBe("9".repeat(64));
  expect(VerificationWorker.instances).toHaveLength(1);
});

it("retires an unresponsive worker after consecutive deadlines and revalidates each job inline", async () => {
  vi.useFakeTimers();
  const { prepareOutputVerification } = await import("./nativeOutputVerificationClient");
  const results = Array.from({ length: 3 }, () => prepareOutputVerification("stdout", ["x"], 1)());
  const worker = VerificationWorker.instances[0];
  vi.advanceTimersByTime(30_000);
  const expected = await verifyOutputItems("stdout", ["x"], 1);
  expect(await Promise.all(results)).toEqual([expected, expected, expected]);
  expect(worker.terminate).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(1_000);
  prepareOutputVerification("stdout", ["x"], 1);
  expect(VerificationWorker.instances).toHaveLength(2);
});

it("rejects invalid worker payload through full fallback without disabling unrelated verification", async () => {
  const { prepareOutputVerification } = await import("./nativeOutputVerificationClient");
  const result = prepareOutputVerification("stdout", ["\ud800"], 3)();
  const worker = VerificationWorker.instances[0];
  worker.reply({ id: worker.postMessage.mock.calls[0][0].id, error: true });
  await expect(result).rejects.toThrow("invalid-payload");
  expect(worker.terminate).not.toHaveBeenCalled();
  const next = prepareOutputVerification("stdout", ["x"], 1)();
  worker.reply({
    id: worker.postMessage.mock.calls[1][0].id,
    digest: await verifyOutputItems("stdout", ["x"], 1),
  });
  await expect(next).resolves.toBe(await verifyOutputItems("stdout", ["x"], 1));
});

it("retains fully validated delivery when worker construction is unavailable", async () => {
  vi.stubGlobal(
    "Worker",
    class {
      constructor() {
        throw new Error("unsupported worker");
      }
    },
  );
  const { prepareOutputVerification } = await import("./nativeOutputVerificationClient");
  const vector = vectors.cases[0];
  await expect(
    prepareOutputVerification(
      vector.channel as VerificationChannel,
      vector.items,
      vector.utf8Bytes,
    )(),
  ).resolves.toBe(vector.sha256);
  expect(() => prepareOutputVerification("stdout", ["漢"], 1)).toThrow("invalid-payload");
});
