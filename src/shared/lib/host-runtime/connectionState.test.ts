import { describe, expect, it } from "vitest";
import {
  initialConnectionState,
  reduceConnectionState,
  type ConnectionState,
} from "./connectionState";

function ready(): ConnectionState {
  let state = initialConnectionState("home-host");
  state = reduceConnectionState(state, { type: "attempt", generation: 1 });
  state = reduceConnectionState(state, { type: "opened", generation: 1 });
  return reduceConnectionState(state, { type: "ready", generation: 1, environmentId: "home-host" });
}

describe("connection lifecycle policy", () => {
  it("distinguishes transport readiness, content synchronization and content failure", () => {
    let state = ready();
    expect(state).toMatchObject({
      transport: "ready",
      content: "synchronizing",
      hasSnapshot: false,
    });
    state = reduceConnectionState(state, { type: "content-applied", generation: 1 });
    expect(state.content).toBe("fresh");
    state = reduceConnectionState(state, { type: "content-failed", generation: 1 });
    expect(state).toMatchObject({ transport: "ready", content: "error", hasSnapshot: true });
  });

  it("retains stale cache state across reconnect and ignores prior-generation data", () => {
    let state = reduceConnectionState(ready(), { type: "content-applied", generation: 1 });
    state = reduceConnectionState(state, { type: "failed", generation: 1, failure: "network" });
    expect(state).toMatchObject({ transport: "retry-wait", content: "stale" });
    state = reduceConnectionState(state, { type: "attempt", generation: 2 });
    expect(reduceConnectionState(state, { type: "content-applied", generation: 1 })).toBe(state);
    expect(reduceConnectionState(state, { type: "attempt", generation: 2 })).toBe(state);
  });

  it.each(["auth", "identity", "schema"] as const)(
    "holds %s failures until inputs change",
    (failure) => {
      const blocked = reduceConnectionState(ready(), { type: "failed", generation: 1, failure });
      expect(blocked.transport).toBe("blocked");
      expect(reduceConnectionState(blocked, { type: "attempt", generation: 2 })).toBe(blocked);
      const changed = reduceConnectionState(blocked, { type: "inputs-changed" });
      expect(changed.transport).toBe("idle");
      expect(reduceConnectionState(changed, { type: "failed", generation: 1, failure })).toBe(
        changed,
      );
      expect(reduceConnectionState(changed, { type: "attempt", generation: 2 }).transport).toBe(
        "connecting",
      );
    },
  );

  it("rejects a different Host identity even when the socket opened", () => {
    let state = initialConnectionState("home-host");
    state = reduceConnectionState(state, { type: "attempt", generation: 1 });
    state = reduceConnectionState(state, { type: "opened", generation: 1 });
    state = reduceConnectionState(state, {
      type: "ready",
      generation: 1,
      environmentId: "replacement-host",
    });
    expect(state).toMatchObject({ transport: "blocked", failure: "identity", hasSnapshot: false });
  });

  it("cannot be revived by late callbacks after scope removal", () => {
    const closed = reduceConnectionState(ready(), { type: "close" });
    expect(closed).toMatchObject({
      transport: "closed",
      content: "unavailable",
      hasSnapshot: false,
    });
    expect(reduceConnectionState(closed, { type: "attempt", generation: 2 })).toBe(closed);
    expect(reduceConnectionState(closed, { type: "content-applied", generation: 1 })).toBe(closed);
  });
});
