import { beforeEach, describe, expect, it, vi } from "vitest";
import { previewSession } from "../../../../host/transcriptPage";
import type { AdoptedDivergence, Attachment, Block, Session } from "../../sessions/model/session";
import type { AdoptedMirrorDeps } from "./adoptedSessions";
import type { HostSession } from "./protocol";
import { planComposerSwitch, withHarnessChoice } from "../../sessions/model/handoff";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

const { keepAdoptedDivergence, mirrorAdoptedSessions, refreshAdoptedSession } =
  await import("./adoptedSessions");
const { getSession, sanitizeSessionForPersist } = await import("../../sessions/data/sessionStore");

/**
 * A conversation started on one computer and continued from another. The
 * transcript is synthetic but shaped like a real one: a message carrying two
 * video attachments and a huge tool output, which the host shrinks before the
 * desktop on the same computer sees them again (`host/transcriptPage.ts`).
 */
const attachments = (): Attachment[] => [
  {
    id: "f1",
    name: "a.mkv",
    mimeType: "video/x-matroska",
    kind: "file",
    size: 9e8,
    path: "D:/v/a.mkv",
  },
  {
    id: "f2",
    name: "b.mkv",
    mimeType: "video/x-matroska",
    kind: "file",
    size: 9e8,
    path: "D:/v/b.mkv",
  },
];
const huge = "output line\n".repeat(40_000);
const longReply = "a long answer. ".repeat(10_000);
function transcript(extra: Block[] = []): Block[] {
  const blocks: Block[] = [];
  for (let i = 0; i < 12; i++) {
    blocks.push({ id: `u${i}`, role: "user", text: `question ${i}` });
    blocks.push({ id: `a${i}`, role: "assistant", text: `answer ${i}` });
  }
  blocks.splice(4, 0, {
    id: "files",
    role: "user",
    text: "see [file1] [file2]",
    attachments: attachments(),
  });
  blocks.splice(7, 0, {
    id: "tool",
    role: "tool",
    text: "Shell",
    tool: { callId: "c", title: "Shell", kind: "execute", status: "completed", output: huge },
  } as Block);
  blocks.splice(10, 0, { id: "long", role: "assistant", text: longReply });
  return [...blocks, ...extra];
}

const desktopSession = (blocks: Block[], over: Partial<Session> = {}): Session =>
  ({
    id: "s1",
    harness: "claude",
    model: "m",
    modelSettings: {},
    runtimeMode: "ask",
    title: "Promo video",
    cwd: "C:/proj",
    providerSessionId: "thread-1",
    blocks,
    ...over,
  }) as Session;
/** What this computer's host sends: its own full copy, shrunk for transport. */
const wireOf = (blocks: Block[], status: HostSession["status"], revision: number): HostSession =>
  previewSession({
    session: desktopSession(blocks, { cwd: "/host/proj" }),
    projectId: "p",
    revision,
    status,
    updatedAt: 10,
  } as HostSession);

const macTurn = (): Block[] => [
  { id: "mac-q", role: "user", text: "pick another model", startedAt: 1 },
  { id: "mac-a", role: "assistant", text: "switched" },
];

/** The desktop app: its loaded sessions and what a mirror pass can do to them. */
function desktop(initial: Session) {
  let current = initial;
  const copies: Session[] = [];
  const flags: AdoptedDivergence[] = [];
  let host: HostSession = wireOf(initial.blocks, "idle", 1);
  // What the mirror remembers between passes; a new map is a restarted app.
  const running = new Map<string, number>();
  const deps = (mirrored = running): AdoptedMirrorDeps => ({
    list: async () => [
      { id: "s1", projectId: "p", revision: host.revision, updatedAt: 10, status: host.status },
    ],
    load: async () => host,
    local: () => [current],
    mirrored,
    apply: (merged) => {
      current = merged;
    },
    preserve: async (copy) => {
      copies.push(copy);
      return true;
    },
    stored: async (id) => copies.find((copy) => copy.id === id) ?? null,
    conflict: (flagged, divergence) => {
      if (flagged.adoptedSyncConflict && flagged.adoptedDivergence?.key === divergence?.key) return;
      if (divergence) flags.push(divergence);
      current = {
        ...flagged,
        adoptedSyncConflict: true,
        ...(divergence ? { adoptedDivergence: divergence } : {}),
      };
    },
  });
  return {
    copies,
    flags,
    session: () => current,
    setHost: (
      blocks: Block[],
      status: HostSession["status"],
      revision: number,
      configuration: Partial<Session> = {},
    ) => {
      host = wireOf(blocks, status, revision);
      host.session = { ...host.session, ...configuration };
    },
    /** The user types in this desktop's own copy. */
    edit: (update: (session: Session) => Session) => {
      current = update(current);
    },
    pass: (mirrored?: Map<string, number>) => mirrorAdoptedSessions(deps(mirrored)),
    /** The user answers the banner (or presses Sync) after the app was reopened. */
    answer: (resolution?: "keep-other" | "keep-both") =>
      refreshAdoptedSession(deps(new Map()), "s1", resolution),
    /** Quit and reopen: the session comes back from the store, with no memory
     * of earlier passes. */
    async restart() {
      const payload = sanitizeSessionForPersist(current);
      invoke.mockImplementation(async (command: string) =>
        command === "session_get" ? { ...payload, createdAt: 1, updatedAt: 2 } : null,
      );
      current = (await getSession("s1"))!;
    },
  };
}

const filePaths = (session: Session) =>
  session.blocks.find((block) => block.id === "files")?.attachments?.map((file) => file.path);

beforeEach(() => invoke.mockReset());

describe("the wire form the desktop reads back from its own host", () => {
  it("really differs from the desktop's copy (guards these tests against drifting from the host)", () => {
    const shrunk = wireOf(transcript(), "idle", 1).session.blocks;
    expect(shrunk.find((block) => block.id === "files")).toMatchObject({
      remoteContent: expect.any(Object),
    });
    expect(filePaths({ blocks: shrunk } as Session)).toEqual([undefined, undefined]);
    expect(shrunk.find((block) => block.id === "tool")?.tool?.output?.length).toBeLessThan(
      huge.length,
    );
    expect(shrunk.find((block) => block.id === "long")?.text.length).toBeLessThan(longReply.length);
  });
});

describe("a conversation with attachments continued from another computer", () => {
  it("restores and mirrors an unsent provider choice before the old host acknowledges it", async () => {
    const original = transcript();
    const app = desktop(desktopSession(original));
    await app.pass();
    app.edit((session) => {
      const plan = planComposerSwitch(session, "codex");
      return {
        ...withHarnessChoice(session, "codex", "gpt", {}),
        ...(plan.kind === "arm" ? { pendingSwitch: plan.pending } : {}),
      };
    });
    await app.restart();
    expect(app.session().pendingContextReplay).toContain("question");
    await app.pass(new Map());
    expect(app.session().id).toBe("s1");
    expect(app.session().harness).toBe("codex");
    expect(app.session().model).toBe("gpt");
    expect(app.session().providerSessionId).toBeUndefined();
    expect(app.session().pendingContextReplay).toContain("question");
    expect(app.session().blocks).toEqual(original);
    expect(app.flags).toHaveLength(0);
    expect(app.copies).toHaveLength(0);
  });
  it("switches providers in the same chat while stale and acknowledged host copies retain all local content", async () => {
    const original = transcript();
    const app = desktop(desktopSession(original));
    await app.pass();
    app.edit((session) => {
      const plan = planComposerSwitch(session, "codex");
      expect(plan.kind).toBe("arm");
      return {
        ...withHarnessChoice(session, "codex", "gpt", { reasoningEffort: "high" }),
        ...(plan.kind === "arm" ? { pendingSwitch: plan.pending } : {}),
      };
    });
    for (const revision of [2, 3]) {
      app.setHost(original, "idle", revision);
      await app.pass();
      expect(app.session().harness).toBe("codex");
      expect(app.session().model).toBe("gpt");
      expect(app.session().pendingSwitch?.from).toBe("claude");
    }
    app.setHost(original, "idle", 4, {
      harness: "codex",
      model: "gpt",
      modelSettings: { reasoningEffort: "high" },
      providerSessionId: undefined,
      pendingContextReplay: "storage-only recovery context",
    });
    await app.pass();
    expect(app.session().id).toBe("s1");
    expect(app.session().blocks).toEqual(original);
    expect(filePaths(app.session())).toEqual(attachments().map((file) => file.path));
    expect(app.session().providerSessionId).toBeUndefined();
    expect(app.session().pendingSwitch?.from).toBe("claude");
    expect(app.session().pendingContextReplay).toBeUndefined();
    expect(app.flags).toHaveLength(0);
    expect(app.copies).toHaveLength(0);
  });
  it("is left alone when nothing changed: no copy, no flag, files kept", async () => {
    const app = desktop(desktopSession(transcript()));
    await app.pass();
    await app.pass();
    expect(app.copies).toHaveLength(0);
    expect(app.flags).toHaveLength(0);
    expect(app.session().adoptedSyncConflict).toBeUndefined();
    expect(filePaths(app.session())).toEqual(["D:/v/a.mkv", "D:/v/b.mkv"]);
  });

  it("takes the other computer's turn without a copy, keeping the files and the full output", async () => {
    const app = desktop(desktopSession(transcript()));
    await app.pass();
    // The other computer sends; the host runs it, then finishes.
    app.setHost([...transcript(), macTurn()[0]], "running", 2);
    await app.pass();
    expect(app.session().continuingElsewhere).toBe(true);
    app.setHost([...transcript(), ...macTurn()], "idle", 3);
    await app.pass();
    await app.pass();
    expect(app.copies).toHaveLength(0);
    expect(app.flags).toHaveLength(0);
    expect(app.session().adoptedSyncConflict).toBeUndefined();
    expect(
      app
        .session()
        .blocks.map((block) => block.id)
        .slice(-2),
    ).toEqual(["mac-q", "mac-a"]);
    expect(filePaths(app.session())).toEqual(["D:/v/a.mkv", "D:/v/b.mkv"]);
    expect(app.session().blocks.find((block) => block.id === "tool")?.tool?.output).toBe(huge);
    expect(app.session().blocks.find((block) => block.id === "long")?.text).toBe(longReply);
    expect(app.session().providerSessionId).toBe("thread-1");
  });

  it("is not copied again by an app restart, however many", async () => {
    const app = desktop(desktopSession(transcript()));
    app.setHost([...transcript(), ...macTurn()], "idle", 3);
    for (let restart = 0; restart < 3; restart++) {
      // Back to the transcript as it was stored before the other computer's turn.
      app.edit(() => desktopSession(transcript()));
      await app.restart();
      await app.pass(new Map());
      await app.pass(new Map());
    }
    expect(app.copies).toHaveLength(0);
    expect(app.flags).toHaveLength(0);
    expect(filePaths(app.session())).toEqual(["D:/v/a.mkv", "D:/v/b.mkv"]);
  });

  it("is not flagged when this desktop ran its own turn the host has not caught up with", async () => {
    const app = desktop(desktopSession(transcript()));
    await app.pass();
    app.edit((session) => ({
      ...session,
      blocks: [
        ...session.blocks,
        { id: "mine-q", role: "user", text: "typed here", startedAt: 5, durationMs: 100 },
        { id: "mine-a", role: "assistant", text: "done here" },
      ],
    }));
    app.setHost(transcript(), "idle", 2);
    await app.pass();
    await app.pass();
    expect(app.copies).toHaveLength(0);
    expect(app.session().adoptedSyncConflict).toBeFalsy();
    expect(
      app
        .session()
        .blocks.map((block) => block.id)
        .slice(-2),
    ).toEqual(["mine-q", "mine-a"]);
  });
});

describe("a genuine conflict", () => {
  /** This desktop and the other computer each continued the same conversation. */
  async function conflicted() {
    const app = desktop(desktopSession(transcript()));
    await app.pass();
    app.setHost([...transcript(), macTurn()[0]], "running", 2);
    await app.pass();
    app.edit((session) => ({
      ...session,
      continuingElsewhere: undefined,
      blocks: [...session.blocks, { id: "mine-q", role: "user", text: "typed here meanwhile" }],
    }));
    app.setHost([...transcript(), ...macTurn()], "idle", 3);
    return app;
  }

  it("is flagged once, never copied, and leaves the local conversation as it was", async () => {
    const app = await conflicted();
    for (let i = 0; i < 4; i++) await app.pass();
    expect(app.copies).toHaveLength(0);
    expect(app.flags).toHaveLength(1);
    expect(app.session().adoptedSyncConflict).toBe(true);
    expect(app.session().blocks.at(-1)?.id).toBe("mine-q");
    expect(app.session().providerSessionId).toBe("thread-1");
    expect(app.session().adoptedDivergence?.keep).toBeUndefined();
  });

  it("is proven again, and still not copied, after the app restarts", async () => {
    const app = await conflicted();
    await app.pass();
    await app.restart();
    // Only the record came back with the session: until a pass reaches the host
    // and proves it, nothing is locked (an unreachable host must not hold sending).
    expect(app.session().adoptedSyncConflict).toBeUndefined();
    expect(app.session().adoptedDivergence?.key).toBeDefined();
    for (let i = 0; i < 3; i++) await app.pass(new Map());
    expect(app.copies).toHaveLength(0);
    expect(app.flags).toHaveLength(2);
    expect(app.session().adoptedSyncConflict).toBe(true);
  });

  it("stays quiet after the user keeps this version, including after a restart", async () => {
    const app = await conflicted();
    await app.pass();
    app.edit(keepAdoptedDivergence);
    expect(app.session().adoptedSyncConflict).toBeUndefined();
    await app.restart();
    expect(app.session().adoptedSyncConflict).toBeUndefined();
    for (let i = 0; i < 3; i++) await app.pass(new Map());
    expect(app.copies).toHaveLength(0);
    expect(app.flags).toHaveLength(1);
    expect(app.session().adoptedSyncConflict).toBeUndefined();
    expect(app.session().adoptedDivergence?.keep).toBe(true);
    expect(app.session().blocks.at(-1)?.id).toBe("mine-q");
  });
});

describe("answering a genuine conflict", () => {
  async function conflicted() {
    const app = desktop(desktopSession(transcript()));
    await app.pass();
    app.setHost([...transcript(), macTurn()[0]], "running", 2);
    await app.pass();
    app.edit((session) => ({
      ...session,
      continuingElsewhere: undefined,
      blocks: [...session.blocks, { id: "mine-q", role: "user", text: "typed here meanwhile" }],
    }));
    app.setHost([...transcript(), ...macTurn()], "idle", 3);
    await app.pass();
    return app;
  }

  it("pressing Sync does not copy anything while the user is choosing", async () => {
    const app = await conflicted();
    await app.restart();
    expect(await app.answer()).toBe(false);
    expect(app.copies).toHaveLength(0);
    expect(app.session().blocks.at(-1)?.id).toBe("mine-q");
    expect(app.session().adoptedSyncConflict).toBe(true);
  });

  it("Keep both after a restart saves one branch with this computer's turn as context, and one provider thread stays with the conversation", async () => {
    const app = await conflicted();
    await app.restart();
    expect(await app.answer("keep-both")).toBe(true);
    expect(app.copies).toHaveLength(1);
    const [branch] = app.copies;
    expect(branch.title).toMatch(/^Promo video \(branch, /);
    expect(branch.blocks.at(-1)?.id).toBe("mine-q");
    expect(branch.pendingContextReplay).toContain("typed here meanwhile");
    // One provider thread, one owner: the branch starts its own on its first turn.
    expect(branch.providerSessionId).toBeUndefined();
    expect(app.session().providerSessionId).toBe("thread-1");
    // The conversation both computers keep is the other computer's, with its files and output intact.
    expect(app.session().blocks.map((block) => block.id)).toEqual(
      [...transcript(), ...macTurn()].map((block) => block.id),
    );
    expect(filePaths(app.session())).toEqual(["D:/v/a.mkv", "D:/v/b.mkv"]);
    expect(app.session().adoptedSyncConflict).toBeUndefined();
    expect(app.session().adoptedDivergence).toBeUndefined();
    // Settled for good: further passes, a restart and a repeated answer add nothing.
    await app.restart();
    for (let i = 0; i < 3; i++) await app.pass(new Map());
    await app.answer("keep-both");
    expect(app.copies).toHaveLength(1);
    expect(app.flags).toHaveLength(1);
    expect(app.session().adoptedSyncConflict).toBeUndefined();
  });

  it("Keep other replaces this computer's turn without a copy and settles both sides", async () => {
    const app = await conflicted();
    expect(await app.answer("keep-other")).toBe(false);
    expect(app.copies).toHaveLength(0);
    expect(app.session().blocks.map((block) => block.id)).not.toContain("mine-q");
    expect(app.session().adoptedSyncConflict).toBeUndefined();
    for (let i = 0; i < 3; i++) await app.pass(new Map());
    expect(app.copies).toHaveLength(0);
    expect(app.flags).toHaveLength(1);
  });

  it("Keep this, then a restart, then a pass leaves this version in place for the host to take", async () => {
    const app = await conflicted();
    app.edit(keepAdoptedDivergence);
    await app.restart();
    await app.pass(new Map());
    expect(app.copies).toHaveLength(0);
    expect(app.session().blocks.at(-1)?.id).toBe("mine-q");
    // Answered, and remembered as answered: the host catches up from this version.
    expect(app.session().adoptedDivergence?.keep).toBe(true);
    expect(app.session().adoptedSyncConflict).toBeUndefined();
  });
});

describe("typing on the desktop during a turn the other computer runs", () => {
  it("queues the message and neither flags nor copies the conversation when the turn ends", async () => {
    const app = desktop(desktopSession(transcript()));
    await app.pass();
    app.setHost([...transcript(), macTurn()[0]], "running", 2);
    await app.pass();
    // The send was queued (the run lease was held, or the turn already showed as running).
    app.edit((session) => ({
      ...session,
      continuingElsewhere: true,
      queuedMessages: [{ id: "q1", text: "typed on the desktop", attachments: [] }],
    }));
    app.setHost([...transcript(), ...macTurn()], "idle", 3);
    for (let i = 0; i < 3; i++) await app.pass();
    expect(app.copies).toHaveLength(0);
    expect(app.flags).toHaveLength(0);
    expect(app.session().adoptedSyncConflict).toBeUndefined();
    expect(app.session().blocks.map((block) => block.id)).toEqual(
      [...transcript(), ...macTurn()].map((block) => block.id),
    );
    // The message waits in the queue for the dispatcher; nothing was lost or sent twice.
    expect(app.session().queuedMessages?.map((row) => row.text)).toEqual(["typed on the desktop"]);
  });
});
