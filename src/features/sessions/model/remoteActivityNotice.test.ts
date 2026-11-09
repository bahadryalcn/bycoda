import { afterEach, describe, expect, it } from "vitest";
import {
  dismissRemoteActivityNotice,
  getRemoteActivityNotices,
  noteRemoteActivity,
} from "./remoteActivityNotice";

describe("remote activity notice", () => {
  afterEach(() => {
    for (const notice of getRemoteActivityNotices()) dismissRemoteActivityNotice(notice);
  });

  it("adds one kind of action up into one notice per scope", () => {
    const app = { cwd: "/work/app" };
    noteRemoteActivity({ scope: app, kind: "deleted", device: "Laptop" });
    noteRemoteActivity({ scope: app, kind: "deleted", device: "Laptop" });
    noteRemoteActivity({ scope: app, kind: "deleted", device: "Phone", ok: false });
    noteRemoteActivity({ scope: app, kind: "stopped", device: "Phone" });
    noteRemoteActivity({ scope: "inbox", kind: "inbox" });
    expect(getRemoteActivityNotices()).toEqual([
      { scope: app, kind: "deleted", done: 2, failed: 1, devices: ["Laptop", "Phone"] },
      { scope: app, kind: "stopped", done: 1, failed: 0, devices: ["Phone"] },
      { scope: "inbox", kind: "inbox", done: 1, failed: 0, devices: [] },
    ]);
  });

  it("starts over after a notice is dismissed and leaves the others", () => {
    noteRemoteActivity({ scope: { cwd: "/work/app" }, kind: "deleted", device: "Laptop" });
    noteRemoteActivity({ scope: { cwd: "/work/app" }, kind: "archived", device: "Laptop" });
    dismissRemoteActivityNotice(getRemoteActivityNotices()[0]!);
    expect(getRemoteActivityNotices().map((notice) => notice.kind)).toEqual(["archived"]);
    noteRemoteActivity({ scope: { cwd: "/work/app" }, kind: "deleted", device: "Laptop" });
    expect(getRemoteActivityNotices().find((notice) => notice.kind === "deleted")?.done).toBe(1);
  });
});
