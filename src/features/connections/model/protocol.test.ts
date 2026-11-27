import { expect, it } from "vitest";
import {
  applySessionSync,
  applyStreamSync,
  HOST_PROTOCOL_VERSION,
  protocolMismatchMessage,
  requestPartialSync,
  requireHostDescriptor,
  sessionReferenceKey,
  type HostSession,
  type SessionSync,
} from "./protocol";

const known: HostSession = {
  projectId: "project",
  revision: 4,
  status: "running",
  updatedAt: 0,
  session: {
    id: "session",
    harness: "codex",
    model: "codex:test",
    modelSettings: {},
    runtimeMode: "supervised",
    cwd: "/host/repo",
    title: "Work",
    busy: true,
    blocks: [
      { id: "user", role: "user", text: "Do it" },
      { id: "reply", role: "assistant", text: "Work", streaming: true },
    ],
  },
};

it("keeps host identities distinct even when session IDs collide", () => {
  expect(sessionReferenceKey({ environmentId: "mac", sessionId: "s" })).not.toBe(
    sessionReferenceKey({ environmentId: "windows", sessionId: "s" }),
  );
});

it("updates and deletes within partial history without requiring unloaded blocks", () => {
  const partial = {
    ...known,
    history: { before: 100, revision: 4, totalBlocks: 102 },
  };
  const next = applySessionSync(partial, {
    kind: "delta",
    partial: true,
    base: 4,
    value: {
      ...known,
      revision: 5,
      history: { before: 99, revision: 5, totalBlocks: 101 },
    },
    blockIds: ["reply"],
    blocks: [{ id: "reply", role: "assistant", text: "continued" }],
  });
  expect(next.session.blocks.map((block) => block.id)).toEqual(["reply"]);
  expect(next.history?.before).toBe(99);
  expect(() =>
    applySessionSync(partial, {
      kind: "delta",
      base: 4,
      value: known,
      blockIds: [],
      blocks: [],
    }),
  ).toThrow("Full delta");
});

it("applies changed blocks and keeps unchanged ones", () => {
  const next = applySessionSync(known, {
    kind: "delta",
    base: 4,
    value: {
      ...known,
      revision: 6,
      session: { ...known.session, busy: false },
    },
    blockIds: ["user", "reply", "done"],
    blocks: [
      { id: "reply", role: "assistant", text: "Work done" },
      { id: "done", role: "system", text: "Finished" },
    ],
  });
  expect(next.revision).toBe(6);
  expect(next.session.busy).toBe(false);
  expect(next.session.blocks.map((block) => block.text)).toEqual([
    "Do it",
    "Work done",
    "Finished",
  ]);
  expect(next.session.blocks[0]).toBe(known.session.blocks[0]);
});

it("returns the known value when nothing changed", () => {
  expect(applySessionSync(known, { kind: "unchanged", revision: 4 })).toBe(known);
});

it("keeps an unchanged preview expandable after a status-only revision", () => {
  const preview = {
    ...known.session.blocks[1]!,
    remoteContent: { revision: 4, bytes: 200000 },
  };
  const partial = {
    ...known,
    history: { before: 100, revision: 4, totalBlocks: 102 },
    session: { ...known.session, blocks: [known.session.blocks[0]!, preview] },
  };
  const next = applySessionSync(partial, {
    kind: "delta",
    partial: true,
    base: 4,
    value: {
      ...known,
      revision: 5,
      status: "idle",
      history: { before: 100, revision: 5, totalBlocks: 102 },
    },
    blockIds: ["user", "reply"],
    blocks: [],
  });
  // The unchanged preview keeps its object; the full-content read pins the
  // session's current revision (RemoteSession `loadLargeRemoteBlock`).
  expect(next.session.blocks[1]).toBe(preview);
  expect(next.session.blocks[0]).toBe(partial.session.blocks[0]);
  expect(preview.remoteContent.revision).toBe(4);
  expect(next.revision).toBe(5);
});

it("rejects deltas that do not apply, so the caller loads a snapshot", () => {
  expect(() => applySessionSync(known, { kind: "unchanged", revision: 3 })).toThrow();
  expect(() =>
    applySessionSync(known, {
      kind: "delta",
      base: 4,
      value: { ...known, revision: 5 },
      blockIds: ["user", "unknown"],
      blocks: [],
    }),
  ).toThrow();
  expect(() => applySessionSync(undefined, { kind: "unchanged", revision: 4 })).toThrow();
});

it("keeps a Host with unknown providers reachable and offers only the known ones", () => {
  const descriptor = requireHostDescriptor({
    protocolVersion: HOST_PROTOCOL_VERSION,
    environmentId: "env",
    name: "mac",
    providers: ["codex", "future-provider" as never, "claude"],
    capabilities: [],
  });
  expect(descriptor.providers).toEqual(["codex", "claude"]);
});

it("names the side to update when protocol versions differ", () => {
  const base = { environmentId: "env", name: "mac", providers: [], capabilities: [] };
  expect(() =>
    requireHostDescriptor({ ...base, protocolVersion: HOST_PROTOCOL_VERSION + 1 }),
  ).toThrow(/Update this app/);
  expect(() =>
    requireHostDescriptor({ ...base, protocolVersion: HOST_PROTOCOL_VERSION - 1 }),
  ).toThrow(/Update the bycoda Host/);
  expect(protocolMismatchMessage(HOST_PROTOCOL_VERSION, HOST_PROTOCOL_VERSION)).toBeNull();
  expect(protocolMismatchMessage(undefined, HOST_PROTOCOL_VERSION)).toMatch(
    /Update the bycoda Host/,
  );
});

const windowed = (ids: string[], before: number | undefined, revision = 4): HostSession => ({
  ...known,
  revision,
  history: { before, revision, totalBlocks: 10 },
  session: {
    ...known.session,
    blocks: ids.map((id) => ({ id, role: "assistant", text: id })),
  },
});
const { blocks: _knownBlocks, ...knownSession } = known.session;
const streamDelta = (ids: string[], before: number, changed: string[]): SessionSync => ({
  kind: "delta",
  partial: true,
  base: 4,
  value: {
    ...known,
    revision: 5,
    history: { before, revision: 5, totalBlocks: 11 },
    session: knownSession,
  },
  blockIds: ids,
  blocks: changed.map((id) => ({ id, role: "assistant", text: `${id}!` })),
});

it("rebases a tail stream's partial delta onto the window the client holds", () => {
  // The client only holds a later window than the stream's.
  const later = applyStreamSync(
    windowed(["w3", "w4"], 5),
    streamDelta(["w2", "w3", "w4", "w5"], 4, ["w5"]),
  );
  expect(later.session.blocks.map((block) => block.id)).toEqual(["w3", "w4", "w5"]);
  expect(later.history).toEqual({ before: 5, revision: 5, totalBlocks: 11 });
  // The client paged older history than the stream's window: it keeps those blocks.
  const older = applyStreamSync(
    windowed(["o1", "w2", "w3"], 2),
    streamDelta(["w2", "w3", "w4"], 4, ["w4"]),
  );
  expect(older.session.blocks.map((block) => block.id)).toEqual(["o1", "w2", "w3", "w4"]);
  expect(older.history).toEqual({ before: 2, revision: 5, totalBlocks: 11 });
  expect(() => applyStreamSync(windowed(["x1"], 8), streamDelta(["w2", "w3"], 4, []))).toThrow(
    "overlap",
  );
  expect(() =>
    applyStreamSync(windowed(["w2"], 4, 3), streamDelta(["w2", "w3"], 4, ["w3"])),
  ).toThrow("base");
});

it("partial sync asks with the first loaded id and resends the full window after a snapshot", async () => {
  const loaded: HostSession = {
    ...known,
    history: { before: 0, revision: 4, totalBlocks: 3 },
    session: {
      ...known.session,
      blocks: [
        { id: "a", role: "user", text: "a" },
        { id: "b", role: "assistant", text: "b" },
        { id: "c", role: "assistant", text: "c" },
      ],
    },
  };
  const sent: string[][] = [];
  const unchanged = await requestPartialSync(loaded, async (ids) => {
    sent.push(ids);
    return { kind: "unchanged", revision: 4 };
  });
  expect(unchanged).toEqual({ kind: "unchanged", revision: 4 });
  expect(sent).toEqual([["a"]]);

  sent.length = 0;
  await requestPartialSync(loaded, async (ids) => {
    sent.push(ids);
    return ids.length === 1
      ? { kind: "snapshot", value: loaded }
      : { kind: "unchanged", revision: 4 };
  });
  expect(sent).toEqual([["a"], ["a", "b", "c"]]);
});

it("partial sync does not resend a one-block window after a snapshot", async () => {
  const single: HostSession = {
    ...known,
    history: { before: 0, revision: 4, totalBlocks: 1 },
    session: { ...known.session, blocks: [{ id: "a", role: "user", text: "a" }] },
  };
  const sent: string[][] = [];
  await requestPartialSync(single, async (ids) => {
    sent.push(ids);
    return { kind: "snapshot", value: single };
  });
  expect(sent).toEqual([["a"]]);
});
