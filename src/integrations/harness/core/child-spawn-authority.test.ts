import { afterEach, expect, it, vi } from "vitest";

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
  mocks.invoke.mockResolvedValue(42);
  const child = await import("./child");
  const invoke = vi.fn(async (_command: string, _args?: Record<string, unknown>) => 42);
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
  return { child, invoke, handlers };
}

async function watchedIncumbent() {
  const f = await fixture(true);
  const releaseBridge = await f.child.acquireHarnessBridge();
  const exited = vi.fn();
  f.child.watchChild("same-owned-child", vi.fn(), exited);
  await f.child.spawnChild("same-owned-child", "agent", [], "/fixture");
  return { ...f, exited, releaseBridge };
}

function restrictedSpawn(f: Awaited<ReturnType<typeof fixture>>, guard = async () => {}) {
  return f.child.spawnChild(
    "same-owned-child",
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
    payload: { sessionId: "same-owned-child", pid, code: reason ? 1 : 0, reason } as never,
  });
}
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

it("rejects before bridge preparation or process invocation when the restrictive callback denies", async () => {
  const f = await fixture(true);
  await expect(
    f.child.spawnChild(
      "owned-probe",
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
      "owned-probe",
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
    "owned-probe",
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
    "owned-probe",
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
  const exited = vi.fn();
  f.child.watchChild("same-owned-child", vi.fn(), exited);
  try {
    await f.child.spawnChild("same-owned-child", "agent", [], "/fixture");
    const entered = deferred();
    const release = deferred();
    mocks.social.mockImplementationOnce(async () => {
      entered.resolve();
      await release.promise;
      return null;
    });
    let authorized = true;
    const pending = f.child.spawnChild(
      "same-owned-child",
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
      payload: { sessionId: "same-owned-child", pid: 42, code: 0 } as never,
    });
    expect(exited).toHaveBeenCalledExactlyOnceWith(0);
  } finally {
    f.child.unwatchChild("same-owned-child");
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
      return 43;
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
      f.child.unwatchChild("same-owned-child");
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
    return 43;
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
    f.child.unwatchChild("same-owned-child");
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
        return 43;
      })
      .mockResolvedValueOnce(44);
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
      f.child.unwatchChild("same-owned-child");
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
      return 43;
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
    f.child.unwatchChild("same-owned-child");
    f.releaseBridge();
  }
});

it.each(["unwatch", "kill", "killAll"])(
  "does not publish a guarded PID or resurrect its watch after %s",
  async (cleanup) => {
    const f = await fixture(true);
    const releaseBridge = await f.child.acquireHarnessBridge();
    const exited = vi.fn();
    f.child.watchChild("same-owned-child", vi.fn(), exited);
    const entered = deferred();
    const release = deferred();
    f.invoke.mockImplementationOnce(async () => {
      entered.resolve();
      await release.promise;
      return 43;
    });
    const pending = restrictedSpawn(f);
    try {
      await entered.promise;
      if (cleanup === "unwatch") f.child.unwatchChild("same-owned-child");
      else if (cleanup === "kill") await f.child.killChild("same-owned-child");
      else await f.child.killAllChildren();
      const replacementExit = vi.fn();
      f.child.watchChild("same-owned-child", vi.fn(), replacementExit);
      release.resolve();
      await pending;
      emitExit(f, 43);
      expect(exited).not.toHaveBeenCalled();
      expect(replacementExit).not.toHaveBeenCalled();
    } finally {
      release.resolve();
      f.child.unwatchChild("same-owned-child");
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
      "same-owned-child",
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
      f.child.unwatchChild("same-owned-child");
      release.resolve();
      await retired;
      expect(f.invoke).toHaveBeenCalledTimes(1);
    } finally {
      release.resolve();
      f.child.unwatchChild("same-owned-child");
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
      return 43;
    })
    .mockResolvedValueOnce(44);
  const old = restrictedSpawn(f);
  try {
    await entered.promise;
    await f.child.spawnChild("same-owned-child", "agent", [], "/fixture");
    release.resolve();
    await old;
    emitExit(f, 43);
    expect(f.exited).not.toHaveBeenCalled();
    emitExit(f, 44);
    expect(f.exited).toHaveBeenCalledExactlyOnceWith(0);
  } finally {
    release.resolve();
    f.child.unwatchChild("same-owned-child");
    f.releaseBridge();
  }
});
