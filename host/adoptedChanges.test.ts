import { describe, expect, it } from "vitest";
import { AdoptedChanges, type AdoptedRow } from "./adoptedChanges";

const row = (id: string, revision = 1, status = "idle"): AdoptedRow => ({
  id,
  revision,
  updatedAt: 10,
  status,
  desktopUpdatedAt: 10,
});

function setup(initial: AdoptedRow[]) {
  const state = { rows: initial, version: 1, reads: 0 };
  const changes = new AdoptedChanges(
    () => {
      state.reads++;
      return state.rows;
    },
    () => state.version,
  );
  const move = (rows: AdoptedRow[]) => {
    state.rows = rows;
    state.version++;
  };
  return { changes, state, move };
}

describe("AdoptedChanges", () => {
  it("answers a new or unknown cursor with a reset and then only what moved", async () => {
    const { changes, move } = setup([row("a"), row("b")]);
    const first = await changes.changesSince(undefined);
    expect(first).toMatchObject({ ids: [], reset: true });
    expect(await changes.changesSince(first.seq)).toEqual({
      seq: first.seq,
      ids: [],
      boot: first.boot,
    });
    move([row("a", 2), row("b")]);
    const next = await changes.changesSince(first.seq);
    expect(next.ids).toEqual(["a"]);
    expect(await changes.changesSince(next.seq)).toEqual({
      seq: next.seq,
      ids: [],
      boot: next.boot,
    });
    // A cursor from another host run is never answered with a guess.
    expect(await changes.changesSince(first.seq + 99)).toMatchObject({ ids: [], reset: true });
  });

  it("reports a status flip, a newly adopted session and one that left", async () => {
    const { changes, move } = setup([row("a"), row("b")]);
    const first = await changes.changesSince(undefined);
    move([row("a", 1, "running"), row("b"), row("c")]);
    expect((await changes.changesSince(first.seq)).ids.sort()).toEqual(["a", "c"]);
    move([row("a", 1, "running"), row("c")]);
    expect((await changes.changesSince(first.seq)).ids.sort()).toEqual(["a", "b", "c"]);
  });

  it("reads the list only when the store changed", async () => {
    const { changes, state, move } = setup([row("a")]);
    await changes.changesSince(undefined);
    for (let i = 0; i < 20; i++) await changes.changesSince(0);
    expect(state.reads).toBe(1);
    move([row("a", 2)]);
    await changes.changesSince(0);
    await changes.changesSince(0);
    expect(state.reads).toBe(2);
  });

  it("forgets the oldest changes and then asks for a full look", async () => {
    const { changes, move } = setup([]);
    const first = await changes.changesSince(undefined);
    for (let i = 0; i < 600; i++) {
      move(Array.from({ length: i + 1 }, (_, n) => row(`s${n}`)));
      await changes.changesSince(0);
    }
    expect((await changes.changesSince(first.seq)).reset).toBe(true);
  });
});

describe("AdoptedChanges across a host restart", () => {
  it("resets a client whose cursor came from another run, however few changes both saw", async () => {
    const rows = [row("a")];
    const run = () =>
      new AdoptedChanges(
        () => rows,
        () => 1,
      );
    const before = run();
    const cursor = (await before.changesSince(undefined)).seq;
    // Both runs have seen no change at all: a counter alone would match.
    const after = run();
    expect(after.boot).not.toBe(before.boot);
    expect(await after.changesSince(cursor)).toMatchObject({ ids: [], reset: true });
    // The new run's own cursor is answered precisely.
    const own = (await after.changesSince(undefined)).seq;
    expect((await after.changesSince(own)).reset).toBeUndefined();
  });
});
