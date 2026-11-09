import { describe, expect, it, vi } from "vitest";
import {
  ParentInputRegistry,
  registerParentInput,
  beginParentInputClosure,
} from "./parentInputClosure";

describe("passive Parent input registry", () => {
  it("observes notified ref values immutably without ignoring later commits or identical external signals", async () => {
    const registry = new ParentInputRegistry();
    const state = { nested: { text: "old" }, optional: undefined };
    const owner = registry.register({
      sessionId: "root",
      kind: "session-parent",
      snapshot: () => state,
    });
    owner.observe();
    state.nested.text = "already notified";
    owner.changed();
    owner.observe(true);
    const close = registry.begin("root", { owner: {}, timeoutMs: 1000 });
    owner.observe();
    expect(close.current()).toBe(true);
    const lease = await close.capture();
    expect(Object.hasOwn(lease.snapshots[0].snapshot, "optional")).toBe(true);
    state.nested.text = "later unnotified React commit";
    owner.observe();
    expect(close.current()).toBe(false);
    close.release();
    const same = registry.begin("root", { owner: {}, timeoutMs: 1000 });
    owner.changed();
    owner.observe(true);
    expect(same.current()).toBe(false);
    same.release();
    owner.release();
    expect(registry.inspect().observedBytes).toBe(0);
  });

  it("holds bounded observation failures without throwing into editing and releases their shared charge", async () => {
    const registry = new ParentInputRegistry({ bytes: 2048 });
    let text = "small";
    const owner = registry.register({
      sessionId: "root",
      kind: "session-parent",
      snapshot: () => ({ text }),
    });
    owner.observe();
    const originalCharge = registry.inspect().observedBytes;
    expect(originalCharge).toBeGreaterThan(0);
    text = "large".repeat(1024);
    expect(() => {
      owner.changed();
      owner.observe(true);
    }).not.toThrow();
    expect(registry.inspect()).toMatchObject({
      observedBytes: originalCharge,
      failedRecords: 1,
      incomplete: true,
    });
    await expect(registry.capture("root")).rejects.toThrow();
    text = "small again";
    owner.changed();
    owner.observe(true);
    expect(registry.inspect()).toMatchObject({
      failedRecords: 0,
      incomplete: false,
    });
    const lease = await registry.capture("root");
    expect(lease.snapshots[0].snapshot.text).toBe(text);
    owner.release();
    expect(registry.inspect().observedBytes).toBe(0);
    lease.release();
    expect(registry.inspect().leaseBytes).toBe(0);
  });

  it("forwards only exact same-root original synchronous work into a live parent sink", async () => {
    const registry = new ParentInputRegistry();
    const child = registry.register({
      sessionId: "root",
      kind: "queue-edit",
      snapshot: () => ({}),
    });
    const parent = registry.register({
      sessionId: "root",
      kind: "session-parent",
      snapshot: () => ({}),
    });
    const foreign = registry.register({
      sessionId: "foreign",
      kind: "session-parent",
      snapshot: () => ({}),
    });
    const original = child.admit()!;
    const close = registry.begin("root", { owner: {}, timeoutMs: 1000 });
    const effect = vi.fn(() => "accepted");
    expect(parent.continue(original, effect)).toBe(false);
    original.apply(() => {
      expect(foreign.continue(original, effect)).toBe(false);
      expect(parent.continue({ ...original }, effect)).toBe(false);
      expect(
        parent.continue(original, () => {
          expect(parent.canMutate()).toBe(true);
          expect(parent.admit()).toBeNull();
          return effect();
        }),
      ).toBe("accepted");
    });
    await Promise.resolve();
    expect(parent.continue(original, effect)).toBe(false);
    parent.release();
    original.apply(() => expect(parent.continue(original, effect)).toBe(false));
    original.finish();
    expect(effect).toHaveBeenCalledOnce();
    close.release();
  });
  it("retains exact private data, own undefined and prototype-shaped data keys", async () => {
    const registry = new ParentInputRegistry();
    const data = {
      text: "  \n",
      optional: undefined,
      nested: JSON.parse('{"__proto__":{"x":1}}'),
    };
    registry.register({
      sessionId: "root",
      kind: "session-parent",
      snapshot: () => data,
    });
    const lease = await registry.capture("root");
    const snapshot = lease.snapshots[0].snapshot;
    expect(snapshot).toEqual(data);
    expect(Object.prototype.hasOwnProperty.call(snapshot, "optional")).toBe(true);
    expect(Object.isFrozen(snapshot.nested)).toBe(true);
    expect(lease.current()).toBe(true);
    expect(lease.missingCoverage).toContain("decision-conservation");
    lease.release();
    expect(lease.current()).toBe(false);
    expect(data.text).toBe("  \n");
  });

  it("never reads or copies another logical session or an unassigned producer", async () => {
    const registry = new ParentInputRegistry();
    const foreign = vi.fn(() => {
      throw new Error("foreign secret");
    });
    registry.register({
      sessionId: "foreign",
      kind: "question-draft",
      snapshot: foreign,
    });
    registry.register({ kind: "question-draft", snapshot: foreign });
    const lease = await registry.capture("root");
    expect(lease.snapshots).toEqual([]);
    expect(lease.missingCoverage).toContain("unassigned-parent-input-scope");
    expect(foreign).not.toHaveBeenCalled();
  });

  it("invalidates ABA mutations and roster replacement with fresh monotonic identities", async () => {
    const registry = new ParentInputRegistry();
    const adapter = {
      sessionId: "root",
      kind: "composer-parent" as const,
      snapshot: () => ({ text: "same" }),
    };
    const first = registry.register(adapter);
    const before = await registry.capture("root");
    first.changed();
    first.changed();
    expect(before.current()).toBe(false);
    const changed = await registry.capture("root");
    expect(changed.snapshots[0].revision).toBe(2);
    first.release();
    registry.register(adapter);
    const remounted = await registry.capture("root");
    expect(remounted.snapshots[0].id).toBeGreaterThan(changed.snapshots[0].id);
    expect(changed.current()).toBe(false);
  });

  it("detects silent state mutation without normalizing an empty or whitespace input", async () => {
    const registry = new ParentInputRegistry();
    let text = "";
    registry.register({
      sessionId: "root",
      kind: "composer-parent",
      snapshot: () => ({ text }),
    });
    const first = await registry.capture("root");
    text = "  ";
    expect(first.current()).toBe(false);
    expect((await registry.capture("root")).snapshots[0].snapshot.text).toBe("  ");
  });

  it("holds composition and never reads a retired adapter's reused element", async () => {
    const registry = new ParentInputRegistry();
    let composing = false;
    const snapshot = vi.fn(() => ({ text: "original" }));
    const owner = registry.register({
      sessionId: "root",
      kind: "queue-edit",
      snapshot,
      composing: () => composing,
    });
    const lease = await registry.capture("root");
    composing = true;
    expect(lease.current()).toBe(false);
    await expect(registry.capture("root")).rejects.toThrow("composing");
    owner.release();
    snapshot.mockImplementation(() => {
      throw new Error("reused foreign ref");
    });
    expect(lease.current()).toBe(false);
    expect((await registry.capture("root")).snapshots).toEqual([]);
  });

  it("fails closed at producer capacity and on unsupported actual data", async () => {
    const registry = new ParentInputRegistry();
    for (let index = 0; index < 257; index++) {
      registry.register({
        sessionId: "root",
        kind: "btw-parent",
        snapshot: () => ({ text: "" }),
      });
    }
    await expect(registry.capture("root")).rejects.toThrow("capacity");
    const invalid = new ParentInputRegistry();
    invalid.register({
      sessionId: "root",
      kind: "question-draft",
      snapshot: () => ({ impossible: [undefined] }),
    });
    await expect(invalid.capture("root")).rejects.toThrow("unavailable");
  });

  it("bounds mounted records without throwing into UI or evicting existing owners", async () => {
    const registry = new ParentInputRegistry({ records: 2 });
    const adapter = {
      sessionId: "root",
      kind: "composer-parent" as const,
      snapshot: () => ({ text: "original" }),
    };
    const first = registry.register(adapter);
    registry.register(adapter);
    const before = await registry.capture("root");
    const overflowSnapshot = vi.fn(() => {
      throw new Error("must not read overflow owner");
    });
    let excess!: ReturnType<ParentInputRegistry["register"]>;
    expect(() => {
      excess = registry.register({ ...adapter, snapshot: overflowSnapshot });
      excess.changed();
    }).not.toThrow();
    expect(registry.inspect()).toMatchObject({
      records: 2,
      overflow: 1,
      incomplete: true,
    });
    expect(before.current()).toBe(false);
    await expect(registry.capture("root")).rejects.toThrow("capacity");
    excess.release();
    excess.release();
    const restored = await registry.capture("root");
    expect(restored.snapshots.map((entry) => entry.snapshot.text)).toEqual([
      "original",
      "original",
    ]);
    expect(overflowSnapshot).not.toHaveBeenCalled();
    first.release();
    expect(restored.current()).toBe(false);
    before.release();
    restored.release();
    expect(registry.inspect()).toMatchObject({
      records: 1,
      overflow: 0,
      leaseBytes: 0,
      leases: 0,
    });
  });

  it("enforces one aggregate JSON byte budget across individually valid entries", async () => {
    const registry = new ParentInputRegistry();
    for (let index = 0; index < 2; index++)
      registry.register({
        sessionId: "root",
        kind: "session-parent",
        snapshot: () => ({ text: "x".repeat(9 * 1024 * 1024) }),
      });
    await expect(registry.capture("root")).rejects.toThrow("capacity");
    expect(registry.inspect()).toMatchObject({ leaseBytes: 0, leases: 0 });
  });

  it("enforces one aggregate node budget before copying an entry bundle", async () => {
    const registry = new ParentInputRegistry();
    for (let index = 0; index < 2; index++)
      registry.register({
        sessionId: "root",
        kind: "session-parent",
        snapshot: () => ({ values: Array(33_000).fill(null) }),
      });
    await expect(registry.capture("root")).rejects.toThrow("capacity");
    expect(registry.inspect()).toMatchObject({ leaseBytes: 0, leases: 0 });
  });

  it("bounds concurrent leases and retains invalidated leases' charge until explicit release", async () => {
    const registry = new ParentInputRegistry({ leases: 2 });
    const owner = registry.register({
      sessionId: "root",
      kind: "queue-edit",
      snapshot: () => ({ text: "exact" }),
    });
    const first = await registry.capture("root");
    const second = await registry.capture("root");
    const charged = registry.inspect().leaseBytes;
    await expect(registry.capture("root")).rejects.toThrow("capacity");
    owner.changed();
    expect(first.current()).toBe(false);
    expect(registry.inspect()).toMatchObject({
      leases: 2,
      leaseBytes: charged,
    });
    first.release();
    first.release();
    const third = await registry.capture("root");
    owner.release();
    expect(third.current()).toBe(false);
    second.release();
    third.release();
    expect(registry.inspect()).toMatchObject({ leases: 0, leaseBytes: 0 });
  });

  it("shares the conservative retained and lease budget and releases each real owner separately", async () => {
    const registry = new ParentInputRegistry({ bytes: 1_800 });
    const retained = registry.retain({
      sessionId: "root",
      kind: "queue-edit",
      snapshot: () => ({ text: "x".repeat(100) }),
    });
    expect(registry.inspect().retainedBytes).toBeGreaterThan(0);
    const lease = await registry.capture("root");
    expect(registry.inspect().leaseBytes + registry.inspect().retainedBytes).toBeLessThanOrEqual(
      1_800,
    );
    await expect(registry.capture("root")).rejects.toThrow("capacity");
    retained.release();
    expect(lease.current()).toBe(false);
    expect(registry.inspect().retainedBytes).toBe(0);
    expect(registry.inspect().leaseBytes).toBeGreaterThan(0);
    lease.release();
    expect(registry.inspect()).toMatchObject({
      retainedBytes: 0,
      leaseBytes: 0,
      leases: 0,
    });
  });

  it("holds a failed retained update without evicting its original charge and safely accepts a later bounded update", async () => {
    const registry = new ParentInputRegistry({ bytes: 1_800 });
    const retained = registry.retain({
      sessionId: "root",
      kind: "queue-edit",
      snapshot: () => ({ text: "original" }),
    });
    const originalCharge = registry.inspect().retainedBytes;
    expect(() => retained.update({ text: "x".repeat(2_000) })).not.toThrow();
    expect(registry.inspect()).toMatchObject({
      retainedBytes: originalCharge,
      failedRecords: 1,
      incomplete: true,
    });
    await expect(registry.capture("root")).rejects.toThrow("capacity");
    retained.update({ text: "original", disposition: "still-unknown" });
    expect(registry.inspect()).toMatchObject({
      failedRecords: 0,
      incomplete: false,
    });
    const lease = await registry.capture("root");
    expect(lease.snapshots[0].snapshot).toEqual({
      text: "original",
      disposition: "still-unknown",
    });
    lease.release();
    retained.release();
    retained.update({ text: "late retired update" });
    retained.release();
    expect(registry.inspect()).toMatchObject({
      records: 0,
      retainedBytes: 0,
      leaseBytes: 0,
    });
  });

  it("bounds retained unknown records without reading overflow inputs or dropping originals", async () => {
    const registry = new ParentInputRegistry({ records: 2 });
    const original = registry.retain({
      sessionId: "root",
      kind: "queue-edit",
      snapshot: () => ({ text: "unknown original" }),
    });
    const second = registry.retain({
      sessionId: "root",
      kind: "queue-edit",
      snapshot: () => ({ text: "second unknown" }),
    });
    const snapshot = vi.fn(() => ({ text: "overflow" }));
    let excess!: ReturnType<ParentInputRegistry["retain"]>;
    expect(() => {
      excess = registry.retain({
        sessionId: "root",
        kind: "queue-edit",
        snapshot,
      });
      excess.update({ text: "later" });
    }).not.toThrow();
    expect(snapshot).not.toHaveBeenCalled();
    expect(registry.inspect()).toMatchObject({ records: 2, overflow: 1 });
    await expect(registry.capture("root")).rejects.toThrow("capacity");
    excess.release();
    const lease = await registry.capture("root");
    expect(lease.snapshots.map((entry) => entry.snapshot.text)).toEqual([
      "unknown original",
      "second unknown",
    ]);
    lease.release();
    original.release();
    second.release();
    expect(registry.inspect()).toMatchObject({ retainedBytes: 0, records: 0 });
  });

  it("never invokes a late accessor while checking currentness", async () => {
    const registry = new ParentInputRegistry();
    const data = { text: "original" };
    registry.register({
      sessionId: "root",
      kind: "question-draft",
      snapshot: () => data,
    });
    const lease = await registry.capture("root");
    const getter = vi.fn(() => "other");
    Object.defineProperty(data, "text", { enumerable: true, get: getter });
    expect(lease.current()).toBe(false);
    expect(getter).not.toHaveBeenCalled();
    lease.release();
  });

  it("keeps a failed observer snapshot as a held marker without throwing into the initiating action", async () => {
    const registry = new ParentInputRegistry();
    let retained!: ReturnType<ParentInputRegistry["retain"]>;
    expect(() => {
      retained = registry.retain({
        sessionId: "root",
        kind: "queue-edit",
        snapshot: () => {
          throw undefined;
        },
      });
    }).not.toThrow();
    expect(registry.inspect()).toMatchObject({
      failedRecords: 1,
      retainedBytes: 0,
      incomplete: true,
    });
    await expect(registry.capture("root")).rejects.toThrow("invalid");
    retained.update({ text: "genuine later data", optional: undefined });
    const lease = await registry.capture("root");
    expect(lease.snapshots[0].snapshot.text).toBe("genuine later data");
    expect(Object.prototype.hasOwnProperty.call(lease.snapshots[0].snapshot, "optional")).toBe(
      true,
    );
    lease.release();
    retained.release();
    expect(registry.inspect()).toMatchObject({
      failedRecords: 0,
      retainedBytes: 0,
      records: 0,
    });
  });
});

describe("explicit shared-profile Parent inputs", () => {
  const begin = (registry: ParentInputRegistry, sessionId: string) =>
    registry.begin(sessionId, { owner: {}, timeoutMs: 1000 });

  it("selects explicit profile data for every root without assigning a session or reading legacy unknown inputs", async () => {
    const registry = new ParentInputRegistry();
    const unknownRead = vi.fn(() => {
      throw new Error("unassigned private data must not be read");
    });
    const unknown = registry.register({
      kind: "question-draft",
      snapshot: unknownRead,
    });
    const unknownJob = unknown.admit()!;
    const shared = registry.register({
      scope: "profile",
      kind: "approval-decision",
      snapshot: () => ({ exact: "  shared\r\n漢🦀\n" }),
    });
    const a = registry.register({
      sessionId: "A",
      kind: "session-parent",
      snapshot: () => ({ root: "A" }),
    });
    const b = registry.register({
      sessionId: "B",
      kind: "session-parent",
      snapshot: () => ({ root: "B" }),
    });
    const close = begin(registry, "A");
    const aLease = await close.capture();
    const bLease = await registry.capture("B");
    for (const [lease, root] of [
      [aLease, "A"],
      [bLease, "B"],
    ] as const) {
      expect(lease.snapshots).toHaveLength(2);
      const profile = lease.snapshots.find((entry) => entry.kind === "approval-decision")!;
      expect(Object.hasOwn(profile, "sessionId")).toBe(false);
      expect(profile.snapshot.exact).toBe("  shared\r\n漢🦀\n");
      expect(lease.snapshots.find((entry) => entry.kind === "session-parent")!.sessionId).toBe(
        root,
      );
      expect(lease.missingCoverage).toContain("unassigned-parent-input-scope");
    }
    expect(unknownRead).not.toHaveBeenCalled();
    expect(registry.closed(undefined)).toBe(false);
    expect(registry.closed(undefined, "profile")).toBe(true);
    expect(unknown.canMutate()).toBe(true);
    expect(shared.canMutate()).toBe(false);
    expect(b.canMutate()).toBe(true);
    const bJob = b.admit()!;
    b.changed();
    expect(close.current()).toBe(true);
    bJob.finish();
    unknownJob.finish();
    close.release();
    bLease.release();
    a.release();
    b.release();
    shared.release();
    unknown.release();
  });

  it("drains the same actual shared Promise in two roots and permits only original synchronous profile publication", async () => {
    const registry = new ParentInputRegistry();
    let text = "before";
    const shared = registry.register({
      scope: "profile",
      kind: "approval-decision",
      snapshot: () => ({ text }),
    });
    const sink = registry.register({
      scope: "profile",
      kind: "question-draft",
      snapshot: () => ({ retained: true }),
    });
    const a = registry.register({
      sessionId: "A",
      kind: "session-parent",
      snapshot: () => ({}),
    });
    const other = registry.register({
      sessionId: "C",
      kind: "session-parent",
      snapshot: () => ({}),
    });
    const original = shared.admit()!;
    let release!: () => void;
    const pending = original.run(async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      expect(registry.canPublish(undefined, "profile")).toBe(false);
      expect(sink.continue(original, () => {})).toBe(false);
      original.apply(() => {
        expect(shared.canMutate()).toBe(true);
        expect(registry.canPublish(undefined, "profile")).toBe(true);
        expect(registry.canPublish("A")).toBe(false);
        expect(a.continue(original, () => {})).toBe(false);
        expect(sink.continue({ ...original }, () => {})).toBe(false);
        expect(
          sink.continue(original, () => {
            text = "  original shared result\r\n";
            return true;
          }),
        ).toBe(true);
        expect(shared.admit()).toBeNull();
      });
      expect(registry.canPublish(undefined, "profile")).toBe(false);
    });
    const closeA = begin(registry, "A");
    const closeB = begin(registry, "B");
    let captured = 0;
    const captureA = closeA.capture().then((lease) => {
      captured++;
      return lease;
    });
    const captureB = closeB.capture().then((lease) => {
      captured++;
      return lease;
    });
    await Promise.resolve();
    original.finish();
    expect(registry.inspect().pendingJobs).toBe(1);
    expect(captured).toBe(0);
    expect(shared.admit()).toBeNull();
    expect(other.canMutate()).toBe(true);
    other.admit()!.finish();
    release();
    await pending;
    const leases = await Promise.all([captureA, captureB]);
    for (const lease of leases)
      expect(
        lease.snapshots.find((entry) => entry.kind === "approval-decision")!.snapshot.text,
      ).toBe("  original shared result\r\n");
    expect(closeA.current() && closeB.current()).toBe(true);
    closeA.release();
    expect(shared.canMutate()).toBe(false);
    expect(shared.admit()).toBeNull();
    closeB.release();
    expect(shared.canMutate()).toBe(true);
    shared.release();
    sink.release();
    a.release();
    other.release();
  });

  it("invalidates every captured root for shared changes/roster retirement while other session changes remain isolated", async () => {
    const registry = new ParentInputRegistry();
    const shared = registry.register({
      scope: "profile",
      kind: "approval-decision",
      snapshot: () => ({ value: "original" }),
    });
    const other = registry.register({
      sessionId: "C",
      kind: "session-parent",
      snapshot: () => ({}),
    });
    const a = begin(registry, "A");
    const b = begin(registry, "B");
    await a.capture();
    await b.capture();
    other.changed();
    expect(a.current() && b.current()).toBe(true);
    shared.changed();
    expect(a.current()).toBe(false);
    expect(b.current()).toBe(false);
    a.release();
    b.release();
    const nextA = begin(registry, "A");
    const nextB = begin(registry, "B");
    await nextA.capture();
    await nextB.capture();
    shared.release();
    expect(nextA.current()).toBe(false);
    expect(nextB.current()).toBe(false);
    nextA.release();
    nextB.release();
    other.release();
  });

  it("includes shared IME in every preflight and refuses invalid profile/session combinations without throwing into registration", async () => {
    const registry = new ParentInputRegistry();
    let composing = true;
    const read = vi.fn(() => ({ text: "IME" }));
    const shared = registry.register({
      scope: "profile",
      kind: "question-draft",
      snapshot: read,
      composing: () => composing,
    });
    const a = begin(registry, "A");
    const b = begin(registry, "B");
    expect(a.current()).toBe(false);
    expect(b.current()).toBe(false);
    expect(shared.canMutate()).toBe(true);
    await expect(a.capture()).rejects.toThrow();
    await expect(b.capture()).rejects.toThrow();
    expect(read).not.toHaveBeenCalled();
    a.release();
    b.release();
    composing = false;
    const next = begin(registry, "A");
    composing = true;
    await expect(next.capture()).rejects.toThrow("composing");
    next.release();
    shared.release();
    let invalid!: ReturnType<ParentInputRegistry["register"]>;
    expect(() => {
      invalid = registry.register({
        scope: "profile",
        sessionId: "invented-root",
        kind: "approval-decision",
        snapshot: read,
      });
    }).not.toThrow();
    expect(invalid.recorded).toBe(false);
    await expect(registry.capture("A")).rejects.toThrow("capacity");
    await expect(registry.capture("B")).rejects.toThrow("capacity");
    invalid.release();
  });

  it("invalidates all captured roots before a shared recovery resume and pins exact original scope/current owner", async () => {
    const registry = new ParentInputRegistry();
    const adapter: {
      scope?: "profile";
      sessionId?: string;
      kind: "approval-decision";
      snapshot(): Record<string, unknown>;
    } = {
      scope: "profile",
      kind: "approval-decision",
      snapshot: () => ({ value: "original" }),
    };
    const shared = registry.register(adapter);
    const original = shared.admit()!;
    original.finish();
    const a = begin(registry, "A");
    const b = begin(registry, "B");
    await a.capture();
    await b.capture();
    const resumed = original.resume()!;
    expect(a.current()).toBe(false);
    expect(b.current()).toBe(false);
    expect(original.resume()).toBeNull();
    resumed.apply(() => expect(registry.canPublish(undefined, "profile")).toBe(true));
    adapter.scope = undefined;
    expect(() => resumed.apply(() => {})).toThrow("owner changed");
    expect(shared.admit()).toBeNull();
    resumed.finish();
    a.release();
    b.release();
    shared.release();
  });

  it("retains original shared work after adapter retirement without reading retired data or granting a replacement owner", async () => {
    const registry = new ParentInputRegistry();
    let live = true;
    const read = vi.fn(() => ({ old: "private" }));
    const shared = registry.register({
      scope: "profile",
      kind: "approval-decision",
      snapshot: read,
      ownsCurrent: () => live,
    });
    const original = shared.admit()!;
    live = false;
    shared.release();
    expect(shared.admit()).toBeNull();
    expect(() => original.apply(() => {})).toThrow("owner changed");
    const replacement = registry.register({
      scope: "profile",
      kind: "approval-decision",
      snapshot: () => ({ fresh: true }),
    });
    const a = begin(registry, "A");
    const b = begin(registry, "B");
    let captured = false;
    const capture = Promise.all([a.capture(), b.capture()]).then((leases) => {
      captured = true;
      return leases;
    });
    await Promise.resolve();
    expect(captured).toBe(false);
    expect(replacement.admit()).toBeNull();
    original.finish();
    const leases = await capture;
    expect(leases.every((lease) => lease.snapshots[0].snapshot.fresh === true)).toBe(true);
    expect(read).not.toHaveBeenCalled();
    a.release();
    b.release();
    replacement.release();
  });

  it("conserves profile originals at bounded record/retained capacity and gates overflow continuations explicitly", async () => {
    const registry = new ParentInputRegistry({ records: 1 });
    const original = registry.retain({
      scope: "profile",
      kind: "approval-decision",
      snapshot: () => ({ text: "keep exact original" }),
    });
    const overflow = registry.register({
      scope: "profile",
      kind: "question-draft",
      snapshot: () => ({ excess: true }),
    });
    const admitted = overflow.admit()!;
    const a = begin(registry, "A");
    const b = begin(registry, "B");
    expect(overflow.admit()).toBeNull();
    admitted.apply(() => expect(registry.canPublish(undefined, "profile")).toBe(true));
    admitted.finish();
    await expect(a.capture()).rejects.toThrow("capacity");
    await expect(b.capture()).rejects.toThrow("capacity");
    a.release();
    b.release();
    overflow.release();
    const restored = await registry.capture("A");
    expect(restored.snapshots[0].snapshot.text).toBe("keep exact original");
    restored.release();
    original.release();
    expect(registry.inspect()).toMatchObject({
      records: 0,
      retainedBytes: 0,
      pendingJobs: 0,
      overflowJobs: 0,
      overflow: 0,
    });
  });

  it("keeps explicit profile gates and pending originals across actual module reload until each exact release", async () => {
    const current = await import("./parentInputClosure");
    let text = "old profile";
    const owner = current.registerParentInput({
      scope: "profile",
      kind: "approval-decision",
      snapshot: () => ({ text }),
    });
    const original = owner.admit()!;
    let release!: () => void;
    const pending = original.run(async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      original.apply(() => {
        text = "old actual shared result";
      });
    });
    const oldA = current.beginParentInputClosure("profile-hmr-A", {
      owner: {},
      timeoutMs: 1000,
    });
    const oldB = current.beginParentInputClosure("profile-hmr-B", {
      owner: {},
      timeoutMs: 1000,
    });
    vi.resetModules();
    const fresh = await import("./parentInputClosure");
    expect(oldA.current()).toBe(false);
    expect(oldB.current()).toBe(false);
    expect(fresh.canMutateParentInputs(undefined, "profile")).toBe(false);
    expect(fresh.canMutateParentInputs(undefined)).toBe(true);
    expect(() =>
      fresh.beginParentInputClosure("profile-hmr-A", {
        owner: {},
        timeoutMs: 1000,
      }),
    ).toThrow("busy");
    oldA.release();
    expect(owner.admit()).toBeNull();
    const next = fresh.beginParentInputClosure("profile-hmr-A", {
      owner: {},
      timeoutMs: 1000,
    });
    let captured = false;
    const capture = next.capture().then((lease) => {
      captured = true;
      return lease;
    });
    await Promise.resolve();
    expect(captured).toBe(false);
    release();
    await pending;
    expect(
      (await capture).snapshots.find((entry) => entry.kind === "approval-decision")!.snapshot.text,
    ).toBe("old actual shared result");
    expect(next.current()).toBe(true);
    next.release();
    expect(owner.canMutate()).toBe(false);
    oldB.release();
    expect(owner.canMutate()).toBe(true);
    owner.release();
  });
});

describe("owned Parent admission closure", () => {
  const adapter = (sessionId = "root") => ({
    sessionId,
    kind: "composer-parent" as const,
    snapshot: () => ({ text: "  exact  " }),
  });
  const begin = (
    registry: ParentInputRegistry,
    sessionId = "root",
    timeoutMs = 1000,
    signal?: AbortSignal,
  ) => registry.begin(sessionId, { owner: {}, timeoutMs, signal });

  it("synchronously closes fresh mutation/dispatch while another genuine root stays open", async () => {
    const registry = new ParentInputRegistry();
    const root = registry.register(adapter());
    const other = registry.register(adapter("other"));
    const foreign = await registry.capture("other");
    const close = begin(registry);
    expect(root.canMutate()).toBe(false);
    expect(root.admit()).toBeNull();
    expect(other.canMutate()).toBe(true);
    other.changed();
    const captured = await close.capture();
    expect(captured.snapshots[0].snapshot.text).toBe("  exact  ");
    expect(close.current()).toBe(true);
    other.changed();
    expect(close.current()).toBe(true);
    expect(foreign.current()).toBe(false);
    close.release();
    expect(root.canMutate()).toBe(true);
    expect(captured.current()).toBe(false);
    foreign.release();
  });

  it("waits the real old attempt and allows only its synchronous apply, without an ambient await permit", async () => {
    const registry = new ParentInputRegistry();
    let text = "before";
    const owner = registry.register({
      ...adapter(),
      snapshot: () => ({ text }),
    });
    const admitted = owner.admit()!;
    let finish!: () => void;
    const pending = admitted.run(async () => {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      expect(owner.canMutate()).toBe(false);
      admitted.apply(() => {
        expect(owner.canMutate()).toBe(true);
        text = "  admitted result  ";
      });
      expect(owner.canMutate()).toBe(false);
    });
    const close = begin(registry);
    let captured = false;
    const capture = close.capture().then((lease) => {
      captured = true;
      return lease;
    });
    await Promise.resolve();
    admitted.finish();
    expect(registry.inspect().pendingJobs).toBe(1);
    expect(captured).toBe(false);
    finish();
    await pending;
    expect((await capture).snapshots[0].snapshot.text).toBe("  admitted result  ");
    expect(close.current()).toBe(true);
    expect(() => admitted.apply(() => {})).toThrow("owner changed");
    close.release();
  });

  it("keeps deadline and abort gates held until original release while actual jobs remain owned", async () => {
    vi.useFakeTimers();
    const registry = new ParentInputRegistry();
    const owner = registry.register(adapter());
    const admitted = owner.admit()!;
    let finish!: () => void;
    const pending = admitted.run(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const controller = new AbortController();
    const close = begin(registry, "root", 10, controller.signal);
    const capture = close.capture().catch((error) => error);
    controller.abort();
    await vi.advanceTimersByTimeAsync(11);
    expect(await capture).toBeInstanceOf(Error);
    expect(close.current()).toBe(false);
    expect(owner.canMutate()).toBe(false);
    expect(registry.inspect().pendingJobs).toBe(1);
    close.release();
    expect(owner.canMutate()).toBe(true);
    expect(registry.inspect().pendingJobs).toBe(1);
    finish();
    await pending;
    expect(registry.inspect().pendingJobs).toBe(0);
    vi.useRealTimers();
  });

  it("rejects overlap and makes a stale release unable to reopen a newer close", () => {
    const registry = new ParentInputRegistry();
    const owner = registry.register(adapter());
    const first = begin(registry);
    expect(() => begin(registry)).toThrow("busy");
    first.release();
    const second = begin(registry);
    first.release();
    expect(owner.canMutate()).toBe(false);
    expect(second.current()).toBe(true);
    second.release();
  });

  it("invalidates external writes, retirement and mount ABA instead of freezing or retargeting them", async () => {
    const registry = new ParentInputRegistry();
    const owner = registry.register(adapter());
    const close = begin(registry);
    owner.changed();
    expect(close.current()).toBe(false);
    await expect(close.capture()).rejects.toThrow("changed");
    close.release();
    const next = begin(registry);
    owner.release();
    registry.register(adapter());
    expect(next.current()).toBe(false);
    next.release();
  });

  it("binds ticket lineage to the original owner/scope and permits only one resumed branch", () => {
    const registry = new ParentInputRegistry();
    const original = adapter();
    const owner = registry.register(original);
    const admitted = owner.admit()!;
    admitted.finish();
    const close = begin(registry);
    const resumed = admitted.resume()!;
    expect(admitted.resume()).toBeNull();
    expect(owner.admit()).toBeNull();
    original.sessionId = "foreign";
    expect(() => resumed.apply(() => {})).toThrow("owner changed");
    resumed.finish();
    expect(resumed.resume()).toBeNull();
    close.release();
  });

  it("holds an already composing owner before changing editability, and fences newly seen IME", async () => {
    const registry = new ParentInputRegistry();
    let composing = true;
    const owner = registry.register({
      ...adapter(),
      composing: () => composing,
    });
    const first = begin(registry);
    expect(first.current()).toBe(false);
    expect(owner.canMutate()).toBe(true);
    await expect(first.capture()).rejects.toThrow("changed");
    first.release();
    composing = false;
    const next = begin(registry);
    composing = true;
    await expect(next.capture()).rejects.toThrow("composing");
    expect(owner.canMutate()).toBe(false);
    next.release();
  });

  it("keeps ordinary capped observers usable and lets their already admitted work settle", async () => {
    const registry = new ParentInputRegistry({ records: 1 });
    registry.register(adapter());
    const overflow = registry.register(adapter());
    const admitted = overflow.admit()!;
    const close = begin(registry);
    admitted.apply(() => expect(overflow.canMutate()).toBe(true));
    admitted.finish();
    await expect(close.capture()).rejects.toThrow("capacity");
    close.release();
    expect(overflow.canMutate()).toBe(true);
    overflow.release();
  });

  it("invalidates an already captured gate before resuming an original recovery attempt", async () => {
    const registry = new ParentInputRegistry();
    const owner = registry.register(adapter());
    const original = owner.admit()!;
    original.finish();
    const close = begin(registry);
    await close.capture();
    expect(close.current()).toBe(true);
    const resumed = original.resume()!;
    expect(close.current()).toBe(false);
    expect(owner.admit()).toBeNull();
    resumed.finish();
    close.release();
  });

  it("invalidates an old module round and keeps its actual gate/job visible after a fresh import", async () => {
    let text = "original module";
    const owner = registerParentInput({
      ...adapter("hmr-root"),
      snapshot: () => ({ text }),
    });
    const admitted = owner.admit()!;
    let finish!: () => void;
    const pending = admitted.run(async () => {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      admitted.apply(() => {
        text = "  old actual result  ";
      });
    });
    const oldClose = beginParentInputClosure("hmr-root", {
      owner: {},
      timeoutMs: 1000,
    });
    vi.resetModules();
    const fresh = await import("./parentInputClosure");
    expect(oldClose.current()).toBe(false);
    expect(() => fresh.beginParentInputClosure("hmr-root", { owner: {}, timeoutMs: 1000 })).toThrow(
      "busy",
    );
    expect(owner.canMutate()).toBe(false);
    oldClose.release();
    const next = fresh.beginParentInputClosure("hmr-root", {
      owner: {},
      timeoutMs: 1000,
    });
    let captured = false;
    const capture = next.capture().then((lease) => {
      captured = true;
      return lease;
    });
    await Promise.resolve();
    expect(captured).toBe(false);
    finish();
    await pending;
    expect((await capture).snapshots[0].snapshot.text).toBe("  old actual result  ");
    expect(next.current()).toBe(true);
    next.release();
    owner.release();
  });
});
