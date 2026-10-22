// @vitest-environment happy-dom
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { TranscriptPool } from "./TranscriptPool";

function Probe(_props: { visible?: boolean }) {
  return null;
}
const element = () => createElement(Probe, { visible: true });
const statesOf = (pool: TranscriptPool) =>
  [...(pool as unknown as { states: Map<string, unknown> }).states.keys()].sort();

describe("TranscriptPool checkpoint retention", () => {
  it("prunes checkpoints of sessions that are gone and no longer pooled", () => {
    // Limit 0 releases every parked entry at once, so only checkpoints remain.
    const pool = new TranscriptPool(0);
    pool.show("a", document.createElement("div"), element());
    pool.show("b", document.createElement("div"), element());
    pool.park("a", pool.getSnapshot().find((e) => e.id === "a")!.host!);
    pool.park("b", pool.getSnapshot().find((e) => e.id === "b")!.host!);
    expect(pool.getSnapshot()).toHaveLength(0);
    expect(statesOf(pool)).toEqual(["a", "b"]);

    pool.setProtectedIds([], ["a"]);

    expect(statesOf(pool)).toEqual(["a"]);
  });

  it("keeps the checkpoint of a known session after its pooled entry is trimmed", () => {
    const pool = new TranscriptPool(0);
    pool.setProtectedIds([], ["a", "b"]);
    const host = document.createElement("div");
    pool.show("a", host, element());
    pool.park("a", host);
    expect(pool.getSnapshot()).toHaveLength(0);
    expect(statesOf(pool)).toEqual(["a"]);
  });

  it("drops the checkpoint of an unknown session when its entry is trimmed", () => {
    const pool = new TranscriptPool(0);
    pool.setProtectedIds([], ["a"]);
    const host = document.createElement("div");
    pool.show("gone", host, element());
    pool.park("gone", host);
    expect(statesOf(pool)).toEqual([]);
  });

  it("never prunes a checkpoint whose entry is still pooled", () => {
    const pool = new TranscriptPool();
    pool.show("a", document.createElement("div"), element());
    pool.setProtectedIds([], []);
    expect(statesOf(pool)).toEqual(["a"]);
  });
});
