import { describe, expect, it, vi } from "vitest";
import { createHostMetadataMirror, hostMetadataPatch } from "./adoptedSessionMetadata";
import type { HostSession } from "./protocol";

const host = (id: string, flags: { archived?: boolean; pinned?: boolean } = {}) =>
  ({ session: { id }, projectId: "project-1", ...flags }) as unknown as HostSession;

describe("hostMetadataPatch", () => {
  it("applies only the field the host changed since it was last seen", () => {
    const seen = { archived: false, pinned: false };
    expect(hostMetadataPatch(seen, { archived: true, pinned: false }, false)).toEqual({
      archived: true,
    });
    expect(hostMetadataPatch(seen, { pinned: true }, false)).toEqual({ pinned: true });
    expect(hostMetadataPatch(seen, {}, false)).toBeUndefined();
  });

  it("only remembers a value it has no earlier sighting of when seeding", () => {
    expect(hostMetadataPatch(undefined, { archived: true }, true)).toBeUndefined();
    expect(hostMetadataPatch(undefined, { archived: true }, false)).toEqual({
      archived: true,
      pinned: false,
    });
  });
});

describe("createHostMetadataMirror", () => {
  it("carries a remote archive and pin of a session adopted while running into this desktop", async () => {
    const apply = vi.fn(async () => {});
    const mirror = createHostMetadataMirror(apply);
    mirror.start(["old"]);
    await mirror.observe(host("native-1"));
    expect(apply).toHaveBeenCalledWith("native-1", "project-1", { archived: false, pinned: false });
    apply.mockClear();
    await mirror.observe(host("native-1", { archived: true }));
    expect(apply).toHaveBeenCalledWith("native-1", "project-1", { archived: true });
    await mirror.observe(host("native-1", { archived: true, pinned: true }));
    expect(apply).toHaveBeenLastCalledWith("native-1", "project-1", { pinned: true });
  });

  it("does not undo what this desktop changed for a session the host already held at start", async () => {
    const apply = vi.fn(async () => {});
    const mirror = createHostMetadataMirror(apply);
    mirror.start(["held"]);
    // The host copy still says unarchived although this desktop archived it.
    await mirror.observe(host("held"));
    await mirror.observe(host("held"));
    expect(apply).not.toHaveBeenCalled();
    await mirror.observe(host("held", { archived: true }));
    expect(apply).toHaveBeenCalledWith("held", "project-1", { archived: true });
  });

  it("tries again when writing the desktop store failed", async () => {
    const apply = vi.fn().mockRejectedValueOnce(new Error("busy")).mockResolvedValue(undefined);
    const mirror = createHostMetadataMirror(apply);
    mirror.start([]);
    await expect(mirror.observe(host("a", { archived: true }))).rejects.toThrow("busy");
    await mirror.observe(host("a", { archived: true }));
    expect(apply).toHaveBeenCalledTimes(2);
  });
});
