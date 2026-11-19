import { describe, expect, it } from "vitest";
import {
  applyProjectDelta,
  projectStreamList,
  type ProjectStreamState,
} from "../../src/features/connections/model/projectSessionDelta";
import { ProjectDeltaEncoder, projectStreamKey, projectStreamProjectId } from "./project-delta";

type Row = { id: string; updatedAt: number; title: string };
const row = (id: string, updatedAt: number, title = id): Row => ({ id, updatedAt, title });
const list = (rows: Row[], etag = rows.map((r) => `${r.id}${r.updatedAt}`).join()) => ({
  etag,
  list: rows,
});
const key = projectStreamKey("principal", "p:1");

/** Receiver side: what a client holding every applied event rebuilds. */
function receive(state: ProjectStreamState<Row> | undefined, read: ReturnType<typeof encode>) {
  if (read.kind === "snapshot")
    return {
      revision: read.revision,
      rows: new Map(read.value.sessions.map((r) => [r.id, r])),
      ids: read.value.sessions.map((r) => r.id),
    };
  if (read.kind === "unchanged") return state;
  return applyProjectDelta(state, read.value, read.base, read.revision, (value) => value as Row)
    .next;
}
const encoder = new ProjectDeltaEncoder();
function encode(rows: Row[], committed: number | undefined, force = false) {
  return encoder.encode(key, list(rows), committed, force);
}

describe("ProjectDeltaEncoder", () => {
  it("keys streams by principal and project", () => {
    expect(projectStreamProjectId(key)).toBe("p:1");
  });

  it("sends only changed rows and rebuilds the same ordered list", () => {
    const rows = Array.from({ length: 50 }, (_, index) => row(`s${index}`, 1000 - index));
    const first = encode(rows, undefined);
    expect(first.kind).toBe("snapshot");
    let state = receive(undefined, first);

    // Nothing changed: no event at all.
    const same = encode(rows, first.revision);
    expect(same).toEqual({ kind: "unchanged", revision: first.revision });

    // A streaming turn in the middle moves its session to the front.
    const bumped = [row("s20", 2000, "streaming"), ...rows.filter((r) => r.id !== "s20")];
    const moved = encode(bumped, first.revision);
    expect(moved).toMatchObject({
      kind: "delta",
      base: first.revision,
      value: { sessions: [bumped[0]], head: ["s20"] },
    });
    state = receive(state, moved);
    expect(projectStreamList(state!)).toEqual(bumped);

    // A row changes in place, one is removed and a new one appears at the front.
    const next = [
      row("new", 3000),
      ...bumped
        .filter((r) => r.id !== "s3")
        .map((r) => (r.id === "s10" ? { ...r, title: "x" } : r)),
    ];
    const changed = encode(next, moved.revision);
    expect(changed).toMatchObject({
      kind: "delta",
      value: { removed: ["s3"], head: ["new"] },
    });
    expect(changed.kind === "delta" && changed.value.sessions.map((r) => r.id)).toEqual([
      "new",
      "s10",
    ]);
    state = receive(state, changed);
    expect(projectStreamList(state!)).toEqual(next);

    // Any other reorder ships the new order up to the tail that kept its order.
    const swapped = [...next];
    [swapped[10], swapped[30]] = [swapped[30]!, swapped[10]!];
    const reordered = encode(swapped, changed.revision);
    expect(reordered).toMatchObject({ kind: "delta", value: { sessions: [] } });
    expect(reordered.kind === "delta" && reordered.value.head).toEqual(
      swapped.slice(0, 30).map((r) => r.id),
    );
    state = receive(state, reordered);
    expect(projectStreamList(state!)).toEqual(swapped);
  });

  it("falls back to a snapshot when the committed revision is not the sender's", () => {
    const rows = [row("a", 2), row("b", 1)];
    const first = encode(rows, undefined);
    // The hub dropped or never committed `first`: the stream still holds an older revision.
    expect(encode(rows, first.revision - 1).kind).toBe("snapshot");
    // A forced baseline is always a snapshot.
    const forced = encode(rows, undefined, true);
    expect(encode(rows, forced.revision, true).kind).toBe("snapshot");
  });

  it("forgets streams the caller no longer keeps", () => {
    const local = new ProjectDeltaEncoder();
    const first = local.encode(key, list([row("a", 1)]), undefined, false);
    local.retain(() => false);
    expect(local.encode(key, list([row("a", 1)]), first.revision, false).kind).toBe("snapshot");
  });
});

describe("applyProjectDelta", () => {
  const held: ProjectStreamState<Row> = {
    revision: 4,
    rows: new Map([
      ["a", row("a", 2)],
      ["b", row("b", 1)],
    ]),
    ids: ["a", "b"],
  };
  const parse = (value: unknown) => value as Row;

  it("rejects a delta that does not follow the held list", () => {
    expect(() => applyProjectDelta(held, { etag: "e", sessions: [] }, 3, 5, parse)).toThrow();
    expect(() => applyProjectDelta(undefined, { etag: "e", sessions: [] }, 4, 5, parse)).toThrow();
  });

  it("rejects rows and orders that do not add up, without touching the held list", () => {
    // A new row that no order hint places.
    expect(() =>
      applyProjectDelta(held, { etag: "e", sessions: [row("c", 3)] }, 4, 5, parse),
    ).toThrow();
    // Removing an unknown row.
    expect(() =>
      applyProjectDelta(held, { etag: "e", sessions: [], removed: ["z"] }, 4, 5, parse),
    ).toThrow();
    // Unknown fields.
    expect(() => applyProjectDelta(held, { etag: "e", sessions: [], x: 1 }, 4, 5, parse)).toThrow();
    expect(held.ids).toEqual(["a", "b"]);
    expect(held.rows.size).toBe(2);
  });
});
