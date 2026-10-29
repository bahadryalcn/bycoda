import { expect, it, vi } from "vitest";
import { fixture } from "../../native-devices.test-support";
import { deliveryIdentity, deliverySha } from "../../native-delivery.test-support";
import { WorkspaceCommands } from "../../workspace-commands";

const target = "native.services.workspace.format";
const maximum = 32 * 1024 * 1024;
const evidence = "2026-10-29-delivery-disposition-root";
const params = (path: string) => {
  const paramsJson = JSON.stringify({
    command: "format_text_file",
    args: { path: `${path}/file.ts`, source: "source", cursorOffset: 1 },
  });
  return { ...deliveryIdentity(paramsJson), target, paramsJson };
};
const ref = (original: ReturnType<typeof params>) => ({
  originalId: original.originalId,
  sha256: original.sha256,
  byteLength: original.byteLength,
  target: original.target,
});

it("keeps an exited failure unknown across HTTP/WS while releasing only its result capacity", async () => {
  const f = await fixture(evidence),
    ws = await f.connect(),
    original = params(f.projectPath);
  const format = vi.spyOn(WorkspaceCommands.prototype, "run").mockImplementationOnce(async () => {
    throw new Error("Actual formatter continuation exited without a result");
  });
  const scope = ref(original),
    unknown = {
      ...scope,
      state: "unknown",
    };
  expect(await f.callHttp("native.services.delivery.apply", original)).toEqual(unknown);
  const row = await f.store.db
    .prepare(`SELECT state,reserved_bytes,sha256,byte_length FROM native_delivery_receipts
      WHERE original_id=? AND principal_id=?`)
    .get(original.originalId, deliverySha(f.device.token));
  expect(row).toEqual({
    state: "admitted",
    reserved_bytes: 0,
    sha256: original.sha256,
    byte_length: original.byteLength,
  });
  const before = f.store.db.dataMutationVersion;
  expect(await ws.call("native.services.delivery.status", scope)).toEqual(unknown);
  expect(await ws.call("native.services.delivery.apply", original)).toEqual(unknown);
  expect(f.store.db.dataMutationVersion).toBe(before);
  expect(format).toHaveBeenCalledTimes(1);
  expect((await f.http("native.services.delivery.status", scope, f.other.token)).result).toEqual({
    state: "absent",
  });
  const conflicting = await ws.request("native.services.delivery.status", {
    ...scope,
    sha256: "a".repeat(64),
  });
  expect(conflicting.error).toBeDefined();
  format.mockResolvedValue(null);
  expect(await ws.call("native.services.delivery.apply", params(f.projectPath))).toMatchObject({
    state: "recorded",
    result: null,
  });
  expect(format).toHaveBeenCalledTimes(2);
  expect(await f.callHttp("native.services.delivery.status", scope)).toEqual(unknown);
  expect(f.command).not.toHaveBeenCalled();
  expect(f.binary).not.toHaveBeenCalled();
});

it("holds an active original across transports until its own continuation exits", async () => {
  const f = await fixture(evidence),
    ws = await f.connect(),
    original = params(f.projectPath);
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>((resolve) => {
      enter = resolve;
    }),
    gate = new Promise<void>((resolve) => {
      release = resolve;
    });
  const format = vi.spyOn(WorkspaceCommands.prototype, "run").mockImplementationOnce(async () => {
    enter();
    await gate;
    throw new Error("Original active formatter finally exited");
  });
  const pending = ws.call("native.services.delivery.apply", original);
  void pending.catch(() => {});
  try {
    await entered;
    expect(await f.callHttp("native.services.delivery.apply", original)).toMatchObject({
      state: "unknown",
    });
    const blocked = await f.http("native.services.delivery.apply", params(f.projectPath));
    expect(blocked.error).toContain("before admission");
    expect(
      (
        await f.store.db
          .prepare("SELECT reserved_bytes FROM native_delivery_receipts WHERE original_id=?")
          .get(original.originalId)
      )?.reserved_bytes,
    ).toBe(maximum);
    expect(format).toHaveBeenCalledTimes(1);
  } finally {
    release();
  }
  expect(await pending).toMatchObject({ state: "unknown" });
  expect(
    (
      await f.store.db
        .prepare("SELECT reserved_bytes FROM native_delivery_receipts WHERE original_id=?")
        .get(original.originalId)
    )?.reserved_bytes,
  ).toBe(0);
  format.mockResolvedValue(null);
  expect(await f.callHttp("native.services.delivery.apply", params(f.projectPath))).toMatchObject({
    state: "recorded",
    result: null,
  });
  expect(format).toHaveBeenCalledTimes(2);
});

it("preserves a recorded result when the actual result COMMIT acknowledgement is lost", async () => {
  const f = await fixture(evidence),
    ws = await f.connect(),
    original = params(f.projectPath);
  let loseResultCommit = false;
  const format = vi.spyOn(WorkspaceCommands.prototype, "run").mockImplementation(async () => {
    loseResultCommit = true;
    return null;
  });
  const exec = f.store.db.exec.bind(f.store.db);
  const fault = vi.spyOn(f.store.db, "exec").mockImplementation(async (sql) => {
    const value = await exec(sql);
    if (sql === "COMMIT" && loseResultCommit) {
      loseResultCommit = false;
      throw new Error("Lost result COMMIT acknowledgement after real SQLite settlement");
    }
    return value;
  });
  expect(await ws.call("native.services.delivery.apply", original)).toMatchObject({
    state: "recorded",
    result: null,
  });
  fault.mockRestore();
  expect(await f.callHttp("native.services.delivery.status", ref(original))).toMatchObject({
    state: "recorded",
    result: null,
  });
  expect(await f.callHttp("native.services.delivery.apply", original)).toMatchObject({
    state: "recorded",
    result: null,
  });
  expect(
    await f.store.db
      .prepare(
        "SELECT state,reserved_bytes,result_json FROM native_delivery_receipts WHERE original_id=?",
      )
      .get(original.originalId),
  ).toEqual({ state: "recorded", reserved_bytes: 0, result_json: "null" });
  expect(format).toHaveBeenCalledTimes(1);
});
