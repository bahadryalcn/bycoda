import { describe, expect, it } from "vitest";
import { RemoteBindingGeneration } from "./remoteBindingGeneration";

describe("RemoteBindingGeneration", () => {
  it("starts at version 0 with the constructor session and key", () => {
    const generation = new RemoteBindingGeneration("s1", "m/e/s1");
    expect(generation.version).toBe(0);
    expect(generation.session).toBe("s1");
    expect(generation.key).toBe("m/e/s1");
    expect(generation.capture()).toEqual({ version: 0, key: "m/e/s1", session: "s1" });
  });

  it("captures explicit key and session overrides", () => {
    const generation = new RemoteBindingGeneration("s1", "k1");
    // An omitted or undefined session falls back to the bound session.
    expect(generation.capture("k2", undefined)).toEqual({ version: 0, key: "k2", session: "s1" });
    expect(generation.capture("k2", "s2")).toEqual({ version: 0, key: "k2", session: "s2" });
  });

  it("issues immutable tokens that survive later rebinding", () => {
    const generation = new RemoteBindingGeneration("s1", "k1");
    const token = generation.capture();
    generation.advance();
    generation.bind("s2");
    generation.track("k2");
    expect(token).toEqual({ version: 0, key: "k1", session: "s1" });
  });

  it("advance makes older tokens stale and keeps newer tokens current", () => {
    const generation = new RemoteBindingGeneration("s1", "k1");
    const old = generation.capture();
    expect(generation.isCurrent(old)).toBe(true);
    expect(generation.isStale(old)).toBe(false);

    generation.advance();
    expect(generation.version).toBe(1);
    expect(generation.isCurrent(old)).toBe(false);
    expect(generation.isBound(old)).toBe(false);
    expect(generation.isStale(old)).toBe(true);

    const fresh = generation.capture();
    expect(fresh.version).toBe(1);
    expect(generation.isCurrent(fresh)).toBe(true);
    expect(generation.isStale(fresh)).toBe(false);
  });

  it("bind moves the bound session without invalidating reads", () => {
    const generation = new RemoteBindingGeneration(undefined, "k1");
    const token = generation.capture();
    expect(token.session).toBeUndefined();

    generation.bind("created");
    expect(generation.session).toBe("created");
    expect(generation.version).toBe(0);
    expect(generation.isCurrent(token)).toBe(true);
    expect(generation.isStale(token)).toBe(false);
    // The read was started for no session, the pane now owns one.
    expect(generation.isBound(token)).toBe(false);

    const bound = generation.capture();
    expect(bound.session).toBe("created");
    expect(generation.isBound(bound)).toBe(true);
  });

  it("isBound requires the same session, isCurrent does not", () => {
    const generation = new RemoteBindingGeneration("s1", "k1");
    const token = generation.capture();
    generation.bind("s2");
    expect(generation.isCurrent(token)).toBe(true);
    expect(generation.isBound(token)).toBe(false);
    generation.bind("s1");
    expect(generation.isBound(token)).toBe(true);
    generation.bind(undefined);
    expect(generation.session).toBeUndefined();
    expect(generation.isBound(token)).toBe(false);
  });

  it("track records the latest render identity without invalidating tokens", () => {
    const generation = new RemoteBindingGeneration("s1", "k1");
    const token = generation.capture();
    generation.track("k2");
    expect(generation.key).toBe("k2");
    expect(generation.version).toBe(0);
    expect(generation.isCurrent(token)).toBe(true);
    expect(generation.capture().key).toBe("k2");
  });

  it("markDeleted invalidates tokens by key and clearDeleted restores them", () => {
    const generation = new RemoteBindingGeneration("s1", "k1");
    const deleted = generation.capture("k1", "s1");
    const other = generation.capture("k2", "s2");

    generation.markDeleted("k1");
    expect(generation.isDeleted("k1")).toBe(true);
    expect(generation.isDeleted("k2")).toBe(false);
    expect(generation.isCurrent(deleted)).toBe(false);
    expect(generation.isBound(deleted)).toBe(false);
    expect(generation.isStale(deleted)).toBe(true);
    // Another key is unaffected by the deletion.
    expect(generation.isCurrent(other)).toBe(true);
    expect(generation.isStale(other)).toBe(false);

    generation.clearDeleted();
    expect(generation.isDeleted("k1")).toBe(false);
    expect(generation.isCurrent(deleted)).toBe(true);
    expect(generation.isBound(deleted)).toBe(true);
    expect(generation.isStale(deleted)).toBe(false);
  });

  it("currentDeleted reflects the latest tracked key", () => {
    const generation = new RemoteBindingGeneration("s1", "k1");
    expect(generation.currentDeleted()).toBe(false);
    generation.markDeleted("k1");
    expect(generation.currentDeleted()).toBe(true);
    generation.track("k2");
    expect(generation.currentDeleted()).toBe(false);
    generation.track("k1");
    expect(generation.currentDeleted()).toBe(true);
    generation.clearDeleted();
    expect(generation.currentDeleted()).toBe(false);
  });

  it("advance clears a recorded deletion", () => {
    const generation = new RemoteBindingGeneration("s1", "k1");
    generation.markDeleted("k1");
    generation.advance();
    expect(generation.isDeleted("k1")).toBe(false);
    expect(generation.currentDeleted()).toBe(false);
    expect(generation.isCurrent(generation.capture("k1", "s1"))).toBe(true);
  });

  it("beginDiscard makes in-flight tokens for that session stale until endDiscard", () => {
    const generation = new RemoteBindingGeneration("s1", "k1");
    const inFlight = generation.capture();
    const otherSession = generation.capture("k2", "s2");
    const unbound = new RemoteBindingGeneration(undefined, "k3");
    const noSession = unbound.capture();
    unbound.beginDiscard("s1");

    generation.beginDiscard("s1");
    expect(generation.isStale(inFlight)).toBe(true);
    // Discard is a staleness rule only; the generation itself is unchanged.
    expect(generation.isCurrent(inFlight)).toBe(true);
    expect(generation.isBound(inFlight)).toBe(true);
    expect(generation.isStale(otherSession)).toBe(false);
    // A token without a session is never stale because of a discard.
    expect(unbound.isStale(noSession)).toBe(false);
    // A token captured during the discard is equally stale.
    expect(generation.isStale(generation.capture())).toBe(true);

    generation.endDiscard();
    expect(generation.isStale(inFlight)).toBe(false);
    expect(generation.isStale(generation.capture())).toBe(false);
  });

  it("stays stale after a discard ends when the generation moved on", () => {
    const generation = new RemoteBindingGeneration("s1", "k1");
    const token = generation.capture();
    generation.beginDiscard("s1");
    generation.advance();
    generation.endDiscard();
    expect(generation.isStale(token)).toBe(true);
  });
});
