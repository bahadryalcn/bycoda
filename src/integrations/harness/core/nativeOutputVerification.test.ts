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

it("keeps at most32 worker requests and falls back with full validation when capacity is occupied", async () => {
  const { prepareOutputVerification } = await import("./nativeOutputVerificationClient");
  const results = Array.from({ length: 33 }, () => prepareOutputVerification("stdout", ["x"], 1)());
  const worker = VerificationWorker.instances[0];
  expect(worker.postMessage).toHaveBeenCalledTimes(32);
  worker.onerror?.();
  const actual = await Promise.all(results);
  expect(new Set(actual).size).toBe(1);
  expect(actual[0]).toBe(await verifyOutputItems("stdout", ["x"], 1));
});

it("uses validated fallback after worker deadline, without accepting missing or late proof", async () => {
  vi.useFakeTimers();
  const { prepareOutputVerification } = await import("./nativeOutputVerificationClient");
  const result = prepareOutputVerification("stdout", ["x"], 1)();
  const worker = VerificationWorker.instances[0];
  vi.advanceTimersByTime(30_000);
  await expect(result).resolves.toBe(await verifyOutputItems("stdout", ["x"], 1));
  expect(worker.terminate).toHaveBeenCalledTimes(1);
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
