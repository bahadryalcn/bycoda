import { beforeEach, describe, expect, it } from "vitest";
import {
  getSessions,
  getSessionsRevision,
  getShellSessions,
  isTextOnlyChange,
  resetSessionsStore,
  selectSessionById,
  setSessions,
} from "./sessionsStore";
import type { Block, Session } from "./session";

const user: Block = { id: "u1", role: "user", text: "hi" };
const reply: Block = { id: "a1", role: "assistant", text: "He", streaming: true };

function session(id: string, blocks: Block[] = [user, reply]): Session {
  return { id, title: id, cwd: "/p", blocks } as unknown as Session;
}

function withText(target: Session, text: string): Session {
  const blocks = target.blocks.slice();
  blocks[blocks.length - 1] = { ...blocks[blocks.length - 1], text } as Block;
  return { ...target, blocks };
}

describe("isTextOnlyChange", () => {
  it("accepts identical arrays and a streamed-text change in one session", () => {
    const a = [session("a"), session("b")];
    expect(isTextOnlyChange(a, a)).toBe(true);
    expect(isTextOnlyChange(a, [withText(a[0], "Hello"), a[1]])).toBe(true);
  });

  it("rejects every other kind of change", () => {
    const a = [session("a"), session("b")];
    const tool = { id: "t1", role: "tool", text: "x" } as unknown as Block;
    expect(isTextOnlyChange(a, [...a, session("c")])).toBe(false);
    expect(isTextOnlyChange(a, [a[1], a[0]])).toBe(false);
    expect(isTextOnlyChange(a, [{ ...a[0], busy: true }, a[1]])).toBe(false);
    expect(isTextOnlyChange(a, [{ ...a[0], title: "New" }, a[1]])).toBe(false);
    expect(isTextOnlyChange(a, [{ ...a[0], blocks: [...a[0].blocks, tool] }, a[1]])).toBe(false);
    expect(isTextOnlyChange(a, [withText({ ...a[0], blocks: [user, tool] }, "y"), a[1]])).toBe(
      false,
    );
    // Text change together with another session field is not text-only.
    expect(isTextOnlyChange(a, [{ ...withText(a[0], "Hello"), busy: true }, a[1]])).toBe(false);
  });
});

describe("selectSessionById", () => {
  it("returns the same object while it is unchanged and undefined for no id", () => {
    const a = session("a");
    const b = session("b");
    expect(selectSessionById([a, b], "b")).toBe(b);
    expect(selectSessionById([a, withText(b, "x")], "a")).toBe(a);
    expect(selectSessionById([a, b], undefined)).toBeUndefined();
    expect(selectSessionById([a, b], "zzz")).toBeUndefined();
  });
});

describe("sessions store", () => {
  beforeEach(() => resetSessionsStore([session("a"), session("b")]));

  it("applies updaters immediately and ignores identical arrays", () => {
    const before = getSessions();
    setSessions((previous) => previous);
    expect(getSessions()).toBe(before);
    setSessions((previous) => [...previous, session("c")]);
    expect(getSessions()).toHaveLength(3);
  });

  it("shell keeps its array across text frames and catches up on a tool block", () => {
    const first = getShellSessions();
    expect(first).toBe(getSessions());

    setSessions((p) => [withText(p[0], "Hello"), p[1]]);
    setSessions((p) => [withText(p[0], "Hello world"), p[1]]);
    expect(getShellSessions()).toBe(first);
    expect(getSessions()).not.toBe(first);

    const tool = { id: "t1", role: "tool", text: "x" } as unknown as Block;
    setSessions((p) => [{ ...p[0], blocks: [...p[0].blocks, tool] }, p[1]]);
    expect(getShellSessions()).toBe(getSessions());
    expect(getShellSessions()[0].blocks[1].text).toBe("Hello world");

    // Text frames after that are compared with the new shell array.
    const adopted = getShellSessions();
    setSessions((p) => [p[0], p[1]].map((s) => s));
    expect(getShellSessions()).toBe(adopted);
  });
});

it("increments the per-window revision once per accepted update, including reset", () => {
  const initial = [session("revision")];
  resetSessionsStore(initial);
  const before = getSessionsRevision();
  setSessions((current) => current);
  expect(getSessionsRevision()).toBe(before);
  setSessions((current) => [withText(current[0], "streamed")]);
  expect(getSessionsRevision()).toBe(before + 1);
  resetSessionsStore([]);
  expect(getSessionsRevision()).toBe(before + 2);
});
