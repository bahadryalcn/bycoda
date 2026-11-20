import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { createNativeBufferUploadService } from "./buffer-upload";
import { NATIVE_UPLOAD_COMMIT_LIMITS } from "./upload-commit";
import { nativeBufferUploadPlatform } from "../../ports/native-workspaces";
import type { HostDomainContext } from "../context";
import { NATIVE_BUFFER_UPLOAD_LIMITS as limits } from "../../../src/shared/model/host-contracts/native-buffer-upload";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  vi.useRealTimers();
});
const owner: NonNullable<HostDomainContext["workspaceOwner"]> = async () => {
  throw new Error("Upload fixture update is already supplied by its isolated execution port");
};
const context = (id = "device-a"): HostDomainContext => ({
  principalId: id,
  authorized: async () => true,
  workspaceOwner: owner,
});
const body = () =>
  Buffer.from(
    JSON.stringify({ clientId: "client", instanceId: "instance", processId: 1, owners: [] }),
  );
const start = (bytes: Buffer, uploadId = "upload-a") => ({
  uploadId,
  byteLength: bytes.length,
  sha256: createHash("sha256").update(bytes).digest("hex"),
});
function fixture(
  update: (params: Record<string, unknown>, context: HostDomainContext) => Promise<unknown> = vi.fn(
    async () => ({ acknowledged: true }),
  ),
  options: { commitDeadlineMs?: number; commitHoldMs?: number } = {},
) {
  let now = 1000;
  const service = createNativeBufferUploadService({
    platform: nativeBufferUploadPlatform,
    environmentId: "env-a",
    update,
    now: () => now,
    ...options,
  });
  cleanups.push(service.close);
  return {
    service,
    update,
    expire: () => {
      now += limits.ttlMs + 1;
    },
    advance: (ms: number) => {
      now += ms;
    },
  };
}
/** An update that starts, then stays pending until the test settles it. */
function hungUpdate() {
  let settle!: (value: unknown) => void;
  const hung = new Promise<unknown>((resolve) => {
    settle = resolve;
  });
  return { update: vi.fn(() => hung), finish: () => settle({ acknowledged: true }) };
}
async function stage(
  service: ReturnType<typeof createNativeBufferUploadService>,
  bytes: Buffer,
  ctx = context(),
  uploadId = "upload-a",
) {
  await service.call("native.buffers.upload.start", start(bytes, uploadId), ctx);
  for (let offset = 0; offset < bytes.length; offset += limits.chunkBytes)
    await service.call(
      "native.buffers.upload.write",
      {
        uploadId,
        offset,
        data: bytes.subarray(offset, offset + limits.chunkBytes).toString("base64"),
      },
      ctx,
    );
}

it("retains identical start/write/commit results without dispatching the update twice", async () => {
  const f = fixture(),
    bytes = body(),
    ctx = context(),
    key = { uploadId: "upload-a" };
  const initial = await f.service.call("native.buffers.upload.start", start(bytes), ctx);
  expect(await f.service.call("native.buffers.upload.start", start(bytes), ctx)).toEqual(initial);
  await expect(
    f.service.call("native.buffers.upload.start", { ...start(bytes), sha256: "a".repeat(64) }, ctx),
  ).rejects.toThrow("identity changed");
  const chunk = { ...key, offset: 0, data: bytes.toString("base64") };
  const written = await f.service.call("native.buffers.upload.write", chunk, ctx);
  expect(await f.service.call("native.buffers.upload.write", chunk, ctx)).toEqual(written);
  const committed = await f.service.call("native.buffers.upload.commit", key, ctx);
  expect(committed.state).toBe("completed");
  expect(committed.result).toEqual({ acknowledged: true });
  expect(await f.service.call("native.buffers.upload.commit", key, ctx)).toEqual(committed);
  expect(await f.service.call("native.buffers.upload.status", key, ctx)).toEqual(committed);
  expect(await f.service.call("native.buffers.upload.write", chunk, ctx)).toEqual(committed);
  expect(f.update).toHaveBeenCalledExactlyOnceWith(JSON.parse(bytes.toString()), ctx);
});

it("rejects gaps, altered duplicates, noncanonical base64 and oversized chunks before update", async () => {
  const f = fixture(),
    ctx = context(),
    bytes = body();
  await f.service.call("native.buffers.upload.start", start(bytes), ctx);
  const key = { uploadId: "upload-a" };
  for (const chunk of [
    { offset: 1, data: bytes.toString("base64") },
    { offset: 0, data: "!" },
    { offset: 0, data: Buffer.alloc(limits.chunkBytes + 1).toString("base64") },
  ])
    await expect(
      f.service.call("native.buffers.upload.write", { ...key, ...chunk }, ctx),
    ).rejects.toThrow();
  await expect(f.service.call("native.buffers.upload.commit", key, ctx)).rejects.toThrow(
    "incomplete",
  );
  await f.service.call(
    "native.buffers.upload.write",
    { ...key, offset: 0, data: bytes.toString("base64") },
    ctx,
  );
  await expect(
    f.service.call(
      "native.buffers.upload.write",
      { ...key, offset: 0, data: Buffer.alloc(bytes.length).toString("base64") },
      ctx,
    ),
  ).rejects.toThrow("changed");
  expect(f.update).not.toHaveBeenCalled();
});

it.each(["digest", "json", "utf8", "schema"])(
  "retains %s rejection as not-sent without calling the Native owner",
  async (failure) => {
    const f = fixture(),
      ctx = context(),
      bytes =
        failure === "json"
          ? Buffer.from("{")
          : failure === "utf8"
            ? Buffer.from([0xff])
            : failure === "schema"
              ? Buffer.from('{"method":"arbitrary"}')
              : body();
    const input = start(bytes);
    if (failure === "digest") input.sha256 = "f".repeat(64);
    await f.service.call("native.buffers.upload.start", input, ctx);
    await f.service.call(
      "native.buffers.upload.write",
      { uploadId: input.uploadId, offset: 0, data: bytes.toString("base64") },
      ctx,
    );
    const status = await f.service.call(
      "native.buffers.upload.commit",
      { uploadId: input.uploadId },
      ctx,
    );
    expect(status).toMatchObject({
      state: "failed",
      outcome: { delivery: "not-sent", code: "invalid-input" },
    });
    expect(f.update).not.toHaveBeenCalled();
  },
);

it("keeps a failed update outcome and never redispatches an unknown commit", async () => {
  const f = fixture(
      vi.fn(async () => {
        throw new Error("private owner IO path");
      }),
    ),
    ctx = context();
  await stage(f.service, body(), ctx);
  const key = { uploadId: "upload-a" };
  const failed = await f.service.call("native.buffers.upload.commit", key, ctx);
  expect(failed).toMatchObject({
    state: "failed",
    outcome: { delivery: "unknown", code: "update-unconfirmed" },
  });
  expect(JSON.stringify(failed)).not.toContain("private owner");
  expect(await f.service.call("native.buffers.upload.commit", key, ctx)).toEqual(failed);
  expect(f.update).toHaveBeenCalledTimes(1);
});

it("single-flights accepted commits, retains capacity and prevents abort/expiry from cancelling actual work", async () => {
  let finish!: () => void, started!: () => void;
  const began = new Promise<void>((resolve) => {
    started = resolve;
  });
  const update = vi.fn(async () => {
    started();
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    return { acknowledged: true };
  });
  const f = fixture(update, { commitDeadlineMs: 10 * limits.ttlMs }),
    ctx = context(),
    key = { uploadId: "upload-a" };
  await stage(f.service, body(), ctx);
  const first = f.service.call("native.buffers.upload.commit", key, ctx);
  await began;
  const second = f.service.call("native.buffers.upload.commit", key, ctx);
  expect((await f.service.call("native.buffers.upload.abort", key, ctx)).state).toBe("committing");
  f.expire();
  expect((await f.service.call("native.buffers.upload.status", key, ctx))?.state).toBe(
    "committing",
  );
  await f.service.call("native.buffers.upload.start", start(body(), "upload-b"), ctx);
  await expect(
    f.service.call("native.buffers.upload.start", start(body(), "upload-c"), ctx),
  ).rejects.toThrow("capacity");
  finish();
  expect((await first).state).toBe("completed");
  expect(await second).toEqual(await first);
  expect(update).toHaveBeenCalledTimes(1);
});

it("isolates principal/environment and rejects missing/revoked capabilities before staging or disclosure", async () => {
  const f = fixture(),
    ctx = context(),
    key = { uploadId: "upload-a" };
  await stage(f.service, body(), ctx);
  expect(await f.service.call("native.buffers.upload.status", key, context("device-b"))).toBeNull();
  await expect(
    f.service.call("native.buffers.upload.start", start(body()), {
      ...ctx,
      workspaceOwner: undefined,
    }),
  ).rejects.toThrow("revoked");
  await expect(
    f.service.call("native.buffers.upload.commit", key, { ...ctx, authorized: async () => false }),
  ).rejects.toThrow("revoked");
  const other = createNativeBufferUploadService({
    environmentId: "env-b",
    update: f.update,
    platform: nativeBufferUploadPlatform,
  });
  cleanups.push(other.close);
  expect(await other.call("native.buffers.upload.status", key, ctx)).toBeNull();
  expect(f.update).not.toHaveBeenCalled();
});

it("bounds reserved bytes globally and per principal, expires staging, and retains an explicit abort receipt", async () => {
  const f = fixture(),
    ctx = context(),
    max = { byteLength: limits.maxBytes, sha256: "a".repeat(64) };
  for (let n = 0; n < 4; n++)
    await f.service.call(
      "native.buffers.upload.start",
      { ...max, uploadId: `upload-${n}` },
      context(`device-${n}`),
    );
  await expect(
    f.service.call("native.buffers.upload.start", { ...max, uploadId: "overflow" }, ctx),
  ).rejects.toThrow("capacity");
  const aborted = await f.service.call(
    "native.buffers.upload.abort",
    { uploadId: "upload-0" },
    context("device-0"),
  );
  expect(aborted.state).toBe("aborted");
  expect(
    await f.service.call(
      "native.buffers.upload.commit",
      { uploadId: "upload-0" },
      context("device-0"),
    ),
  ).toEqual(aborted);
  await f.service.call("native.buffers.upload.start", { ...max, uploadId: "now-fits" }, ctx);
  f.expire();
  expect(
    await f.service.call("native.buffers.upload.status", { uploadId: "now-fits" }, ctx),
  ).toBeNull();
  await f.service.call("native.buffers.upload.start", start(body(), "fresh"), ctx);
});

it("bounds a hung commit to an unknown receipt, keeps its quota until the late settlement and never rewrites it as success", async () => {
  vi.useFakeTimers();
  const hung = hungUpdate(),
    f = fixture(hung.update),
    ctx = context(),
    key = { uploadId: "upload-a" };
  await stage(f.service, body(), ctx);
  const first = f.service.call("native.buffers.upload.commit", key, ctx);
  await vi.advanceTimersByTimeAsync(0);
  const second = f.service.call("native.buffers.upload.commit", key, ctx);
  await vi.advanceTimersByTimeAsync(NATIVE_UPLOAD_COMMIT_LIMITS.deadlineMs);
  const receipt = await first;
  expect(receipt).toMatchObject({
    state: "failed",
    outcome: { delivery: "unknown", code: "update-unconfirmed" },
  });
  expect(receipt.result).toBeUndefined();
  expect(await second).toEqual(receipt);
  // Retries return the same receipt and never dispatch the update again.
  expect(await f.service.call("native.buffers.upload.commit", key, ctx)).toEqual(receipt);
  expect(await f.service.call("native.buffers.upload.status", key, ctx)).toEqual(receipt);
  expect(await f.service.call("native.buffers.upload.abort", key, ctx)).toEqual(receipt);
  // The staging allocation is still charged while the operation may be running.
  await f.service.call("native.buffers.upload.start", start(body(), "upload-b"), ctx);
  await expect(
    f.service.call("native.buffers.upload.start", start(body(), "upload-c"), ctx),
  ).rejects.toThrow("capacity");
  // Late success is not reported as completed, but releases the charged allocation.
  hung.finish();
  await vi.advanceTimersByTimeAsync(0);
  const late = await f.service.call("native.buffers.upload.status", key, ctx);
  expect(late).toMatchObject({
    state: "failed",
    outcome: { delivery: "unknown", code: "update-unconfirmed" },
  });
  expect(late?.result).toBeUndefined();
  expect(late?.expiresAt).toBe(
    receipt.expiresAt - NATIVE_UPLOAD_COMMIT_LIMITS.holdMs + limits.ttlMs,
  );
  await f.service.call("native.buffers.upload.start", start(body(), "upload-c"), ctx);
  expect(hung.update).toHaveBeenCalledTimes(1);
});

it("keeps the original receipt and quota of a never-settling commit until its hold ends, then abandons it", async () => {
  vi.useFakeTimers();
  const hung = hungUpdate(),
    f = fixture(hung.update),
    ctx = context(),
    key = { uploadId: "upload-a" };
  await stage(f.service, body(), ctx);
  const pending = f.service.call("native.buffers.upload.commit", key, ctx);
  await vi.advanceTimersByTimeAsync(NATIVE_UPLOAD_COMMIT_LIMITS.deadlineMs);
  const receipt = await pending;
  expect(receipt.outcome).toEqual({ delivery: "unknown", code: "update-unconfirmed" });
  // Past the normal receipt lifetime the receipt and quota are still retained.
  f.expire();
  expect(await f.service.call("native.buffers.upload.status", key, ctx)).toEqual(receipt);
  await f.service.call("native.buffers.upload.start", start(body(), "upload-b"), ctx);
  await expect(
    f.service.call("native.buffers.upload.start", start(body(), "upload-c"), ctx),
  ).rejects.toThrow("capacity");
  // After the hard hold the entry is released even though the operation never settled.
  f.advance(NATIVE_UPLOAD_COMMIT_LIMITS.holdMs);
  expect(await f.service.call("native.buffers.upload.status", key, ctx)).toBeNull();
  await f.service.call("native.buffers.upload.start", start(body(), "upload-c"), ctx);
  // A settlement after abandonment is a harmless no-op and never dispatches again.
  hung.finish();
  await vi.advanceTimersByTimeAsync(0);
  expect(await f.service.call("native.buffers.upload.status", key, ctx)).toBeNull();
  expect(hung.update).toHaveBeenCalledTimes(1);
});

it("prune applies a hard commit lifetime so a stuck committing entry cannot outlive its deadline", async () => {
  vi.useFakeTimers();
  const hung = hungUpdate(),
    f = fixture(hung.update),
    ctx = context(),
    key = { uploadId: "upload-a" };
  await stage(f.service, body(), ctx);
  const pending = f.service.call("native.buffers.upload.commit", key, ctx);
  await vi.advanceTimersByTimeAsync(0);
  f.advance(NATIVE_UPLOAD_COMMIT_LIMITS.deadlineMs);
  expect(await f.service.call("native.buffers.upload.status", key, ctx)).toMatchObject({
    state: "failed",
    outcome: { delivery: "unknown", code: "update-unconfirmed" },
  });
  hung.finish();
  expect((await pending).state).toBe("failed");
});

it("closes without waiting for a hung commit beyond its deadline", async () => {
  vi.useFakeTimers();
  const hung = hungUpdate(),
    f = fixture(hung.update),
    ctx = context();
  await stage(f.service, body(), ctx);
  const pending = f.service.call("native.buffers.upload.commit", { uploadId: "upload-a" }, ctx);
  await vi.advanceTimersByTimeAsync(0);
  const closing = f.service.close();
  await vi.advanceTimersByTimeAsync(NATIVE_UPLOAD_COMMIT_LIMITS.deadlineMs);
  await closing;
  expect((await pending).state).toBe("failed");
  hung.finish();
});
