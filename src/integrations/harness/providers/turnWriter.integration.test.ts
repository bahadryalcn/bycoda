import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HarnessOperationContext } from "../core/types";

// Actual Core/provider views, controlled byte transport. No real Native/Host
// permission, physical process or SDK attestation is issued by these fixtures.
const transport = vi.hoisted(() => ({ invoke: vi.fn(), bridge: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: transport.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("../core/socialBridge", () => ({
  socialBridge: transport.bridge,
  socialAcpServers: () => [],
  socialSpawnArgs: (_provider: unknown, args: string[]) => args,
}));
vi.mock("../core/runtimeLogsBridge", () => ({
  runtimeLogsBridge: async () => null,
  runtimeLogsAcpServers: () => [],
  runtimeLogsSpawnArgs: (_provider: unknown, args: string[]) => args,
}));
vi.mock("../core/conversationToolsBridge", () => ({
  conversationToolsBridge: async () => null,
  conversationToolsAcpServers: () => [],
  conversationToolsSpawnArgs: (_provider: unknown, args: string[]) => args,
}));

beforeEach(() => {
  vi.resetModules();
  transport.invoke.mockReset();
  transport.bridge.mockReset().mockResolvedValue(null);
});
afterEach(() => vi.useRealTimers());
const uuid = (value: number) => `00000000-0000-4000-8000-${value.toString(16).padStart(12, "0")}`;

async function fixture(mode: "host" | "native" = "host") {
  let sequence = 0;
  const writes: Array<Record<string, unknown>> = [];
  let reply: ((frame: Record<string, unknown>) => void) | undefined;
  transport.invoke.mockImplementation(
    async (command: string, args: Record<string, unknown> = {}) => {
      if (command === "control_authorize_turn")
        return { version: 1, sessionId: args.sessionId, turnId: uuid(++sequence) };
      if (command === "harness_spawn")
        return {
          version: 1,
          backend: mode,
          sessionId: args.sessionId,
          constructionId: uuid(++sequence),
          pid: 42,
        };
      if (command === "harness_bind_turn") {
        const control = args.controlTurn as { sessionId: string; turnId: string };
        return {
          version: 1,
          bindingId: uuid(++sequence),
          sessionId: control.sessionId,
          constructionId: args.constructionId,
          turnId: control.turnId,
        };
      }
      if (command === "harness_write" || command === "harness_write_controlled") {
        const frame = JSON.parse(String(args.line)) as Record<string, unknown>;
        writes.push(frame);
        if (frame.id !== undefined)
          queueMicrotask(() => reply?.({ id: frame.id, result: "accepted" }));
      }
      return undefined;
    },
  );
  const core = await import("../core/child");
  const source = await import("./turnWriter");
  const controls = await import("../core/controlTurn");
  if (mode === "host")
    core.configureChildBackend({ invoke: transport.invoke, listen: vi.fn(async () => () => {}) });
  const control =
    mode === "native"
      ? await controls.beginNativeControlTurn("logical", "/project", false, transport.invoke)
      : undefined;
  const process = core.createChildProcessHandle("physical#1", control);
  await core.spawnChild(process, "fixture", [], "/project");
  const context = (label: string): HarnessOperationContext =>
    Object.freeze({
      operation: Object.freeze({ label }),
      nativeControlTurn: control,
      originalProcess: process,
      originalProcesses: Object.freeze([process]),
    });
  return {
    core,
    source,
    process,
    control,
    context,
    writes,
    onReply(callback: (frame: Record<string, unknown>) => void) {
      reply = callback;
    },
    calls: (name: string) => transport.invoke.mock.calls.filter(([command]) => command === name),
  };
}

describe("provider operation source with actual shared Core clients", () => {
  it("cancels queued B without sending a cancel or closing active A on the same process", async () => {
    const f = await fixture();
    const { JsonRpcClient } = await import("../core/jsonRpc");
    const rpc = new JsonRpcClient(f.process, {});
    const a = f.context("A"),
      b = f.context("B");
    const viewA = await f.source.captureRpcTurnWriter(f.process, rpc, undefined, a)();
    const startB = f.source.captureRpcTurnWriter(f.process, rpc, undefined, b);
    await viewA.notify("A-before");
    expect(f.source.cancelQueuedOperation(b)).toBe(true);
    await expect(startB()).rejects.toThrow("cancelled");
    await viewA.notify("A-after");
    expect(f.writes.map((frame) => frame.method)).toEqual(["A-before", "A-after"]);
    expect(f.calls("harness_kill")).toHaveLength(0);
    f.source.finishProviderOperation(a);
    rpc.close();
  });

  it("never restores closed A cleanup permission after B claims and then closes the same warm process", async () => {
    const f = await fixture();
    const { JsonRpcClient } = await import("../core/jsonRpc");
    const rpc = new JsonRpcClient(f.process, {});
    const a = f.context("A"),
      b = f.context("B");
    await f.source.captureRpcTurnWriter(f.process, rpc, undefined, a)();
    f.source.finishProviderOperation(a);
    const cleanupA = await f.source.rpcTurnWriter(f.process, rpc, undefined, a, "control");
    await cleanupA.notify("A-own-cleanup-before-B");
    const viewB = await f.source.captureRpcTurnWriter(f.process, rpc, undefined, b)();
    await viewB.notify("B");
    f.source.finishProviderOperation(b);
    await expect(cleanupA.notify("late-A-cleanup")).rejects.toThrow("replaced");
    expect(f.source.ownsOperation(a, f.process)).toBe(false);
    expect(f.writes.map((frame) => frame.method)).toEqual(["A-own-cleanup-before-B", "B"]);
    rpc.close();
  });

  it("never readmits a finished operation after pruning, including its captured thunk and late alias", async () => {
    const f = await fixture();
    const { JsonRpcClient } = await import("../core/jsonRpc");
    const rpc = new JsonRpcClient(f.process, {});
    const a = f.context("A"),
      b = f.context("B"),
      c = f.context("C");
    const startA = f.source.captureRpcTurnWriter(f.process, rpc, undefined, a);
    const viewA = await startA();
    await viewA.notify("A");
    f.source.finishProviderOperation(a);
    const viewB = await f.source.captureRpcTurnWriter(f.process, rpc, undefined, b)();
    await viewB.notify("B");
    f.source.finishProviderOperation(b);
    const startC = f.source.captureRpcTurnWriter(f.process, rpc, undefined, c);
    await expect(startA().then((view) => view.notify("resurrected-A"))).rejects.toThrow();
    const lateAlias = f.core.createChildProcessHandle("late-alias-of-A");
    const observed = vi.fn();
    expect(() =>
      f.source.observeProviderProcess(
        {
          sessionId: "logical",
          cwd: "/project",
          model: "fixture",
          runtimeMode: "supervised",
          onEvent: vi.fn(),
          onOriginalProcess: observed,
          operationContext: a,
        },
        lateAlias,
        "starting",
      ),
    ).toThrow();
    expect(observed).not.toHaveBeenCalled();
    const viewC = await startC();
    await viewC.notify("C-still-writable");
    expect(f.writes.map((frame) => frame.method)).toEqual(["A", "B", "C-still-writable"]);
    expect(f.calls("harness_spawn")).toHaveLength(1);
    f.source.finishProviderOperation(c);
    rpc.close();
  });

  it("refuses an unknown operation even with the same exact physical source", async () => {
    const f = await fixture();
    const { JsonRpcClient } = await import("../core/jsonRpc");
    const rpc = new JsonRpcClient(f.process, {});
    const known = f.context("known"),
      unknown = f.context("unknown");
    const good = await f.source.captureRpcTurnWriter(f.process, rpc, undefined, known)();
    await expect(
      f.source
        .rpcTurnWriter(f.process, rpc, undefined, unknown, "control")
        .then((view) => view.notify("unknown")),
    ).rejects.toThrow();
    await good.notify("known-still-writable");
    expect(f.writes.map((frame) => frame.method)).toEqual(["known-still-writable"]);
    f.source.finishProviderOperation(known);
    rpc.close();
  });

  it("rechecks the original operation at actual Host write after ACP bridge preparation", async () => {
    const f = await fixture();
    const { AcpClient } = await import("../core/acp");
    const acp = new AcpClient(f.process, {});
    f.onReply((frame) => acp.pushLine(JSON.stringify(frame)));
    const a = f.context("A"),
      b = f.context("B");
    const viewA = await f.source.captureAcpTurnWriter(f.process, acp, undefined, a)();
    let release!: (value: null) => void;
    const bridge = new Promise<null>((resolve) => {
      release = resolve;
    });
    transport.bridge.mockReturnValue(bridge);
    const first = viewA.request("session/new", { mcpServers: [] }).then(
      (value) => ({ kind: "resolved" as const, value }),
      (error: unknown) => ({ kind: "rejected" as const, error }),
    );
    await vi.waitFor(() => expect(transport.bridge).toHaveBeenCalled());
    f.source.finishProviderOperation(a);
    const viewB = await f.source.captureAcpTurnWriter(f.process, acp, undefined, b)();
    await viewB.notify("B");
    release(null);
    expect((await first).kind).toBe("rejected");
    expect(f.writes.map((frame) => frame.method)).toEqual(["B"]);
    f.source.finishProviderOperation(b);
    acp.close();
  });

  it("refuses a mismatched actual RPC process before a Native binding can mutate its source", async () => {
    const f = await fixture("native");
    const { JsonRpcClient } = await import("../core/jsonRpc");
    const clientA = new JsonRpcClient(f.process, {});
    const second = f.core.createChildProcessHandle("physical#2", f.control);
    await f.core.spawnChild(second, "fixture", [], "/project");
    const context = Object.freeze({
      operation: Object.freeze({}),
      nativeControlTurn: f.control,
      originalProcess: second,
      originalProcesses: Object.freeze([second]),
    });
    f.source.beginProviderOperation(context, second);
    await expect(f.source.rpcTurnWriter(second, clientA, f.control, context)).rejects.toThrow();
    expect(f.calls("harness_bind_turn")).toHaveLength(0);
    expect(f.calls("harness_write")).toHaveLength(0);
    expect(f.calls("harness_write_controlled")).toHaveLength(0);
    f.source.finishProviderOperation(context);
    clientA.close();
  });
});
