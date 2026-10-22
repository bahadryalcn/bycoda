import { expect, it } from "vitest";
import { applySessionSync, sessionReferenceKey, type HostSession } from "./protocol";

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
  expect(next.session.blocks[1]?.remoteContent).toEqual({
    revision: 5,
    bytes: 200000,
  });
  expect(next.session.blocks[0]).toBe(partial.session.blocks[0]);
  expect(preview.remoteContent.revision).toBe(4);
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
