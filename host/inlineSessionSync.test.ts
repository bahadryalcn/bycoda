import { expect, it, vi } from "vitest";
import { inlineSessionSync } from "./inlineSessionSync";
import type { SessionSync } from "../src/features/connections/model/protocol";
import type { RemoteChangesValue } from "./remoteChanges";

const delta = (text = "hello"): SessionSync => ({
  kind: "delta",
  base: 1,
  value: { revision: 2, session: { id: "s", title: text } } as never,
  blockIds: ["b"],
  blocks: [{ id: "b", content: text } as never],
});
const value = (): RemoteChangesValue => ({
  instanceId: "host",
  reset: false,
  sessions: [{ sessionId: "s", revision: 2 }],
  projects: [],
});
const input = { inlineSync: true, sessions: [{ sessionId: "s", revision: 1 }], projects: [] };

it("attaches only small matching deltas for opted in clients", () => {
  const read = vi.fn(() => delta());
  expect(inlineSessionSync(input, value(), read).sessions[0].sync).toEqual(delta());
  read.mockClear();
  expect(
    inlineSessionSync({ ...input, inlineSync: false }, value(), read).sessions[0].sync,
  ).toBeUndefined();
  expect(read).not.toHaveBeenCalled();
  expect(
    inlineSessionSync(input, { ...value(), reset: true }, read).sessions[0].sync,
  ).toBeUndefined();
  expect(read).not.toHaveBeenCalled();
});

it("only materializes opted-in session deltas while keeping hidden control hints", () => {
  const changes = value();
  changes.sessions.push({ sessionId: "hidden", revision: 2 });
  const read = vi.fn(() => delta());
  const selected = inlineSessionSync(
    {
      ...input,
      inlineSessionIds: ["s"],
      sessions: [...input.sessions, { sessionId: "hidden", revision: 1 }],
    },
    changes,
    read,
  );
  expect(selected.sessions.find((entry) => entry.sessionId === "hidden")).toEqual({
    sessionId: "hidden",
    revision: 2,
  });
  expect(read).toHaveBeenCalledTimes(1);
  expect(read).toHaveBeenCalledWith("s", 1);
  read.mockClear();
  inlineSessionSync({ ...input, inlineSessionIds: [] }, value(), read);
  expect(read).not.toHaveBeenCalled();
});

it("falls back to hints for byte/block budgets, snapshots and changed revisions", () => {
  for (const sync of [
    delta("ü".repeat(65536)),
    { ...delta(), blocks: Array(129).fill({ id: "b" }) },
    { kind: "snapshot", value: {} },
    { ...delta(), base: 0 },
    { ...delta(), value: { revision: 3 } },
  ]) {
    expect(
      inlineSessionSync(input, value(), () => sync as SessionSync).sessions[0].sync,
    ).toBeUndefined();
  }
});

it("shares the byte budget across sessions and isolates missing sessions", () => {
  const changes = value();
  changes.sessions.push({ sessionId: "second", revision: 2 });
  const result = inlineSessionSync(
    { ...input, sessions: [...input.sessions, { sessionId: "second", revision: 1 }] },
    changes,
    () => delta("a".repeat(20000)),
  );
  expect(result.sessions.filter((entry) => entry.sync)).toHaveLength(1);
  expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(65536);
  expect(
    inlineSessionSync(input, value(), () => {
      throw new Error("deleted");
    }).sessions[0].sync,
  ).toBeUndefined();
});
