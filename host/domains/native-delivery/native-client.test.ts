import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { fixture } from "../../native-devices.test-support";
import { deliverySha } from "../../native-delivery.test-support";
import { nativeDeliveryEpochOriginalId } from "../../../src/shared/model/host-contracts/native-delivery-epochs";

const binary = process.env.BYCODA_NATIVE_DELIVERY_TEST_BINARY;
const nativeTest = "remote::native_buffer_delivery::tests::real_host_epoch_buffer_roundtrip";

/** Explicitly opted-in composed verification. Ordinary Host development does not
 * require an unrelated native build, and libtest never receives live owner data. */
async function runNative(
  executable: string,
  configuration: { endpoint: string; environmentId: string; token: string; projectPath: string },
) {
  const child = spawn(
    resolve(executable),
    ["--ignored", "--exact", nativeTest, "--nocapture", "--test-threads=1"],
    {
      cwd: process.cwd(),
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, BYCODA_EPOCH_HOST_FIXTURE: JSON.stringify(configuration) },
    },
  );
  const chunks: Buffer[] = [];
  let bytes = 0,
    failure: string | undefined;
  const capture = (chunk: Buffer) => {
    bytes += chunk.length;
    if (bytes > 256 * 1024) {
      failure = "Native fixture exceeded its bounded output allowance";
      child.kill();
    } else chunks.push(chunk);
  };
  child.stdout.on("data", capture);
  child.stderr.on("data", capture);
  const timer = setTimeout(() => {
    failure = "Native fixture exceeded its 30 second deadline";
    child.kill();
  }, 30_000);
  try {
    const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (done, reject) => {
        child.once("error", reject);
        child.once("close", (code, signal) => done({ code, signal }));
      },
    );
    // Keep even failed fixture output safe for Vitest's assertion diagnostics.
    const output = Buffer.concat(chunks)
      .toString("utf8")
      .replaceAll(configuration.token, "[fixture credential]");
    if (failure) throw new Error(`${failure}\n${output}`);
    expect(exit, output).toEqual({ code: 0, signal: null });
    expect(output).toContain(`test ${nativeTest} ... ok`);
    expect(output).toContain("1 passed; 0 failed; 0 ignored");
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null && child.signalCode === null) child.kill();
  }
}

it.skipIf(!binary)(
  "composes actual Rust Native FULL acknowledgement, restart and semantic retirement with the real authenticated Host",
  async () => {
    const f = await fixture("2026-10-29-delivery-epochs-cross-process");
    await runNative(binary!, {
      endpoint: f.endpoint,
      environmentId: f.store.environmentId,
      token: f.device.token,
      projectPath: f.projectPath,
    });
    const principal = deliverySha(f.device.token);
    const epochs = await f.store.db
      .prepare(
        "SELECT owner_id,generation,through,high_water,closed FROM native_delivery_epochs WHERE environment_id=? AND principal_id=?",
      )
      .all(f.store.environmentId, principal);
    expect(epochs).toHaveLength(1);
    expect(epochs[0]).toMatchObject({ through: 2, high_water: 2, closed: 0 });
    expect(
      (await f.store.db.prepare("SELECT COUNT(*) AS count FROM native_delivery_receipts").get())
        ?.count,
    ).toBe(0);
    expect(
      await f.store.db
        .prepare(
          "SELECT min_version FROM native_delivery_protocol_floors WHERE environment_id=? AND principal_id=?",
        )
        .get(f.store.environmentId, principal),
    ).toEqual({ min_version: 2 });
    const clockRows = await f.store.db
      .prepare("SELECT report_id,state_json FROM native_buffer_clocks")
      .all();
    expect(clockRows).toHaveLength(1);
    expect(JSON.parse(String(clockRows[0]!.state_json))).toMatchObject({ highWater: 2 });
    const epoch = {
      ownerId: String(epochs[0]!.owner_id),
      generation: Number(epochs[0]!.generation),
    };
    const ws = await f.connect();
    expect(await ws.call("native.delivery.epochs.status", epoch)).toMatchObject({
      through: 2,
      highWater: 2,
      closed: false,
    });
    const before = f.store.db.dataMutationVersion;
    const blocked = await f.http("native.buffers.update", {
      clientId: "restored-legacy-client",
      instanceId: "restored-legacy-instance",
      processId: 1,
      owners: [],
    });
    expect(blocked.error).toBeDefined();
    const original = {
      originalId: nativeDeliveryEpochOriginalId({ ...epoch, sequence: 1 }),
      sha256: "0".repeat(64),
      byteLength: 1,
    };
    expect(await ws.call("native.buffers.delivery.status", original)).toMatchObject({
      state: "fenced",
      epoch: { ...epoch, through: 2, closed: false },
    });
    const foreign = await f.http("native.delivery.epochs.status", epoch, f.other.token);
    expect(foreign.error).toBeDefined();
    expect(foreign.result).toBeUndefined();
    expect(
      await f.store.db.prepare("SELECT report_id,state_json FROM native_buffer_clocks").all(),
    ).toEqual(clockRows);
    expect(f.store.db.dataMutationVersion).toBe(before);
  },
  45_000,
);
