import { describe, expect, it } from "vitest";
import { createMountedEditorClosure, type MountedEditorRead } from "./mountedEditorClosure";

describe("passive mounted editor input leases", () => {
  it("retains exact immutable raw data and never guesses session ownership", async () => {
    const registry = createMountedEditorClosure();
    const source = {
      text: " \t\nç😀",
      diskBaseline: "\ufeffdisk\r\n",
      eol: "crlf",
      optional: undefined,
    };
    registry.register(() => ({ snapshot: source }));
    const lease = await registry.captureEditorInputs("session");
    expect(lease.current()).toBe(true);
    expect(lease.snapshots).toHaveLength(1);
    expect(lease.snapshots[0]).toMatchObject({
      id: 1,
      revision: 0,
      kind: "file-editor",
      snapshot: source,
    });
    expect(lease.snapshots[0]).not.toHaveProperty("sessionId");
    expect(Object.prototype.hasOwnProperty.call(lease.snapshots[0].snapshot, "optional")).toBe(
      true,
    );
    expect(Object.isFrozen(lease.snapshots[0].snapshot)).toBe(true);
    expect(lease.missingCoverage).toEqual(
      expect.arrayContaining([
        "editor-profile-shared",
        "editor-admission-open",
        "buffers",
        "filesystem",
      ]),
    );
    source.text = "later";
    expect(lease.current()).toBe(false);
    expect(lease.snapshots[0].snapshot.text).toBe(" \t\nç😀");
    lease.release();
  });
  it("invalidates irreversibly on a late edit even when the body is restored", async () => {
    const registry = createMountedEditorClosure();
    const registration = registry.register(() => ({ snapshot: { text: "same" } }));
    const before = await registry.captureEditorInputs("s");
    registration.changed();
    expect(before.current()).toBe(false);
    const after = await registry.captureEditorInputs("s");
    expect(after.registryEpoch).toBeGreaterThan(before.registryEpoch);
    expect(after.snapshots[0].revision).toBe(1);
    expect(after.current()).toBe(true);
    before.release();
    after.release();
  });
  it("invalidates on roster changes and never treats retirement as an empty successful old roster", async () => {
    const registry = createMountedEditorClosure();
    const first = registry.register(() => ({ snapshot: { documentId: "a" } }));
    const before = await registry.captureEditorInputs("s");
    const second = registry.register(() => ({
      snapshot: { documentId: "a", text: "other mount" },
    }));
    expect(before.current()).toBe(false);
    const both = await registry.captureEditorInputs("s");
    expect(both.snapshots.map((item) => item.id)).toEqual([1, 2]);
    first.unregister();
    expect(both.current()).toBe(false);
    second.unregister();
    before.release();
    both.release();
  });
  it("holds loading/composition/accepted operations without taking or saving a partial capture", async () => {
    const registry = createMountedEditorClosure();
    let busy: string | undefined = "composition";
    registry.register(() => ({ snapshot: { text: "kept" }, ...(busy ? { busy } : {}) }));
    await expect(registry.captureEditorInputs("s")).rejects.toMatchObject({ code: "busy" });
    busy = undefined;
    const lease = await registry.captureEditorInputs("s");
    expect(lease.current()).toBe(true);
    busy = "save";
    expect(lease.current()).toBe(false);
    lease.release();
  });
  it("keeps unknown bindings and other origins explicit instead of dropping their actual mount", async () => {
    const registry = createMountedEditorClosure();
    registry.register(() => ({
      snapshot: { text: "", origin: "remote", draftBinding: { phase: "unknown", receipt: null } },
      missingCoverage: ["editor-native-binding", "editor-remote-origin"],
    }));
    const lease = await registry.captureEditorInputs("s");
    expect(lease.snapshots).toHaveLength(1);
    expect(lease.missingCoverage).toContain("editor-native-binding");
    lease.release();
    expect(lease.current()).toBe(false);
    lease.release();
  });
  it("bounds leases and recovers capacity only when their original owners release them", async () => {
    const registry = createMountedEditorClosure();
    const leases = await Promise.all(
      Array.from({ length: 32 }, () => registry.captureEditorInputs("s")),
    );
    await expect(registry.captureEditorInputs("s")).rejects.toMatchObject({ code: "capacity" });
    leases[0].release();
    leases[0].release();
    const replacement = await registry.captureEditorInputs("s");
    replacement.release();
    leases.forEach((lease) => lease.release());
  });
  it("preserves overflow mounts as held state without crashing registration or silently omitting them", async () => {
    const registry = createMountedEditorClosure();
    const registrations = Array.from({ length: 257 }, () =>
      registry.register(() => ({ snapshot: {} })),
    );
    await expect(registry.captureEditorInputs("s")).rejects.toMatchObject({ code: "capacity" });
    registrations.pop()!.unregister();
    const lease = await registry.captureEditorInputs("s");
    expect(lease.snapshots).toHaveLength(256);
    lease.release();
    registrations.forEach((item) => item.unregister());
  });
  it("rejects accessors, invalid Unicode and scope before returning a lease", async () => {
    const registry = createMountedEditorClosure();
    let value: MountedEditorRead = { snapshot: { text: "\ud800" } };
    const registration = registry.register(() => value);
    await expect(registry.captureEditorInputs("s")).rejects.toMatchObject({
      code: "invalid-snapshot",
    });
    value = {
      snapshot: {
        get text() {
          throw new Error("not data");
        },
      },
    };
    await expect(registry.captureEditorInputs("s")).rejects.toMatchObject({
      code: "invalid-snapshot",
    });
    await expect(registry.captureEditorInputs("")).rejects.toMatchObject({ code: "invalid-scope" });
    registration.unregister();
  });
  it("rejects a roster changed synchronously by an adapter instead of issuing a closed partial roster", async () => {
    const registry = createMountedEditorClosure();
    let added = false;
    registry.register(() => {
      if (!added) {
        added = true;
        registry.register(() => ({ snapshot: { text: "new mount" } }));
      }
      return { snapshot: { text: "original" } };
    });
    await expect(registry.captureEditorInputs("s")).rejects.toMatchObject({ code: "busy" });
    const lease = await registry.captureEditorInputs("s");
    expect(lease.snapshots).toHaveLength(2);
    expect(lease.current()).toBe(true);
    lease.release();
  });
});
