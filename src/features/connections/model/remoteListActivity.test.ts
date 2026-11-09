import { describe, expect, it } from "vitest";
import type { HostSessionSummary } from "./protocol";
import { noteOwnSessionRequest, remoteListActivity } from "./remoteListActivity";

const row = (id: string, archived = false) => ({ id, archived }) as HostSessionSummary;
const held = { sessions: [row("a"), row("b"), row("c")], etag: "e1" };
const change = (extra: object) => ({ projectId: "p", etag: "e2", base: "e1", ...extra });

describe("remoteListActivity", () => {
  it("counts removals and archive flips from an incremental change", () => {
    expect(
      remoteListActivity("m", held, change({ removed: ["a"], upserts: [row("b", true)] }), false),
    ).toEqual({ deleted: 1, archived: 1 });
  });

  it("ignores loads, resets, full snapshots and changes off the held list", () => {
    const none = { deleted: 0, archived: 0 };
    const removed = { removed: ["a"] };
    expect(remoteListActivity("m", undefined, change(removed), false)).toEqual(none);
    expect(remoteListActivity("m", held, change(removed), true)).toEqual(none);
    expect(remoteListActivity("m", held, change({ sessions: [] }), false)).toEqual(none);
    expect(remoteListActivity("m", held, change({ ...removed, base: "old" }), false)).toEqual(none);
  });

  it("ignores new rows, already archived rows and ids never held", () => {
    expect(
      remoteListActivity(
        "m",
        { ...held, sessions: [row("a", true)] },
        change({ removed: ["zz"], upserts: [row("a", true), row("n", true)] }),
        false,
      ),
    ).toEqual({ deleted: 0, archived: 0 });
  });

  it("skips this client's own delete and archive once", () => {
    noteOwnSessionRequest("m", "sessions.delete", { sessionId: "a" });
    noteOwnSessionRequest("m", "sessions.update", { sessionId: "b", archived: true });
    noteOwnSessionRequest("m", "sessions.update", { sessionId: "c", archived: false });
    const incoming = change({ removed: ["a"], upserts: [row("b", true)] });
    expect(remoteListActivity("m", held, incoming, false)).toEqual({ deleted: 0, archived: 0 });
    expect(remoteListActivity("m", held, incoming, false)).toEqual({ deleted: 1, archived: 1 });
  });

  it("lets an own action expire", () => {
    noteOwnSessionRequest("m2", "sessions.delete", { sessionId: "a" });
    expect(
      remoteListActivity("m2", held, change({ removed: ["a"] }), false, Date.now() + 3 * 60_000),
    ).toEqual({ deleted: 1, archived: 0 });
  });
});
