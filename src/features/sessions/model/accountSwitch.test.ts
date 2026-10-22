import { describe, expect, it, vi } from "vitest";
import { SWITCH_BUSY_STATUS, switchSessionAccount, type AccountSwitchDeps } from "./accountSwitch";
import { appendPreparingHandoff, planComposerSwitch, pendingHandoff } from "./handoff";
import { newSession, type Session } from "./session";

function convo(extra?: Partial<Session>): Session {
  return {
    ...newSession("claude", "/tmp/project"),
    blocks: [
      { id: "u1", role: "user", text: "fix the parser" },
      { id: "a1", role: "assistant", text: "Parser fixed." },
    ],
    providerSessionId: "thread-1",
    providerAccountId: "account-a",
    usageLimit: {},
    ...extra,
  };
}

function setup(session: Session | undefined, transfer?: AccountSwitchDeps["transfer"]) {
  const state = { session };
  const deps = {
    transfer: vi.fn(transfer ?? (async () => true)),
    forget: vi.fn(async () => undefined),
    bind: vi.fn(),
    latest: vi.fn(() => state.session),
    label: (_p: string, id: string) => `Label ${id}`,
    removing: vi.fn(() => false),
    ownsRequest: vi.fn(() => true),
  };
  return { state, deps };
}

const run = (s: ReturnType<typeof setup>, account = "account-b") =>
  switchSessionAccount(s.state.session?.id ?? "x", "claude", account, s.deps);

describe("switchSessionAccount", () => {
  const changes: [string, Partial<Session>][] = [
    ["running turn", { busy: true }],
    ["provider", { harness: "codex" }],
    ["thread", { providerSessionId: "new-thread" }],
    ["account", { providerAccountId: "new-account" }],
    ["working directory", { cwd: "/tmp/other-project" }],
  ];

  it.each(changes)(
    "does not rebind after %s changes while forget awaits",
    async (_name, change) => {
      const s = setup(convo());
      let finishForget!: () => void;
      let startedForget!: () => void;
      const started = new Promise<void>((resolve) => {
        startedForget = resolve;
      });
      s.deps.forget.mockImplementation(() => {
        startedForget();
        return new Promise<void>((resolve) => {
          finishForget = resolve;
        });
      });
      const switching = run(s);
      await started;
      const newer = { ...s.state.session!, ...change };
      s.state.session = newer;
      finishForget();
      expect(await switching).toEqual({ kind: "stale" });
      expect(s.deps.transfer).toHaveBeenCalledTimes(1);
      expect(s.deps.bind).not.toHaveBeenCalled();
      expect(s.state.session).toBe(newer);
    },
  );

  it("drops an empty conversation switch when a turn starts during forget", async () => {
    const s = setup(newSession("claude", "/tmp/project"));
    let finishForget!: () => void;
    s.deps.forget.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishForget = resolve;
        }),
    );
    const switching = run(s);
    const newer = {
      ...s.state.session!,
      busy: true,
      blocks: convo().blocks,
      providerSessionId: "new-thread",
    };
    s.state.session = newer;
    finishForget();
    expect(await switching).toEqual({ kind: "stale" });
    expect(s.deps.transfer).not.toHaveBeenCalled();
    expect(s.deps.bind).not.toHaveBeenCalled();
    expect(s.state.session).toBe(newer);
  });

  it.each(["account", "transferred", "handoff"] as const)(
    "a deferred %s update preserves a newer session state",
    async (mode) => {
      const original = mode === "account" ? newSession("claude", "/tmp/project") : convo();
      const s = setup(original, async () => mode === "transferred");
      const result = await run(s);
      expect(result.kind === "switched" && result.mode).toBe(mode);
      if (result.kind !== "switched") throw new Error("Expected successful account switch");
      for (const [, change] of changes) {
        const newer = { ...original, ...change };
        expect(result.update(newer)).toBe(newer);
      }
      const withNewBlocks = {
        ...original,
        blocks: [...original.blocks, { id: "later-turn", role: "user" as const, text: "new work" }],
      };
      expect(result.update(withNewBlocks)).toBe(withNewBlocks);
      expect(result.update(original).providerAccountId).toBe("account-b");
    },
  );

  it.each([false, true])(
    "refuses a superseded request during forget (empty conversation: %s)",
    async (empty) => {
      const s = setup(empty ? newSession("claude", "/tmp/project") : convo());
      s.deps.forget.mockImplementation(async () => {
        s.deps.ownsRequest.mockReturnValue(false);
      });
      expect(await run(s)).toEqual({ kind: "stale" });
      expect(s.deps.bind).not.toHaveBeenCalled();
      expect(s.state.session?.providerAccountId).not.toBe("account-b");
    },
  );

  it("ignores a superseded request when its returned updater is applied later", async () => {
    const original = convo();
    const s = setup(original);
    const result = await run(s);
    expect(result.kind).toBe("switched");
    if (result.kind !== "switched") throw new Error("Expected successful account switch");
    s.deps.ownsRequest.mockReturnValue(false);
    expect(result.update(original)).toBe(original);
  });
  it("silinen hesabın sağlayıcı geçmişi yoksa aynı konuşmayı bağlamıyla sürdürür", async () => {
    const original = convo({ providerAccountId: "removed" });
    const s = setup(original, async () => false);
    const result = await run(s, "replacement");
    expect(result.kind).toBe("switched");
    if (result.kind !== "switched") return;
    const next = result.update(original);
    expect(next.id).toBe(original.id);
    expect(next.blocks.slice(0, original.blocks.length)).toEqual(original.blocks);
    expect(next.providerAccountId).toBe("replacement");
    expect(next.providerSessionId).toBeUndefined();
    expect(pendingHandoff(next)?.text).toContain("fix the parser");
    expect(pendingHandoff(next)?.text).toContain("Parser fixed.");
  });
  it("moves the provider thread when the transfer succeeds", async () => {
    const s = setup(convo());
    const result = await run(s);
    expect(result.kind).toBe("switched");
    if (result.kind !== "switched") return;
    expect(result.mode).toBe("transferred");
    expect(result.status).toBe("Continuing with Label account-b");
    expect(s.deps.transfer).toHaveBeenCalledWith({
      provider: "claude",
      fromAccountId: "account-a",
      toAccountId: "account-b",
      providerSessionId: "thread-1",
      cwd: "/tmp/project",
    });
    expect(s.deps.forget).toHaveBeenCalledWith("claude", s.state.session!.id);
    expect(s.deps.bind).toHaveBeenCalledWith(
      "claude",
      s.state.session!.id,
      "thread-1",
      "/tmp/project",
      "account-b",
      s.state.session!.blocks,
    );
    const next = result.update(s.state.session!);
    expect(next).toMatchObject({
      providerAccountId: "account-b",
      providerSessionId: "thread-1",
      usageLimit: undefined,
    });
    expect(pendingHandoff(next)).toBeNull();
  });

  it("falls back to a recap when nothing was transferred", async () => {
    const s = setup(convo(), async () => false);
    const result = await run(s);
    expect(result.kind === "switched" && result.mode).toBe("handoff");
    expect(s.deps.bind).not.toHaveBeenCalled();
    if (result.kind !== "switched") return;
    expect(result.status).toContain("summary goes with your next message");
    const next = result.update(s.state.session!);
    expect(next.providerSessionId).toBeUndefined();
    expect(next.providerAccountId).toBe("account-b");
    expect(pendingHandoff(next)?.text).toContain("fix the parser");
  });

  it("falls back to a recap when the transfer throws", async () => {
    const s = setup(convo(), async () => {
      throw new Error("disk");
    });
    const result = await run(s);
    expect(result.kind === "switched" && result.mode).toBe("handoff");
    expect(s.deps.bind).not.toHaveBeenCalled();
    expect(s.deps.forget).toHaveBeenCalled();
  });

  it("uses a recap when there is no provider thread but a conversation", async () => {
    const s = setup(convo({ providerSessionId: undefined }));
    const result = await run(s);
    expect(s.deps.transfer).not.toHaveBeenCalled();
    expect(result.kind === "switched" && result.mode).toBe("handoff");
  });

  it("refuses while a turn is running", async () => {
    const s = setup(convo({ busy: true }));
    expect(await run(s)).toEqual({ kind: "refused", status: SWITCH_BUSY_STATUS });
    expect(s.deps.transfer).not.toHaveBeenCalled();
    expect(s.deps.forget).not.toHaveBeenCalled();
  });

  it("refuses while a handoff is being prepared or the session is closing", async () => {
    const preparing = appendPreparingHandoff(convo(), "codex", "claude");
    expect((await run(setup(preparing))).kind).toBe("refused");
    const s = setup(convo());
    s.deps.removing.mockReturnValue(true);
    expect((await run(s)).kind).toBe("refused");
  });

  it("only sets the account after an unsent harness switch", async () => {
    const codex: Session = {
      ...convo({ harness: "codex", providerAccountId: undefined }),
    };
    const plan = planComposerSwitch(codex, "claude");
    expect(plan.kind).toBe("arm");
    if (plan.kind !== "arm") return;
    const switched: Session = {
      ...codex,
      harness: "claude",
      providerSessionId: undefined,
      providerAccountId: undefined,
      usageLimit: undefined,
      pendingSwitch: plan.pending,
    };
    const s = setup(switched);
    const result = await run(s, "account-a");
    expect(s.deps.transfer).not.toHaveBeenCalled();
    expect(s.deps.bind).not.toHaveBeenCalled();
    expect(result.kind === "switched" && result.mode).toBe("account");
    if (result.kind !== "switched") return;
    expect(result.status).toBeUndefined();
    const next = result.update(switched);
    expect(next.providerAccountId).toBe("account-a");
    expect(next.pendingSwitch).toEqual(plan.pending);
    expect(next.blocks).toEqual(switched.blocks);
  });

  it("only sets the account on an empty session", async () => {
    const s = setup({ ...newSession("claude", "/tmp/p") });
    const result = await run(s);
    expect(result.kind === "switched" && result.mode).toBe("account");
    expect(s.deps.transfer).not.toHaveBeenCalled();
  });

  it("does nothing for the account already in use or another harness", async () => {
    const s = setup(convo());
    expect(await run(s, "account-a")).toEqual({ kind: "noop" });
    expect(await switchSessionAccount(s.state.session!.id, "codex", "x", s.deps)).toEqual({
      kind: "noop",
    });
    expect(
      await switchSessionAccount("missing", "claude", "x", {
        ...s.deps,
        latest: () => undefined,
      }),
    ).toEqual({ kind: "noop" });
    expect(s.deps.transfer).not.toHaveBeenCalled();
  });

  it("drops the switch when the session changed during the transfer", async () => {
    for (const change of [
      { busy: true },
      { providerAccountId: "account-c" },
      { providerSessionId: "thread-2" },
      { harness: "codex" as const },
    ]) {
      const s = setup(convo(), async () => {
        s.state.session = { ...s.state.session!, ...change };
        return true;
      });
      expect(await run(s)).toEqual({ kind: "stale" });
      expect(s.deps.forget).not.toHaveBeenCalled();
      expect(s.deps.bind).not.toHaveBeenCalled();
    }
    const gone = setup(convo(), async () => {
      gone.state.session = undefined;
      return true;
    });
    expect(
      await switchSessionAccount("x", "claude", "account-b", {
        ...gone.deps,
        latest: vi.fn().mockReturnValueOnce(convo()).mockReturnValue(undefined),
      }),
    ).toEqual({ kind: "stale" });
  });
});
