import { afterEach, expect, it, vi } from "vitest";
import { nativeDeliveryFixture, deliveryIdentity } from "./native-delivery.test-support";
import { nativeDeliveryConsumedResult } from "./native-delivery-store";
import { durableWrite } from "./turn-git-history";

const format = "native.services.workspace.format" as const;
const finish = "native.services.conversation.desktop.finish" as const;
const maximum = 32 * 1024 * 1024;
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of cleanups.splice(0).reverse()) await close();
});
async function fixture() {
  const f = await nativeDeliveryFixture("2026-10-29-delivery-disposition");
  cleanups.push(f.close);
  return f;
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const formatJson = () =>
  JSON.stringify({
    command: "format_text_file",
    args: { path: "/fixture/source.ts", source: "source", cursorOffset: 0 },
  });
const original = (paramsJson = formatJson()) => ({
  ...deliveryIdentity(paramsJson),
  target: format,
  paramsJson,
});
const identity = (request: ReturnType<typeof original>) => ({
  originalId: request.originalId,
  sha256: request.sha256,
  byteLength: request.byteLength,
});
const unknown = (request: ReturnType<typeof original>) => ({
  ...identity(request),
  target: format,
  state: "unknown",
});
const row = (f: Fixture, originalId: string) =>
  f.store.db
    .prepare(
      "SELECT kind,state,sha256,byte_length,reserved_bytes,result_json FROM native_delivery_receipts WHERE original_id=?",
    )
    .get(originalId);

function commitFault(f: Fixture, sqlMatch: RegExp, mode: "before" | "after", message: string) {
  const prepare = f.store.db.prepare.bind(f.store.db),
    exec = f.store.db.exec.bind(f.store.db);
  let armed = false,
    fired = false;
  const statements = vi.spyOn(f.store.db, "prepare").mockImplementation((sql) => {
    if (sqlMatch.test(sql)) armed = true;
    return prepare(sql);
  });
  const commits = vi.spyOn(f.store.db, "exec").mockImplementation(async (sql) => {
    if (sql === "COMMIT" && armed && !fired) {
      fired = true;
      if (mode === "after") await exec(sql);
      throw new Error(message);
    }
    return exec(sql);
  });
  return {
    restore() {
      statements.mockRestore();
      commits.mockRestore();
    },
    get fired() {
      return fired;
    },
  };
}

it("releases an exited formatter reservation for a distinct full-capacity original while the failed original stays unknown", async () => {
  const f = await fixture(),
    failed = original();
  f.setFormat(async () => {
    throw new Error("Formatter exited without a result");
  });
  expect(await f.call("native.services.delivery.apply", failed)).toEqual(unknown(failed));
  expect(await row(f, failed.originalId)).toMatchObject({
    state: "admitted",
    reserved_bytes: 0,
    result_json: null,
    sha256: failed.sha256,
    byte_length: failed.byteLength,
  });
  f.setFormat(async () => null);
  const next = original();
  expect(await f.call("native.services.delivery.apply", next)).toMatchObject({
    state: "recorded",
    result: null,
  });
  expect(f.counts.format).toBe(2);
  await f.reopen();
  expect(
    await f.call("native.services.delivery.status", {
      ...identity(failed),
      target: format,
    }),
  ).toEqual(unknown(failed));
  expect(await f.call("native.services.delivery.apply", failed)).toEqual(unknown(failed));
  expect(f.counts.format).toBe(2);
  await expect(
    f.call("native.services.delivery.ack", {
      ...identity(failed),
      target: format,
      consumedResult: nativeDeliveryConsumedResult(format, null),
    }),
  ).rejects.toThrow();
  expect((await row(f, failed.originalId))?.state).toBe("admitted");
});

it("keeps an unresolved actual handler's maximum reservation and blocks a distinct formatter before dispatch", async () => {
  const f = await fixture(),
    active = original(),
    next = original();
  let enter!: () => void, release!: (value: unknown) => void;
  const entered = new Promise<void>((resolve) => {
      enter = resolve;
    }),
    waiting = new Promise<unknown>((resolve) => {
      release = resolve;
    });
  f.setFormat(async () => {
    enter();
    return waiting;
  });
  const pending = f.call("native.services.delivery.apply", active);
  try {
    await entered;
    expect(await row(f, active.originalId)).toMatchObject({
      state: "admitted",
      reserved_bytes: maximum,
    });
    await expect(f.call("native.services.delivery.apply", next)).rejects.toThrow(
      /capacity.*before admission/i,
    );
    expect(await row(f, next.originalId)).toBeUndefined();
    expect(await f.call("native.services.delivery.apply", active)).toEqual(unknown(active));
    expect(f.counts.format).toBe(1);
    expect((await row(f, active.originalId))?.reserved_bytes).toBe(maximum);
  } finally {
    release(null);
    await pending;
  }
  expect(
    await f.call("native.services.delivery.status", {
      ...identity(active),
      target: format,
    }),
  ).toMatchObject({ state: "recorded", result: null });
});

it("does not dispose a committed admission whose acknowledgement was lost before the effect entered", async () => {
  const f = await fixture(),
    request = original(),
    exec = f.store.db.exec.bind(f.store.db);
  vi.spyOn(console, "error").mockImplementation(() => {});
  let fired = false;
  const fault = vi.spyOn(f.store.db, "exec").mockImplementation(async (sql) => {
    await exec(sql);
    if (sql === "COMMIT" && !fired) {
      fired = true;
      throw new Error("Admission COMMIT ACK lost");
    }
  });
  await expect(f.call("native.services.delivery.apply", request)).rejects.toThrow(
    "Admission COMMIT ACK lost",
  );
  fault.mockRestore();
  expect(fired).toBe(true);
  expect(f.counts.format).toBe(0);
  expect(await row(f, request.originalId)).toMatchObject({
    state: "admitted",
    reserved_bytes: maximum,
  });
  await f.reopen();
  expect(await f.call("native.services.delivery.apply", request)).toEqual(unknown(request));
  await expect(f.call("native.services.delivery.apply", original())).rejects.toThrow(
    /capacity.*before admission/i,
  );
  expect(f.counts.format).toBe(0);
  expect((await row(f, request.originalId))?.reserved_bytes).toBe(maximum);
});

it("fences late result recording after disposition rather than reusing released capacity", async () => {
  const f = await fixture(),
    request = original();
  f.setFormat(async () => {
    throw new Error("Exited formatter");
  });
  expect(await f.call("native.services.delivery.apply", request)).toEqual(unknown(request));
  await expect(f.journal.record(f.principal, format, identity(request), null)).rejects.toThrow(
    /reserv|held/i,
  );
  await f.reopen();
  await expect(
    f.journal.record(f.principal, format, identity(request), {
      formatted: "late",
      cursorOffset: 0,
    }),
  ).rejects.toThrow(/reserv|held/i);
  expect(
    await f.call("native.services.delivery.status", {
      ...identity(request),
      target: format,
    }),
  ).toEqual(unknown(request));
  expect(await row(f, request.originalId)).toMatchObject({
    state: "admitted",
    reserved_bytes: 0,
    result_json: null,
  });
  expect(f.counts.format).toBe(1);
});

it("preserves an actually recorded result after lost result COMMIT ACK and leaves retired originals terminal", async () => {
  const f = await fixture(),
    request = original(),
    result = { formatted: "recorded result", cursorOffset: 1 };
  f.setFormat(async () => result);
  vi.spyOn(console, "error").mockImplementation(() => {});
  const fault = commitFault(
    f,
    /UPDATE\s+native_delivery_receipts\s+SET\s+state='recorded'/i,
    "after",
    "Result COMMIT ACK lost",
  );
  expect(await f.call("native.services.delivery.apply", request)).toMatchObject({
    state: "recorded",
    result,
  });
  fault.restore();
  expect(fault.fired).toBe(true);
  expect(await row(f, request.originalId)).toMatchObject({
    state: "recorded",
    reserved_bytes: 0,
    result_json: JSON.stringify(result),
  });
  await f.reopen();
  expect(await f.call("native.services.delivery.apply", request)).toMatchObject({
    state: "recorded",
    result,
  });
  const consumedResult = nativeDeliveryConsumedResult(format, result);
  expect(
    await f.call("native.services.delivery.ack", {
      ...identity(request),
      target: format,
      consumedResult,
    }),
  ).toMatchObject({ state: "retired", consumedResult });
  expect(await f.call("native.services.delivery.apply", request)).toMatchObject({
    state: "retired",
    consumedResult,
  });
  expect(f.counts.format).toBe(1);
  expect(await row(f, request.originalId)).toMatchObject({
    state: "retired",
    reserved_bytes: 0,
  });
});

it.each(["rollback", "before", "after"] as const)(
  "keeps unknown identity and never replays after disposition %s failure",
  async (mode) => {
    const f = await fixture(),
      request = original();
    f.setFormat(async () => {
      throw new Error("Handler exited before disposition fault");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    let fault: ReturnType<typeof commitFault> | undefined;
    if (mode === "rollback") {
      await f.store.db.exec(
        "CREATE TRIGGER reject_disposition BEFORE UPDATE OF reserved_bytes ON native_delivery_receipts WHEN OLD.state='admitted' AND NEW.state='admitted' AND NEW.reserved_bytes=0 BEGIN SELECT RAISE(ABORT,'Disposition rollback'); END",
      );
    } else {
      fault = commitFault(
        f,
        /UPDATE\s+native_delivery_receipts\s+SET\s+reserved_bytes\s*=\s*0/i,
        mode,
        "Disposition COMMIT failure",
      );
    }
    const outcome = await f.call("native.services.delivery.apply", request).then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );
    if ("error" in outcome) expect(String(outcome.error)).toMatch(/Disposition|Handler exited/i);
    else expect(outcome.value).toEqual(unknown(request));
    fault?.restore();
    if (mode === "rollback") await f.store.db.exec("DROP TRIGGER reject_disposition");
    else expect(fault?.fired).toBe(true);
    const reserved = mode === "after" ? 0 : maximum;
    expect(await row(f, request.originalId)).toMatchObject({
      state: "admitted",
      reserved_bytes: reserved,
      result_json: null,
      sha256: request.sha256,
      byte_length: request.byteLength,
    });
    await f.reopen();
    expect(
      await f.call("native.services.delivery.status", {
        ...identity(request),
        target: format,
      }),
    ).toEqual(unknown(request));
    expect(await f.call("native.services.delivery.apply", request)).toEqual(unknown(request));
    expect(f.counts.format).toBe(1);
    expect((await row(f, request.originalId))?.reserved_bytes).toBe(reserved);
    f.setFormat(async () => null);
    if (reserved === 0)
      expect(await f.call("native.services.delivery.apply", original())).toMatchObject({
        state: "recorded",
        result: null,
      });
    else
      await expect(f.call("native.services.delivery.apply", original())).rejects.toThrow(
        /capacity.*before admission/i,
      );
  },
);

it("releases only already-owned failure bookkeeping after authority loss without disclosure or revived dispatch", async () => {
  const f = await fixture(),
    request = original(),
    context = f.context(),
    guards: Array<() => Promise<boolean>> = [];
  context.retainResultAuthority = (check) => guards.push(check);
  f.setFormat(async () => {
    f.setAllowed(false);
    throw new Error("Formatter exited as authority retired");
  });
  await expect(f.call("native.services.delivery.apply", request, context)).rejects.toThrow(
    /authoriz/i,
  );
  expect(await row(f, request.originalId)).toMatchObject({
    state: "admitted",
    reserved_bytes: 0,
    result_json: null,
  });
  // The owner adapter retains its existing current-auth check before dispatch.
  // Cleanup must not turn that check into disclosure authority after revocation.
  expect(guards.length).toBeGreaterThan(0);
  expect(await Promise.all(guards.map((check) => check()))).toEqual(guards.map(() => false));
  await expect(
    f.call("native.services.delivery.status", {
      ...identity(request),
      target: format,
    }),
  ).rejects.toThrow(/authoriz/i);
  await expect(f.call("native.services.delivery.apply", original())).rejects.toThrow(/authoriz/i);
  expect(f.counts.format).toBe(1);
  f.setAllowed(true);
  await f.reopen();
  expect(await f.call("native.services.delivery.apply", request)).toEqual(unknown(request));
  f.setFormat(async () => null);
  expect(await f.call("native.services.delivery.apply", original())).toMatchObject({
    state: "recorded",
    result: null,
  });
  expect(f.counts.format).toBe(2);
});

it.each([false, true])(
  "preserves planned buffer proof through disposition and requires actual commit for ACK, committed=%s",
  async (committed) => {
    const f = await fixture(),
      paramsJson = f.report(),
      originalId = deliveryIdentity(paramsJson),
      request = { ...originalId, paramsJson };
    let entered = false;
    f.setWrite(async (path, bytes) => {
      if (!entered && path.includes("buffers")) {
        entered = true;
        if (committed) await durableWrite(path, bytes);
        throw new Error(committed ? "Projection COMMIT ACK lost" : "Projection never committed");
      }
    });
    expect(await f.call("native.buffers.delivery.apply", request)).toMatchObject({
      state: committed ? "recorded" : "unknown",
    });
    f.setWrite(undefined);
    const saved = await f.journal.readMetadata(f.principal, "buffer", originalId);
    expect(saved?.state).toBe("admitted");
    expect(saved?.proof).toBeDefined();
    expect(await row(f, originalId.originalId)).toMatchObject({
      state: "admitted",
      reserved_bytes: 0,
    });
    await f.reopen();
    expect((await f.journal.readMetadata(f.principal, "buffer", originalId))?.proof).toEqual(
      saved!.proof,
    );
    expect(await f.call("native.buffers.delivery.apply", request)).toMatchObject({
      state: committed ? "recorded" : "unknown",
    });
    const ack = {
      ...originalId,
      consumedResult: nativeDeliveryConsumedResult("buffer", {
        acknowledged: true,
      }),
    };
    if (committed) {
      expect(await f.call("native.buffers.delivery.ack", ack)).toMatchObject({
        state: "retired",
      });
      expect(await f.call("native.buffers.delivery.status", originalId)).toMatchObject({
        state: "retired",
      });
    } else {
      await expect(f.call("native.buffers.delivery.ack", ack)).rejects.toThrow(/proof/i);
      expect(await f.call("native.buffers.delivery.status", originalId)).toMatchObject({
        state: "unknown",
      });
    }
    expect(f.counts.buffers).toBe(1);
  },
);

it("disposes the exact admitted clone when an exited handler mutates its input identity", async () => {
  const f = await fixture(),
    paramsJson = formatJson(),
    captured = deliveryIdentity(paramsJson),
    mutable = { ...captured };
  const neighbor = deliveryIdentity(JSON.stringify({ id: "neighbor", result: null }));
  await f.journal.admit(f.principal, finish, neighbor);
  await f.journal.execute(f.principal, format, mutable, async () => {
    mutable.originalId = neighbor.originalId;
    mutable.sha256 = neighbor.sha256;
    mutable.byteLength = neighbor.byteLength;
    throw new Error("Exited with mutated caller object");
  });
  expect(await row(f, captured.originalId)).toMatchObject({
    kind: format,
    state: "admitted",
    reserved_bytes: 0,
    sha256: captured.sha256,
    byte_length: captured.byteLength,
  });
  expect(await row(f, neighbor.originalId)).toMatchObject({
    kind: finish,
    state: "admitted",
    reserved_bytes: 17,
    sha256: neighbor.sha256,
    byte_length: neighbor.byteLength,
  });
  await expect(f.journal.record(f.principal, format, captured, null)).rejects.toThrow(
    /reserv|held/i,
  );
});
