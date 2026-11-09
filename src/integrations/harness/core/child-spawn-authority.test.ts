import { afterEach, expect, it, vi } from "vitest";
import type { ChildProcessHandle } from "./child";

function receipt(sessionId: string, pid = 42, backend: "native" | "host" = "host") {
  return {
    version: 1 as const,
    backend,
    sessionId,
    pid,
    constructionId: `00000000-0000-4000-8000-${pid.toString(16).padStart(12, "0")}`,
  };
}

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  social: vi.fn(),
  logs: vi.fn(),
  conversation: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("./socialBridge", () => ({
  socialBridge: mocks.social,
  socialSpawnArgs: (_provider: unknown, args: string[]) => args,
}));
vi.mock("./runtimeLogsBridge", () => ({
  runtimeLogsBridge: mocks.logs,
  runtimeLogsSpawnArgs: (_provider: unknown, args: string[]) => args,
}));
vi.mock("./conversationToolsBridge", () => ({
  conversationToolsBridge: mocks.conversation,
  conversationToolsSpawnArgs: (_provider: unknown, args: string[]) => args,
}));

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function fixture(headless: boolean) {
  vi.resetModules();
  for (const mock of [mocks.social, mocks.logs, mocks.conversation]) mock.mockResolvedValue(null);
  mocks.invoke.mockImplementation(async (_command, args) => receipt(args.sessionId, 42, "native"));
  const child = await import("./child");
  const invoke = vi.fn(async (_command: string, args?: Record<string, unknown>) =>
    receipt(String(args?.sessionId)),
  );
  const handlers = new Map<string, (event: { payload: never }) => void>();
  if (headless)
    child.configureChildBackend({
      invoke: invoke as never,
      listen: vi.fn(async (name, handler) => {
        handlers.set(name, handler as never);
        return () => {
          handlers.delete(name);
        };
      }),
    });
  return {
    child,
    invoke,
    handlers,
    exited: vi.fn(),
    handles: [] as ChildProcessHandle[],
    latest: undefined as ChildProcessHandle | undefined,
  };
}

function newProcess(f: Awaited<ReturnType<typeof fixture>>, sessionId = "same-owned-child") {
  const handle = f.child.createChildProcessHandle(sessionId);
  f.handles.push(handle);
  f.latest = handle;
  f.child.watchChild(handle, vi.fn(), f.exited);
  return handle;
}
function unwatchAll(f: Awaited<ReturnType<typeof fixture>>) {
  for (const handle of f.handles) f.child.unwatchChild(handle);
}

async function watchedIncumbent() {
  const f = await fixture(true);
  const releaseBridge = await f.child.acquireHarnessBridge();
  const incumbent = newProcess(f);
  await f.child.spawnChild(incumbent, "agent", [], "/fixture");
  return { ...f, releaseBridge };
}

function restrictedSpawn(f: Awaited<ReturnType<typeof fixture>>, guard = async () => {}) {
  return f.child.spawnChild(
    newProcess(f),
    "agent",
    [],
    "/fixture",
    undefined,
    undefined,
    undefined,
    undefined,
    guard,
  );
}

function emitExit(f: Awaited<ReturnType<typeof fixture>>, pid: number, reason?: string) {
  f.handlers.get("harness-exit")?.({
    payload: {
      sessionId: "same-owned-child",
      constructionId: receipt("same-owned-child", pid).constructionId,
      pid,
      code: reason ? 1 : 0,
      reason,
    } as never,
  });
}
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

it("snapshots explicit spawn authority before the original asynchronous restriction and bridges", async () => {
  const f = await fixture(true);
  const entered = deferred();
  const release = deferred();
  const scope = { environmentId: "original-owner", generation: 7 };
  let first = true;
  const spawning = f.child.spawnChild(
    newProcess(f, "authority"),
    "codex",
    [],
    "/fixture",
    undefined,
    "codex",
    undefined,
    scope,
    async () => {
      if (first) {
        first = false;
        entered.resolve();
        await release.promise;
      }
    },
  );
  await entered.promise;
  scope.environmentId = "later-owner";
  scope.generation = 8;
  release.resolve();
  await spawning;
  expect(f.invoke).toHaveBeenCalledWith(
    "harness_spawn",
    expect.objectContaining({
      sessionId: "authority",
      authorityEnvironmentId: "original-owner",
      authorityGeneration: 7,
    }),
  );
});

it("rejects before bridge preparation or process invocation when the restrictive callback denies", async () => {
  const f = await fixture(true);
  await expect(
    f.child.spawnChild(
      newProcess(f, "owned-probe"),
      "codex",
      ["app-server"],
      "/fixture",
      { provider: "codex", id: "default" },
      "codex",
      undefined,
      undefined,
      async () => {
        throw new Error("Probe grant revoked");
      },
    ),
  ).rejects.toThrow("revoked");
  expect(mocks.social).not.toHaveBeenCalled();
  expect(mocks.logs).not.toHaveBeenCalled();
  expect(mocks.conversation).not.toHaveBeenCalled();
  expect(f.invoke).not.toHaveBeenCalled();
  expect(mocks.invoke).not.toHaveBeenCalled();
});

it.each(["social", "logs", "conversation"] as const)(
  "rechecks after a delayed %s bridge and never invokes process spawn after revocation",
  async (group) => {
    const f = await fixture(true);
    const entered = deferred();
    const release = deferred();
    mocks[group].mockImplementationOnce(async () => {
      entered.resolve();
      await release.promise;
      return null;
    });
    let authorized = true;
    const beforeSpawn = vi.fn(async () => {
      if (!authorized) throw new Error("Probe grant revoked");
    });
    const pending = f.child.spawnChild(
      newProcess(f, "owned-probe"),
      "codex",
      ["app-server"],
      "/fixture",
      { provider: "codex", id: "default" },
      "codex",
      undefined,
      undefined,
      beforeSpawn,
    );
    const denied = expect(pending).rejects.toThrow("revoked");
    await entered.promise;
    authorized = false;
    release.resolve();
    await denied;
    expect(f.invoke).not.toHaveBeenCalled();
    expect(mocks.invoke).not.toHaveBeenCalled();
  },
);

it("passes the restrictive function only to the configured in-process backend", async () => {
  const f = await fixture(true);
  const beforeSpawn = vi.fn(async () => undefined);
  await f.child.spawnChild(
    newProcess(f, "owned-probe"),
    "codex",
    ["app-server"],
    "/fixture",
    { provider: "codex", id: "default" },
    "codex",
    undefined,
    { environmentId: "environment", generation: 7 },
    beforeSpawn,
  );
  expect(beforeSpawn).toHaveBeenCalledTimes(2);
  expect(f.invoke).toHaveBeenCalledExactlyOnceWith(
    "harness_spawn",
    expect.objectContaining({
      beforeSpawn,
      account: { provider: "codex", id: "default" },
      authorityEnvironmentId: "environment",
      authorityGeneration: 7,
    }),
  );
  expect(mocks.invoke).not.toHaveBeenCalled();
});

it("never serializes the optional function into desktop IPC arguments", async () => {
  const f = await fixture(false);
  const beforeSpawn = vi.fn(async () => undefined);
  await f.child.spawnChild(
    newProcess(f, "owned-probe"),
    "codex",
    ["app-server"],
    "/fixture",
    { provider: "codex", id: "default" },
    "codex",
    undefined,
    undefined,
    beforeSpawn,
  );
  expect(beforeSpawn).toHaveBeenCalledTimes(2);
  expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith(
    "harness_spawn",
    expect.not.objectContaining({ beforeSpawn: expect.anything() }),
  );
  expect(JSON.stringify(mocks.invoke.mock.calls)).not.toContain("beforeSpawn");
  expect(f.invoke).not.toHaveBeenCalled();
});

it("preserves the incumbent child's exit generation when a delayed replacement is denied", async () => {
  const f = await fixture(true);
  const releaseBridge = await f.child.acquireHarnessBridge();
  const exited = f.exited;
  const incumbent = newProcess(f);
  try {
    await f.child.spawnChild(incumbent, "agent", [], "/fixture");
    const entered = deferred();
    const release = deferred();
    mocks.social.mockImplementationOnce(async () => {
      entered.resolve();
      await release.promise;
      return null;
    });
    let authorized = true;
    const pending = f.child.spawnChild(
      newProcess(f),
      "codex",
      ["app-server"],
      "/fixture",
      undefined,
      "codex",
      undefined,
      undefined,
      async () => {
        if (!authorized) throw new Error("Probe grant revoked");
      },
    );
    const denied = expect(pending).rejects.toThrow("revoked");
    await entered.promise;
    authorized = false;
    release.resolve();
    await denied;
    expect(f.invoke).toHaveBeenCalledTimes(1);
    f.handlers.get("harness-exit")?.({
      payload: {
        sessionId: "same-owned-child",
        constructionId: receipt("same-owned-child").constructionId,
        pid: 42,
        code: 0,
      } as never,
    });
    expect(exited).toHaveBeenCalledExactlyOnceWith(0);
  } finally {
    unwatchAll(f);
    releaseBridge();
  }
});

it.each(["during preparation", "after rejection"])(
  "routes the incumbent exit %s when backend preparation revokes its replacement",
  async (when) => {
    const f = await watchedIncumbent();
    const entered = deferred();
    const release = deferred();
    let authorized = true;
    f.invoke.mockImplementationOnce(async (_command, args) => {
      entered.resolve();
      await release.promise;
      const restriction = args?.beforeSpawn;
      if (typeof restriction !== "function")
        throw new Error("In-process authorization is required");
      await restriction();
      return receipt("same-owned-child", 43);
    });
    const pending = restrictedSpawn(f, async () => {
      if (!authorized) throw new Error("Probe grant revoked");
    });
    const denied = expect(pending).rejects.toThrow("revoked");
    try {
      await entered.promise;
      if (when === "during preparation") {
        emitExit(f, 42);
        expect(f.exited).toHaveBeenCalledExactlyOnceWith(0);
      }
      authorized = false;
      release.resolve();
      await denied;
      if (when === "after rejection") emitExit(f, 42);
      expect(f.exited).toHaveBeenCalledExactlyOnceWith(0);
    } finally {
      release.resolve();
      unwatchAll(f);
      f.releaseBridge();
    }
  },
);

it("reconciles a guarded candidate's early exit while retaining its incumbent during preparation", async () => {
  const f = await watchedIncumbent();
  const entered = deferred();
  const release = deferred();
  f.invoke.mockImplementationOnce(async () => {
    entered.resolve();
    await release.promise;
    return receipt("same-owned-child", 43);
  });
  const pending = restrictedSpawn(f);
  try {
    await entered.promise;
    emitExit(f, 43, "Candidate exited during startup");
    expect(f.exited).not.toHaveBeenCalled();
    release.resolve();
    await pending;
    expect(f.exited).toHaveBeenCalledExactlyOnceWith(1, "Candidate exited during startup");
    emitExit(f, 42);
    expect(f.exited).toHaveBeenCalledOnce();
  } finally {
    release.resolve();
    unwatchAll(f);
    f.releaseBridge();
  }
});

it.each(["reject", "succeed"])(
  "never replaces a newer successful PID when an older guarded invoke later settles: %s",
  async (outcome) => {
    const f = await watchedIncumbent();
    const entered = deferred();
    const release = deferred();
    f.invoke
      .mockImplementationOnce(async () => {
        entered.resolve();
        await release.promise;
        if (outcome === "reject") throw new Error("Old replacement revoked");
        return receipt("same-owned-child", 43);
      })
      .mockResolvedValueOnce(receipt("same-owned-child", 44));
    const old = restrictedSpawn(f).catch((error) => error);
    try {
      await entered.promise;
      await restrictedSpawn(f);
      release.resolve();
      const result = await old;
      if (outcome === "reject") expect(result).toBeInstanceOf(Error);
      emitExit(f, 43);
      expect(f.exited).not.toHaveBeenCalled();
      emitExit(f, 44);
      expect(f.exited).toHaveBeenCalledExactlyOnceWith(0);
    } finally {
      release.resolve();
      unwatchAll(f);
      f.releaseBridge();
    }
  },
);

it("keeps an older accepted guarded PID when the newer request fails without spawning", async () => {
  const f = await watchedIncumbent();
  const entered = deferred();
  const release = deferred();
  f.invoke
    .mockImplementationOnce(async () => {
      entered.resolve();
      await release.promise;
      return receipt("same-owned-child", 43);
    })
    .mockRejectedValueOnce(new Error("Newer replacement revoked"));
  const old = restrictedSpawn(f);
  try {
    await entered.promise;
    await expect(restrictedSpawn(f)).rejects.toThrow("revoked");
    release.resolve();
    await old;
    emitExit(f, 43);
    expect(f.exited).toHaveBeenCalledExactlyOnceWith(0);
  } finally {
    release.resolve();
    unwatchAll(f);
    f.releaseBridge();
  }
});

it.each(["unwatch", "kill", "killAll"])(
  "does not publish a guarded PID or resurrect its watch after %s",
  async (cleanup) => {
    const f = await fixture(true);
    const releaseBridge = await f.child.acquireHarnessBridge();
    const exited = f.exited;
    const entered = deferred();
    const release = deferred();
    f.invoke.mockImplementationOnce(async () => {
      entered.resolve();
      await release.promise;
      return receipt("same-owned-child", 43);
    });
    const pending = restrictedSpawn(f);
    try {
      await entered.promise;
      let stopped: Promise<void> | undefined;
      if (cleanup === "unwatch") f.child.unwatchChild(f.latest!);
      else if (cleanup === "kill") stopped = f.child.killChild(f.latest!);
      else await f.child.killAllChildren();
      const replacementExit = vi.fn();
      f.child.watchChild(newProcess(f), vi.fn(), replacementExit);
      release.resolve();
      await pending;
      await stopped;
      emitExit(f, 43);
      expect(exited).not.toHaveBeenCalled();
      expect(replacementExit).not.toHaveBeenCalled();
    } finally {
      release.resolve();
      unwatchAll(f);
      releaseBridge();
    }
  },
);

it.each(["grant", "bridge"])(
  "does not invoke a held guarded %s preparation after retirement",
  async (phase) => {
    const f = await watchedIncumbent();
    const entered = deferred();
    const release = deferred();
    let first = true;
    const guard = async () => {
      if (phase === "grant" && first) {
        first = false;
        entered.resolve();
        await release.promise;
      }
    };
    if (phase === "bridge")
      mocks.social.mockImplementationOnce(async () => {
        entered.resolve();
        await release.promise;
        return null;
      });
    const pending = f.child.spawnChild(
      newProcess(f),
      "codex",
      [],
      "/fixture",
      undefined,
      "codex",
      undefined,
      undefined,
      guard,
    );
    const retired = expect(pending).rejects.toThrow("startup cancelled");
    try {
      await entered.promise;
      unwatchAll(f);
      release.resolve();
      await retired;
      expect(f.invoke).toHaveBeenCalledTimes(1);
    } finally {
      release.resolve();
      unwatchAll(f);
      f.releaseBridge();
    }
  },
);

it("retires a held guarded invoke when the ordinary spawn path publishes a newer PID", async () => {
  const f = await watchedIncumbent();
  const entered = deferred();
  const release = deferred();
  f.invoke
    .mockImplementationOnce(async () => {
      entered.resolve();
      await release.promise;
      return receipt("same-owned-child", 43);
    })
    .mockResolvedValueOnce(receipt("same-owned-child", 44));
  const old = restrictedSpawn(f);
  try {
    await entered.promise;
    await f.child.spawnChild(newProcess(f), "agent", [], "/fixture");
    release.resolve();
    await old;
    emitExit(f, 43);
    expect(f.exited).not.toHaveBeenCalled();
    emitExit(f, 44);
    expect(f.exited).toHaveBeenCalledExactlyOnceWith(0);
  } finally {
    release.resolve();
    unwatchAll(f);
    f.releaseBridge();
  }
});
