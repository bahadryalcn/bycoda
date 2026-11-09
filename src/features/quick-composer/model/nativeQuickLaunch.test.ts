import { expect, it, vi } from "vitest";
import { createNativeQuickLaunchRuntime } from "./nativeQuickLaunch";
import { quickNativeReply } from "./nativeQuickLaunch.fixture";
import type { QuickLaunch } from "./quickComposer";

const request = (): QuickLaunch => ({
  prompt: "original",
  cwd: "/repo",
  harness: "codex",
  reveal: false,
  modelSettings: { effort: "high" },
});
const options = () => ({
  key: crypto.randomUUID(),
  intentId: crypto.randomUUID(),
  rawPrompt: " /plan original ",
  prepare: vi.fn(async () => request()),
  explicit: true,
});
function deferred() {
  let resolve!: (value: unknown) => void;
  const promise = new Promise<unknown>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
it("uses the Native scope/sequence exactly and makes no legacy submission", async () => {
  const native = vi.fn(async (command, args) => quickNativeReply(command, args));
  const runtime = createNativeQuickLaunchRuntime(native);
  const input = options();
  const result = await runtime.run(input);
  expect(native.mock.calls.map(([command]) => command)).toEqual([
    "quick_composer_launch_scope",
    "quick_composer_submit_intent",
  ]);
  expect(native.mock.calls[1][1]).toMatchObject({
    submission: { sequence: 1, intentId: input.intentId, request: { prompt: "original" } },
  });
  expect(result.rawPrompt).toBe(input.rawPrompt);
  expect(result.receipt.qualified).toBe(false);
  runtime.complete(input.key, result);
  expect(runtime.has(input.key)).toBe(false);
});
it("lost ACK uses the original tuple on explicit retry despite newer intent and options", async () => {
  const native = vi.fn(async (command, args) => {
    if (command === "quick_composer_submit_intent") throw new Error("lost ACK");
    return quickNativeReply(command, args);
  });
  const runtime = createNativeQuickLaunchRuntime(native);
  const input = options();
  await expect(runtime.run(input)).rejects.toThrow("lost ACK");
  const later = {
    ...input,
    intentId: crypto.randomUUID(),
    rawPrompt: "newer",
    prepare: vi.fn(async () => ({ ...request(), prompt: "newer" })),
  };
  const result = await runtime.run(later);
  expect(result.intentId).toBe(input.intentId);
  expect(result.request.prompt).toBe("original");
  expect(later.prepare).not.toHaveBeenCalled();
  expect(
    native.mock.calls.filter(([command]) => command === "quick_composer_submit_intent"),
  ).toHaveLength(1);
  expect(native.mock.calls[2][1]).toEqual({
    query: (native.mock.calls[1][1] as { submission: unknown }).submission,
  });
});
it.each(["pending", "unknown", "unavailable"])(
  "%s never replays or refreshes the Native scope",
  async (state) => {
    const native = vi.fn(async (command, args) => quickNativeReply(command, args, state));
    const runtime = createNativeQuickLaunchRuntime(native);
    const input = options();
    await expect(runtime.run(input)).rejects.toThrow("unknown");
    await expect(runtime.run(input)).rejects.toThrow("unknown");
    expect(native.mock.calls.map(([command]) => command)).toEqual([
      "quick_composer_launch_scope",
      "quick_composer_submit_intent",
      "quick_composer_submit_status",
    ]);
  },
);
it("closure observation never retries verified failure; explicit correction gets a new immutable tuple", async () => {
  let failed = true;
  let scopeReads = 0;
  const native = vi.fn(async (command, args) => {
    const state = failed ? "failed" : "queued";
    const result = quickNativeReply(command, args, state);
    if (command === "quick_composer_launch_scope") result!.nextSequence = ++scopeReads;
    return result;
  });
  const runtime = createNativeQuickLaunchRuntime(native);
  const input = options();
  await expect(runtime.run(input)).rejects.toThrow("unknown");
  await expect(runtime.run({ ...input, explicit: false })).rejects.toThrow("unknown");
  failed = false;
  const result = await runtime.run(input);
  expect(result.receipt.state).toBe("queued");
  expect(
    native.mock.calls.filter(([command]) => command === "quick_composer_submit_intent"),
  ).toHaveLength(1);
  failed = true;
  const second = { ...options(), lineage: {} as { intentId?: string } };
  await expect(runtime.run(second)).rejects.toThrow();
  const oldLineage = { ...second.lineage };
  const corrected = {
    ...second,
    rawPrompt: "corrected",
    prepare: vi.fn(async () => ({ ...request(), prompt: "corrected" })),
  };
  await expect(runtime.run(corrected)).rejects.toThrow();
  const sent = native.mock.calls.filter(([command]) => command === "quick_composer_submit_intent");
  expect(sent).toHaveLength(3);
  expect(sent[1][1]).toMatchObject({
    submission: { sequence: 2, intentId: second.intentId, request: { prompt: "original" } },
  });
  expect(sent[2][1]).toMatchObject({
    submission: { sequence: 3, request: { prompt: "corrected" } },
  });
  expect((sent[2][1] as { submission: { intentId: string } }).submission.intentId).not.toBe(
    second.intentId,
  );
  const count = native.mock.calls.length;
  await expect(runtime.run({ ...second, explicit: false, lineage: oldLineage })).rejects.toThrow(
    "unknown",
  );
  expect(native.mock.calls).toHaveLength(count);
});
it("retains immutable request and actual pending ownership across a fresh implementation/HMR", async () => {
  const gate = deferred();
  const native = vi.fn(async (command, args) => {
    if (command === "quick_composer_submit_intent") await gate.promise;
    return quickNativeReply(command, args);
  });
  const shared = { entries: new Map() };
  const runtime = createNativeQuickLaunchRuntime(native, shared);
  const input = options();
  const original = request();
  input.prepare.mockResolvedValue(original);
  const first = runtime.run(input);
  await vi.waitFor(() => expect(native).toHaveBeenCalledTimes(2));
  original.prompt = "mutated";
  original.modelSettings!.effort = "low";
  const fresh = createNativeQuickLaunchRuntime(native, shared);
  const next = fresh.run({ ...input, explicit: false });
  gate.resolve(undefined);
  const [a, b] = await Promise.all([first, next]);
  expect(a).toBe(b);
  expect(a.request.prompt).toBe("original");
  expect(a.request.modelSettings!.effort).toBe("high");
  expect(native).toHaveBeenCalledTimes(2);
});
it("bounds actual pending subscribers until settlement and keeps the original job", async () => {
  const gate = deferred();
  const native = vi.fn(async (command, args) => {
    if (command === "quick_composer_submit_intent") await gate.promise;
    return quickNativeReply(command, args);
  });
  const runtime = createNativeQuickLaunchRuntime(native);
  const input = options();
  const pending = Array.from({ length: 32 }, () => runtime.run(input));
  await expect(runtime.run(input)).rejects.toThrow("waiters");
  await vi.waitFor(() => expect(native).toHaveBeenCalledTimes(2));
  gate.resolve(undefined);
  await Promise.all(pending);
  expect((await runtime.run(input)).receipt.state).toBe("queued");
});
it.each([
  (value: Record<string, unknown>) => {
    value.sequence = 99;
  },
  (value: Record<string, unknown>) => {
    value.qualified = true;
  },
  (value: Record<string, unknown>) => {
    value.extra = true;
  },
  (value: Record<string, unknown>) => {
    value.scope = { windowEpoch: crypto.randomUUID(), storeInstance: crypto.randomUUID() };
  },
  (value: Record<string, unknown>) => {
    value.requestDigest = "bad";
  },
  (value: Record<string, unknown>) => {
    value.deliveryId = "bad";
  },
])(
  "malformed or mismatched receipt keeps the request and cannot authorize cleanup %#",
  async (mutate) => {
    const native = vi.fn(async (command, args) => {
      const value = quickNativeReply(command, args);
      if (command === "quick_composer_submit_intent") mutate(value!);
      return value;
    });
    const runtime = createNativeQuickLaunchRuntime(native);
    const input = options();
    await expect(runtime.run(input)).rejects.toThrow("unknown");
    expect(runtime.has(input.key)).toBe(true);
    await runtime.run({ ...input, explicit: false });
    expect(
      native.mock.calls.filter(([command]) => command === "quick_composer_submit_intent"),
    ).toHaveLength(1);
  },
);
it("a changed digest/delivery receipt during reconciliation stays unknown", async () => {
  const native = vi.fn(async (command, args) => {
    const value = quickNativeReply(
      command,
      args,
      command === "quick_composer_submit_intent" ? "pending" : "queued",
    );
    if (command === "quick_composer_submit_status") value!.requestDigest = "b".repeat(64);
    return value;
  });
  const runtime = createNativeQuickLaunchRuntime(native);
  const input = options();
  await expect(runtime.run(input)).rejects.toThrow();
  await expect(runtime.run(input)).rejects.toThrow();
  expect(runtime.has(input.key)).toBe(true);
});
it("failed scope discovery has no legacy fallback and closure cannot submit later", async () => {
  const native = vi.fn(async () => {
    throw new Error("unavailable command");
  });
  const runtime = createNativeQuickLaunchRuntime(native);
  const input = options();
  await expect(runtime.run(input)).rejects.toThrow("unavailable command");
  await expect(runtime.run({ ...input, explicit: false })).rejects.toThrow("unknown");
  expect(native).toHaveBeenCalledTimes(1);
  expect(runtime.has(input.key)).toBe(false);
});

it("a read-only scope discovery failure cannot silently launch the old draft on a later explicit Start", async () => {
  let reads = 0;
  const native = vi.fn(async (command, args) => {
    if (command === "quick_composer_launch_scope" && ++reads === 1)
      throw new Error("scope unavailable");
    return quickNativeReply(command, args);
  });
  const runtime = createNativeQuickLaunchRuntime(native);
  const input = options();
  await expect(runtime.run(input)).rejects.toThrow("scope unavailable");
  const corrected = {
    ...input,
    rawPrompt: "current B",
    prepare: vi.fn(async () => ({ ...request(), prompt: "current B" })),
  };
  const result = await runtime.run(corrected);
  expect(corrected.prepare).toHaveBeenCalledOnce();
  expect(result.request.prompt).toBe("current B");
  expect(result.rawPrompt).toBe("current B");
  expect(
    native.mock.calls.filter(([command]) => command === "quick_composer_submit_intent"),
  ).toHaveLength(1);
  expect(native.mock.calls[2][1]).toMatchObject({
    submission: { request: { prompt: "current B" } },
  });
});
