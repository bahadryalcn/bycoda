import { readFile, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import {
  nativeDeliveryFixture,
  deliveryIdentity,
  deliverySha,
} from "./native-delivery.test-support";
import { durableWrite } from "../git/turn-git-history";
import { createNativeBufferUploadService } from "../domains/native-workspaces/buffer-upload";
import { createNativeServiceUploadService } from "../domains/native-services/upload";
import { nativeBufferUploadPlatform } from "../ports/native-workspaces";
import { nativeDeliveryConsumedResult } from "./native-delivery-store";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function fixture() {
  const f = await nativeDeliveryFixture();
  cleanups.push(f.close);
  return f;
}
const format = "native.services.workspace.format" as const;
const finish = "native.services.conversation.desktop.finish" as const;

it("retains exact original buffer proof across Host reopen, later projection archive and duplicate apply", async () => {
  const f = await fixture(),
    paramsJson = f.report(),
    identity = deliveryIdentity(paramsJson);
  const expected = { ...identity, state: "recorded", result: { acknowledged: true } };
  expect(await f.call("native.buffers.delivery.apply", { ...identity, paramsJson })).toEqual(
    expected,
  );
  expect(f.counts.buffers).toBe(1);
  const row = await f.journal.read(f.principal, "buffer", identity);
  expect(row?.proof?.reportVersion).toBeGreaterThan(0);
  await f.reopen();
  expect(await f.call("native.buffers.delivery.status", identity)).toEqual(expected);
  expect(await f.call("native.buffers.delivery.apply", { ...identity, paramsJson })).toEqual(
    expected,
  );
  expect(f.counts.buffers).toBe(1);
  await f.call("native.buffers.delivery.apply", { ...deliveryIdentity(paramsJson), paramsJson });
  await f.reopen();
  expect(await f.call("native.buffers.delivery.status", identity)).toEqual(expected);
  expect(f.counts.buffers).toBe(2);
});

it("does not trust a recorded DB result when exact current/archive proof is absent or corrupt", async () => {
  const f = await fixture(),
    paramsJson = f.report(),
    identity = deliveryIdentity(paramsJson);
  await f.call("native.buffers.delivery.apply", { ...identity, paramsJson });
  const row = await f.journal.read(f.principal, "buffer", identity);
  const path = join(f.root, "native-activity", "buffers", `${row!.proof!.reportId}.json`);
  const original = await readFile(path);
  await unlink(path);
  await f.reopen();
  expect(await f.call("native.buffers.delivery.status", identity)).toEqual({
    ...identity,
    state: "unknown",
  });
  expect(await f.call("native.buffers.delivery.apply", { ...identity, paramsJson })).toEqual({
    ...identity,
    state: "unknown",
  });
  expect(f.counts.buffers).toBe(1);
  await writeFile(path, Buffer.concat([original, Buffer.from(" ")]));
  expect(await f.call("native.buffers.delivery.status", identity)).toEqual({
    ...identity,
    state: "unknown",
  });
});

it("recovers an FS commit whose acknowledgement was lost without dispatching a second buffer update", async () => {
  const f = await fixture(),
    paramsJson = f.report(),
    identity = deliveryIdentity(paramsJson);
  let written = false;
  f.setWrite(async (path, bytes) => {
    if (!written && path.includes("buffers")) {
      written = true;
      await durableWrite(path, bytes);
      throw new Error("Lost after actual projection commit");
    }
  });
  expect(await f.call("native.buffers.delivery.apply", { ...identity, paramsJson })).toMatchObject({
    state: "recorded",
  });
  expect((await f.journal.read(f.principal, "buffer", identity))?.state).toBe("admitted");
  f.setWrite(undefined);
  await f.reopen();
  expect(await f.call("native.buffers.delivery.status", identity)).toMatchObject({
    state: "recorded",
  });
  expect(f.counts.buffers).toBe(1);
});

it("leaves a planned-but-unwritten projection unknown across restart and never retries it", async () => {
  const f = await fixture(),
    paramsJson = f.report(),
    identity = deliveryIdentity(paramsJson);
  f.setWrite(async (path) => {
    if (path.includes("buffers")) throw new Error("Before projection write");
  });
  expect(await f.call("native.buffers.delivery.apply", { ...identity, paramsJson })).toMatchObject({
    state: "unknown",
  });
  expect((await f.journal.read(f.principal, "buffer", identity))?.proof).toBeDefined();
  f.setWrite(undefined);
  await f.reopen();
  expect(await f.call("native.buffers.delivery.apply", { ...identity, paramsJson })).toMatchObject({
    state: "unknown",
  });
  expect(f.counts.buffers).toBe(1);
});

it("does not enter external effects if critical admission commit acknowledgement fails", async () => {
  const f = await fixture(),
    paramsJson = f.report(),
    identity = deliveryIdentity(paramsJson);
  const exec = f.store.db.exec.bind(f.store.db);
  let injected = false;
  vi.spyOn(f.store.db, "exec").mockImplementation(async (sql) => {
    const value = await exec(sql);
    if (!injected && sql === "COMMIT") {
      injected = true;
      throw new Error("Lost critical commit acknowledgement");
    }
    return value;
  });
  await expect(
    f.call("native.buffers.delivery.apply", { ...identity, paramsJson }),
  ).rejects.toThrow();
  vi.restoreAllMocks();
  expect(f.counts.buffers).toBe(0);
  expect(await f.call("native.buffers.delivery.apply", { ...identity, paramsJson })).toMatchObject({
    state: "unknown",
  });
  expect(f.counts.buffers).toBe(0);
});

it("uses FULL for critical journal commits, restores NORMAL and keeps status free of mutations", async () => {
  const f = await fixture(),
    paramsJson = f.report(),
    identity = deliveryIdentity(paramsJson),
    modes: number[] = [];
  const exec = f.store.db.exec.bind(f.store.db);
  vi.spyOn(f.store.db, "exec").mockImplementation(async (sql) => {
    if (sql === "COMMIT") {
      const row = await f.store.db.prepare("PRAGMA synchronous").get();
      modes.push(Number(row?.synchronous));
    }
    return exec(sql);
  });
  await f.call("native.buffers.delivery.apply", { ...identity, paramsJson });
  expect(modes.length).toBeGreaterThanOrEqual(3);
  expect(modes.every((mode) => mode === 2)).toBe(true);
  expect((await f.store.db.prepare("PRAGMA synchronous").get())?.synchronous).toBe(1);
  const mutations = f.store.db.dataMutationVersion,
    commits = modes.length;
  expect(await f.call("native.buffers.delivery.status", identity)).toMatchObject({
    state: "recorded",
  });
  expect(f.store.db.dataMutationVersion).toBe(mutations);
  expect(modes.length).toBe(commits);
});

it("single-flights a durable admitted original while its real formatter work is pending", async () => {
  const f = await fixture(),
    paramsJson = JSON.stringify({
      command: "format_text_file",
      args: { path: "/fixture/file.ts", source: "source", cursorOffset: 0 },
    }),
    identity = deliveryIdentity(paramsJson);
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>((resolve) => {
      enter = resolve;
    }),
    held = new Promise<void>((resolve) => {
      release = resolve;
    });
  f.setFormat(async () => {
    enter();
    await held;
    return { formatted: "result", cursorOffset: 0 };
  });
  const params = { ...identity, target: format, paramsJson },
    original = f.call("native.services.delivery.apply", params);
  try {
    await entered;
    expect(await f.call("native.services.delivery.apply", params)).toMatchObject({
      state: "unknown",
    });
    expect(
      await f.call("native.services.delivery.status", { ...identity, target: format }),
    ).toMatchObject({ state: "unknown" });
    expect(f.counts.format).toBe(1);
  } finally {
    release();
  }
  expect(await original).toMatchObject({ state: "recorded", result: { formatted: "result" } });
});

it("binds ID to exact UTF8 bytes and target, while different physical originals remain separate", async () => {
  const f = await fixture(),
    paramsJson = f.report(),
    identity = deliveryIdentity(paramsJson);
  await f.call("native.buffers.delivery.apply", { ...identity, paramsJson });
  await expect(
    f.call("native.buffers.delivery.apply", { ...identity, paramsJson: paramsJson + " " }),
  ).rejects.toThrow("bytes");
  const changed = paramsJson + " ";
  await expect(
    f.call("native.buffers.delivery.apply", {
      ...deliveryIdentity(changed, identity.originalId),
      paramsJson: changed,
    }),
  ).rejects.toThrow("identity conflicts");
  const targetJson = JSON.stringify({ id: "relay", result: null });
  await expect(
    f.call("native.services.delivery.apply", {
      ...deliveryIdentity(targetJson, identity.originalId),
      target: finish,
      paramsJson: targetJson,
    }),
  ).rejects.toThrow("target conflicts");
  await f.call("native.buffers.delivery.apply", { ...deliveryIdentity(paramsJson), paramsJson });
  expect(f.counts.buffers).toBe(2);
  expect(
    await f.call("native.buffers.delivery.status", identity, f.context("b".repeat(64))),
  ).toEqual({ state: "absent" });
});

it("retains service handler results but never reruns an admitted unknown formatter after restart", async () => {
  const f = await fixture(),
    paramsJson = JSON.stringify({
      command: "format_text_file",
      args: { path: "/fixture/file.ts", source: "source 😀", cursorOffset: 1 },
    }),
    identity = deliveryIdentity(paramsJson);
  // Use actual finite schema shape; invalid formatter selection remains preadmission.
  const params = { ...identity, target: format, paramsJson };
  expect(await f.call("native.services.delivery.apply", params)).toMatchObject({
    state: "recorded",
    result: { formatted: "formatted 😀" },
  });
  await f.reopen();
  expect(await f.call("native.services.delivery.apply", params)).toMatchObject({
    state: "recorded",
  });
  expect(f.counts.format).toBe(1);
  await f.call("native.services.delivery.ack", {
    ...identity,
    target: format,
    consumedResult: nativeDeliveryConsumedResult(format, {
      formatted: "formatted 😀",
      cursorOffset: 1,
    }),
  });
  const next = deliveryIdentity(paramsJson);
  f.setFormat(async () => {
    throw new Error("Formatter response lost after admission");
  });
  expect(
    await f.call("native.services.delivery.apply", { ...next, target: format, paramsJson }),
  ).toMatchObject({ state: "unknown" });
  await f.reopen();
  expect(
    await f.call("native.services.delivery.apply", { ...next, target: format, paramsJson }),
  ).toMatchObject({ state: "unknown" });
  expect(f.counts.format).toBe(2);
});

it("records finish handler return without recreating pending requesters, and gates retained result disclosure", async () => {
  const f = await fixture(),
    paramsJson = JSON.stringify({ id: "relay-original", result: { text: "Türkçe 😀" } }),
    identity = deliveryIdentity(paramsJson),
    guards: Array<() => Promise<boolean>> = [];
  const ctx = f.context();
  ctx.retainResultAuthority = (check) => guards.push(check);
  expect(
    await f.call(
      "native.services.delivery.apply",
      { ...identity, target: finish, paramsJson },
      ctx,
    ),
  ).toMatchObject({ state: "recorded", result: { accepted: true } });
  await f.reopen();
  expect(
    await f.call("native.services.delivery.status", { ...identity, target: finish }),
  ).toMatchObject({ state: "recorded" });
  expect(f.counts.finish).toBe(1);
  f.setAllowed(false);
  expect(await guards[0]()).toBe(false);
  await expect(
    f.call("native.services.delivery.status", { ...identity, target: finish }),
  ).rejects.toThrow();
});

it("reads full original result bytes in bounded guarded chunks after restart without wrapper inflation", async () => {
  const f = await fixture(),
    paramsJson = JSON.stringify({
      command: "format_text_file",
      args: { path: "/fixture/file.ts", source: "x", cursorOffset: 0 },
    }),
    identity = deliveryIdentity(paramsJson);
  const result = { formatted: "Türkçe 😀\n".repeat(150_000), cursorOffset: 0 },
    raw = Buffer.from(JSON.stringify(result));
  f.setFormat(async () => result);
  const expectedSource = { sha256: deliverySha(raw), byteLength: raw.length };
  expect(
    await f.call("native.services.delivery.apply", { ...identity, target: format, paramsJson }),
  ).toEqual({ ...identity, target: format, state: "recorded", resultSource: expectedSource });
  await f.reopen();
  expect(
    await f.call("native.services.delivery.status", { ...identity, target: format }),
  ).toMatchObject({ state: "recorded", resultSource: expectedSource });
  const chunks: Buffer[] = [],
    guards: Array<() => Promise<boolean>> = [],
    ctx = f.context();
  ctx.retainResultAuthority = (check) => guards.push(check);
  for (let offset = 0; offset < raw.length; offset += 65_536) {
    const chunk = await f.call(
      "native.services.delivery.result.read",
      { ...identity, target: format, resultSource: expectedSource, offset, limit: 65_536 },
      ctx,
    );
    expect(chunk).toMatchObject({
      ...identity,
      target: format,
      resultSource: expectedSource,
      offset,
    });
    const bytes = Buffer.from((chunk as { data: string }).data, "base64");
    expect(bytes.length).toBe(Math.min(65_536, raw.length - offset));
    chunks.push(bytes);
  }
  const received = Buffer.concat(chunks);
  expect(received.length).toBe(raw.length);
  expect(deliverySha(received)).toBe(expectedSource.sha256);
  expect(JSON.parse(received.toString("utf8"))).toEqual(result);
  await expect(
    f.call("native.services.delivery.result.read", {
      ...identity,
      target: format,
      resultSource: { ...expectedSource, sha256: "b".repeat(64) },
      offset: 0,
      limit: 65_536,
    }),
  ).rejects.toThrow();
  await expect(
    f.call("native.services.delivery.result.read", {
      ...identity,
      target: format,
      resultSource: expectedSource,
      offset: 0,
      limit: 65_537,
    }),
  ).rejects.toThrow();
  expect(f.counts.format).toBe(1);
  f.setAllowed(false);
  expect(await guards[0]()).toBe(false);
  await expect(
    f.call("native.services.delivery.result.read", {
      ...identity,
      target: format,
      resultSource: expectedSource,
      offset: 0,
      limit: 65_536,
    }),
  ).rejects.toThrow();
});

it("preserves the existing32MiB target result limit using source metadata rather than shrinking it for a wrapper", async () => {
  const f = await fixture(),
    paramsJson = JSON.stringify({
      command: "format_text_file",
      args: { path: "/fixture/file.ts", source: "x", cursorOffset: 0 },
    }),
    identity = deliveryIdentity(paramsJson);
  const maximum = 32 * 1024 * 1024,
    empty = { formatted: "", cursorOffset: 0 },
    result = {
      ...empty,
      formatted: "x".repeat(maximum - Buffer.byteLength(JSON.stringify(empty))),
    };
  // Legacy admitted originals keep their larger result contract.
  await f.journal.admit(f.principal, format, identity);
  await f.store.db
    .prepare("UPDATE native_delivery_receipts SET reserved_bytes=? WHERE original_id=?")
    .run(maximum, identity.originalId);
  await f.journal.record(f.principal, format, identity, result);
  const raw = Buffer.from(JSON.stringify(result));
  expect(raw.length).toBe(maximum);
  const status = (await f.call("native.services.delivery.status", {
    ...identity,
    target: format,
  })) as { state: string; resultSource: { sha256: string; byteLength: number } };
  expect(status).toEqual({
    ...identity,
    target: format,
    state: "recorded",
    resultSource: { sha256: deliverySha(raw), byteLength: maximum },
  });
  for (const offset of [0, maximum - 65_536]) {
    const part = (await f.call("native.services.delivery.result.read", {
      ...identity,
      target: format,
      resultSource: status.resultSource,
      offset,
      limit: 65_536,
    })) as { data: string };
    expect(deliverySha(Buffer.from(part.data, "base64"))).toBe(
      deliverySha(raw.subarray(offset, offset + 65_536)),
    );
  }
  expect(f.counts.format).toBe(0);
});

it("preserves delivery metadata and recorded result across staged buffer/service commits", async () => {
  const f = await fixture(),
    ctx = f.context();
  const bufferUpload = createNativeBufferUploadService({
    environmentId: f.store.environmentId,
    platform: nativeBufferUploadPlatform,
    update: async () => {
      throw new Error("Legacy owner must not receive a delivery-bound payload");
    },
    deliver: (identity, paramsJson, context) =>
      f.call("native.buffers.delivery.apply", { ...identity, paramsJson }, context),
  });
  const serviceUpload = createNativeServiceUploadService({
    environmentId: f.store.environmentId,
    platform: nativeBufferUploadPlatform,
    execute: async () => {
      throw new Error("Legacy formatter must not be replayed");
    },
    deliver: (target, identity, paramsJson, context) =>
      f.call("native.services.delivery.apply", { ...identity, target, paramsJson }, context),
  });
  cleanups.push(bufferUpload.close, serviceUpload.close);
  for (const service of [false, true]) {
    const paramsJson = service
      ? JSON.stringify({ id: "staged-relay", result: { text: "x".repeat(1_100_000) } })
      : f.report();
    const bytes = Buffer.from(paramsJson),
      identity = deliveryIdentity(paramsJson),
      uploadId = randomUUID();
    const call = (action: string, params: Record<string, unknown>) =>
      service
        ? serviceUpload.call(`native.services.upload.${action}` as never, params, ctx)
        : bufferUpload.call(`native.buffers.upload.${action}` as never, params, ctx);
    await call(service ? "begin" : "start", {
      uploadId,
      byteLength: bytes.length,
      sha256: identity.sha256,
      delivery: identity,
      ...(service ? { target: finish } : {}),
    });
    for (let offset = 0; offset < bytes.length; offset += 65_536)
      await call(service ? "append" : "write", {
        uploadId,
        offset,
        data: bytes.subarray(offset, offset + 65_536).toString("base64"),
      });
    const committed = await call("commit", { uploadId });
    expect(committed).toMatchObject({
      state: "completed",
      delivery: identity,
      result: { state: "recorded", ...identity },
    });
    expect(await call("status", { uploadId })).toEqual(committed);
    expect(await call("commit", { uploadId })).toEqual(committed);
  }
  expect(f.counts).toEqual({ buffers: 1, finish: 1, format: 0 });
});
