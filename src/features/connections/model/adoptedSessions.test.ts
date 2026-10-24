import { describe, expect, it, vi } from "vitest";
import type { Attachment, Block, Session } from "../../sessions/model/session";
import {
  ADOPTED_FLAGGED_REFETCH_MS,
  adoptedBranchId,
  adoptedDivergenceKey,
  adoptedTranscriptLead,
  desktopCopyOf,
  mergeAdoptedSession,
  mirrorAdoptedSessions,
  refreshAdoptedSession,
  planAdoptedFetches,
  supportsAdoptedSessions,
  type AdoptedEntry,
  type AdoptedMirrorDeps,
} from "./adoptedSessions";
import type { HostSession } from "./protocol";

const block = (id: string) => ({ id, role: "user", text: id }) as never;
const local = (over: Partial<Session> = {}): Session =>
  ({
    id: "s1",
    harness: "claude",
    model: "old",
    modelSettings: {},
    runtimeMode: "ask",
    title: "Local",
    cwd: "C:/proj",
    worktreeCwd: "C:/proj/wt",
    blocks: [block("a")],
    ...over,
  }) as Session;
const host = (session: Partial<Session>, status: HostSession["status"] = "idle") =>
  ({
    session: {
      ...local(),
      cwd: "/other",
      worktreeCwd: undefined,
      blocks: [block("a"), block("b")],
      ...session,
    },
    projectId: "p",
    revision: 5,
    status,
    updatedAt: 10,
  }) as HostSession;
const entry = (over: Partial<AdoptedEntry> = {}): AdoptedEntry => ({
  id: "s1",
  projectId: "p",
  revision: 5,
  updatedAt: 10,
  status: "idle",
  ...over,
});

describe("refreshAdoptedSession", () => {
  function setup(session = local(), remote = host({})) {
    let current = session;
    const deps: AdoptedMirrorDeps = {
      list: vi.fn(async () => [entry()]),
      load: vi.fn(async () => remote),
      local: () => [current],
      apply: vi.fn((merged) => {
        current = merged;
      }),
      mirrored: new Map([[session.id, remote.revision]]),
      preserve: vi.fn(async () => true),
    };
    return {
      deps,
      current: () => current,
      change: (next: Session) => {
        current = next;
      },
    };
  }

  it("fetches a full snapshot even at the same revision and reflects host activity", async () => {
    const { deps, current } = setup(local(), host({ busy: true }, "running"));
    expect(await refreshAdoptedSession(deps, "s1")).toBe(false);
    expect(deps.load).toHaveBeenCalledWith("s1");
    expect(deps.preserve).not.toHaveBeenCalled();
    expect(current()).toMatchObject({
      id: "s1",
      cwd: "C:/proj",
      worktreeCwd: "C:/proj/wt",
      continuingElsewhere: true,
    });
    expect(current().busy).toBeUndefined();
    expect(current().blocks).toHaveLength(2);
  });

  it("keeping both saves one branch with its context before replacing the original, and establishes a new merge baseline", async () => {
    const session = local({
      blocks: [block("local")],
      adoptedSyncConflict: true,
      providerSessionId: "provider-old",
      automationId: "automation",
      queuedMessages: [],
    });
    const { deps, current } = setup(session);
    let resolve!: (saved: boolean) => void;
    vi.mocked(deps.preserve!).mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const refresh = refreshAdoptedSession(deps, "s1", "keep-both");
    await vi.waitFor(() => expect(deps.preserve).toHaveBeenCalledOnce());
    expect(deps.apply).not.toHaveBeenCalled();
    const copy = vi.mocked(deps.preserve!).mock.calls[0][0];
    expect(copy.id).not.toBe(session.id);
    expect(copy).toMatchObject({
      blocks: session.blocks,
      cwd: session.cwd,
    });
    expect(copy.title).toMatch(/^Local \(branch, \d{4}-\d\d-\d\d \d\d:\d\d\)$/);
    expect(copy.title).not.toContain("local copy");
    // The branch keeps its context by replaying it once, and starts a thread of its own:
    // the provider thread stays with the conversation both computers keep.
    expect(copy.pendingContextReplay).toContain("USER: local");
    expect(copy.providerSessionId).toBeUndefined();
    expect(copy.automationId).toBeUndefined();
    expect(copy.queuedMessages).toBeUndefined();
    resolve(true);
    expect(await refresh).toBe(true);
    expect(current().adoptedSyncConflict).toBeUndefined();
    expect(current().providerSessionId).toBe(host({}).session.providerSessionId);
    expect(current().blocks).toEqual(host({}).session.blocks);
    // A host rewind after explicit replacement uses the newly accepted baseline.
    vi.mocked(deps.list).mockResolvedValue([entry({ revision: 6 })]);
    vi.mocked(deps.load).mockResolvedValue({ ...host({ blocks: [] }), revision: 6 });
    await mirrorAdoptedSessions(deps);
    expect(current().blocks).toEqual([]);
  });

  it("keeps the original conversation when the branch cannot be saved", async () => {
    const { deps, current } = setup(local({ blocks: [block("local")] }));
    const original = current();
    vi.mocked(deps.preserve!).mockResolvedValue(false);
    await expect(refreshAdoptedSession(deps, "s1", "keep-both")).rejects.toThrow(
      "Could not save this computer's version",
    );
    expect(current()).toBe(original);
    expect(deps.apply).not.toHaveBeenCalled();
  });

  it("rejects local edits or a local turn started during the fetch", async () => {
    for (const edit of [{ blocks: [block("new")] }, { busy: true }]) {
      const { deps, current, change } = setup();
      vi.mocked(deps.load).mockImplementation(async () => {
        change({ ...current(), ...edit });
        return host({});
      });
      await expect(refreshAdoptedSession(deps, "s1")).rejects.toThrow("changed while refreshing");
      expect(deps.apply).not.toHaveBeenCalled();
      expect(deps.preserve).not.toHaveBeenCalled();
    }
  });

  it("does not replace a conversation edited while its branch is being saved", async () => {
    const { deps, current, change } = setup(local({ blocks: [block("local")] }));
    vi.mocked(deps.preserve!).mockImplementation(async () => {
      change({ ...current(), blocks: [block("newer-local")] });
      return true;
    });
    await expect(refreshAdoptedSession(deps, "s1", "keep-both")).rejects.toThrow(
      "changed while refreshing",
    );
    expect(current().blocks).toEqual([block("newer-local")]);
    expect(deps.apply).not.toHaveBeenCalled();
  });

  it("carries a queue update that arrives while the branch is saved instead of failing after it exists", async () => {
    const { deps, current, change } = setup(local({ blocks: [block("local")] }));
    const queued = [{ id: "q1", text: "from the phone", attachments: [] }];
    vi.mocked(deps.preserve!).mockImplementation(async () => {
      // The shared queue replaces the session object, not its conversation.
      change({ ...current(), queuedMessages: queued, queueStatus: "active" });
      return true;
    });
    await expect(refreshAdoptedSession(deps, "s1", "keep-both")).resolves.toBe(true);
    expect(deps.preserve).toHaveBeenCalledOnce();
    expect(current().blocks.map((entry) => entry.id)).toEqual(["a", "b"]);
    expect(current().queuedMessages).toEqual(queued);
    expect(current().queueStatus).toBe("active");
  });

  it("never saves a copy while the user is choosing: a plain refresh of two changed versions only flags them", async () => {
    const { deps, current } = setup(local({ blocks: [block("local")] }));
    const original = current();
    const conflict = vi.fn();
    deps.conflict = conflict;
    expect(await refreshAdoptedSession(deps, "s1")).toBe(false);
    expect(deps.preserve).not.toHaveBeenCalled();
    expect(deps.apply).not.toHaveBeenCalled();
    expect(current()).toBe(original);
    expect(conflict).toHaveBeenCalledOnce();
    expect(conflict.mock.calls[0]![0]).toBe(original);
    expect(conflict.mock.calls[0]![1].key).toBe(adoptedDivergenceKey(original, host({}).session));
  });

  it("keeping the other version replaces this one without a copy and takes the host's provider thread", async () => {
    const { deps, current } = setup(
      local({
        blocks: [block("local")],
        adoptedSyncConflict: true,
        providerSessionId: "mine",
        adoptedDivergence: { key: "k" },
      }),
      host({ providerSessionId: "theirs" }),
    );
    expect(await refreshAdoptedSession(deps, "s1", "keep-other")).toBe(false);
    expect(deps.preserve).not.toHaveBeenCalled();
    expect(current().blocks.map((item) => item.id)).toEqual(["a", "b"]);
    expect(current().providerSessionId).toBe("theirs");
    expect(current().adoptedSyncConflict).toBeUndefined();
    expect(current().adoptedDivergence).toBeUndefined();
  });

  it("answers the same conflict with the same branch, so a retry or a restart never makes a second one", async () => {
    const mine = local({ blocks: [block("local")] });
    const first = setup(mine);
    await refreshAdoptedSession(first.deps, "s1", "keep-both");
    const branch = vi.mocked(first.deps.preserve!).mock.calls[0]![0];
    expect(branch.id).toBe(adoptedBranchId("s1", adoptedDivergenceKey(mine, host({}).session)));
    expect(branch.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
    const second = setup(mine);
    await refreshAdoptedSession(second.deps, "s1", "keep-both");
    expect(vi.mocked(second.deps.preserve!).mock.calls[0]![0].id).toBe(branch.id);
    // Already saved (and maybe continued since): it is neither saved again nor overwritten.
    const third = setup(mine);
    third.deps.stored = async () => branch;
    expect(await refreshAdoptedSession(third.deps, "s1", "keep-both")).toBe(true);
    expect(third.deps.preserve).not.toHaveBeenCalled();
    expect(third.current().blocks.map((item) => item.id)).toEqual(["a", "b"]);
  });

  it("applies a resolution only to a conflict that is still there", async () => {
    // The host only lags: keeping both would branch for nothing.
    const { deps, current } = setup(
      local({ blocks: [block("a"), block("b"), block("c")], adoptedSyncConflict: true }),
    );
    expect(await refreshAdoptedSession(deps, "s1", "keep-both")).toBe(false);
    expect(deps.preserve).not.toHaveBeenCalled();
    expect(current().adoptedSyncConflict).toBeUndefined();
    expect(current().blocks.map((item) => item.id)).toEqual(["a", "b", "c"]);
  });

  it("leaves the local conversation untouched when the host fails or removes the session", async () => {
    const { deps, current } = setup();
    const original = current();
    vi.mocked(deps.load).mockRejectedValue(new Error("offline"));
    await expect(refreshAdoptedSession(deps, "s1")).rejects.toThrow("offline");
    vi.mocked(deps.list).mockResolvedValue([]);
    await expect(refreshAdoptedSession(deps, "s1")).rejects.toThrow("no longer available");
    expect(current()).toBe(original);
    expect(deps.apply).not.toHaveBeenCalled();
  });
});

describe("planAdoptedFetches", () => {
  it("fetches loaded idle sessions whose revision moved", () => {
    expect(planAdoptedFetches([entry()], [local()], new Map())).toHaveLength(1);
    expect(planAdoptedFetches([entry()], [local()], new Map([["s1", 5]]))).toHaveLength(0);
    expect(
      planAdoptedFetches([entry({ revision: 6 })], [local()], new Map([["s1", 5]])),
    ).toHaveLength(1);
  });
  it("skips unloaded and busy sessions", () => {
    expect(planAdoptedFetches([entry({ id: "zz" })], [local()], new Map())).toHaveLength(0);
    expect(planAdoptedFetches([entry()], [local({ busy: true })], new Map())).toHaveLength(0);
  });
});

describe("mergeAdoptedSession", () => {
  const file: Attachment = {
    id: "image1",
    name: "image.png",
    mimeType: "image/png",
    kind: "image",
    size: 3,
    path: "C:/proj/image.png",
  };
  const message: Block = { id: "a", role: "user", text: "[image1]", attachments: [file] };

  it("merges persisted attachments with desktop-only preview and file flags", () => {
    const current = local({
      blocks: [
        {
          ...message,
          attachments: [
            {
              ...file,
              copyFromPath: true,
              data: "YWJj",
              previewUrl: "blob:preview",
              loadPreview: async () => "YWJj",
              missing: false,
            },
          ],
        },
      ],
    });
    const merged = mergeAdoptedSession(current, host({ blocks: [message, block("b")] }));
    expect(merged?.blocks).toEqual([message, block("b")]);
  });

  it("accepts host progress after local preview hydration since the baseline", () => {
    const base = local({ blocks: [message] });
    const current = {
      ...base,
      blocks: [{ ...message, attachments: [{ ...file, copyFromPath: true }] }],
    };
    expect(
      mergeAdoptedSession(current, host({ blocks: [message, block("b")] }), base)?.blocks,
    ).toEqual([message, block("b")]);
  });

  it("treats empty and absent attachment lists as the same transcript", () => {
    expect(
      mergeAdoptedSession(
        local({ blocks: [{ ...message, attachments: [] }] }),
        host({ blocks: [{ ...message, attachments: undefined }, block("b")] }),
      )?.blocks,
    ).toHaveLength(2);
  });

  it.each([{ path: undefined }, { path: "C:/Users/me/.bycoda-host/attachments/image1" }])(
    "ignores where each side stored the same attachment: %j",
    (edit) => {
      const stored = { ...message, attachments: [{ ...file, ...edit }] };
      expect(
        mergeAdoptedSession(local({ blocks: [stored] }), host({ blocks: [message, block("b")] })),
      ).toBeDefined();
      expect(
        mergeAdoptedSession(local({ blocks: [message] }), host({ blocks: [stored, block("b")] })),
      ).toBeDefined();
    },
  );

  it("treats a finished block's stored `streaming: false` as absent", () => {
    const reply = { id: "r", role: "assistant", text: "done" } as Block;
    expect(
      adoptedTranscriptLead(
        local({ blocks: [reply, block("next")] }),
        host({ blocks: [{ ...reply, streaming: false }] }).session,
      ),
    ).toBe("local");
  });

  it.each([
    { name: "other.png" },
    { id: "image2" },
    { size: 4 },
    { mimeType: "image/jpeg" },
    { browserAnnotation: { url: "https://example.test" } },
  ])("keeps real attachment metadata changes as conflicts: %j", (edit) => {
    const current = local({
      blocks: [{ ...message, attachments: [{ ...file, ...edit } as Attachment] }],
    });
    expect(mergeAdoptedSession(current, host({ blocks: [message, block("b")] }))).toBeUndefined();
  });

  it("adopts a host provider switch with its model, settings and resume identity together", () => {
    const merged = mergeAdoptedSession(
      local({ providerAccountId: "claude-account", providerSessionId: "claude-thread" }),
      host({
        harness: "codex",
        model: "gpt",
        modelSettings: { reasoningEffort: "high" },
        providerSessionId: "codex-thread",
      }),
    )!;
    expect(merged).toMatchObject({
      harness: "codex",
      model: "gpt",
      modelSettings: { reasoningEffort: "high" },
      providerSessionId: "codex-thread",
    });
    expect(merged.providerAccountId).toBeUndefined();
  });
  it("clears the old provider thread when the incoming provider has no thread yet", () => {
    expect(
      mergeAdoptedSession(
        local({ providerSessionId: "claude-thread" }),
        host({ harness: "codex", model: "gpt", providerSessionId: undefined }),
      )?.providerSessionId,
    ).toBeUndefined();
  });
  it("keeps a local provider configuration as a unit when only the local side changed", () => {
    const base = local({ providerSessionId: "claude-thread" });
    const edited = { ...base, model: "local-model", modelSettings: { effort: "high" } };
    expect(mergeAdoptedSession(edited, host({ ...base }), base)).toMatchObject({
      harness: "claude",
      model: "local-model",
      modelSettings: { effort: "high" },
      providerSessionId: "claude-thread",
    });
  });
  it("reports conflicting provider configuration edits instead of mixing identities", () => {
    const base = local({ providerSessionId: "claude-thread" });
    const edited = { ...base, model: "local-model" };
    expect(
      mergeAdoptedSession(
        edited,
        host({ harness: "codex", model: "gpt", providerSessionId: "codex-thread" }),
        base,
      ),
    ).toBeUndefined();
  });
  it("rejects equal-length divergent text, and accepts a rewind only with an unchanged baseline", () => {
    const edited = local({
      blocks: [{ id: "a", role: "user", text: "new local" } as never],
    });
    expect(mergeAdoptedSession(edited, host({ blocks: [block("a")] }))).toBeUndefined();
    const base = local({ blocks: [block("a"), block("b")] });
    expect(mergeAdoptedSession(base, host({ blocks: [block("a")] }), base)?.blocks).toEqual([
      block("a"),
    ]);
    expect(mergeAdoptedSession(edited, host({ blocks: [] }), base)).toBeUndefined();
  });
  it("takes the transcript and keeps local identity", () => {
    const merged = mergeAdoptedSession(
      local(),
      host({ title: "Remote", model: "new", providerSessionId: "prov-2" }),
    )!;
    expect(merged.blocks).toHaveLength(2);
    expect(merged.title).toBe("Remote");
    expect(merged.model).toBe("new");
    expect(merged.providerSessionId).toBe("prov-2");
    expect(merged.cwd).toBe("C:/proj");
    expect(merged.worktreeCwd).toBe("C:/proj/wt");
    expect(merged.continuingElsewhere).toBeUndefined();
  });
  it("clears incomplete-history state after accepting the complete host transcript", () => {
    const merged = mergeAdoptedSession(
      local({ historyPartial: true, historyLoading: true, historyLoadError: "offline" }),
      host({}),
    )!;
    expect(merged.blocks).toHaveLength(2);
    expect(merged.historyPartial).toBeUndefined();
    expect(merged.historyLoading).toBeUndefined();
    expect(merged.historyLoadError).toBeUndefined();
  });
  it("adopts rewind archives and pending replay metadata from the host", () => {
    const history = [{
      id: "rewind-1",
      fromBlockId: "b",
      createdAt: 10,
      blocks: [block("b")],
    }];
    const merged = mergeAdoptedSession(
      local(),
      host({ rewindHistory: history, pendingContextReplay: "retained prefix" }),
    );
    expect(merged).toMatchObject({
      rewindHistory: history,
      pendingContextReplay: "retained prefix",
    });
  });
  it("holds sending while the host runs", () => {
    expect(mergeAdoptedSession(local(), host({}, "running"))!.continuingElsewhere).toBe(true);
  });
  it("does not drop newer local turns", () => {
    const longer = local({ blocks: [block("a"), block("b"), block("c")] });
    expect(mergeAdoptedSession(longer, host({}))).toBeUndefined();
  });
});

describe("adopted sessions after quitting mid-turn or with a lagging host", () => {
  const user = (id: string, text = id) => ({ id, role: "user", text }) as Block;
  const notice = { id: "quit", role: "system", text: "x", notice: "interrupt" } as Block;
  const openTurn = [
    user("u1"),
    { id: "r1", role: "assistant", text: "done" } as Block,
    { ...user("u2"), startedAt: 1 },
    { id: "t1", role: "tool", text: "", streaming: true, tool: { status: "in_progress" } } as never,
    { id: "ap", role: "approval", text: "", approval: {} } as never,
  ];
  const sealed = [
    openTurn[0],
    openTurn[1],
    { ...openTurn[2], durationMs: 5 },
    { id: "t1", role: "tool", text: "", streaming: false, tool: { status: "cancelled" } } as never,
    notice,
  ];

  it("keeps the sealed local turn over a host copy saved before the quit", () => {
    const merged = mergeAdoptedSession(local({ blocks: sealed }), host({ blocks: openTurn }));
    expect(merged!.blocks).toEqual(sealed);
  });

  it("takes a host copy that continued past the interrupted turn", () => {
    const ahead = [...openTurn.slice(0, 4), user("u3")];
    const merged = mergeAdoptedSession(local({ blocks: sealed }), host({ blocks: ahead }));
    expect(merged!.blocks).toEqual(ahead);
  });

  it("still reports an earlier turn edited on the host", () => {
    const edited = [openTurn[0], { ...openTurn[1], text: "other" }, ...openTurn.slice(2)];
    expect(
      mergeAdoptedSession(local({ blocks: sealed }), host({ blocks: edited })),
    ).toBeUndefined();
  });

  it("prefers a running host copy over the local one when both hold the same blocks", () => {
    const merged = mergeAdoptedSession(
      local({ blocks: sealed }),
      host({ blocks: openTurn }, "running"),
    );
    expect(merged!.blocks).toEqual(openTurn);
  });

  function mirrorAfterRestart(session: Session, remote: Session["blocks"]) {
    let current = session;
    const preserve = vi.fn(async () => true);
    const conflict = vi.fn();
    const mirrored = new Map<string, number>();
    const run = mirrorAdoptedSessions({
      list: async () => [entry()],
      load: async () => host({ blocks: remote }),
      local: () => [current],
      apply: (merged) => {
        current = merged;
      },
      mirrored,
      preserve,
      conflict,
    });
    return { run, preserve, conflict, mirrored, current: () => current };
  }

  it("does not fork a separate local copy for a host copy saved before the quit", async () => {
    const mirror = mirrorAfterRestart(local({ blocks: sealed }), openTurn);
    await mirror.run;
    expect(mirror.preserve).not.toHaveBeenCalled();
    expect(mirror.current().blocks).toEqual(sealed);
  });

  it("keeps the sealed turn when a stale host copy changes revision again", async () => {
    let current = local({ blocks: sealed });
    let remote = host({ blocks: openTurn });
    const deps: AdoptedMirrorDeps = {
      list: async () => [entry({ revision: remote.revision })],
      load: async () => remote,
      local: () => [current],
      apply: (merged) => {
        current = merged;
      },
      mirrored: new Map(),
    };
    await mirrorAdoptedSessions(deps);
    remote = { ...host({ blocks: openTurn, title: "Renamed" }), revision: 6 };
    await mirrorAdoptedSessions(deps);
    expect(current.title).toBe("Renamed");
    expect(current.blocks).toEqual(sealed);
  });

  it("waits for a host that never received the interrupted turn or later ones", async () => {
    const session = local({ blocks: [...sealed, user("continue")] });
    const mirror = mirrorAfterRestart(session, openTurn.slice(0, 2));
    await mirror.run;
    expect(mirror.preserve).not.toHaveBeenCalled();
    expect(mirror.conflict).not.toHaveBeenCalled();
    expect(mirror.current()).toBe(session);
    // Judged at this revision; only the host's next change is fetched again.
    expect(mirror.mirrored.get("s1")).toBe(5);
  });

  it("lets a local turn lead a host copy that only stored an attachment elsewhere", async () => {
    const file = { id: "f1", name: "a.png", mimeType: "image/png", kind: "image", size: 1 };
    const sent = (path?: string) =>
      ({ ...user("u1"), attachments: [{ ...file, ...(path ? { path } : {}) }] }) as Block;
    for (const [mine, theirs] of [
      [sent(), sent("C:/host/attachments/f1")],
      [sent("C:/desktop/f1"), sent()],
    ]) {
      const session = local({ blocks: [mine, user("u2")] });
      const mirror = mirrorAfterRestart(session, [theirs]);
      await mirror.run;
      expect(mirror.preserve).not.toHaveBeenCalled();
      expect(mirror.conflict).not.toHaveBeenCalled();
      expect(mirror.current()).toBe(session);
    }
  });

  it("flags a divergence the host keeps refusing once and never saves a copy", async () => {
    const reply = (text: string) => ({ id: "r1", role: "assistant", text }) as Block;
    let current = local({ blocks: [user("u1"), reply("desktop")] });
    let revision = 5;
    const remote = () => ({ ...host({ blocks: [user("u1"), reply("host")] }), revision });
    const preserve = vi.fn(async () => true);
    const apply = vi.fn((merged: Session) => {
      current = merged;
    });
    const conflict = vi.fn((flagged: Session, divergence?: { key: string }) => {
      current = { ...flagged, adoptedSyncConflict: true, adoptedDivergence: divergence };
    });
    const deps: AdoptedMirrorDeps = {
      list: async () => [entry({ revision })],
      load: async () => remote(),
      local: () => [current],
      apply,
      mirrored: new Map(),
      preserve,
      conflict,
    };
    await mirrorAdoptedSessions(deps);
    expect(preserve).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
    expect(conflict).toHaveBeenCalledOnce();
    expect(current.blocks.map((entry) => entry.id)).toEqual(["u1", "r1"]);
    expect((current.blocks[1] as Block).text).toBe("desktop");
    const key = current.adoptedDivergence!.key;
    // The host moves on without touching the disputed block: still that divergence.
    // A flagged conversation is only compared again after a few seconds.
    revision = 6;
    await mirrorAdoptedSessions(deps);
    expect(conflict).toHaveBeenCalledOnce();
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(Date.now() + ADOPTED_FLAGGED_REFETCH_MS + 1_000);
      await mirrorAdoptedSessions(deps);
    } finally {
      vi.useRealTimers();
    }
    expect(preserve).not.toHaveBeenCalled();
    expect(conflict.mock.calls.map(([, divergence]) => divergence?.key)).toEqual([key, key]);
  });

  it("stays silent about a divergence the user chose to keep, across passes and restarts", async () => {
    const reply = (text: string) => ({ id: "r1", role: "assistant", text }) as Block;
    let current = local({
      blocks: [user("u1"), reply("desktop")],
      adoptedSyncConflict: true,
    });
    const diverged = host({ blocks: [user("u1"), reply("host")] });
    const key = adoptedDivergenceKey(current, diverged.session);
    current = { ...current, adoptedDivergence: { key, keep: true } };
    const preserve = vi.fn(async () => true);
    const conflict = vi.fn();
    for (const revision of [5, 6]) {
      // A fresh `mirrored` map is an app restart: nothing but the session remembers.
      const mirrored = new Map<string, number>();
      await mirrorAdoptedSessions({
        list: async () => [entry({ revision })],
        load: async () => ({ ...diverged, revision }),
        local: () => [current],
        apply: (merged) => {
          current = merged;
        },
        mirrored,
        preserve,
        conflict,
      });
      expect(mirrored.get("s1")).toBe(revision);
    }
    expect(preserve).not.toHaveBeenCalled();
    expect(conflict).not.toHaveBeenCalled();
    expect(current.adoptedSyncConflict).toBeUndefined();
    expect(current.adoptedDivergence).toEqual({ key, keep: true });
  });

  it("asks again when the divergence is a different one than the one kept", async () => {
    const reply = (text: string) => ({ id: "r1", role: "assistant", text }) as Block;
    const current = local({
      blocks: [user("u1"), reply("desktop")],
      adoptedDivergence: { key: "an-older-divergence", keep: true },
    });
    const conflict = vi.fn();
    await mirrorAdoptedSessions({
      list: async () => [entry()],
      load: async () => host({ blocks: [user("u1"), reply("host")] }),
      local: () => [current],
      apply: vi.fn(),
      mirrored: new Map(),
      conflict,
    });
    expect(conflict).toHaveBeenCalledOnce();
    expect(conflict.mock.calls[0][1]).toEqual({
      key: expect.not.stringMatching(/older/),
      hostHead: { count: 2, chain: expect.stringMatching(/^[0-9a-f]{32}$/) },
    });
  });

  it("clears the flag and its record once the conversations agree again", async () => {
    const current = local({
      blocks: [block("a")],
      adoptedSyncConflict: true,
      adoptedDivergence: { key: "0:a:a:x:y" },
    });
    const merged = mergeAdoptedSession(current, host({ blocks: [block("a"), block("b")] }));
    expect(merged?.adoptedSyncConflict).toBeUndefined();
    expect(merged?.adoptedDivergence).toBeUndefined();
  });

  it("names a divergence by the transcripts' heads, not by the host revision or the pass", () => {
    const reply = (text: string) => ({ id: "r1", role: "assistant", text }) as Block;
    const mine = local({ blocks: [user("u1"), reply("desktop")] });
    const theirs = (text: string, extra: Block[] = []) =>
      host({ blocks: [user("u1"), reply(text), ...extra] }).session;
    const key = adoptedDivergenceKey(mine, theirs("host"));
    expect(adoptedDivergenceKey(mine, theirs("host"))).toBe(key);
    // The host moving on is a different divergence: it has to be asked about again,
    // or keeping this version would silently stop meaning anything.
    expect(adoptedDivergenceKey(mine, theirs("host", [user("later")]))).not.toBe(key);
    expect(adoptedDivergenceKey(mine, theirs("host, edited again"))).not.toBe(key);
    // Both appended after a different agreement: not the same divergence.
    const base = { count: 1, chain: "0123456789abcdef0123456789abcdef" };
    expect(adoptedDivergenceKey({ ...mine, adoptedBase: base }, theirs("host"))).not.toBe(key);
  });

  it("flags, and does not copy, when the lagging host diverged", async () => {
    const session = local({ blocks: [...sealed, user("continue")] });
    const mirror = mirrorAfterRestart(session, [openTurn[0], user("elsewhere")]);
    await mirror.run;
    expect(mirror.preserve).not.toHaveBeenCalled();
    expect(mirror.conflict).toHaveBeenCalledOnce();
    expect(mirror.current()).toBe(session);
  });
});

describe("mirrorAdoptedSessions", () => {
  it("reports live status before loading a conflicting transcript", async () => {
    const onRunning = vi.fn();
    const conflict = vi.fn();
    await mirrorAdoptedSessions({
      list: async () => [entry({ status: "running" })],
      load: async () => {
        expect(onRunning).toHaveBeenCalledWith(new Set(["s1"]));
        return host({ blocks: [] }, "running");
      },
      local: () => [local()],
      apply: vi.fn(),
      mirrored: new Map(),
      onRunning,
      conflict,
    });
    expect(conflict).toHaveBeenCalledTimes(1);
  });

  it("reports status changes even when the transcript revision is unchanged", async () => {
    const onRunning = vi.fn();
    const load = vi.fn();
    const deps = {
      list: async () => [entry({ status: "running" })],
      load,
      local: () => [local()],
      apply: vi.fn(),
      mirrored: new Map([["s1", 5]]),
      onRunning,
    };
    await mirrorAdoptedSessions(deps);
    await mirrorAdoptedSessions({ ...deps, list: async () => [entry()] });
    // Each pass reports before and after its fetches.
    expect(onRunning.mock.calls).toEqual([
      [new Set(["s1"])],
      [new Set(["s1"])],
      [new Set()],
      [new Set()],
    ]);
    expect(load).not.toHaveBeenCalled();
  });

  it("retains a conflicting local edit and does not mark a rejected revision mirrored", async () => {
    const mirrored = new Map<string, number>();
    const current = local({
      blocks: [{ id: "a", role: "user", text: "edited here" } as never],
    });
    const conflict = vi.fn();
    const apply = vi.fn();
    await mirrorAdoptedSessions({
      list: async () => [entry()],
      load: async () => host({ blocks: [block("a")] }),
      local: () => [current],
      apply,
      mirrored,
      conflict,
    });
    expect(apply).not.toHaveBeenCalled();
    expect(conflict).toHaveBeenCalledWith(current, {
      key: expect.any(String),
      hostHead: { count: 1, chain: expect.any(String) },
    });
    expect(mirrored.has("s1")).toBe(false);
  });

  it("checks edits made while the snapshot is in flight and accepts an unchanged-baseline reset", async () => {
    let current = local();
    let revision = 5;
    let next = host({});
    const mirrored = new Map<string, number>();
    const deps = {
      list: async () => [entry({ revision })],
      load: async () => next,
      local: () => [current],
      apply: (merged: Session) => {
        current = merged;
      },
      mirrored,
    };
    await mirrorAdoptedSessions(deps);
    expect(current.blocks).toHaveLength(2);
    revision = 6;
    next = { ...host({ blocks: [] }), revision };
    await mirrorAdoptedSessions(deps);
    expect(current.blocks).toEqual([]);
    revision = 7;
    const conflict = vi.fn();
    await mirrorAdoptedSessions({
      ...deps,
      conflict,
      load: async () => {
        current = { ...current, blocks: [block("new local")] };
        return { ...host({}), revision };
      },
    });
    expect(current.blocks).toEqual([block("new local")]);
    expect(mirrored.get("s1")).toBe(6);
    expect(conflict).toHaveBeenCalledTimes(1);
  });

  it("records a closed conflicting session's divergence instead of marking it caught up, and not a failed adoption", async () => {
    const mirrored = new Map<string, number>();
    const save = vi.fn();
    await mirrorAdoptedSessions({
      list: async () => [entry()],
      load: async () => host({ blocks: [] }),
      local: () => [],
      apply: vi.fn(),
      mirrored,
      stored: async () => local(),
      save,
    });
    // The divergence is saved with the closed session (no blocks replaced), so it
    // shows when opened; only then is this revision settled.
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]![0]).toMatchObject({
      blocks: [expect.objectContaining({ id: "a" })],
      adoptedDivergence: { key: expect.any(String) },
    });
    expect(save.mock.calls[0]![0].adoptedDivergence.keep).toBeUndefined();
    expect(mirrored.get("s1")).toBe(5);
    const failedAdoption = new Map<string, number>();
    await mirrorAdoptedSessions({
      list: async () => [entry()],
      load: async () => host({}),
      local: () => [],
      apply: vi.fn(),
      mirrored: failedAdoption,
      stored: async () => null,
      save,
      adopt: async () => false,
    });
    expect(failedAdoption.has("s1")).toBe(false);
  });
  it("saves a closed conversation's divergence once, so the safety pass stops fetching it", async () => {
    const mirrored = new Map<string, number>();
    let stored = local();
    const load = vi.fn(async () => host({ blocks: [] }));
    const save = vi.fn(async (merged: Session) => {
      stored = merged;
      return true;
    });
    const deps: AdoptedMirrorDeps = {
      list: async () => [entry()],
      load,
      local: () => [],
      apply: vi.fn(),
      mirrored,
      stored: async () => stored,
      stamp: async () => 1,
      save,
    };
    await mirrorAdoptedSessions(deps);
    await mirrorAdoptedSessions(deps);
    expect(load).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(1);
    // The host moved on and it is still the same difference: recorded, not saved again.
    mirrored.clear();
    await mirrorAdoptedSessions(deps);
    expect(save).toHaveBeenCalledTimes(1);
    expect(mirrored.get("s1")).toBe(5);
  });

  it("retries a closed conversation's divergence when the guarded save refuses", async () => {
    const mirrored = new Map<string, number>();
    const save = vi.fn(async () => false);
    await mirrorAdoptedSessions({
      list: async () => [entry()],
      load: async () => host({ blocks: [] }),
      local: () => [],
      apply: vi.fn(),
      mirrored,
      stored: async () => local(),
      stamp: async () => 1,
      save,
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(mirrored.has("s1")).toBe(false);
  });
  it("applies once per revision and reports running ids", async () => {
    const mirrored = new Map<string, number>();
    const apply = vi.fn();
    const load = vi.fn(async () => host({}, "running"));
    const deps = {
      list: async () => [entry({ status: "running" })],
      load,
      local: () => [local()],
      apply,
      mirrored,
    };
    expect([...(await mirrorAdoptedSessions(deps))]).toEqual(["s1"]);
    expect(apply).toHaveBeenCalledTimes(1);
    await mirrorAdoptedSessions(deps);
    expect(load).toHaveBeenCalledTimes(1);
  });
  it("does not apply when the session turned busy during the fetch", async () => {
    let busy = false;
    const apply = vi.fn();
    await mirrorAdoptedSessions({
      list: async () => [entry()],
      load: async () => {
        busy = true;
        return host({});
      },
      local: () => [local({ busy })],
      apply,
      mirrored: new Map(),
    });
    expect(apply).not.toHaveBeenCalled();
  });
  it("catches up a closed session in storage, once per revision", async () => {
    const save = vi.fn(async () => {});
    const stored = vi.fn(async () => local());
    const deps = {
      list: async () => [entry(), entry({ id: "busy", status: "running" as const })],
      load: async () => host({}),
      local: () => [],
      apply: vi.fn(),
      mirrored: new Map<string, number>(),
      stored,
      save,
    };
    await mirrorAdoptedSessions(deps);
    await mirrorAdoptedSessions(deps);
    // Once each: the running one only to learn it is already stored here.
    expect(stored.mock.calls.map(([id]) => id)).toEqual(["s1", "s1", "busy"]);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0]).toMatchObject({
      id: "s1",
      cwd: "C:/proj",
      blocks: [{ id: "a" }, { id: "b" }],
    });
  });
});

describe("sessions started on this machine's host from another computer", () => {
  it("are saved here once, even while their turn runs", async () => {
    const adopt = vi.fn(async () => {});
    const deps = {
      list: async () => [entry({ id: "new", status: "running" as const })],
      load: vi.fn(async () => host({})),
      local: () => [],
      apply: vi.fn(),
      mirrored: new Map<string, number>(),
      stored: vi.fn(async () => null),
      save: vi.fn(async () => {}),
      adopt,
    };
    await mirrorAdoptedSessions(deps);
    await mirrorAdoptedSessions(deps);
    expect(adopt).toHaveBeenCalledTimes(1);
    expect(adopt).toHaveBeenCalledWith(expect.objectContaining({ id: "new" }));
    expect(deps.save).not.toHaveBeenCalled();
  });

  it("then catch up like any shared session once the turn ends", async () => {
    const save = vi.fn(async () => {});
    const adopt = vi.fn(async () => {});
    await mirrorAdoptedSessions({
      list: async () => [entry({ revision: 7 })],
      load: async () => host({ title: "Finished" }),
      local: () => [],
      apply: vi.fn(),
      mirrored: new Map([["s1", 5]]),
      stored: async () => local(),
      save,
      adopt,
    });
    expect(adopt).not.toHaveBeenCalled();
    // The second argument is the optional stored-copy stamp, unset here.
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ title: "Finished" }), undefined);
  });

  it("are filed under the project folder, with the host's working copy as worktree", () => {
    const same = (a: string, b: string) => a === b;
    const inProject = desktopCopyOf(
      host({ id: "h1", cwd: "/Users/me/shop", busy: true }, "running"),
      "/Users/me/shop",
      same,
    );
    expect(inProject).toMatchObject({
      id: "h1",
      cwd: "/Users/me/shop",
      worktreeCwd: undefined,
      continuingElsewhere: true,
    });
    expect(inProject.busy).toBeUndefined();
    const inWorktree = desktopCopyOf(
      host({ cwd: "/Users/me/shop-worktrees/fix" }),
      "/Users/me/shop",
      same,
    );
    expect(inWorktree).toMatchObject({
      cwd: "/Users/me/shop",
      worktreeCwd: "/Users/me/shop-worktrees/fix",
    });
    expect(inWorktree.continuingElsewhere).toBeUndefined();
  });
});

it("needs the sessions.desktop capability", () => {
  expect(supportsAdoptedSessions(["sync"])).toBe(false);
  expect(supportsAdoptedSessions(["sessions.desktop"])).toBe(true);
  expect(supportsAdoptedSessions(undefined)).toBe(false);
});

describe("mirrorAdoptedSessions delta and closed-copy save", () => {
  const completedBlocks: Session["blocks"] = [
    block("a"),
    { id: "output", role: "assistant", text: "Completed the task" } as never,
    { id: "tool", role: "tool", text: "Verification passed" } as never,
  ];

  it("catches up a tab opened after its loaded-session fetches were planned", async () => {
    let sessions: Session[] = [];
    const promptOnly = local({ historyPartial: true });
    const load = vi.fn(async () => host({ blocks: completedBlocks }));
    const deps: AdoptedMirrorDeps = {
      list: async () => [entry()],
      local: () => sessions,
      load,
      apply: (merged) => {
        sessions = [merged];
      },
      mirrored: new Map(),
      stored: async () => {
        sessions = [promptOnly];
        return promptOnly;
      },
      save: vi.fn(async () => true),
    };

    await mirrorAdoptedSessions(deps);
    expect(load).not.toHaveBeenCalled();
    expect(deps.mirrored.has("s1")).toBe(false);
    await mirrorAdoptedSessions(deps);
    expect(sessions[0].blocks).toEqual(completedBlocks);
    expect(sessions[0].historyPartial).toBeUndefined();
    expect(deps.mirrored.get("s1")).toBe(5);
  });

  it("refreshes a stale tab opened during adoption even when the host revision stays unchanged", async () => {
    let sessions: Session[] = [];
    const remote = host({ blocks: completedBlocks }, "running");
    const load = vi.fn(async () => remote);
    const deps: AdoptedMirrorDeps = {
      list: async () => [entry({ status: "running" })],
      local: () => sessions,
      load,
      apply: (merged) => {
        sessions = [merged];
      },
      mirrored: new Map(),
      stored: async () => null,
      save: vi.fn(async () => true),
      adopt: vi.fn(async () => {
        sessions = [local()];
        return true;
      }),
    };

    await mirrorAdoptedSessions(deps);
    expect(deps.mirrored.has("s1")).toBe(false);
    await mirrorAdoptedSessions(deps);
    expect(deps.adopt).toHaveBeenCalledOnce();
    expect(load).toHaveBeenCalledWith("s1", undefined);
    expect(sessions[0].blocks).toEqual(completedBlocks);
    expect(sessions[0].continuingElsewhere).toBe(true);
    expect(deps.mirrored.get("s1")).toBe(5);
  });

  it("does not mark a newly opened tab caught up when only its stored copy was saved", async () => {
    let sessions: Session[] = [];
    const promptOnly = local();
    const remote = host({ blocks: completedBlocks });
    const conflict = vi.fn();
    const deps: AdoptedMirrorDeps = {
      list: async () => [entry()],
      local: () => sessions,
      load: vi.fn(async () => remote),
      apply: (merged) => {
        sessions = [merged];
      },
      mirrored: new Map(),
      stored: async () => promptOnly,
      save: vi.fn(async () => {
        sessions = [promptOnly];
        return true;
      }),
      conflict,
    };

    await mirrorAdoptedSessions(deps);
    expect(deps.save).toHaveBeenCalledOnce();
    expect(deps.mirrored.has("s1")).toBe(false);
    await mirrorAdoptedSessions(deps);
    expect(sessions[0].blocks).toEqual(completedBlocks);
    expect(conflict).not.toHaveBeenCalled();
    expect(deps.mirrored.get("s1")).toBe(5);
  });

  it("asks for a delta from the last applied snapshot", async () => {
    const mirrored = new Map<string, number>();
    let current = local();
    let revision = 5;
    const seen: (HostSession | undefined)[] = [];
    const run = () =>
      mirrorAdoptedSessions({
        list: async () => [entry({ revision })],
        load: async (_id, known) => {
          seen.push(known);
          return { ...host({}), revision };
        },
        local: () => [current],
        apply: (merged) => {
          current = merged;
        },
        mirrored,
      });
    await run();
    expect(seen).toEqual([undefined]);
    revision = 6;
    await run();
    expect(seen[1]?.revision).toBe(5);
  });

  it("keeps a conflicting session on deltas without marking it mirrored", async () => {
    const mirrored = new Map<string, number>();
    const edited = local({
      blocks: [{ id: "a", role: "user", text: "edited here" } as never],
    });
    const seen: (HostSession | undefined)[] = [];
    const run = () =>
      mirrorAdoptedSessions({
        list: async () => [entry()],
        load: async (_id, known) => {
          seen.push(known);
          return host({ blocks: [block("a")] });
        },
        local: () => [edited],
        apply: vi.fn(),
        mirrored,
        conflict: vi.fn(),
      });
    await run();
    await run();
    expect(seen[0]).toBeUndefined();
    expect(seen[1]?.revision).toBe(5);
    expect(mirrored.has("s1")).toBe(false);
  });

  it("does not remember a snapshot dropped because a local turn started", async () => {
    const mirrored = new Map<string, number>();
    let busy = false;
    const seen: (HostSession | undefined)[] = [];
    const run = () =>
      mirrorAdoptedSessions({
        list: async () => [entry()],
        load: async (_id, known) => {
          seen.push(known);
          busy = true;
          return host({});
        },
        local: () => [local({ busy })],
        apply: vi.fn(),
        mirrored,
      });
    await run();
    busy = false;
    await run();
    expect(seen).toEqual([undefined, undefined]);
  });

  it("does not mark a closed copy mirrored when the guarded save refuses", async () => {
    const mirrored = new Map<string, number>();
    const stored = local();
    const save = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
    const run = () =>
      mirrorAdoptedSessions({
        list: async () => [entry()],
        load: async () => host({}),
        local: () => [],
        apply: vi.fn(),
        mirrored,
        stored: async () => stored,
        stamp: async () => 42,
        save,
      });
    await run();
    expect(save).toHaveBeenCalledWith(expect.anything(), 42);
    expect(mirrored.has("s1")).toBe(false);
    await run();
    expect(mirrored.get("s1")).toBe(5);
  });
});

describe("divergence judged by conversation content", () => {
  const prompt = { id: "u1", role: "user", text: "Review the plan" } as Block;
  const agent = {
    id: "t1",
    role: "tool",
    text: "Chat subagent",
    agentRun: { name: "Chat subagent", steps: [{ id: "s1", kind: "tool", text: "rg" }] },
  } as Block;
  const finished = {
    ...agent,
    tool: { callId: "call", kind: "agent", status: "completed", title: "Chat subagent" },
    agentRun: {
      name: "Chat subagent",
      steps: [
        { id: "s1", kind: "tool", text: "rg" },
        { id: "s2", kind: "tool", text: "git status" },
      ],
    },
  } as Block;
  const reply = { id: "a1", role: "assistant", text: "Done." } as Block;

  it("takes the host turn when it only stamped turn bookkeeping on the copied prompt", () => {
    const ran = {
      ...prompt,
      durationMs: 1200,
      providerTurnId: "turn-1",
      turnMetrics: { inputTokens: 10, outputTokens: 2 },
    } as Block;
    const merged = mergeAdoptedSession(local({ blocks: [prompt] }), host({ blocks: [ran, reply] }));
    expect(merged?.blocks).toEqual([ran, reply]);
  });

  it("does not fork a copy over a late subagent result on the same row", async () => {
    let current = local({ blocks: [prompt, finished] });
    const preserve = vi.fn(async () => true);
    const conflict = vi.fn();
    await mirrorAdoptedSessions({
      list: async () => [entry()],
      load: async () => host({ blocks: [prompt, agent, reply] }),
      local: () => [current],
      apply: (merged) => {
        current = merged;
      },
      mirrored: new Map(),
      preserve,
      conflict,
    });
    expect(preserve).not.toHaveBeenCalled();
    expect(conflict).not.toHaveBeenCalled();
    expect(current.blocks.map((item) => item.id)).toEqual(["u1", "t1", "a1"]);
  });

  it("still treats an edited prompt or a different assistant reply as divergence", () => {
    const edited = { ...prompt, text: "Review the other plan" } as Block;
    expect(mergeAdoptedSession(local({ blocks: [edited] }), host({ blocks: [prompt, reply] }))).toBeUndefined();
    const other = { ...reply, text: "Something else." } as Block;
    expect(
      mergeAdoptedSession(local({ blocks: [prompt, other, block("x")] }), host({ blocks: [prompt, reply] })),
    ).toBeUndefined();
  });

  it("an explicit refresh keeps turns the lagging host has not caught up with", async () => {
    let current = local({ blocks: [prompt, reply, block("continue")], adoptedSyncConflict: true });
    const before = current.blocks;
    const preserve = vi.fn(async () => true);
    const mirrored = new Map<string, number>();
    const preserved = await refreshAdoptedSession(
      {
        list: async () => [entry()],
        load: async () => host({ blocks: [prompt, reply] }),
        local: () => [current],
        apply: (merged) => {
          current = merged;
        },
        mirrored,
        preserve,
      },
      "s1",
    );
    expect(preserved).toBe(false);
    expect(preserve).not.toHaveBeenCalled();
    expect(current.blocks).toBe(before);
    expect(current.adoptedSyncConflict).toBeUndefined();
    expect(mirrored.get("s1")).toBe(5);
  });

  it("an explicit refresh leaves a real local divergence for the user's answer, with no copy", async () => {
    let current = local({ blocks: [prompt, block("mine")] });
    const preserve = vi.fn(async () => true);
    const conflict = vi.fn();
    expect(
      await refreshAdoptedSession(
        {
          list: async () => [entry()],
          load: async () => host({ blocks: [prompt, block("theirs")] }),
          local: () => [current],
          apply: (merged) => {
            current = merged;
          },
          mirrored: new Map(),
          preserve,
          conflict,
        },
        "s1",
      ),
    ).toBe(false);
    expect(preserve).not.toHaveBeenCalled();
    expect(conflict).toHaveBeenCalledOnce();
    expect(current.blocks.map((item) => item.id)).toEqual(["u1", "mine"]);
  });
});

describe("a session adopted while the host was still writing it", () => {
  const prompt = { id: "u1", role: "user", text: "Explain the cache" } as Block;
  const partial = {
    id: "a1",
    role: "assistant",
    text: "The cache",
    streaming: true,
  } as Block;
  const complete = {
    id: "a1",
    role: "assistant",
    text: "The cache keeps pages.",
  } as Block;
  const followUp = { id: "u2", role: "user", text: "And eviction?" } as Block;
  // Desktop storage drops the stream flag: the restored reply is closed but cut short.
  const stored = (session: Session): Session => ({
    ...session,
    blocks: session.blocks.map(
      ({ streaming: _streaming, ...rest }) => rest as Block,
    ),
  });

  it("takes the host's finished reply without saving a local copy", async () => {
    const midTurn = host({ blocks: [prompt, partial] }, "running");
    const finished = { ...host({ blocks: [prompt, complete] }), revision: 6 };
    let snapshot: HostSession = midTurn;
    let saved: Session | null = null;
    let loaded: Session[] = [];
    const preserve = vi.fn(async () => true);
    const conflict = vi.fn();
    const deps: AdoptedMirrorDeps = {
      list: async () => [
        entry({ revision: snapshot.revision, status: snapshot.status }),
      ],
      load: async () => snapshot,
      local: () => loaded,
      apply: (merged) => {
        loaded = loaded.map((session) =>
          session.id === merged.id ? merged : session,
        );
      },
      mirrored: new Map(),
      stored: async () => saved,
      save: vi.fn(async () => true),
      adopt: async () => {
        saved = stored(desktopCopyOf(snapshot, "C:/proj", (a, b) => a === b));
        return true;
      },
      preserve,
      conflict,
    };
    await mirrorAdoptedSessions(deps);
    // The Working card loads the running session from storage.
    loaded = [{ ...saved!, continuingElsewhere: true }];
    snapshot = finished;
    await mirrorAdoptedSessions(deps);
    expect(preserve).not.toHaveBeenCalled();
    expect(conflict).not.toHaveBeenCalled();
    expect(loaded[0].blocks).toEqual([prompt, complete]);
    expect(loaded[0].continuingElsewhere).toBeUndefined();
  });

  it("does the same without a baseline, e.g. after the app restarted", async () => {
    let current = stored(local({ blocks: [prompt, partial] }));
    const preserve = vi.fn(async () => true);
    await mirrorAdoptedSessions({
      list: async () => [entry({ revision: 6 })],
      load: async () => ({
        ...host({ blocks: [prompt, complete, followUp] }),
        revision: 6,
      }),
      local: () => [current],
      apply: (merged) => {
        current = merged;
      },
      mirrored: new Map(),
      preserve,
    });
    expect(preserve).not.toHaveBeenCalled();
    expect(current.blocks).toEqual([prompt, complete, followUp]);
  });

  it("reports a truncated local reply as the host leading, never as the same transcript", () => {
    const local_ = stored(local({ blocks: [prompt, partial] }));
    const remote = host({ blocks: [prompt, complete] }).session;
    // The host refresh accepts only "local" or "same"; a stale tail must not win.
    expect(adoptedTranscriptLead(local_, remote)).toBe("host");
  });

  it("still treats a differing reply as divergence", () => {
    const other = {
      id: "a1",
      role: "assistant",
      text: "Something else entirely.",
    } as Block;
    expect(
      adoptedTranscriptLead(
        stored(local({ blocks: [prompt, partial] })),
        host({ blocks: [prompt, other] }).session,
      ),
    ).toBeUndefined();
    // Only the tail can be cut short: an earlier truncated block is a real edit.
    expect(
      adoptedTranscriptLead(
        local({
          blocks: [prompt, { ...complete, text: "The cache" }, followUp],
        }),
        host({ blocks: [prompt, complete, followUp] }).session,
      ),
    ).toBeUndefined();
  });

  it("waits for a long transcript to finish loading before comparing it", async () => {
    let current = local({ blocks: [complete], historyLoading: true });
    const load = vi.fn(async () => ({
      ...host({ blocks: [prompt, complete] }),
      revision: 6,
    }));
    const preserve = vi.fn(async () => true);
    await mirrorAdoptedSessions({
      list: async () => [entry({ revision: 6 })],
      load,
      local: () => [current],
      apply: (merged) => {
        current = merged;
      },
      mirrored: new Map(),
      preserve,
    });
    expect(load).not.toHaveBeenCalled();
    expect(preserve).not.toHaveBeenCalled();
    expect(current.blocks).toEqual([complete]);
  });
});

describe("a host turn that just finished", () => {
  it("stays continuing elsewhere until its transcript is applied here", async () => {
    let current = local({ blocks: [block("a")] });
    let listing = entry({ status: "running" });
    let snapshot: HostSession | Error = host(
      { blocks: [block("a")] },
      "running",
    );
    const reported: string[][] = [];
    const deps: AdoptedMirrorDeps = {
      list: async () => [listing],
      load: async () => {
        if (snapshot instanceof Error) throw snapshot;
        return snapshot;
      },
      local: () => [current],
      apply: (merged) => {
        current = merged;
      },
      mirrored: new Map(),
      onRunning: (ids) => reported.push([...ids]),
    };
    await mirrorAdoptedSessions(deps);
    expect(reported.at(-1)).toEqual(["s1"]);
    // Finished on the host, but its transcript could not be fetched yet.
    listing = entry({ revision: 6 });
    snapshot = new Error("offline");
    await mirrorAdoptedSessions(deps);
    expect(reported.at(-1)).toEqual(["s1"]);
    snapshot = { ...host({ blocks: [block("a"), block("b")] }), revision: 6 };
    await mirrorAdoptedSessions(deps);
    expect(reported.at(-1)).toEqual([]);
    expect(current.blocks.map((item) => item.id)).toEqual(["a", "b"]);
  });

  it("is released for an explicit sync once flagged as a conflict", async () => {
    let current = local({
      blocks: [{ id: "a", role: "user", text: "edited here" } as Block],
    });
    const reported: string[][] = [];
    const deps: AdoptedMirrorDeps = {
      list: async () => [entry({ status: "running" })],
      load: async () => host({ blocks: [block("a")] }, "running"),
      local: () => [current],
      apply: vi.fn(),
      mirrored: new Map(),
      onRunning: (ids) => reported.push([...ids]),
      conflict: (session) => {
        current = { ...session, adoptedSyncConflict: true };
      },
    };
    await mirrorAdoptedSessions(deps);
    await mirrorAdoptedSessions({
      ...deps,
      list: async () => [entry({ revision: 6 })],
      load: async () => ({
        ...host({ blocks: [block("a"), block("b")] }),
        revision: 6,
      }),
    });
    expect(reported.at(-1)).toEqual([]);
  });
});

it("hands a finished host turn that keeps failing to arrive to an explicit sync", async () => {
  vi.useFakeTimers();
  try {
    let current = local();
    let listing = entry({ status: "running" });
    const reported: string[][] = [];
    const deps: AdoptedMirrorDeps = {
      list: async () => [listing],
      load: async () => {
        throw new Error("offline");
      },
      local: () => [current],
      apply: vi.fn(),
      mirrored: new Map(),
      onRunning: (ids) => reported.push([...ids]),
      conflict: (session) => {
        current = { ...session, adoptedSyncConflict: true };
      },
    };
    await mirrorAdoptedSessions(deps);
    listing = entry({ revision: 6 });
    await mirrorAdoptedSessions(deps);
    expect(reported.at(-1)).toEqual(["s1"]);
    vi.advanceTimersByTime(61_000);
    await mirrorAdoptedSessions(deps);
    expect(current.adoptedSyncConflict).toBe(true);
    expect(reported.at(-1)).toEqual([]);
  } finally {
    vi.useRealTimers();
  }
});
