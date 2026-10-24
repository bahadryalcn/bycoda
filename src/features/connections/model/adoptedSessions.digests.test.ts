import { describe, expect, it, vi } from "vitest";
import { previewBlock } from "../../../../host/transcriptPage";
import type { Block, Session } from "../../sessions/model/session";
import { blockDigest, conversationHead } from "../../sync/model/conversationDigest";
import {
  adoptedBranchId,
  adoptedDivergenceKey,
  adoptedLocalAhead,
  desktopCopyOf,
  keepAdoptedDivergence,
  mergeAdoptedSession,
  mirrorAdoptedSessions,
  planAdoptedFetches,
  refreshAdoptedSession,
  type AdoptedEntry,
  type AdoptedMirrorDeps,
} from "./adoptedSessions";
import type { HostSession } from "./protocol";

const user = (id: string, text = id): Block => ({ id, role: "user", text });
const reply = (id: string, text = id): Block => ({ id, role: "assistant", text });
const session = (blocks: Block[], over: Partial<Session> = {}): Session =>
  ({
    id: "s1",
    harness: "claude",
    model: "m",
    modelSettings: {},
    runtimeMode: "ask",
    title: "Title",
    cwd: "C:/proj",
    blocks,
    ...over,
  }) as Session;
/** What the host sends when asked for digests: a head, and shrunk blocks that carry the
 * digest of the full block. */
const hostOf = (
  blocks: Block[],
  over: { status?: HostSession["status"]; revision?: number; head?: boolean } = {},
): HostSession => ({
  session: session(blocks, { cwd: "/other" }),
  projectId: "p",
  revision: over.revision ?? 5,
  status: over.status ?? "idle",
  updatedAt: 10,
  ...(over.head === false ? {} : { head: conversationHead(blocks) }),
});
const shrink = (block: Block, text: string): Block => ({
  ...block,
  text,
  remoteContent: { revision: 5, bytes: 9_999, digest: blockDigest(block) },
});
const entry = (over: Partial<AdoptedEntry> = {}): AdoptedEntry => ({
  id: "s1",
  projectId: "p",
  revision: 5,
  updatedAt: 10,
  status: "idle",
  ...over,
});

describe("merging with digests", () => {
  const big: Block = {
    id: "t",
    role: "tool",
    text: "",
    tool: { id: "t1", name: "Bash", status: "done", output: "line\n".repeat(30_000) },
  } as unknown as Block;
  const withFile: Block = {
    id: "f",
    role: "user",
    text: "[file1]",
    attachments: [
      {
        id: "f1",
        name: "clip.mkv",
        mimeType: "video/x-matroska",
        kind: "file",
        size: 9,
        path: "C:/files/clip.mkv",
      },
    ],
  };

  it("keeps this desktop's full block when the host sent only a shrunk block of the same digest", () => {
    const wire = [
      shrink(withFile, "[file1]"),
      { ...shrink(big, ""), tool: { ...(big.tool as object), output: "line\nline\n…" } } as Block,
      reply("r"),
    ];
    const merged = mergeAdoptedSession(session([withFile, big]), hostOf(wire))!;
    expect(merged.blocks[0]).toBe(withFile);
    expect(merged.blocks[1]).toBe(big);
    expect(merged.blocks[2]).toBe(wire[2]);
    // Both now hold the host's transcript.
    expect(merged.adoptedBase).toEqual(hostOf(wire).head);
  });

  it("keeps everything, including quit notices, when the transcripts are the same", () => {
    const mine = session([user("u"), reply("r")]);
    const merged = mergeAdoptedSession(mine, hostOf([user("u"), reply("r")]))!;
    expect(merged.blocks).toBe(mine.blocks);
    expect(merged.adoptedBase).toEqual(conversationHead(mine.blocks));
  });

  it("takes the host's blocks when it moved on and this computer has not since the base", () => {
    const base = conversationHead([user("u")])!;
    const rewound = hostOf([]);
    const merged = mergeAdoptedSession(session([user("u")], { adoptedBase: base }), rewound)!;
    expect(merged.blocks).toEqual([]);
    // Without a base a host reset is not told apart from a host that lags.
    expect(mergeAdoptedSession(session([user("u")]), rewound)).toBeUndefined();
  });

  it("leaves a transcript this computer extended to the host to catch up", () => {
    const base = conversationHead([user("u")])!;
    const mine = session([user("u"), reply("r")], { adoptedBase: base });
    expect(mergeAdoptedSession(mine, hostOf([user("u")]))).toBeUndefined();
    expect(adoptedLocalAhead(mine, hostOf([user("u")]))).toBe(true);
  });

  it("refuses to merge when both appended after the same base", () => {
    const base = conversationHead([user("u")])!;
    const mine = session([user("u"), user("desk")], { adoptedBase: base });
    const theirs = hostOf([user("u"), user("phone")]);
    expect(mergeAdoptedSession(mine, theirs)).toBeUndefined();
    expect(adoptedLocalAhead(mine, theirs)).toBe(false);
  });

  it("falls back to comparing content when the host sent no digests for a shrunk block", () => {
    const wire = [{ ...withFile, remoteContent: { revision: 5, bytes: 99 } }, reply("r")];
    const merged = mergeAdoptedSession(session([withFile]), hostOf(wire, { head: false }))!;
    expect(merged.blocks[0]).toBe(withFile);
    expect(merged.blocks).toHaveLength(2);
    // Nothing is claimed as agreed when it could not be judged by digests.
    expect(merged.adoptedBase).toBeUndefined();
  });

  it("does not trust digests the host's own head does not vouch for", () => {
    const wire = [user("u"), reply("r")];
    const lying = { ...hostOf(wire), head: { count: 2, chain: "f".repeat(32) } };
    const merged = mergeAdoptedSession(session([user("u")]), lying)!;
    expect(merged.blocks).toHaveLength(2);
    expect(merged.adoptedBase).toBeUndefined();
  });

  it("keeps the saved base through a merge whose local turn was kept over a stale host copy", () => {
    const base = conversationHead([user("u")])!;
    const open = {
      id: "t",
      role: "tool",
      text: "",
      streaming: true,
      tool: { status: "in_progress" },
    };
    const sealed = { ...open, streaming: false, tool: { status: "cancelled" } };
    const mine = session([user("u"), sealed as Block], { adoptedBase: base });
    const merged = mergeAdoptedSession(mine, hostOf([user("u"), open as Block]));
    // The host is a turn behind and does not hold what was kept.
    expect(merged === undefined || merged.blocks === mine.blocks).toBe(true);
  });

  it("starts a copy adopted from the host at the host's head", () => {
    const theirs = hostOf([user("u"), shrink(withFile, "[file1]")]);
    const copy = desktopCopyOf(theirs, "C:/proj", (a, b) => a === b);
    expect(copy.adoptedBase).toEqual(theirs.head);
    expect(
      desktopCopyOf(hostOf([user("u")], { head: false }), "C:/proj", () => true).adoptedBase,
    ).toEqual(conversationHead([user("u")]));
    const unjudged = desktopCopyOf(
      hostOf([{ ...withFile, remoteContent: { revision: 1, bytes: 5 } }], { head: false }),
      "C:/proj",
      () => true,
    );
    expect(unjudged.adoptedBase).toBeUndefined();
  });
});

describe("the mirror with a persisted base", () => {
  function mirror(initial: Session, remote: () => HostSession) {
    let current = initial;
    const conflict = vi.fn();
    const preserve = vi.fn(async () => true);
    const apply = vi.fn((merged: Session) => {
      current = merged;
    });
    const deps = (mirrored = new Map<string, number>()): AdoptedMirrorDeps => ({
      list: async () => [entry({ revision: remote().revision })],
      load: async () => remote(),
      local: () => [current],
      apply,
      mirrored,
      conflict,
      preserve,
    });
    return { deps, conflict, preserve, apply, current: () => current };
  }

  it("remembers what was agreed across a restart, so a lagging host is not a divergence", async () => {
    const base = [user("u"), reply("r")];
    const m = mirror(
      session([...base, user("desk")], { adoptedBase: conversationHead(base) }),
      () => hostOf(base),
    );
    for (const _restart of [1, 2, 3]) {
      const mirrored = new Map<string, number>();
      await mirrorAdoptedSessions(m.deps(mirrored));
      expect(mirrored.get("s1")).toBe(5);
    }
    expect(m.conflict).not.toHaveBeenCalled();
    expect(m.preserve).not.toHaveBeenCalled();
    expect(m.apply).not.toHaveBeenCalled();
  });

  it("takes host progress when this computer has not changed since the base, and records it", async () => {
    const base = [user("u")];
    const theirs = [user("u"), user("phone"), reply("answer")];
    const m = mirror(session(base, { adoptedBase: conversationHead(base) }), () => hostOf(theirs));
    await mirrorAdoptedSessions(m.deps());
    expect(m.current().blocks.map((b) => b.id)).toEqual(["u", "phone", "answer"]);
    expect(m.current().adoptedBase).toEqual(conversationHead(theirs));
    expect(m.conflict).not.toHaveBeenCalled();
  });

  it("flags a genuine conflict once, with the host's head, and never copies", async () => {
    const base = [user("u")];
    const m = mirror(
      session([...base, user("desk")], { adoptedBase: conversationHead(base) }),
      () => hostOf([...base, user("phone")]),
    );
    await mirrorAdoptedSessions(m.deps());
    await mirrorAdoptedSessions(m.deps());
    expect(m.preserve).not.toHaveBeenCalled();
    expect(m.apply).not.toHaveBeenCalled();
    const [, flagged] = m.conflict.mock.calls[0]!;
    expect(flagged).toEqual({
      key: expect.stringMatching(/^heads:/),
      hostHead: conversationHead([...base, user("phone")]),
    });
    // The same divergence has the same key on every pass.
    expect(m.conflict.mock.calls.every(([, divergence]) => divergence.key === flagged.key)).toBe(
      true,
    );
  });

  it("converges once the user keeps this version: the host is then the side that is behind", async () => {
    const base = [user("u")];
    const hostBlocks = [...base, user("phone")];
    const flagged = session([...base, user("desk")], {
      adoptedBase: conversationHead(base),
      adoptedSyncConflict: true,
      adoptedDivergence: { key: "k", hostHead: conversationHead(hostBlocks) },
    });
    const kept = keepAdoptedDivergence(flagged);
    expect(kept.adoptedBase).toEqual(conversationHead(hostBlocks));
    expect(kept.adoptedSyncConflict).toBeUndefined();
    const m = mirror(kept, () => hostOf(hostBlocks));
    const mirrored = new Map<string, number>();
    await mirrorAdoptedSessions(m.deps(mirrored));
    // Nothing flagged, nothing replaced: the host catches up from this computer,
    // and the answered divergence is retired.
    expect(m.conflict).not.toHaveBeenCalled();
    expect(m.preserve).not.toHaveBeenCalled();
    expect(m.current().blocks).toBe(kept.blocks);
    // The answer stands until both computers hold the same transcript: the host
    // may still add to what was discarded before it catches up.
    expect(m.current().adoptedDivergence).toEqual({ key: "k", keep: true });
    expect(m.current().adoptedBase).toEqual(conversationHead(hostBlocks));
    expect(mirrored.get("s1")).toBe(5);
  });

  describe("after Keep this", () => {
    const base = [user("u")];
    const seen = [...base, user("phone")];
    const kept = () =>
      keepAdoptedDivergence(
        session([...base, user("desk")], {
          adoptedBase: conversationHead(base),
          adoptedSyncConflict: true,
          adoptedDivergence: { key: "k", hostHead: conversationHead(seen) },
        }),
      );

    it("holds while the host only keeps appending after the head the user saw", async () => {
      let revision = 5;
      let theirs = seen;
      const m = mirror(kept(), () => hostOf(theirs, { revision }));
      const mirrored = new Map<string, number>();
      // The host has not caught up yet, then streams on after the version discarded.
      for (const extra of [
        [],
        [user("m1")],
        [user("m1"), reply("m2")],
        [user("m1"), reply("m2", "m2 grown")],
      ]) {
        theirs = [...seen, ...extra];
        revision++;
        await mirrorAdoptedSessions(m.deps(mirrored));
        expect(mirrored.get("s1")).toBe(revision);
      }
      expect(m.conflict).not.toHaveBeenCalled();
      expect(m.preserve).not.toHaveBeenCalled();
      expect(m.current().blocks.at(-1)?.id).toBe("desk");
      expect(m.current().adoptedDivergence?.keep).toBe(true);
    });

    it("asks again when the host no longer contains the version the user saw", async () => {
      const m = mirror(kept(), () =>
        hostOf([...base, user("phone", "edited later"), user("more")], { revision: 7 }),
      );
      await mirrorAdoptedSessions(m.deps());
      expect(m.conflict).toHaveBeenCalledOnce();
      const rewound = mirror(kept(), () => hostOf([user("other")], { revision: 8 }));
      await mirrorAdoptedSessions(rewound.deps());
      expect(rewound.conflict).toHaveBeenCalledOnce();
    });
  });

  it("an explicit refresh of two changed versions flags them once: no copy, nothing replaced", async () => {
    const base = [user("u")];
    const theirs = [...base, user("phone")];
    const mine = session([...base, user("desk")], { adoptedBase: conversationHead(base) });
    const m = mirror(mine, () => hostOf(theirs));
    const deps = { ...m.deps(new Map()), list: async () => [entry()] };
    expect(await refreshAdoptedSession(deps, "s1")).toBe(false);
    expect(m.preserve).not.toHaveBeenCalled();
    expect(m.current()).toBe(mine);
    expect(m.conflict).toHaveBeenCalledOnce();
    expect(m.conflict.mock.calls[0]![1].hostHead).toEqual(conversationHead(theirs));
  });

  it("keeping both saves one branch, and both sides then agree on the host's transcript", async () => {
    const base = [user("u")];
    const theirs = [...base, user("phone")];
    const m = mirror(
      session([...base, user("desk")], {
        adoptedBase: conversationHead(base),
        providerSessionId: "desk-thread",
        adoptedSyncConflict: true,
        adoptedDivergence: { key: "k", hostHead: conversationHead(theirs) },
      }),
      () => {
        const host = hostOf(theirs);
        return { ...host, session: { ...host.session, providerSessionId: "host-thread" } };
      },
    );
    const mirrored = new Map<string, number>();
    const deps = { ...m.deps(mirrored), list: async () => [entry()] };
    expect(await refreshAdoptedSession(deps, "s1", "keep-both")).toBe(true);
    expect(m.preserve).toHaveBeenCalledOnce();
    const branch = m.preserve.mock.calls[0]![0] as Session;
    // The branch keeps this computer's turns and their context, with no provider thread.
    expect(branch.blocks.map((b) => b.id)).toEqual(["u", "desk"]);
    expect(branch.providerSessionId).toBeUndefined();
    expect(branch.pendingContextReplay).toContain("desk");
    // The conversation both computers keep: the host's transcript and the host's one provider thread.
    expect(m.current().blocks.map((b) => b.id)).toEqual(["u", "phone"]);
    expect(m.current().providerSessionId).toBe("host-thread");
    expect(m.current().adoptedBase).toEqual(conversationHead(theirs));
    expect(m.current().adoptedSyncConflict).toBeUndefined();
    expect(m.current().adoptedDivergence).toBeUndefined();
    // Nothing is left to ask about on the next pass or after a restart.
    m.conflict.mockClear();
    await mirrorAdoptedSessions({ ...m.deps(new Map()), list: async () => [entry()] });
    expect(m.conflict).not.toHaveBeenCalled();
    expect(m.preserve).toHaveBeenCalledOnce();
  });

  it("does not fork on a host whose shrunk blocks carry digests, however often the app restarts", async () => {
    const file: Block = {
      id: "f",
      role: "user",
      text: "[file1]",
      attachments: [
        {
          id: "f1",
          name: "a.mkv",
          mimeType: "video/x-matroska",
          kind: "file",
          size: 9,
          path: "C:/files/a.mkv",
        },
      ],
    };
    // An attachment the wire form cannot express as a prefix of the full one.
    const wireFile: Block = {
      ...file,
      attachments: [
        { id: "f1", name: "a.mkv", mimeType: "video/x-matroska", kind: "file", size: 9 },
      ],
      remoteContent: { revision: 5, bytes: 4_000, digest: blockDigest(file) },
    };
    const m = mirror(session([user("u"), file]), () => hostOf([user("u"), wireFile]));
    for (const _restart of [1, 2, 3]) await mirrorAdoptedSessions(m.deps());
    expect(m.preserve).not.toHaveBeenCalled();
    expect(m.conflict).not.toHaveBeenCalled();
    expect(m.current().blocks[1]).toBe(file);
    expect(m.current().adoptedBase).toEqual(conversationHead([user("u"), file]));
  });
});

describe("a flagged conversation nobody has answered", () => {
  it("is compared again at most every few seconds while the host keeps changing", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1_000_000);
    try {
      const base = [user("u")];
      let current = session([...base, user("desk")], { adoptedBase: conversationHead(base) });
      let revision = 5;
      let loads = 0;
      const mirrored = new Map<string, number>();
      const pass = () =>
        mirrorAdoptedSessions({
          list: async () => [entry({ revision })],
          load: async () => {
            loads++;
            return hostOf([...base, user("phone"), reply(`r${revision}`)], { revision });
          },
          local: () => [current],
          apply: (merged) => {
            current = merged;
          },
          mirrored,
          conflict: (flagged, divergence) => {
            if (flagged.adoptedSyncConflict && flagged.adoptedDivergence?.key === divergence?.key)
              return;
            current = {
              ...flagged,
              adoptedSyncConflict: true,
              ...(divergence ? { adoptedDivergence: divergence } : {}),
            };
          },
        } as AdoptedMirrorDeps);
      await pass();
      expect(loads).toBe(1);
      expect(current.adoptedSyncConflict).toBe(true);
      // The host's heartbeat names it again and again: no fetch within the window.
      for (let i = 0; i < 4; i++) {
        revision++;
        vi.setSystemTime(Date.now() + 1_000);
        await pass();
      }
      expect(loads).toBe(1);
      // Once the window has passed, the newest host change is looked at.
      vi.setSystemTime(Date.now() + 5_000);
      await pass();
      expect(loads).toBe(2);
      // Nothing moved on either side since: it is not looked at again.
      vi.setSystemTime(Date.now() + 60_000);
      await pass();
      expect(loads).toBe(2);
      // A local edit is a change worth comparing.
      current = { ...current, blocks: [...current.blocks, user("desk2")] };
      await pass();
      expect(loads).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("divergence key", () => {
  it("is the heads of the base and both sides, and the same on every pass", () => {
    const base = conversationHead([user("u")])!;
    const mine = session([user("u"), user("desk")], { adoptedBase: base });
    const theirs = hostOf([user("u"), user("phone")]).session;
    const key = adoptedDivergenceKey(mine, theirs);
    expect(key).toMatch(/^heads:/);
    expect(adoptedDivergenceKey(mine, theirs)).toBe(key);
    expect(adoptedDivergenceKey({ ...mine, title: "Renamed" }, theirs)).toBe(key);
  });
});

describe("a changed host block is never hidden behind its shrunk preview", () => {
  const file = {
    id: "f1",
    name: "a.png",
    mimeType: "image/png",
    kind: "image" as const,
    size: 10,
    path: "C:/files/a.png",
  };
  const queued: Block = {
    id: "u2",
    role: "user",
    text: "queued",
    draft: true,
    followUpDelivery: "pending",
    attachments: [file],
  } as Block;
  /** What the host holds after it delivered the message: the flags are gone. */
  const delivered: Block = { id: "u2", role: "user", text: "queued", attachments: [file] };
  const shared = user("u1");

  it("takes the host's block when it dropped a flag the preview cannot show (digests)", () => {
    const wire = [shared, previewBlock(delivered, 5, true)];
    expect(wire[1]!.remoteContent?.digest).toBeDefined();
    const mine = session([shared, queued], { adoptedBase: conversationHead([shared, queued]) });
    const host = hostOf(wire);
    const merged = mergeAdoptedSession(mine, host)!;
    expect(merged.blocks[1]).not.toBe(queued);
    expect(merged.blocks[1]!.draft).toBeUndefined();
    expect(merged.blocks[1]!.followUpDelivery).toBeUndefined();
    // The files this computer holds stay with the attachment it still shows.
    expect(merged.blocks[1]!.attachments?.[0]?.path).toBe(file.path);
    expect(merged.adoptedBase).toEqual(host.head);
  });

  it("takes the host's block when a tool output changed beyond the preview clip (digests)", () => {
    const tool = (output: string): Block =>
      ({
        id: "t",
        role: "tool",
        text: "Shell",
        tool: { callId: "c", title: "Shell", kind: "execute", status: "completed", output },
      }) as Block;
    const stale = tool("x".repeat(200_000));
    // The host's output was cut back: its clipped preview is a prefix of the stale one.
    const wire = [shared, previewBlock(tool("x".repeat(100_000)), 5, true)];
    const mine = session([shared, stale], { adoptedBase: conversationHead([shared, stale]) });
    const host = hostOf(wire);
    const merged = mergeAdoptedSession(mine, host)!;
    expect(merged.blocks[1]).toBe(wire[1]);
    expect(merged.blocks[1]).not.toBe(stale);
    // The base moves only past what was taken.
    expect(merged.adoptedBase).toEqual(host.head);
  });

  it("compares the legacy path (no digests) as strictly: a dropped flag is a different block", () => {
    const wire = [shared, previewBlock(delivered, 5)];
    const mine = session([shared, queued]);
    const host = hostOf(wire, { head: false });
    const merged = mergeAdoptedSession(mine, host, mine);
    expect(merged?.blocks[1]!.draft).toBeUndefined();
    expect(merged?.blocks[1]!.attachments?.[0]?.path).toBe(file.path);
    // Without a baseline it is no longer excused as the same message.
    expect(mergeAdoptedSession(mine, host)).toBeUndefined();
  });

  it("keeps the local block, and agrees on the host's head, when the digests are the same", () => {
    const wire = [shared, previewBlock(queued, 5, true)];
    const same = hostOf(wire);
    const merged = mergeAdoptedSession(session([shared, queued]), same)!;
    expect(merged.blocks[1]).toBe(queued);
    expect(merged.adoptedBase).toEqual(same.head);
  });
});

describe("answering a conflict twice makes one branch", () => {
  it("names the branch by the key the user answered, not by the host's state at retry", async () => {
    const base = [user("u")];
    let theirs = [...base, user("phone")];
    let current = session([...base, user("desk")], {
      adoptedBase: conversationHead(base),
      adoptedSyncConflict: true,
      adoptedDivergence: { key: "answered-key", hostHead: conversationHead(theirs) },
    });
    const preserve = vi.fn(async (_copy: Session) => true);
    const deps = (): AdoptedMirrorDeps => ({
      list: async () => [entry()],
      load: async () => hostOf(theirs),
      local: () => [current],
      apply: (merged) => {
        current = merged;
      },
      mirrored: new Map(),
      preserve,
    });
    expect(await refreshAdoptedSession(deps(), "s1", "keep-both")).toBe(true);
    const first = preserve.mock.calls[0]![0].id;
    expect(first).toBe(adoptedBranchId("s1", "answered-key"));
    // The retry runs against a host that moved on since: the computed key differs.
    current = session([...base, user("desk")], {
      adoptedBase: conversationHead(base),
      adoptedSyncConflict: true,
      adoptedDivergence: { key: "answered-key" },
    });
    theirs = [...base, user("phone"), user("phone-2")];
    expect(adoptedDivergenceKey(current, hostOf(theirs).session)).not.toBe("answered-key");
    const stored = new Map<string, Session>([[first, session([], { id: first })]]);
    await refreshAdoptedSession(
      { ...deps(), stored: async (id) => stored.get(id) ?? null },
      "s1",
      "keep-both",
    );
    // Found, not made again.
    expect(preserve).toHaveBeenCalledOnce();
  });

  it("names it by the computed key when nothing was saved with the session", async () => {
    const base = [user("u")];
    const theirs = [...base, user("phone")];
    let current = session([...base, user("desk")], { adoptedBase: conversationHead(base) });
    const preserve = vi.fn(async (_copy: Session) => true);
    await refreshAdoptedSession(
      {
        list: async () => [entry()],
        load: async () => hostOf(theirs),
        local: () => [current],
        apply: (merged) => {
          current = merged;
        },
        mirrored: new Map(),
        preserve,
      },
      "s1",
      "keep-both",
    );
    expect(preserve.mock.calls[0]![0].id).toBe(
      adoptedBranchId(
        "s1",
        adoptedDivergenceKey(
          session([...base, user("desk")], { adoptedBase: conversationHead(base) }),
          hostOf(theirs).session,
        ),
      ),
    );
  });
});

describe("a divergence restored from storage", () => {
  it("is fetched again to be proven, and a settled one is not", () => {
    const unproven = session([user("u")], { adoptedDivergence: { key: "k" } });
    const proven = { ...unproven, adoptedSyncConflict: true };
    const answered = { ...unproven, adoptedDivergence: { key: "k", keep: true as const } };
    const mirrored = new Map([["s1", 5]]);
    const plan = (local: Session) => planAdoptedFetches([entry()], [local], mirrored);
    expect(plan(unproven)).toHaveLength(1);
    expect(plan(proven)).toHaveLength(0);
    expect(plan(answered)).toHaveLength(0);
    expect(plan(session([user("u")]))).toHaveLength(0);
  });
});
