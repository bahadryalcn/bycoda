import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import {
  nativeDeliveryFixture,
  deliveryIdentity,
  deliverySha,
} from "./native-delivery.test-support";
import { createNativeServiceUploadService } from "../domains/native-services/upload";
import { nativeUploadPlatform } from "../ports/native-workspaces";
import { nativeDeliveryConsumedResult } from "./native-delivery-store";
import { monotonicNow } from "../../src/shared/lib/time/timestamps";
import { NATIVE_DELIVERY_ADMISSION_MS } from "../domains/native-delivery/service";
import { WS_LIMITS } from "../../src/shared/model/host-contracts/policy";

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

it("does not enter external effects if critical admission commit acknowledgement fails", async () => {
  const f = await fixture(),
    { apply } = formatRequest();
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
  await expect(f.call("native.services.delivery.apply", apply)).rejects.toThrow();
  vi.restoreAllMocks();
  expect(f.counts.format).toBe(0);
  expect(await f.call("native.services.delivery.apply", apply)).toMatchObject({ state: "unknown" });
  expect(f.counts.format).toBe(0);
});

it("uses FULL for critical journal commits, restores NORMAL and keeps status free of mutations", async () => {
  const f = await fixture(),
    { apply, status } = formatRequest(),
    modes: number[] = [];
  const exec = f.store.db.exec.bind(f.store.db);
  vi.spyOn(f.store.db, "exec").mockImplementation(async (sql) => {
    if (sql === "COMMIT") {
      const row = await f.store.db.prepare("PRAGMA synchronous").get();
      modes.push(Number(row?.synchronous));
    }
    return exec(sql);
  });
  await f.call("native.services.delivery.apply", apply);
  expect(modes.length).toBeGreaterThanOrEqual(2);
  expect(modes.every((mode) => mode === 2)).toBe(true);
  expect((await f.store.db.prepare("PRAGMA synchronous").get())?.synchronous).toBe(1);
  const mutations = f.store.db.dataMutationVersion,
    commits = modes.length;
  expect(await f.call("native.services.delivery.status", status)).toMatchObject({
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
    { identity, apply } = formatRequest(),
    { paramsJson } = apply;
  await f.call("native.services.delivery.apply", apply);
  await expect(
    f.call("native.services.delivery.apply", {
      ...identity,
      target: format,
      paramsJson: paramsJson + " ",
    }),
  ).rejects.toThrow("bytes");
  const changed = paramsJson + " ";
  await expect(
    f.call("native.services.delivery.apply", {
      ...deliveryIdentity(changed, identity.originalId),
      target: format,
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
  await f.call("native.services.delivery.apply", {
    ...deliveryIdentity(paramsJson),
    target: format,
    paramsJson,
  });
  expect(f.counts.format).toBe(2);
  expect(
    await f.call(
      "native.services.delivery.status",
      { ...identity, target: format },
      f.context("b".repeat(64)),
    ),
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

it("preserves delivery metadata and recorded result across staged service commits", async () => {
  const f = await fixture(),
    ctx = f.context();
  const serviceUpload = createNativeServiceUploadService({
    environmentId: f.store.environmentId,
    platform: nativeUploadPlatform,
    execute: async () => {
      throw new Error("Legacy formatter must not be replayed");
    },
    deliver: (target, identity, paramsJson, context) =>
      f.call("native.services.delivery.apply", { ...identity, target, paramsJson }, context),
  });
  cleanups.push(serviceUpload.close);
  const paramsJson = JSON.stringify({
    id: "staged-relay",
    result: { text: "x".repeat(1_100_000) },
  });
  const bytes = Buffer.from(paramsJson);
  const identity = deliveryIdentity(paramsJson);
  const uploadId = randomUUID();
  await serviceUpload.call(
    "native.services.upload.begin",
    {
      uploadId,
      target: finish,
      byteLength: bytes.length,
      sha256: identity.sha256,
      delivery: identity,
    },
    ctx,
  );
  for (let offset = 0; offset < bytes.length; offset += 65_536) {
    await serviceUpload.call(
      "native.services.upload.append",
      {
        uploadId,
        offset,
        data: bytes.subarray(offset, offset + 65_536).toString("base64"),
      },
      ctx,
    );
  }
  const commit = () => serviceUpload.call("native.services.upload.commit", { uploadId }, ctx);
  const committed = await commit();
  expect(committed).toMatchObject({
    state: "completed",
    delivery: identity,
    result: { state: "recorded", target: finish, ...identity },
  });
  expect(await serviceUpload.call("native.services.upload.status", { uploadId }, ctx)).toEqual(
    committed,
  );
  expect(await commit()).toEqual(committed);
  expect(f.counts).toEqual({ finish: 1, format: 0 });
});

const formatRequest = (extra: Record<string, unknown> = {}) => {
  const paramsJson = JSON.stringify({
    command: "format_text_file",
    args: { path: "/fixture/source.ts", source: "source", cursorOffset: 0 },
  });
  const identity = deliveryIdentity(paramsJson);
  return {
    identity,
    status: { ...identity, target: format },
    apply: { ...identity, target: format, paramsJson, ...extra },
  };
};
const gated = () => {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => (release = resolve));
  return { promise, release };
};

it("never admits or runs a delivery whose ingress deadline passed before admission", async () => {
  const f = await fixture();
  const request = formatRequest();
  const expired = {
    ...f.context(),
    ingressAt: monotonicNow() - NATIVE_DELIVERY_ADMISSION_MS - 1,
  };
  await expect(
    f.call("native.services.delivery.apply", request.apply, expired),
  ).rejects.toMatchObject({ name: "HostDomainOutcomeError", delivery: "not-sent" });
  expect(f.counts.format).toBe(0);
  expect(await f.call("native.services.delivery.status", request.status)).toEqual({
    state: "absent",
  });
  // The same original is still admissible by a caller whose deadline is open.
  expect(await f.call("native.services.delivery.apply", request.apply)).toMatchObject({
    state: "recorded",
  });
  expect(f.counts.format).toBe(1);
});

it("counts FIFO queue time against the original ingress deadline and admits nothing once it lapses", async () => {
  const f = await fixture();
  const request = formatRequest();
  const hold = gated();
  const holder = f.store.db.scope(() => hold.promise);
  const queued = f.call("native.services.delivery.apply", request.apply, {
    ...f.context(),
    ingressAt: monotonicNow() - NATIVE_DELIVERY_ADMISSION_MS + 60,
  });
  const outcome = expect(queued).rejects.toMatchObject({ delivery: "not-sent" });
  await new Promise((resolve) => setTimeout(resolve, 150));
  hold.release();
  await holder;
  await outcome;
  expect(f.counts.format).toBe(0);
  expect(await f.call("native.services.delivery.status", request.status)).toEqual({
    state: "absent",
  });
});

it("acknowledges durable admission first and serves the typed result by original id without replay", async () => {
  const f = await fixture();
  const request = formatRequest({ acknowledge: "admission" });
  const hold = gated();
  f.setFormat(async () => {
    await hold.promise;
    return { formatted: "formatted", cursorOffset: 1 };
  });
  const accepted = { ...request.identity, target: format, state: "accepted" };
  expect(await f.call("native.services.delivery.apply", request.apply)).toEqual(accepted);
  expect(
    await f.call("native.services.delivery.status", {
      ...request.status,
      acknowledge: "admission",
    }),
  ).toEqual(accepted);
  // Without the opt-in a status read keeps the legacy meaning: admitted and outcome unknown.
  expect(await f.call("native.services.delivery.status", request.status)).toEqual({
    ...request.identity,
    target: format,
    state: "unknown",
  });
  // A duplicate, even with the opt-in, never starts a second effect.
  expect(await f.call("native.services.delivery.apply", request.apply)).toEqual(accepted);
  expect(f.counts.format).toBe(1);
  hold.release();
  await vi.waitFor(async () =>
    expect(
      await f.call("native.services.delivery.status", {
        ...request.status,
        acknowledge: "admission",
      }),
    ).toMatchObject({ state: "recorded", result: { formatted: "formatted", cursorOffset: 1 } }),
  );
  expect(await f.call("native.services.delivery.apply", request.apply)).toMatchObject({
    state: "recorded",
  });
  expect(f.counts.format).toBe(1);
});

it("keeps early admission replies bounded until their physical effects settle", async () => {
  const f = await fixture();
  const hold = gated();
  const start = () =>
    f.journal.begin(
      f.principal,
      finish,
      deliveryIdentity("{}"),
      async () => {
        await hold.promise;
        return { accepted: true };
      },
      { acknowledgeAdmission: true },
    );
  const limit = WS_LIMITS.maxControlJobsPerDevice;
  const pending = Array.from({ length: limit + 1 }, start);
  try {
    const started = await Promise.all(pending);
    expect(started.filter((entry) => entry.acknowledgeEarly)).toHaveLength(limit);
    expect(started.at(-1)?.acknowledgeEarly).toBe(false);
  } finally {
    hold.release();
    await Promise.allSettled(pending.map(async (entry) => (await entry).settled));
  }
  const next = await start();
  await next.settled;
  expect(next.acknowledgeEarly).toBe(true);
});

it("keeps an accepted original unknown and unreplayed after a restart or a failed effect", async () => {
  const f = await fixture();
  const crashed = formatRequest({ acknowledge: "admission" });
  const hold = gated();
  f.setFormat(async () => {
    await hold.promise;
    throw new Error("Formatter failed after acceptance");
  });
  expect(await f.call("native.services.delivery.apply", crashed.apply)).toMatchObject({
    state: "accepted",
  });
  hold.release();
  const unknown = { ...crashed.identity, target: format, state: "unknown" };
  // The failed effect leaves no live owner: no longer accepted, never retried.
  await vi.waitFor(async () =>
    expect(
      await f.call("native.services.delivery.status", {
        ...crashed.status,
        acknowledge: "admission",
      }),
    ).toMatchObject({ state: "unknown" }),
  );
  await f.reopen();
  expect(
    await f.call("native.services.delivery.status", {
      ...crashed.status,
      acknowledge: "admission",
    }),
  ).toMatchObject(unknown);
  expect(await f.call("native.services.delivery.apply", crashed.apply)).toMatchObject({
    state: "unknown",
  });
  expect(f.counts.format).toBe(1);
});

it("does not raise a revoked requester's scope: accepted work cannot record or disclose after revocation", async () => {
  const f = await fixture();
  const request = formatRequest({ acknowledge: "admission" });
  const hold = gated();
  f.setFormat(async () => {
    await hold.promise;
    return { formatted: "late", cursorOffset: 0 };
  });
  expect(await f.call("native.services.delivery.apply", request.apply)).toMatchObject({
    state: "accepted",
  });
  f.setAllowed(false);
  hold.release();
  await expect(
    f.call("native.services.delivery.status", { ...request.status, acknowledge: "admission" }),
  ).rejects.toThrow(/authoriz/i);
  f.setAllowed(true);
  await vi.waitFor(async () =>
    expect(
      await f.call("native.services.delivery.status", {
        ...request.status,
        acknowledge: "admission",
      }),
    ).toMatchObject({ state: "unknown" }),
  );
  expect(f.counts.format).toBe(1);
});
