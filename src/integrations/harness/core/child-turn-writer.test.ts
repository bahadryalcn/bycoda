import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChildTurnWriter } from "./child";
import type { HostRunHandle, HostRunBinding } from "./hostRun";

const transport = vi.hoisted(() => ({ invoke: vi.fn(), bridge: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: transport.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("./socialBridge", () => ({
  socialBridge: transport.bridge,
  socialAcpServers: () => [],
  socialSpawnArgs: (_provider: unknown, args: string[]) => args,
}));
vi.mock("./runtimeLogsBridge", () => ({
  runtimeLogsBridge: async () => null,
  runtimeLogsAcpServers: () => [],
  runtimeLogsSpawnArgs: (_provider: unknown, args: string[]) => args,
}));
vi.mock("./conversationToolsBridge", () => ({
  conversationToolsBridge: async () => null,
  conversationToolsAcpServers: () => [],
  conversationToolsSpawnArgs: (_provider: unknown, args: string[]) => args,
}));

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
beforeEach(() => {
  vi.resetModules();
  transport.invoke.mockReset();
  transport.bridge.mockReset().mockResolvedValue(null);
});
afterEach(() => {
  vi.useRealTimers();
});

async function fixture() {
  // Actual Core clients and opaque handles; Native/Host effects are controlled replies.
  // This proves propagation/refusal, not the Rust command's physical/window checks.
  let next = 0;
  const construction = uuid(30);
  const processReceipt = {
    version: 1,
    backend: "native",
    sessionId: "physical#1",
    pid: 41,
    constructionId: construction,
  };
  const binding = (args: Record<string, unknown>) => {
    const control = args.controlTurn as { sessionId: string; turnId: string };
    return {
      version: 1,
      bindingId: uuid(100 + Number.parseInt(control.turnId.slice(-3), 16)),
      sessionId: control.sessionId,
      constructionId: args.constructionId,
      turnId: control.turnId,
    };
  };
  transport.invoke.mockImplementation(async (command: string, args: Record<string, unknown>) => {
    if (command === "control_authorize_turn")
      return { version: 1, sessionId: args.sessionId, turnId: uuid(++next) };
    if (command === "harness_spawn") return { ...processReceipt, sessionId: args.sessionId };
    if (command === "harness_bind_turn") return binding(args);
    return undefined;
  });
  const core = await import("./child");
  const controls = await import("./controlTurn");
  const a = await controls.beginNativeControlTurn("logical", "/project", false, transport.invoke);
  const process = core.createChildProcessHandle("physical#1", a);
  const spawn = () => core.spawnChild(process, "codex", [], "/project");
  const second = () =>
    controls.beginNativeControlTurn("logical", "/project", false, transport.invoke);
  const calls = (command: string) =>
    transport.invoke.mock.calls
      .filter(([name]) => name === command)
      .map(([, args]) => args as Record<string, unknown>);
  return {
    core,
    controls,
    a,
    process,
    spawn,
    second,
    calls,
    construction,
    processReceipt,
    binding,
  };
}

async function hostFixture() {
  const native = await fixture();
  // Controlled in-process Host authority, not a real execution grant. The
  // production Core must preserve these exact private objects without a DTO.
  const runs = new WeakMap<HostRunHandle, string>();
  const bindings = new WeakMap<HostRunBinding, HostRunHandle>();
  const births: HostRunHandle[] = [];
  const issuedBindings: HostRunBinding[] = [];
  const effects: string[] = [];
  let current: HostRunHandle | undefined;
  const mint = (logicalSession = "logical") => {
    const run = Object.freeze({}) as HostRunHandle;
    runs.set(run, logicalSession);
    return run;
  };
  const invoke = vi.fn();
  invoke.mockImplementation(async (command: string, args: Record<string, unknown>) => {
    if (command === "harness_spawn") {
      const run = args.hostRun as HostRunHandle;
      if (!runs.has(run)) throw new Error("Foreign Host run before spawn");
      births.push(run);
      return { ...native.processReceipt, backend: "host", sessionId: args.sessionId };
    }
    if (command === "harness_bind_host_run") {
      const run = args.hostRun as HostRunHandle;
      if (!runs.has(run)) throw new Error("Foreign Host run");
      if (runs.get(run) !== runs.get(births[0])) throw new Error("Host run source mismatch");
      if (args.sessionId !== "host-physical" || args.constructionId !== native.construction)
        throw new Error("Foreign Host construction");
      const binding = Object.freeze({}) as HostRunBinding;
      bindings.set(binding, run);
      issuedBindings.push(binding);
      current = run;
      return binding;
    }
    if (command === "harness_write_host_run") {
      const run = bindings.get(args.binding as HostRunBinding);
      if (!run || run !== current) throw new Error("Original Host run is closed");
      if (args.sessionId !== "host-physical" || args.constructionId !== native.construction)
        throw new Error("Foreign Host construction");
      effects.push(String(args.line));
      return;
    }
    if (command === "harness_write")
      throw new Error("No raw fallback in the enrolled Host fixture");
    return undefined;
  });
  native.core.configureChildBackend({ invoke, listen: async () => () => {} });
  const a = mint();
  const b = mint();
  const process = native.core.createChildProcessHandle("host-physical");
  const calls = (command: string) =>
    invoke.mock.calls
      .filter(([name]) => name === command)
      .map(([, args]) => args as Record<string, unknown>);
  return {
    ...native,
    nativeProcess: native.process,
    nativeControl: native.a,
    process,
    a,
    b,
    invoke,
    mint,
    births,
    issuedBindings,
    effects,
    calls,
  };
}

describe("original Host run writers (controlled in-process Host authority)", () => {
  it("keeps one warm birth run, binds B's exact capability and refuses late A without raw replay", async () => {
    const f = await hostFixture();
    f.core.associateChildHostRun(f.process, f.a);
    await f.core.spawnChild(f.process, "codex", [], "/project");
    const a = await f.core.bindChildTurnWriter(f.process, undefined, f.a);
    await f.core.writeChild(a, "A");
    const b = await f.core.bindChildTurnWriter(f.process, undefined, f.b);
    await f.core.writeChild(
      f.core.guardChildTurnWriter(b, () => {}),
      "B",
    );
    await expect(f.core.writeChild(a, "late A")).rejects.toThrow("Original Host run is closed");
    expect(f.effects).toEqual(["A", "B"]);
    expect(f.births).toEqual([f.a]);
    expect(f.calls("harness_spawn")).toHaveLength(1);
    expect(f.calls("harness_bind_host_run").map((args) => args.hostRun)).toEqual([f.a, f.b]);
    expect(f.calls("harness_write_host_run")[1].binding).toBe(f.issuedBindings[1]);
    expect(f.calls("harness_write")).toHaveLength(0);
    expect(f.calls("harness_bind_turn")).toHaveLength(0);
    expect(() => f.core.associateChildHostRun(f.process, f.b)).toThrow(
      "birth Host run cannot be replaced",
    );
    await expect(f.core.bindChildTurnWriter(f.process)).rejects.toThrow(
      "Original Host run is required",
    );
  });

  it("captures all operation views' original Host run before deferred entry and leaves warm birth unchanged", async () => {
    const f = await hostFixture();
    const source = await import("../providers/turnWriter");
    const { JsonRpcClient } = await import("./jsonRpc");
    const { AcpClient } = await import("./acp");
    const { PiRpc } = await import("../providers/pi/piClient");
    const context = { operation: {}, hostRun: f.a };
    const input = {
      sessionId: "logical",
      cwd: "/project",
      model: "codex:test",
      runtimeMode: "supervised" as const,
      operationContext: context,
      onEvent: () => {},
    };
    source.observeProviderProcess(input, f.process, "starting");
    await f.core.spawnChild(f.process, "codex", [], "/project");
    const rpc = new JsonRpcClient(f.process, {});
    const acp = new AcpClient(f.process, {});
    const pi = new PiRpc(f.process, vi.fn());
    const capturedRpc = source.captureRpcTurnWriter(f.process, rpc, undefined, context);
    const capturedAcp = source.captureAcpTurnWriter(f.process, acp, undefined, context);
    const capturedPi = source.capturePiTurnWriter(f.process, pi, undefined, context);
    const capturedBytes = source.captureByteTurnWriter(f.process, undefined, context);
    // A mutable caller alias cannot upgrade already-captured operation writers.
    context.hostRun = f.b;
    const [rpcView, acpView, piView, bytes] = await Promise.all([
      capturedRpc(),
      capturedAcp(),
      capturedPi(),
      capturedBytes(),
    ]);
    await rpcView.notify("A-rpc");
    await acpView.notify("A-acp");
    const piResult = piView.request({ type: "A-pi" });
    pi.pushLine(JSON.stringify({ type: "response", id: "mc_1", command: "A-pi", success: true }));
    await piResult;
    await bytes("A-bytes");
    expect(f.calls("harness_bind_host_run")).toHaveLength(1);
    expect(f.calls("harness_bind_host_run")[0].hostRun).toBe(f.a);
    expect(f.calls("harness_spawn")[0].hostRun).toBe(f.a);
    source.observeProviderProcess(
      { ...input, operationContext: { operation: {}, hostRun: f.b } },
      f.process,
    );
    expect(f.births).toEqual([f.a]);
    expect(f.effects).toHaveLength(4);
    expect(f.calls("harness_write")).toHaveLength(0);
    source.finishProviderOperation(context);
    rpc.close();
    acp.close();
    pi.close();
  });

  it("retains the exact pending and unknown Host bind without retry or fallback", async () => {
    const f = await hostFixture();
    f.core.associateChildHostRun(f.process, f.a);
    await f.core.spawnChild(f.process, "codex", [], "/project");
    const bind = deferred<unknown>();
    const original = f.invoke.getMockImplementation()!;
    f.invoke.mockImplementation((command, args) =>
      command === "harness_bind_host_run" ? bind.promise : original(command, args),
    );
    const first = f.core.bindChildTurnWriter(f.process, undefined, f.a);
    expect(f.core.bindChildTurnWriter(f.process, undefined, f.a)).toBe(first);
    const refused = expect(first).rejects.toThrow("unknown Host bind");
    await vi.waitFor(() => expect(f.calls("harness_bind_host_run")).toHaveLength(1));
    bind.reject(new Error("unknown Host bind"));
    await refused;
    expect(f.core.bindChildTurnWriter(f.process, undefined, f.a)).toBe(first);
    await expect(f.core.bindChildTurnWriter(f.process)).rejects.toThrow(
      "Original Host run is required",
    );
    expect(f.calls("harness_bind_host_run")).toHaveLength(1);
    expect(f.calls("harness_write")).toHaveLength(0);
  });

  it.each(["foreign", "wrong-logical-source"])(
    "refuses an opaque %s Host run through its original backend",
    async (kind) => {
      const f = await hostFixture();
      f.core.associateChildHostRun(f.process, f.a);
      await f.core.spawnChild(f.process, "codex", [], "/project");
      const foreign =
        kind === "foreign"
          ? (Object.freeze({}) as HostRunHandle)
          : f.mint("another-logical-source");
      const first = f.core.bindChildTurnWriter(f.process, undefined, foreign);
      await expect(first).rejects.toThrow(
        kind === "foreign" ? "Foreign Host run" : "source mismatch",
      );
      expect(f.core.bindChildTurnWriter(f.process, undefined, foreign)).toBe(first);
      expect(f.calls("harness_write_host_run")).toHaveLength(0);
      expect(f.calls("harness_write")).toHaveLength(0);
      expect(f.calls("harness_bind_turn")).toHaveLength(0);
    },
  );

  it("refuses mixed backends, missing birth and malformed run objects before any bind", async () => {
    const f = await hostFixture();
    await expect(f.core.bindChildTurnWriter(f.process, undefined, f.a)).rejects.toThrow(
      "birth Host run is required",
    );
    await expect(f.core.bindChildTurnWriter(f.process, f.nativeControl, f.a)).rejects.toThrow(
      "cannot be combined",
    );
    await expect(f.core.bindChildTurnWriter(f.process, f.nativeControl)).rejects.toThrow(
      "Native control turn cannot target a Host",
    );
    await expect(f.core.bindChildTurnWriter(f.nativeProcess, undefined, f.a)).rejects.toThrow(
      "Host run cannot target a Native",
    );
    expect(() => f.core.associateChildHostRun(f.nativeProcess, f.a)).toThrow(
      "Host run cannot target a Native",
    );
    const getter = vi.fn(() => true);
    const malformed = Object.freeze(
      Object.defineProperty({}, "run", { get: getter }),
    ) as HostRunHandle;
    await expect(f.core.bindChildTurnWriter(f.process, undefined, malformed)).rejects.toThrow(
      "opaque Host run",
    );
    expect(getter).not.toHaveBeenCalled();
    expect(f.calls("harness_bind_host_run")).toHaveLength(0);
    expect(f.calls("harness_bind_turn")).toHaveLength(0);
    expect(f.calls("harness_spawn")).toHaveLength(0);
    expect(transport.invoke.mock.calls.some(([command]) => command === "harness_bind_turn")).toBe(
      false,
    );
  });

  it.each(["null", "array", "dto", "then-property", "accessor", "unfrozen"])(
    "rejects a %s Host binding without any raw write",
    async (kind) => {
      const f = await hostFixture();
      f.core.associateChildHostRun(f.process, f.a);
      await f.core.spawnChild(f.process, "codex", [], "/project");
      const getter = vi.fn(() => "invented");
      const malformed =
        kind === "null"
          ? null
          : kind === "array"
            ? Object.freeze([])
            : kind === "dto"
              ? Object.freeze({ version: 1, runId: "invented" })
              : kind === "then-property"
                ? Object.freeze(JSON.parse('{"then":null}'))
                : kind === "accessor"
                  ? Object.freeze(Object.defineProperty({}, "binding", { get: getter }))
                  : {};
      const original = f.invoke.getMockImplementation()!;
      f.invoke.mockImplementation((command, args) =>
        command === "harness_bind_host_run" ? malformed : original(command, args),
      );
      await expect(f.core.bindChildTurnWriter(f.process, undefined, f.a)).rejects.toThrow(
        "binding is unconfirmed",
      );
      expect(getter).not.toHaveBeenCalled();
      expect(f.calls("harness_write_host_run")).toHaveLength(0);
      expect(f.calls("harness_write")).toHaveLength(0);
    },
  );

  it("captures original birth run and invoke before spawn preparation waits", async () => {
    const f = await hostFixture();
    f.core.associateChildHostRun(f.process, f.a);
    const preparation = deferred();
    const starting = f.core.spawnChild(
      f.process,
      "codex",
      [],
      "/project",
      undefined,
      undefined,
      undefined,
      undefined,
      () => preparation.promise,
    );
    expect(() => f.core.associateChildHostRun(f.process, f.b)).toThrow(
      "birth Host run cannot be replaced",
    );
    const replacement = vi.fn(async () => {
      throw new Error("replacement backend must not receive A");
    });
    f.core.configureChildBackend({ invoke: replacement, listen: async () => () => {} });
    preparation.resolve();
    await starting;
    const writer = await f.core.bindChildTurnWriter(f.process, undefined, f.a);
    await f.core.writeChild(writer, "A original backend");
    expect(replacement).not.toHaveBeenCalled();
    expect(f.births).toEqual([f.a]);
    expect(f.effects).toEqual(["A original backend"]);
  });
});

describe("immutable child turn writers (controlled command transport)", () => {
  it.each(["json-rpc", "acp", "pi"])(
    "refuses a different process in %s synchronously before any Native bind",
    async (kind) => {
      const f = await fixture();
      await f.spawn();
      const { JsonRpcClient } = await import("./jsonRpc");
      const { AcpClient } = await import("./acp");
      const { PiRpc } = await import("../providers/pi/piClient");
      const client =
        kind === "json-rpc"
          ? new JsonRpcClient(f.process, {})
          : kind === "acp"
            ? new AcpClient(f.process, {})
            : new PiRpc(f.process, vi.fn());
      // The same physical locator is still a distinct opaque construction.
      const other = f.core.createChildProcessHandle(f.process.sessionId, f.a);
      const bindAfterCheck = () => {
        client.assertProcess(other);
        return f.core.bindChildTurnWriter(other, f.a);
      };
      expect(bindAfterCheck).toThrow("different process construction");
      expect(f.calls("harness_bind_turn")).toHaveLength(0);
      expect(() => client.assertProcess(f.process)).not.toThrow();
      const writer = await f.core.bindChildTurnWriter(f.process, f.a);
      expect(() => client.withWriter(writer)).not.toThrow();
      expect(f.calls("harness_bind_turn")).toHaveLength(1);
      client.close();
    },
  );

  it("adds refusal guards without changing the exact Native binding or B's writer", async () => {
    const f = await fixture();
    await f.spawn();
    const original = await f.core.bindChildTurnWriter(f.process, f.a);
    const order: string[] = [];
    let open = true;
    const first = f.core.guardChildTurnWriter(original, () => {
      order.push("first");
    });
    const guarded = f.core.guardChildTurnWriter(first, () => {
      order.push("second");
      if (!open) throw new Error("A closed");
    });
    expect(Object.isFrozen(guarded)).toBe(true);
    f.core.assertChildTurnWriter(f.process, guarded);
    await f.core.writeChild(guarded, "A");
    const bControl = await f.second();
    const b = await f.core.bindChildTurnWriter(f.process, bControl);
    open = false;
    await expect(f.core.writeChild(guarded, "late A")).rejects.toThrow("A closed");
    await f.core.writeChild(b, "B");
    expect(order).toEqual(["first", "second", "first", "second"]);
    expect(f.calls("harness_bind_turn")).toHaveLength(2);
    expect(
      f.calls("harness_write_controlled").map((args) => ({
        line: args.line,
        turnId: (args.binding as { turnId: string }).turnId,
      })),
    ).toEqual([
      { line: "A", turnId: f.controls.nativeControlTurnReceipt(f.a).turnId },
      { line: "B", turnId: f.controls.nativeControlTurnReceipt(bControl).turnId },
    ]);
    expect(f.calls("harness_write")).toHaveLength(0);
    expect(() =>
      f.core.guardChildTurnWriter(Object.freeze({ ...original }) as ChildTurnWriter, () => {}),
    ).toThrow("original child turn writer");
  });

  it("refuses a Host ACP write after its bridge await and still permits B's own view", async () => {
    const f = await fixture();
    const hostInvoke = vi.fn(async (command: string, args: Record<string, unknown>) =>
      command === "harness_spawn"
        ? { ...f.processReceipt, backend: "host", sessionId: args.sessionId }
        : undefined,
    );
    f.core.configureChildBackend({ invoke: hostInvoke, listen: async () => () => {} });
    const process = f.core.createChildProcessHandle("host");
    await f.core.spawnChild(process, "codex", [], "/project");
    const original = await f.core.bindChildTurnWriter(process);
    let aOpen = true;
    const guardedA = f.core.guardChildTurnWriter(original, () => {
      if (!aOpen) throw new Error("A closed while preparing bridge");
    });
    const { AcpClient } = await import("./acp");
    const client = new AcpClient(process, {});
    const a = client.withWriter(guardedA);
    const bridge = deferred<null>();
    transport.bridge.mockReturnValue(bridge.promise);
    const pending = a.request("session/new", { mcpServers: [] });
    const refused = expect(pending).rejects.toThrow("A closed while preparing bridge");
    expect(transport.bridge).toHaveBeenCalledTimes(1);
    aOpen = false;
    bridge.resolve(null);
    await refused;
    expect(hostInvoke.mock.calls.map(([command]) => command)).toEqual(["harness_spawn"]);
    const b = client.withWriter(f.core.guardChildTurnWriter(original, () => {}));
    const positive = b.request("B");
    client.pushLine(JSON.stringify({ id: 2, result: "B result" }));
    await expect(positive).resolves.toBe("B result");
    expect(hostInvoke.mock.calls.map(([command]) => command)).toEqual([
      "harness_spawn",
      "harness_write",
    ]);
    expect(f.calls("harness_bind_turn")).toHaveLength(0);
    expect(f.calls("harness_write_controlled")).toHaveLength(0);
    client.close();
  });

  it("refuses an asynchronous guard instead of invoking with a pending check", async () => {
    const f = await fixture();
    await f.spawn();
    const original = await f.core.bindChildTurnWriter(f.process, f.a);
    const guard = deferred();
    const writer = f.core.guardChildTurnWriter(original, () => guard.promise);
    await expect(f.core.writeChild(writer, "unverified")).rejects.toThrow("must be synchronous");
    expect(f.calls("harness_write_controlled")).toHaveLength(0);
    expect(f.calls("harness_write")).toHaveLength(0);
    guard.reject(new Error("late guard failure"));
    await Promise.resolve();
  });

  it("rechecks original teardown after a synchronous write guard reenters cleanup", async () => {
    const f = await fixture();
    await f.spawn();
    const original = await f.core.bindChildTurnWriter(f.process, f.a);
    const writer = f.core.guardChildTurnWriter(original, () => f.core.unwatchChild(f.process));
    await expect(f.core.writeChild(writer, "after teardown")).rejects.toThrow("retired");
    expect(f.calls("harness_write_controlled")).toHaveLength(0);
    expect(f.calls("harness_write")).toHaveLength(0);
  });

  it("binds two issued turns to one warm construction and never retargets an old writer", async () => {
    const f = await fixture();
    await f.spawn();
    const a = await f.core.bindChildTurnWriter(f.process, f.a);
    const bControl = await f.second();
    const b = await f.core.bindChildTurnWriter(f.process, bControl);
    expect(a).not.toBe(b);
    expect(Object.isFrozen(a)).toBe(true);
    await f.core.writeChild(b, "B");
    await f.core.writeChild(a, "late A");
    expect(f.calls("harness_spawn")).toHaveLength(1);
    expect(f.calls("harness_write")).toHaveLength(0);
    const writes = f.calls("harness_write_controlled");
    expect(writes.map((args) => (args.binding as { turnId: string }).turnId)).toEqual([
      f.controls.nativeControlTurnReceipt(bControl).turnId,
      f.controls.nativeControlTurnReceipt(f.a).turnId,
    ]);
    expect(
      writes.every(
        (args) => args.sessionId === "physical#1" && args.constructionId === f.construction,
      ),
    ).toBe(true);
    expect(Object.keys(writes[0].binding as object).sort()).toEqual([
      "bindingId",
      "constructionId",
      "sessionId",
      "turnId",
      "version",
    ]);
  });

  it("caches the exact pending/rejected bind and has no legacy fallback", async () => {
    const f = await fixture();
    await f.spawn();
    const bind = deferred<unknown>();
    const original = transport.invoke.getMockImplementation()!;
    transport.invoke.mockImplementation((command, args) =>
      command === "harness_bind_turn" ? bind.promise : original(command, args),
    );
    const first = f.core.bindChildTurnWriter(f.process, f.a);
    expect(f.core.bindChildTurnWriter(f.process, f.a)).toBe(first);
    await vi.waitFor(() => expect(f.calls("harness_bind_turn")).toHaveLength(1));
    bind.reject(new Error("Native bind outcome unknown"));
    await expect(first).rejects.toThrow("unknown");
    expect(f.core.bindChildTurnWriter(f.process, f.a)).toBe(first);
    expect(f.calls("harness_bind_turn")).toHaveLength(1);
    expect(f.calls("harness_write")).toHaveLength(0);
  });

  it("installs the original bind cache before a synchronously reentrant Native dispatch", async () => {
    const f = await fixture();
    await f.spawn();
    const original = transport.invoke.getMockImplementation()!;
    let reentrant: Promise<ChildTurnWriter> | undefined;
    transport.invoke.mockImplementation((command, args) => {
      if (command === "harness_bind_turn") reentrant = f.core.bindChildTurnWriter(f.process, f.a);
      return original(command, args);
    });
    const binding = f.core.bindChildTurnWriter(f.process, f.a);
    await binding;
    expect(reentrant).toBe(binding);
    expect(f.calls("harness_bind_turn")).toHaveLength(1);
  });

  it("copies the exact Native binding and refuses physical retirement without selecting another source", async () => {
    const f = await fixture();
    await f.spawn();
    const original = transport.invoke.getMockImplementation()!;
    let reply: Record<string, unknown> | undefined;
    transport.invoke.mockImplementation((command, args) => {
      if (command !== "harness_bind_turn") return original(command, args);
      reply = f.binding(args);
      return Promise.resolve(reply);
    });
    const writer = await f.core.bindChildTurnWriter(f.process, f.a);
    reply!.turnId = uuid(20);
    reply!.bindingId = uuid(120);
    await f.core.writeChild(writer, "original");
    expect((f.calls("harness_write_controlled")[0].binding as { turnId: string }).turnId).toBe(
      f.controls.nativeControlTurnReceipt(f.a).turnId,
    );
    f.core.unwatchChild(f.process);
    await expect(f.core.writeChild(writer, "retired")).rejects.toThrow("retired");
    expect(f.calls("harness_write_controlled")).toHaveLength(1);
    expect(f.calls("harness_write")).toHaveLength(0);
  });

  it("fails closed when Native does not implement the new bind command", async () => {
    const f = await fixture();
    await f.spawn();
    const original = transport.invoke.getMockImplementation()!;
    transport.invoke.mockImplementation((command, args) =>
      command === "harness_bind_turn"
        ? Promise.reject(new Error("Command harness_bind_turn not found"))
        : original(command, args),
    );
    const work = f.core.bindChildTurnWriter(f.process, f.a);
    await expect(work).rejects.toThrow("not found");
    expect(f.core.bindChildTurnWriter(f.process, f.a)).toBe(work);
    expect(f.calls("harness_write")).toHaveLength(0);
    expect(f.calls("harness_write_controlled")).toHaveLength(0);
  });

  it("refuses missing original Native control and foreign/forged writer handles before write", async () => {
    const f = await fixture();
    await f.spawn();
    await expect(f.core.bindChildTurnWriter(f.process)).rejects.toThrow(
      "Original Native control turn",
    );
    const writer = await f.core.bindChildTurnWriter(f.process, f.a);
    const foreign = f.core.createChildProcessHandle("physical#1");
    expect(() => f.core.assertChildTurnWriter(foreign, writer)).toThrow("different process");
    await expect(
      f.core.writeChild(Object.freeze({ ...writer }) as ChildTurnWriter, "forged"),
    ).rejects.toThrow();
    expect(f.calls("harness_write")).toHaveLength(0);
    expect(f.calls("harness_write_controlled")).toHaveLength(0);
  });

  it.each([
    "missing",
    "extra",
    "accessor",
    "version",
    "bindingId",
    "sessionId",
    "constructionId",
    "turnId",
  ])("rejects a %s binding response without promoting its fields", async (field) => {
    const f = await fixture();
    await f.spawn();
    const original = transport.invoke.getMockImplementation()!;
    transport.invoke.mockImplementation((command, args) => {
      if (command !== "harness_bind_turn") return original(command, args);
      const value: Record<string, unknown> = f.binding(args);
      if (field === "missing") delete value.turnId;
      else if (field === "extra") value.qualified = true;
      else if (field === "accessor")
        Object.defineProperty(value, "bindingId", { get: () => uuid(101) });
      else value[field] = field === "version" ? 2 : "foreign";
      return Promise.resolve(value);
    });
    await expect(f.core.bindChildTurnWriter(f.process, f.a)).rejects.toThrow("unconfirmed");
    expect(f.calls("harness_write")).toHaveLength(0);
  });

  it("rejects unknown strict commands and rejected controlled writes without raw replay", async () => {
    const f = await fixture();
    await f.spawn();
    const writer = await f.core.bindChildTurnWriter(f.process, f.a);
    transport.invoke.mockImplementation(async (command) => {
      throw new Error(`unsupported ${command}`);
    });
    await expect(f.core.writeChild(writer, "original")).rejects.toThrow("harness_write_controlled");
    expect(f.calls("harness_write")).toHaveLength(0);
    await expect(f.second()).rejects.toThrow("control_authorize_turn");
    expect(f.calls("harness_write")).toHaveLength(0);
  });

  it("keeps its original invoke across a pending spawn and later Host backend configuration", async () => {
    const f = await fixture();
    const spawning = deferred<unknown>();
    const original = transport.invoke.getMockImplementation()!;
    transport.invoke.mockImplementation((command, args) =>
      command === "harness_spawn" ? spawning.promise : original(command, args),
    );
    const spawn = f.spawn();
    const binding = f.core.bindChildTurnWriter(f.process, f.a);
    const hostInvoke = vi.fn(async () => undefined);
    f.core.configureChildBackend({ invoke: hostInvoke, listen: async () => () => {} });
    spawning.resolve(f.processReceipt);
    await spawn;
    const writer = await binding;
    const scope = { environmentId: "environment-A", generation: 2 };
    const writing = f.core.writeChild(writer, "A", scope);
    scope.environmentId = "B";
    scope.generation = 7;
    await writing;
    expect(hostInvoke).not.toHaveBeenCalled();
    expect(f.calls("harness_write_controlled")[0]).toMatchObject({
      authorityEnvironmentId: "environment-A",
      authorityGeneration: 2,
    });
  });

  it("preserves explicit uncontrolled Native/Host mode without manufacturing Native bindings", async () => {
    const f = await fixture();
    const raw = f.core.createChildProcessHandle("raw-helper");
    await f.core.spawnChild(raw, "codex", [], "/project");
    await f.core.writeChild(await f.core.bindChildTurnWriter(raw), "raw");
    const hostInvoke = vi.fn(async (command: string, args: Record<string, unknown>) =>
      command === "harness_spawn"
        ? { ...f.processReceipt, backend: "host", sessionId: args.sessionId }
        : undefined,
    );
    f.core.configureChildBackend({ invoke: hostInvoke, listen: async () => () => {} });
    const host = f.core.createChildProcessHandle("host");
    await f.core.spawnChild(host, "codex", [], "/project");
    await f.core.writeChild(await f.core.bindChildTurnWriter(host), "host");
    await expect(f.core.bindChildTurnWriter(host, f.a)).rejects.toThrow("cannot target a Host");
    expect(f.calls("harness_bind_turn")).toHaveLength(0);
    expect(f.calls("harness_write")).toHaveLength(1);
    expect(hostInvoke.mock.calls.map(([command]) => command)).toEqual([
      "harness_spawn",
      "harness_write",
    ]);
  });

  it("keeps immutable JSON-RPC views on one ID sequence and exact writers, including delayed replies", async () => {
    const f = await fixture();
    await f.spawn();
    const { JsonRpcClient } = await import("./jsonRpc");
    const rpc = new JsonRpcClient(f.process, {});
    const aWriter = await f.core.bindChildTurnWriter(f.process, f.a);
    const a = rpc.withWriter(aWriter);
    const b = rpc.withWriter(await f.core.bindChildTurnWriter(f.process, await f.second()));
    expect(Object.isFrozen(a)).toBe(true);
    const first = a.request("A");
    const second = b.request("B");
    rpc.pushLine(JSON.stringify({ id: 2, result: "B result" }));
    rpc.pushLine(JSON.stringify({ id: 1, result: "A result" }));
    await expect(first).resolves.toBe("A result");
    await expect(second).resolves.toBe("B result");
    const held = deferred();
    const late = held.promise.then(() => a.respond(80, { original: true }));
    await b.notify("B notify");
    held.resolve();
    await late;
    const writes = f.calls("harness_write_controlled");
    expect(writes.map((args) => JSON.parse(String(args.line)).id).slice(0, 2)).toEqual([1, 2]);
    expect((writes.at(-1)!.binding as { turnId: string }).turnId).toBe(
      f.controls.nativeControlTurnReceipt(f.a).turnId,
    );
    expect(writes.every((args) => !String(args.line).includes("bindingId"))).toBe(true);
    const other = f.core.createChildProcessHandle("other");
    expect(() => new JsonRpcClient(other, {}).withWriter(aWriter)).toThrow();
    rpc.close();
  });

  it("does not assign the newest view to unsolicited server requests", async () => {
    const f = await fixture();
    await f.spawn();
    const { JsonRpcClient } = await import("./jsonRpc");
    let reply!: Promise<void>;
    const rpc = new JsonRpcClient(f.process, {
      onRequest: (id) => {
        reply = rpc.respond(id, { legacy: true });
        return reply;
      },
    });
    rpc.withWriter(await f.core.bindChildTurnWriter(f.process, f.a));
    rpc.withWriter(await f.core.bindChildTurnWriter(f.process, await f.second()));
    rpc.pushLine(JSON.stringify({ id: 90, method: "unattributed" }));
    await reply;
    expect(f.calls("harness_write_controlled")).toHaveLength(0);
    expect(f.calls("harness_write")).toHaveLength(1);
    expect(f.calls("harness_write")[0]).not.toHaveProperty("binding");
    rpc.close();
  });

  it("retains the exact controlled write beyond an RPC write timeout", async () => {
    const f = await fixture();
    await f.spawn();
    const { JsonRpcClient } = await import("./jsonRpc");
    const rpc = new JsonRpcClient(f.process, {});
    const writer = await f.core.bindChildTurnWriter(f.process, f.a);
    const view = rpc.withWriter(writer);
    const actual = deferred();
    const original = transport.invoke.getMockImplementation()!;
    transport.invoke.mockImplementation((command, args) =>
      command === "harness_write_controlled" ? actual.promise : original(command, args),
    );
    vi.useFakeTimers();
    let observed: Promise<void> | undefined;
    let ended = false;
    const result = view.respond(8, {}, (work) => {
      observed = work;
      void work.then(() => {
        ended = true;
      });
    });
    const rejection = expect(result).rejects.toThrow("write timed out");
    await vi.advanceTimersByTimeAsync(15_000);
    await rejection;
    expect(ended).toBe(false);
    expect(f.calls("harness_write_controlled")).toHaveLength(1);
    actual.resolve();
    await observed;
    expect(ended).toBe(true);
    expect(f.calls("harness_write")).toHaveLength(0);
    rpc.close();
  });

  it("retains an ACP view before deferred bridge work and shares the same RPC multiplexer", async () => {
    const f = await fixture();
    await f.spawn();
    const { AcpClient } = await import("./acp");
    const rpc = new AcpClient(f.process, {});
    const a = rpc.withWriter(await f.core.bindChildTurnWriter(f.process, f.a));
    const b = rpc.withWriter(await f.core.bindChildTurnWriter(f.process, await f.second()));
    const bridge = deferred<null>();
    transport.bridge.mockReturnValue(bridge.promise);
    const first = a.request("session/new", { mcpServers: [] });
    const second = b.request("B");
    rpc.pushLine(JSON.stringify({ id: 1, result: "B" }));
    await second;
    bridge.resolve(null);
    await vi.waitFor(() => expect(f.calls("harness_write_controlled")).toHaveLength(2));
    rpc.pushLine(JSON.stringify({ id: 2, result: "A" }));
    await first;
    const writes = f.calls("harness_write_controlled");
    expect(JSON.parse(String(writes[1].line)).method).toBe("session/new");
    expect((writes[1].binding as { turnId: string }).turnId).toBe(
      f.controls.nativeControlTurnReceipt(f.a).turnId,
    );
    rpc.close();
  });

  it("shares Pi IDs between immutable operation views without rebinding a deferred request", async () => {
    const f = await fixture();
    await f.spawn();
    const { PiRpc } = await import("../providers/pi/piClient");
    const rpc = new PiRpc(f.process, vi.fn());
    const a = rpc.withWriter(await f.core.bindChildTurnWriter(f.process, f.a));
    const b = rpc.withWriter(await f.core.bindChildTurnWriter(f.process, await f.second()));
    const held = deferred();
    const first = held.promise.then(() => a.request({ type: "A" }));
    const second = b.request({ type: "B" });
    rpc.pushLine(JSON.stringify({ type: "response", id: "mc_1", success: true, command: "B" }));
    await second;
    held.resolve();
    await vi.waitFor(() => expect(f.calls("harness_write_controlled")).toHaveLength(2));
    rpc.pushLine(JSON.stringify({ type: "response", id: "mc_2", success: true, command: "A" }));
    await first;
    const writes = f.calls("harness_write_controlled");
    expect((writes[1].binding as { turnId: string }).turnId).toBe(
      f.controls.nativeControlTurnReceipt(f.a).turnId,
    );
    expect(writes.map((args) => JSON.parse(String(args.line)).id)).toEqual(["mc_1", "mc_2"]);
    rpc.close();
  });

  it.each(["deadline", "cancel"])(
    "keeps B's reused Pi ID after A's %s and late actual write rejection",
    async (end) => {
      const f = await fixture();
      await f.spawn();
      const { PiRpc } = await import("../providers/pi/piClient");
      const rpc = new PiRpc(f.process, vi.fn());
      const a = rpc.withWriter(await f.core.bindChildTurnWriter(f.process, f.a));
      const actualA = deferred();
      const originalInvoke = transport.invoke.getMockImplementation()!;
      transport.invoke.mockImplementation((command, args) =>
        command === "harness_write_controlled" && JSON.parse(String(args.line)).type === "A"
          ? actualA.promise
          : originalInvoke(command, args),
      );
      vi.useFakeTimers();
      const first = a.request({ id: "reused", type: "A" }, 10);
      const rejectedA = expect(first).rejects.toThrow(
        end === "deadline" ? "timed out" : "cancelled",
      );
      if (end === "deadline") await vi.advanceTimersByTimeAsync(10);
      else rpc.cancelRequest("reused");
      await rejectedA;
      // A's public IPC acknowledgement may remain unresolved after the Native
      // writer itself settled; this fixture controls acknowledgement delivery.
      const bControl = await f.second();
      const b = rpc.withWriter(await f.core.bindChildTurnWriter(f.process, bControl));
      let secondEnded = false;
      const second = b.request({ id: "reused", type: "B" }, 1_000);
      void second.then(
        () => {
          secondEnded = true;
        },
        () => {
          secondEnded = true;
        },
      );
      actualA.reject(new Error("A actual write failed after waiter ended"));
      await vi.advanceTimersByTimeAsync(0);
      expect(secondEnded).toBe(false);
      const response = {
        type: "response",
        id: "reused",
        command: "B",
        success: true,
        data: { original: "B" },
      };
      rpc.pushLine(JSON.stringify(response));
      await expect(second).resolves.toEqual(response);
      expect(
        f
          .calls("harness_write_controlled")
          .map((args) => (args.binding as { turnId: string }).turnId),
      ).toEqual([
        f.controls.nativeControlTurnReceipt(f.a).turnId,
        f.controls.nativeControlTurnReceipt(bControl).turnId,
      ]);
      expect(f.calls("harness_write")).toHaveLength(0);
      rpc.close();
    },
  );

  it("scopes Pi cancellation to the exact writer after ID reuse and turn closure", async () => {
    const f = await fixture();
    await f.spawn();
    const { PiRpc } = await import("../providers/pi/piClient");
    const rpc = new PiRpc(f.process, vi.fn());
    let aOpen = true;
    const a = rpc.withWriter(
      f.core.guardChildTurnWriter(await f.core.bindChildTurnWriter(f.process, f.a), () => {
        if (!aOpen) throw new Error("A closed");
      }),
    );
    const first = a.request({ id: "reused", type: "A" });
    const cancelledA = expect(first).rejects.toThrow("cancelled");
    aOpen = false;
    expect(a.cancelRequest("reused")).toBeUndefined();
    await cancelledA;
    const b = rpc.withWriter(await f.core.bindChildTurnWriter(f.process, await f.second()));
    let bEnded = false;
    const second = b.request({ id: "reused", type: "B" });
    void second.then(
      () => {
        bEnded = true;
      },
      () => {
        bEnded = true;
      },
    );
    a.cancelRequest("reused");
    await Promise.resolve();
    expect(bEnded).toBe(false);
    const response = { type: "response", id: "reused", command: "B", success: true };
    rpc.pushLine(JSON.stringify(response));
    await expect(second).resolves.toEqual(response);
    const ownB = b.request({ id: "own-B", type: "B" });
    const cancelledB = expect(ownB).rejects.toThrow("cancelled");
    b.cancelRequest("own-B");
    await cancelledB;
    // The legacy base API remains an explicit fresh-ID cleanup path.
    const legacy = rpc.request({ id: "legacy", type: "legacy" });
    const cancelledLegacy = expect(legacy).rejects.toThrow("cancelled");
    rpc.cancelRequest("legacy");
    await cancelledLegacy;
    expect(f.calls("harness_write_controlled")).toHaveLength(3);
    expect(f.calls("harness_write")).toHaveLength(1);
    rpc.close();
  });
});
