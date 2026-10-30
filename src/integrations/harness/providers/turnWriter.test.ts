import { beforeEach, expect, it, vi } from "vitest";
import type { HarnessOperationContext, HarnessSessionInput } from "../core/types";
import type { ControlTurnHandle } from "../core/controlTurn";
import { processConstructions } from "./processConstruction.testSupport";

const { bytes } = vi.hoisted(() => ({ bytes: vi.fn(async (_id: string, _line: string) => {}) }));
vi.mock("../core/child", async () => {
  const { processConstructions } = await import("./processConstruction.testSupport");
  return processConstructions.mock({ writeChild: bytes });
});
import { JsonRpcClient } from "../core/jsonRpc";
import {
  observeProviderProcess,
  captureRpcTurnWriter,
  finishProviderOperation,
  cancelQueuedOperation,
  ownsOperation,
  captureHttpOperation,
  ownsHttpOperation,
  assertProviderOperation,
} from "./turnWriter";

beforeEach(() => {
  processConstructions.reset();
  bytes.mockClear();
});
const context = (handle: ReturnType<typeof processConstructions.create>): HarnessOperationContext =>
  Object.freeze({
    operation: Object.freeze({}),
    nativeControlTurn: Object.freeze({}) as ControlTurnHandle,
    originalProcesses: Object.freeze([handle]),
  });
const input = (ctx: HarnessOperationContext): HarnessSessionInput => ({
  sessionId: "source-warm",
  cwd: "/repo",
  model: "fixture",
  runtimeMode: "supervised",
  onEvent: () => {},
  operationContext: ctx,
});

// Source/protocol fixture only: actual RPC multiplexer with explicit fake Core
// process/writer objects. No Native receipt, Host run, HMR or provider ACK proof.
it("keeps one warm transport while A cannot write or regain cleanup ownership after B closes", async () => {
  const process = processConstructions.create("source-warm"),
    client = new JsonRpcClient(process, {});
  const a = context(process),
    b = context(process);
  observeProviderProcess(input(a), process, "starting");
  const aView = await captureRpcTurnWriter(process, client, a.nativeControlTurn, a)();
  await aView.notify("fixture/a");
  finishProviderOperation(a);
  observeProviderProcess(input(b), process);
  const bView = await captureRpcTurnWriter(process, client, b.nativeControlTurn, b)();
  await bView.notify("fixture/b");
  expect(ownsOperation(a, process)).toBe(false);
  await expect(aView.notify("fixture/stale-a")).rejects.toThrow(/closed|replaced/);
  finishProviderOperation(b);
  expect(ownsOperation(a, process)).toBe(false);
  expect(ownsOperation(b, process)).toBe(true);
  await expect(bView.notify("fixture/after-close")).rejects.toThrow(/closed/);
  expect(bytes).toHaveBeenCalledTimes(2);
  expect(processConstructions.created).toEqual([process]);
  expect(
    processConstructions.operations
      .filter((entry) => entry.kind === "bind")
      .map((entry) => entry.args[0]),
  ).toEqual([a.nativeControlTurn, b.nativeControlTurn]);
});

it("cancels queued B without touching active A or admitting a later B alias", async () => {
  const process = processConstructions.create("queued-source"),
    client = new JsonRpcClient(process, {});
  const a = context(process),
    b = context(process);
  observeProviderProcess(input(a), process, "starting");
  const aView = await captureRpcTurnWriter(process, client, a.nativeControlTurn, a)();
  const bindB = captureRpcTurnWriter(process, client, b.nativeControlTurn, b);
  expect(cancelQueuedOperation(b)).toBe(true);
  await aView.notify("fixture/a-still-active");
  await expect(bindB()).rejects.toThrow(/cancelled/);
  const alias = processConstructions.create("queued-source#later");
  expect(() => observeProviderProcess(input(b), alias, "starting")).toThrow(/cancelled/);
  expect(() => assertProviderOperation(b)).toThrow(/cancelled/);
  expect(bytes).toHaveBeenCalledTimes(1);
  expect(
    processConstructions.operations
      .filter((entry) => entry.kind === "bind")
      .map((entry) => entry.args[0]),
  ).toEqual([a.nativeControlTurn]);
  finishProviderOperation(a);
  finishProviderOperation(b);
  expect(ownsOperation(a, process)).toBe(false);
});

it("B actual entry fences A even before A's delayed outer finalizer", async () => {
  const process = processConstructions.create("entered-source"),
    client = new JsonRpcClient(process, {});
  const a = context(process),
    b = context(process);
  const aView = await captureRpcTurnWriter(process, client, a.nativeControlTurn, a)();
  const bView = await captureRpcTurnWriter(process, client, b.nativeControlTurn, b)();
  expect(ownsOperation(a, process)).toBe(false);
  await expect(aView.notify("fixture/late-a")).rejects.toThrow(/replaced/);
  await bView.notify("fixture/current-b");
  finishProviderOperation(b);
  finishProviderOperation(a);
  expect(ownsOperation(a, process)).toBe(false);
  expect(bytes).toHaveBeenCalledTimes(1);
});

it("keeps HTTP operation ownership on the actual client without inventing a child", () => {
  const client = Object.freeze({ realHttpClientFixture: true });
  const a: HarnessOperationContext = Object.freeze({ operation: Object.freeze({}) });
  const b: HarnessOperationContext = Object.freeze({ operation: Object.freeze({}) });
  const c: HarnessOperationContext = Object.freeze({ operation: Object.freeze({}) });
  captureHttpOperation(client, a).begin();
  const queuedB = captureHttpOperation(client, b);
  finishProviderOperation(a);
  expect(ownsHttpOperation(a, client)).toBe(false);
  expect(cancelQueuedOperation(b)).toBe(true);
  expect(() => queuedB.begin()).toThrow(/cancelled/);
  finishProviderOperation(b);
  captureHttpOperation(client, c).begin();
  finishProviderOperation(c);
  expect(ownsHttpOperation(a, client)).toBe(false);
  expect(ownsHttpOperation(c, client)).toBe(true);
  expect(processConstructions.created).toEqual([]);
  expect(bytes).not.toHaveBeenCalled();
});

it("refuses excess source reservations before a new bind and never makes a missing old record permissive", async () => {
  const process = processConstructions.create("bounded-source"),
    client = new JsonRpcClient(process, {});
  const a = context(process);
  const aView = await captureRpcTurnWriter(process, client, a.nativeControlTurn, a)();
  const queued = Array.from({ length: 511 }, () => context(process));
  for (const owner of queued) captureRpcTurnWriter(process, client, owner.nativeControlTurn, owner);
  const overflow = context(process);
  expect(() => captureRpcTurnWriter(process, client, overflow.nativeControlTurn, overflow)).toThrow(
    /capacity/,
  );
  await aView.notify("fixture/a-remains-active");
  expect(processConstructions.operations.filter((entry) => entry.kind === "bind")).toHaveLength(1);
  finishProviderOperation(a);
  for (const owner of queued) finishProviderOperation(owner);
  const fresh = context(process);
  await (
    await captureRpcTurnWriter(process, client, fresh.nativeControlTurn, fresh)()
  ).notify("fixture/fresh");
  finishProviderOperation(fresh);
  expect(ownsOperation(a, process)).toBe(false);
  expect(bytes).toHaveBeenCalledTimes(2);
});

it("permanently closes a finished operation before pruning, alias observation or captured reentry", async () => {
  const process = processConstructions.create("finished-source"),
    client = new JsonRpcClient(process, {});
  const a = context(process),
    b = context(process),
    c = context(process);
  const startA = captureRpcTurnWriter(process, client, a.nativeControlTurn, a);
  await (await startA()).notify("fixture/a-original");
  finishProviderOperation(a);
  // Closing user admission does not erase legitimate latest-owner cleanup.
  expect(ownsOperation(a, process)).toBe(true);
  await (await captureRpcTurnWriter(process, client, b.nativeControlTurn, b)()).notify("fixture/b");
  finishProviderOperation(b);
  // C's source reservation prunes the superseded closed A census entry.
  const startC = captureRpcTurnWriter(process, client, c.nativeControlTurn, c);
  const bindings = processConstructions.operations.filter((entry) => entry.kind === "bind").length;
  await expect(startA()).rejects.toThrow(/closed/);
  expect(() => captureRpcTurnWriter(process, client, a.nativeControlTurn, a)).toThrow(/closed/);
  const alias = processConstructions.create("finished-source#alias");
  expect(() => observeProviderProcess(input(a), alias, "starting")).toThrow(/closed/);
  expect(processConstructions.operations.filter((entry) => entry.kind === "bind")).toHaveLength(
    bindings,
  );
  expect(ownsOperation(a, process)).toBe(false);
  await (await startC()).notify("fixture/c-still-current");
  finishProviderOperation(c);
  expect(ownsOperation(c, process)).toBe(true);
  const neverAdmitted = context(alias);
  finishProviderOperation(neverAdmitted);
  expect(() => observeProviderProcess(input(neverAdmitted), alias)).toThrow(/closed/);
  expect(bytes).toHaveBeenCalledTimes(3);
});
