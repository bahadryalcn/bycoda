import { beforeEach, describe, expect, it } from "vitest";
import { applyRemoteGroupRecords, captureLocalGroupChanges } from "./syncGroups";
import { captureLocalProjectChanges, localProjectIdsByPath } from "./syncProjects";
import { rememberProject } from "../../projects/model/recents";
import { applyPushResult, markPullCompleted, markPulled, takeOutbox } from "./syncPeerState";
import {
  loadProjectGroupAssignments,
  loadProjectGroups,
  saveProjectGroupAssignments,
  saveProjectGroups,
} from "../../projects/model/projectGroups";

function mockLocalStorage() {
  const data = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    value: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
      removeItem: (key: string) => void data.delete(key),
    },
    configurable: true,
  });
}

const MACHINE = "host-1";

describe("syncGroups", () => {
  beforeEach(mockLocalStorage);

  it("captures each local group as its own op, keyed by the group id", () => {
    saveProjectGroups([{ id: "g1", name: "Work", collapsed: false }]);
    captureLocalGroupChanges(MACHINE);
    const ops = takeOutbox(MACHINE);
    expect(ops).toContainEqual(
      expect.objectContaining({ table: "group", id: "g1", value: { id: "g1", name: "Work" } }),
    );
  });

  it("never sends collapsed and keeps this machine's own collapsed state on apply", () => {
    saveProjectGroups([{ id: "g1", name: "Work", collapsed: true }]);
    captureLocalGroupChanges(MACHINE);
    expect(takeOutbox(MACHINE).find((op) => op.table === "group")?.value).not.toHaveProperty(
      "collapsed",
    );
    applyRemoteGroupRecords(MACHINE, [
      { table: "group", id: "g1", rev: 2, value: { id: "g1", name: "Renamed", collapsed: false } },
      { table: "group", id: "g2", rev: 3, value: { id: "g2", name: "New", collapsed: true } },
    ]);
    expect(loadProjectGroups()).toEqual([
      { id: "g1", name: "Renamed", collapsed: true },
      { id: "g2", name: "New", collapsed: false },
    ]);
  });

  it("flipping collapsed locally queues nothing", () => {
    saveProjectGroups([{ id: "g1", name: "Work", collapsed: false }]);
    markPulled(MACHINE, [{ table: "group", id: "g1", rev: 1, value: { name: "Work", id: "g1" } }]);
    saveProjectGroups([{ id: "g1", name: "Work", collapsed: true }]);
    captureLocalGroupChanges(MACHINE);
    expect(takeOutbox(MACHINE).some((op) => op.table === "group")).toBe(false);
  });

  it("applying a remote group record adds it locally", () => {
    applyRemoteGroupRecords(MACHINE, [
      { table: "group", id: "g2", rev: 1, value: { id: "g2", name: "Personal", collapsed: false } },
    ]);
    expect(loadProjectGroups()).toEqual([{ id: "g2", name: "Personal", collapsed: false }]);
  });

  it("a tombstoned group record removes it locally", () => {
    saveProjectGroups([{ id: "g1", name: "Work", collapsed: false }]);
    applyRemoteGroupRecords(MACHINE, [{ table: "group", id: "g1", rev: 2, value: null }]);
    expect(loadProjectGroups()).toEqual([]);
  });

  it("captures and applies assignments by project sync id", () => {
    saveProjectGroups([{ id: "g1", name: "Work", collapsed: false }]);
    saveProjectGroupAssignments({ "/home/me/app": "g1" });
    captureLocalGroupChanges(MACHINE, { "/home/me/app": "proj-1" });
    expect(takeOutbox(MACHINE)).toContainEqual(
      expect.objectContaining({
        table: "assignment",
        id: "proj-1",
        value: { projectId: "proj-1", groupId: "g1" },
      }),
    );
    applyRemoteGroupRecords(MACHINE, [
      { table: "assignment", id: "proj-2", rev: 3, value: { projectId: "proj-2", groupId: "g1" } },
    ]);
    // Applying an assignment keyed by a projectId this machine cannot map
    // to a local path yet is accepted without throwing; nothing local
    // changes until a matching path/project id arrives (Task 7).
    expect(loadProjectGroupAssignments()).toEqual({ "/home/me/app": "g1" });
  });

  it("updating a group in place keeps the local group order", () => {
    saveProjectGroups([
      { id: "g1", name: "Work", collapsed: false },
      { id: "g2", name: "Home", collapsed: false },
    ]);
    applyRemoteGroupRecords(MACHINE, [
      { table: "group", id: "g1", rev: 2, value: { id: "g1", name: "Work 2", collapsed: true } },
    ]);
    expect(loadProjectGroups().map((group) => group.id)).toEqual(["g1", "g2"]);
    expect(loadProjectGroups()[0].name).toBe("Work 2");
  });

  it("a group tombstone removes its assignments from storage", () => {
    saveProjectGroups([{ id: "g1", name: "Work", collapsed: false }]);
    saveProjectGroupAssignments({ "/home/me/app": "g1" });
    applyRemoteGroupRecords(MACHINE, [{ table: "group", id: "g1", rev: 2, value: null }]);
    expect(JSON.parse(localStorage.getItem("bycoda.projectGroupAssignments") ?? "{}")).toEqual({});
  });

  it("never tombstones an assignment this machine has not itself had", () => {
    captureLocalGroupChanges(MACHINE, { "/home/me/app": "proj-1" });
    expect(takeOutbox(MACHINE).some((op) => op.table === "assignment")).toBe(false);
    // Another machine's assignment, known from the host but for a group not present here.
    markPulled(MACHINE, [
      { table: "assignment", id: "proj-1", rev: 4, value: { projectId: "proj-1", groupId: "far" } },
    ]);
    captureLocalGroupChanges(MACHINE, { "/home/me/app": "proj-1" });
    expect(takeOutbox(MACHINE).some((op) => op.table === "assignment")).toBe(false);
  });

  it("tombstones an assignment that was assigned here, is known to the host, and was removed here", () => {
    saveProjectGroups([{ id: "g1", name: "Work", collapsed: false }]);
    saveProjectGroupAssignments({ "/home/me/app": "g1" });
    const ids = { "/home/me/app": "proj-1" };
    captureLocalGroupChanges(MACHINE, ids);
    const sent = takeOutbox(MACHINE);
    applyPushResult(
      MACHINE,
      { rev: 2, applied: sent.map((op) => ({ table: op.table, id: op.id, rev: 2 })), rejected: [] },
      sent,
    );
    saveProjectGroupAssignments({});
    captureLocalGroupChanges(MACHINE, ids);
    expect(takeOutbox(MACHINE).find((op) => op.table === "assignment")).toMatchObject({
      id: "proj-1",
      baseRev: 2,
      value: null,
    });
  });

  it("adopts a host assignment that arrived before this machine had the folder", () => {
    saveProjectGroups([{ id: "g1", name: "Work", collapsed: false }]);
    markPulled(MACHINE, [
      { table: "assignment", id: "proj-1", rev: 2, value: { projectId: "proj-1", groupId: "g1" } },
    ]);
    captureLocalGroupChanges(MACHINE, { "/home/me/app": "proj-1" });
    expect(loadProjectGroupAssignments()).toEqual({ "/home/me/app": "g1" });
    expect(takeOutbox(MACHINE).some((op) => op.table === "assignment")).toBe(false);
  });

  it("does not push a group order before the first pull", () => {
    saveProjectGroups([{ id: "g1", name: "A", collapsed: false }]);
    captureLocalGroupChanges(MACHINE);
    expect(takeOutbox(MACHINE).some((op) => op.table === "groupOrder")).toBe(false);
  });

  it("applies an assignment record when the project id resolves to a local path", () => {
    rememberProject("/home/me/code/app");
    captureLocalProjectChanges(MACHINE);
    const [pathKeyValue, projectId] = Object.entries(localProjectIdsByPath())[0];
    saveProjectGroups([{ id: "g1", name: "Work", collapsed: false }]);
    applyRemoteGroupRecords(MACHINE, [
      { table: "assignment", id: projectId, rev: 4, value: { projectId, groupId: "g1" } },
    ]);
    expect(loadProjectGroupAssignments()).toEqual({ [pathKeyValue]: "g1" });
  });

  it("tombstones a group that was seen locally, known to the host, then deleted", () => {
    saveProjectGroups([{ id: "g1", name: "Work", collapsed: false }]);
    captureLocalGroupChanges(MACHINE);
    markPulled(MACHINE, [
      { table: "group", id: "g1", rev: 1, value: { id: "g1", name: "Work", collapsed: false } },
    ]);
    takeOutbox(MACHINE);
    saveProjectGroups([]);
    captureLocalGroupChanges(MACHINE);
    expect(takeOutbox(MACHINE)).toContainEqual(
      expect.objectContaining({ table: "group", id: "g1", value: null }),
    );
  });

  it("does not tombstone a host-known group this machine never had locally", () => {
    markPulled(MACHINE, [
      { table: "group", id: "g9", rev: 1, value: { id: "g9", name: "Far", collapsed: false } },
    ]);
    captureLocalGroupChanges(MACHINE);
    expect(takeOutbox(MACHINE).some((op) => op.table === "group" && op.id === "g9")).toBe(false);
  });

  it("strips machine-local workspace fields on capture", () => {
    saveProjectGroups([
      {
        id: "g1",
        name: "Work",
        collapsed: false,
        workspaceFile: "/a/x.code-workspace",
        workspaceFolders: ["/a"],
      },
    ]);
    captureLocalGroupChanges(MACHINE);
    const op = takeOutbox(MACHINE).find((o) => o.table === "group");
    expect(op?.value).not.toHaveProperty("workspaceFile");
    expect(op?.value).not.toHaveProperty("workspaceFolders");
  });

  it("keeps local workspace fields on apply and omits them for new groups", () => {
    saveProjectGroups([
      {
        id: "g1",
        name: "Work",
        collapsed: false,
        workspaceFile: "/a/x.code-workspace",
        workspaceFolders: ["/a"],
      },
    ]);
    applyRemoteGroupRecords(MACHINE, [
      {
        table: "group",
        id: "g1",
        rev: 2,
        value: {
          id: "g1",
          name: "Work 2",
          collapsed: false,
          workspaceFile: "/b/y.code-workspace",
          workspaceFolders: ["/b"],
        },
      },
      {
        table: "group",
        id: "g2",
        rev: 1,
        value: {
          id: "g2",
          name: "New",
          collapsed: false,
          workspaceFile: "/b/z.code-workspace",
          workspaceFolders: ["/b"],
        },
      },
    ]);
    const groups = loadProjectGroups();
    expect(groups[0]).toMatchObject({
      name: "Work 2",
      workspaceFile: "/a/x.code-workspace",
      workspaceFolders: ["/a"],
    });
    expect(groups[1]).not.toHaveProperty("workspaceFile");
  });

  it("captures group order as one groupOrder op and reaches a fixed point", () => {
    saveProjectGroups([
      { id: "g1", name: "A", collapsed: false },
      { id: "g2", name: "B", collapsed: false },
    ]);
    markPullCompleted(MACHINE);
    captureLocalGroupChanges(MACHINE);
    const op = takeOutbox(MACHINE).find((o) => o.table === "groupOrder");
    expect(op).toMatchObject({ id: "groups", value: { order: ["g1", "g2"] } });
    const sent = takeOutbox(MACHINE);
    applyPushResult(
      MACHINE,
      {
        rev: sent.length,
        applied: sent.map((o, i) => ({ table: o.table, id: o.id, rev: i + 1 })),
        rejected: [],
      },
      sent,
    );
    captureLocalGroupChanges(MACHINE);
    expect(takeOutbox(MACHINE)).toEqual([]);
  });

  it("two machines converge on the order without echoing", () => {
    saveProjectGroups([
      { id: "g1", name: "A", collapsed: false },
      { id: "g2", name: "B", collapsed: false },
    ]);
    const remote = {
      table: "groupOrder" as const,
      id: "groups",
      rev: 3,
      value: { order: ["g2", "g3", "g1"] },
    };
    applyRemoteGroupRecords(MACHINE, [
      { table: "group", id: "g3", rev: 3, value: { id: "g3", name: "C", collapsed: false } },
      remote,
    ]);
    expect(loadProjectGroups().map((g) => g.id)).toEqual(["g2", "g3", "g1"]);
    markPulled(MACHINE, [
      remote,
      { table: "group", id: "g3", rev: 3, value: { id: "g3", name: "C", collapsed: false } },
      { table: "group", id: "g1", rev: 1, value: { id: "g1", name: "A", collapsed: false } },
      { table: "group", id: "g2", rev: 1, value: { id: "g2", name: "B", collapsed: false } },
    ]);
    captureLocalGroupChanges(MACHINE);
    expect(takeOutbox(MACHINE).some((o) => o.table === "groupOrder")).toBe(false);
  });

  it("a local reorder keeps foreign ids at their host positions", () => {
    saveProjectGroups([
      { id: "g2", name: "B", collapsed: false },
      { id: "g1", name: "A", collapsed: false },
    ]);
    markPulled(MACHINE, [
      { table: "groupOrder", id: "groups", rev: 1, value: { order: ["g1", "gx", "g2"] } },
    ]);
    captureLocalGroupChanges(MACHINE);
    expect(takeOutbox(MACHINE).find((o) => o.table === "groupOrder")?.value).toEqual({
      order: ["g2", "gx", "g1"],
    });
  });

  it("remote order skips unknown ids and keeps local-only groups after", () => {
    saveProjectGroups([
      { id: "g1", name: "A", collapsed: false },
      { id: "g2", name: "B", collapsed: false },
      { id: "g4", name: "D", collapsed: false },
    ]);
    applyRemoteGroupRecords(MACHINE, [
      { table: "groupOrder", id: "groups", rev: 2, value: { order: ["g2", "zz", "g1"] } },
    ]);
    expect(loadProjectGroups().map((g) => g.id)).toEqual(["g2", "g1", "g4"]);
  });
});
