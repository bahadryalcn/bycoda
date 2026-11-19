import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { createNativeServiceUploadService } from "./upload";
import { NATIVE_UPLOAD_COMMIT_LIMITS } from "../native-workspaces/upload-commit";
import { NATIVE_SERVICE_UPLOAD_LIMITS as limits } from "../../../src/shared/model/host-contracts/native-service-upload";
import { nativeBufferUploadPlatform } from "../../ports/native-workspaces";
import type { HostDomainContext } from "../context";
import type { NativeServiceOwnerPorts } from "./ports";
import type { NativeServiceUploadTarget } from "../../../src/shared/model/host-contracts/native-service-upload";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  vi.useRealTimers();
});
const target: NativeServiceUploadTarget = "native.services.conversation.desktop.finish";
const params = { id: "original-desktop-request", result: { text: "Türkçe 😀" } };
const body = Buffer.from(JSON.stringify(params));
const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const ctx = (id = "paired-owner"): HostDomainContext => ({
  principalId: id,
  authorized: async () => true,
  nativeServices: {} as NativeServiceOwnerPorts,
});
function fixture(
  execute: (
    target: NativeServiceUploadTarget,
    params: Record<string, unknown>,
    context: HostDomainContext,
  ) => Promise<unknown> = vi.fn(
    async (
      _target: NativeServiceUploadTarget,
      _params: Record<string, unknown>,
      _context: HostDomainContext,
    ): Promise<unknown> => ({ accepted: true }),
  ),
  options: { commitDeadlineMs?: number; commitHoldMs?: number } = {},
) {
  let clock = 1000;
  const service = createNativeServiceUploadService({
    environmentId: "env",
    platform: nativeBufferUploadPlatform,
    execute,
    now: () => clock,
    ...options,
  });
  cleanups.push(service.close);
  const begin = (bytes = body, uploadId = "upload-a") => ({
    uploadId,
    target,
    byteLength: bytes.length,
    sha256: digest(bytes),
  });
  const stage = async (context = ctx(), bytes = body, uploadId = "upload-a") => {
    await service.call("native.services.upload.begin", begin(bytes, uploadId), context);
    await service.call(
      "native.services.upload.append",
      { uploadId, offset: 0, data: bytes.toString("base64") },
      context,
    );
  };
  return {
    service,
    execute,
    begin,
    stage,
    expire: () => {
      clock += 120001;
    },
    advance: (ms: number) => {
      clock += ms;
    },
  };
}
/** An operation that starts, then stays pending until the test settles it. */
function hungExecute() {
  let settle!: (value: unknown) => void;
  const hung = new Promise<unknown>((resolve) => {
    settle = resolve;
  });
  return { execute: vi.fn(() => hung), finish: () => settle({ accepted: true }) };
}

it("binds target and exact bytes, preserves original request ID and retains one result across duplicate commits", async () => {
  const f = fixture(),
    context = ctx(),
    key = { uploadId: "upload-a" };
  const initial = await f.service.call("native.services.upload.begin", f.begin(), context);
  expect(await f.service.call("native.services.upload.begin", f.begin(), context)).toEqual(initial);
  await expect(
    f.service.call(
      "native.services.upload.begin",
      { ...f.begin(), target: "native.services.workspace.format" },
      context,
    ),
  ).rejects.toThrow("identity changed");
  await expect(
    f.service.call(
      "native.services.upload.append",
      { ...key, offset: 1, data: body.toString("base64") },
      context,
    ),
  ).rejects.toThrow("offset");
  const write = { ...key, offset: 0, data: body.toString("base64") };
  await f.service.call("native.services.upload.append", write, context);
  await f.service.call("native.services.upload.append", write, context);
  const receipt = await f.service.call("native.services.upload.commit", key, context);
  expect(receipt).toMatchObject({ state: "completed", result: { accepted: true }, target });
  expect(f.execute).toHaveBeenCalledExactlyOnceWith(target, params, context);
  expect(await f.service.call("native.services.upload.commit", key, context)).toEqual(receipt);
  expect(await f.service.call("native.services.upload.status", key, context)).toEqual(receipt);
});

it("single-flights an admitted operation and retains capacity across cancel, expiry and concurrent waiters", async () => {
  let finish!: () => void, began!: () => void;
  const started = new Promise<void>((done) => {
    began = done;
  });
  const execute = vi.fn(async () => {
    began();
    await new Promise<void>((done) => {
      finish = done;
    });
    return { accepted: true };
  });
  const f = fixture(execute, { commitDeadlineMs: 10 * limits.ttlMs }),
    context = ctx(),
    key = { uploadId: "upload-a" };
  await f.stage(context);
  const first = f.service.call("native.services.upload.commit", key, context);
  await started;
  const second = f.service.call("native.services.upload.commit", key, context);
  f.expire();
  expect((await f.service.call("native.services.upload.cancel", key, context)).state).toBe(
    "committing",
  );
  expect((await f.service.call("native.services.upload.status", key, context))?.state).toBe(
    "committing",
  );
  await f.service.call("native.services.upload.begin", f.begin(body, "upload-b"), context);
  await expect(
    f.service.call("native.services.upload.begin", f.begin(body, "upload-c"), context),
  ).rejects.toThrow("capacity");
  finish();
  expect((await first).state).toBe("completed");
  expect(await second).toEqual(await first);
  expect(execute).toHaveBeenCalledTimes(1);
});

it.each(["sha", "utf8", "target-dto"])(
  "retains %s invalid input as not-sent and never calls an arbitrary operation",
  async (kind) => {
    const f = fixture(),
      context = ctx(),
      bytes =
        kind === "utf8"
          ? Buffer.from([255])
          : kind === "target-dto"
            ? Buffer.from('{"command":"files.write","args":{}}')
            : body;
    const input = f.begin(bytes);
    if (kind === "sha") input.sha256 = "f".repeat(64);
    await f.service.call("native.services.upload.begin", input, context);
    await f.service.call(
      "native.services.upload.append",
      { uploadId: input.uploadId, offset: 0, data: bytes.toString("base64") },
      context,
    );
    expect(
      await f.service.call("native.services.upload.commit", { uploadId: input.uploadId }, context),
    ).toMatchObject({ state: "failed", outcome: { delivery: "not-sent", code: "invalid-input" } });
    await expect(
      f.service.call(
        "native.services.upload.begin",
        { ...f.begin(body, "forged"), target: "files.write" },
        context,
      ),
    ).rejects.toThrow();
    expect(f.execute).not.toHaveBeenCalled();
  },
);

it("retains unknown execution without replay and never reveals an entry to another principal or revoked grant", async () => {
  const f = fixture(
      vi.fn(async () => {
        throw new Error("private diagnostic path/token");
      }),
    ),
    context = ctx(),
    key = { uploadId: "upload-a" };
  await f.stage(context);
  const failed = await f.service.call("native.services.upload.commit", key, context);
  expect(failed).toMatchObject({
    state: "failed",
    outcome: { delivery: "unknown", code: "operation-unconfirmed" },
  });
  expect(JSON.stringify(failed)).not.toContain("private diagnostic");
  expect(await f.service.call("native.services.upload.commit", key, context)).toEqual(failed);
  expect(await f.service.call("native.services.upload.status", key, ctx("other"))).toBeNull();
  await expect(
    f.service.call("native.services.upload.status", key, {
      ...context,
      authorized: async () => false,
    }),
  ).rejects.toThrow("revoked");
  expect(f.execute).toHaveBeenCalledTimes(1);
});

it("returns authenticated null after receive expiry and makes cancellation an explicit no-dispatch receipt", async () => {
  const f = fixture(),
    context = ctx(),
    key = { uploadId: "upload-a" };
  expect(await f.service.call("native.services.upload.status", key, context)).toBeNull();
  await f.stage(context);
  f.expire();
  expect(await f.service.call("native.services.upload.status", key, context)).toBeNull();
  await f.stage(context);
  const cancelled = await f.service.call("native.services.upload.cancel", key, context);
  expect(cancelled.state).toBe("cancelled");
  expect(await f.service.call("native.services.upload.commit", key, context)).toEqual(cancelled);
  expect(f.execute).not.toHaveBeenCalled();
});

it("bounds a hung commit to an unknown receipt, keeps its quota until the late settlement and never rewrites it as success", async () => {
  vi.useFakeTimers();
  const hung = hungExecute(),
    f = fixture(hung.execute),
    context = ctx(),
    key = { uploadId: "upload-a" };
  await f.stage(context);
  const first = f.service.call("native.services.upload.commit", key, context);
  await vi.advanceTimersByTimeAsync(0);
  const second = f.service.call("native.services.upload.commit", key, context);
  await vi.advanceTimersByTimeAsync(NATIVE_UPLOAD_COMMIT_LIMITS.deadlineMs);
  const receipt = await first;
  expect(receipt).toMatchObject({
    state: "failed",
    outcome: { delivery: "unknown", code: "operation-unconfirmed" },
  });
  expect(receipt.result).toBeUndefined();
  expect(await second).toEqual(receipt);
  // Retries return the same receipt and never dispatch the operation again.
  expect(await f.service.call("native.services.upload.commit", key, context)).toEqual(receipt);
  expect(await f.service.call("native.services.upload.status", key, context)).toEqual(receipt);
  expect(await f.service.call("native.services.upload.cancel", key, context)).toEqual(receipt);
  // The staging allocation is still charged while the operation may be running.
  await f.service.call("native.services.upload.begin", f.begin(body, "upload-b"), context);
  await expect(
    f.service.call("native.services.upload.begin", f.begin(body, "upload-c"), context),
  ).rejects.toThrow("capacity");
  // Late success is not reported as completed, but releases the charged allocation.
  hung.finish();
  await vi.advanceTimersByTimeAsync(0);
  const late = await f.service.call("native.services.upload.status", key, context);
  expect(late).toMatchObject({
    state: "failed",
    outcome: { delivery: "unknown", code: "operation-unconfirmed" },
  });
  expect(late?.result).toBeUndefined();
  expect(late?.expiresAt).toBe(
    receipt.expiresAt - NATIVE_UPLOAD_COMMIT_LIMITS.holdMs + limits.ttlMs,
  );
  await f.service.call("native.services.upload.begin", f.begin(body, "upload-c"), context);
  expect(hung.execute).toHaveBeenCalledTimes(1);
});

it("keeps the original receipt and quota of a never-settling commit until its hold ends, then abandons it", async () => {
  vi.useFakeTimers();
  const hung = hungExecute(),
    f = fixture(hung.execute),
    context = ctx(),
    key = { uploadId: "upload-a" };
  await f.stage(context);
  const pending = f.service.call("native.services.upload.commit", key, context);
  await vi.advanceTimersByTimeAsync(NATIVE_UPLOAD_COMMIT_LIMITS.deadlineMs);
  const receipt = await pending;
  expect(receipt.outcome).toEqual({ delivery: "unknown", code: "operation-unconfirmed" });
  // Past the normal receipt lifetime the receipt and quota are still retained.
  f.expire();
  expect(await f.service.call("native.services.upload.status", key, context)).toEqual(receipt);
  await f.service.call("native.services.upload.begin", f.begin(body, "upload-b"), context);
  await expect(
    f.service.call("native.services.upload.begin", f.begin(body, "upload-c"), context),
  ).rejects.toThrow("capacity");
  // After the hard hold the entry is released even though the operation never settled.
  f.advance(NATIVE_UPLOAD_COMMIT_LIMITS.holdMs);
  expect(await f.service.call("native.services.upload.status", key, context)).toBeNull();
  await f.service.call("native.services.upload.begin", f.begin(body, "upload-c"), context);
  // A settlement after abandonment is a harmless no-op and never dispatches again.
  hung.finish();
  await vi.advanceTimersByTimeAsync(0);
  expect(await f.service.call("native.services.upload.status", key, context)).toBeNull();
  expect(hung.execute).toHaveBeenCalledTimes(1);
});

it("prune applies a hard commit lifetime so a stuck committing entry cannot outlive its deadline", async () => {
  vi.useFakeTimers();
  const hung = hungExecute(),
    f = fixture(hung.execute),
    context = ctx(),
    key = { uploadId: "upload-a" };
  await f.stage(context);
  const pending = f.service.call("native.services.upload.commit", key, context);
  await vi.advanceTimersByTimeAsync(0);
  f.advance(NATIVE_UPLOAD_COMMIT_LIMITS.deadlineMs);
  expect(await f.service.call("native.services.upload.status", key, context)).toMatchObject({
    state: "failed",
    outcome: { delivery: "unknown", code: "operation-unconfirmed" },
  });
  hung.finish();
  expect((await pending).state).toBe("failed");
});

it("closes without waiting for a hung commit beyond its deadline", async () => {
  vi.useFakeTimers();
  const hung = hungExecute(),
    f = fixture(hung.execute),
    context = ctx();
  await f.stage(context);
  const pending = f.service.call(
    "native.services.upload.commit",
    { uploadId: "upload-a" },
    context,
  );
  await vi.advanceTimersByTimeAsync(0);
  const closing = f.service.close();
  await vi.advanceTimersByTimeAsync(NATIVE_UPLOAD_COMMIT_LIMITS.deadlineMs);
  await closing;
  expect((await pending).state).toBe("failed");
  hung.finish();
});
