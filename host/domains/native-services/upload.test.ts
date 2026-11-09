import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { createNativeServiceUploadService } from "./upload";
import { nativeBufferUploadPlatform } from "../../ports/native-workspaces";
import type { HostDomainContext } from "../context";
import type { NativeServiceOwnerPorts } from "./ports";
import type { NativeServiceUploadTarget } from "../../../src/shared/model/host-contracts/native-service-upload";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
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
  execute = vi.fn(
    async (
      _target: NativeServiceUploadTarget,
      _params: Record<string, unknown>,
      _context: HostDomainContext,
    ): Promise<unknown> => ({ accepted: true }),
  ),
) {
  let clock = 1000;
  const service = createNativeServiceUploadService({
    environmentId: "env",
    platform: nativeBufferUploadPlatform,
    execute,
    now: () => clock,
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
  };
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
  const f = fixture(execute),
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
