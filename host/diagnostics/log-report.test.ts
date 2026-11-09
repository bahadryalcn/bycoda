import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  DIAGNOSTICS_LOGS_RPC,
  HOST_LOG_SECTION_NAMES,
} from "../../src/shared/model/host-contracts/diagnostics-logs";
import { HOST_RPC_METHODS } from "../../src/shared/model/host-contracts/methods";
import { dispatchOwnerRpc } from "../server/owner-rpc";
import { readHostLogReport } from "./log-report";

const dirs: string[] = [];
const dataDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "bycoda-logreport-"));
  dirs.push(dir);
  mkdirSync(join(dir, "logs"));
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const schema = DIAGNOSTICS_LOGS_RPC["diagnostics.logs.read"];

it("returns bounded tails, skips missing files and validates against the contract", async () => {
  const dir = dataDir();
  const big = Array.from({ length: 60_000 }, (_, i) => `line-${i}`).join("\n") + "\n";
  writeFileSync(join(dir, "logs", "host.log"), big);
  writeFileSync(join(dir, "logs", "host.1.log"), "previous\n");
  const report = await readHostLogReport({ dataDir: dir, version: "1.2.3" });
  expect(schema.result.parse(report)).toEqual(report);
  const names = report.sections.map((section) => section.name);
  expect(names).toEqual(["host", "host-previous", "host-environment"]);
  const host = report.sections[0];
  expect(host.truncated).toBe(true);
  expect(Buffer.byteLength(host.text)).toBeLessThanOrEqual(400 * 1024);
  expect(host.text.startsWith("line-")).toBe(true);
  expect(host.text).toContain("line-59999");
  expect(report.sections[1]).toMatchObject({ text: "previous\n", truncated: false });
  expect(report.hostVersion).toBe("1.2.3");
  for (const name of names) expect(HOST_LOG_SECTION_NAMES).toContain(name);
});

it("describes the environment without paths", async () => {
  const dir = dataDir();
  const env = (await readHostLogReport({ dataDir: dir, version: "1.2.3" })).sections.at(-1)!;
  expect(env.name).toBe("host-environment");
  expect(env.text).toContain("hostVersion: 1.2.3");
  expect(env.text).toContain("dataDirKind: override");
  expect(env.text).not.toContain(dir);
});

it("renders the crash marker and redacts home paths and tokens", async () => {
  const dir = dataDir();
  writeFileSync(
    join(dir, "logs", "last-crash.json"),
    JSON.stringify({
      message: "boom",
      location: null,
      thread: "host",
      backtrace: `at ${join(homedir(), "proj", "a.ts")}:1`,
      occurredAt: "2026-11-09T10:00:00.000Z",
      appVersion: "1.2.3",
    }),
  );
  writeFileSync(join(dir, "host.log"), "Authorization: Bearer abcdefghijklmnop1234\n");
  const report = await readHostLogReport({ dataDir: dir, version: "1.2.3" });
  const crash = report.sections.find((section) => section.name === "host-crash")!;
  expect(crash.text).toContain("thread: host");
  expect(crash.text).toContain("appVersion: 1.2.3");
  expect(crash.text).toContain("~");
  expect(crash.text).not.toContain(homedir());
  const stdout = report.sections.find((section) => section.name === "host-stdout")!;
  expect(stdout.text).not.toContain("abcdefghijklmnop1234");
});

it("rejects extra params in the contract and declares a paired-device read method", () => {
  expect(schema.params.safeParse({}).success).toBe(true);
  expect(schema.params.safeParse({ extra: 1 }).success).toBe(false);
  expect(HOST_RPC_METHODS["diagnostics.logs.read"]).toMatchObject({
    kind: "query",
    cost: "read",
  });
});

it("routes through the owner dispatcher and refuses invalid params", async () => {
  const dir = dataDir();
  const dependencies = { engine: { store: { attachmentDir: join(dir, "attachments") } } };
  const request = (params: unknown) =>
    ({ input: { method: "diagnostics.logs.read" }, params, result: undefined }) as never;
  const ok = request({});
  await dispatchOwnerRpc(dependencies as never, ok);
  expect((ok as { result: { hostVersion: string } }).result.hostVersion).toBeTruthy();
  await expect(dispatchOwnerRpc(dependencies as never, request({ extra: 1 }))).rejects.toThrow();
});
