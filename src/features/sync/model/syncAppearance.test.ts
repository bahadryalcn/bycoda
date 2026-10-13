import { beforeEach, describe, expect, it } from "vitest";
import { pathKey } from "../../../shared/lib/paths";
import { forgetProject, rememberProject } from "../../projects/model/recents";
import {
  loadTabGroupColors,
  loadTabGroupCustomColors,
  loadTabGroupLabels,
  loadTabGroupLogos,
  loadTabGroupMascots,
  saveTabGroupColor,
  saveTabGroupCustomColor,
  saveTabGroupLabel,
  saveTabGroupLogo,
  saveTabGroupMascot,
  saveWorkspaceProjectNames,
} from "../../workspace/model/tabGroups";
import { applyRemoteAppearanceRecords, captureLocalAppearanceChanges } from "./syncAppearance";
import { localMachineId } from "./syncMachineId";
import { applyPushResult, markPulled, takeOutbox } from "./syncPeerState";
import { machineProjectId } from "./syncProjectId";
import { captureLocalProjectChanges, localProjectIdsByPath } from "./syncProjects";
import type { SyncRecord } from "./syncProtocol";

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
const PATH = "/home/me/code/web-portal";
const KEY = pathKey(PATH);
const ID = machineProjectId(localMachineId(), PATH);

function capture(): void {
  captureLocalProjectChanges(MACHINE);
  captureLocalAppearanceChanges(MACHINE, localProjectIdsByPath());
}

const appearanceOps = () => takeOutbox(MACHINE).filter((op) => op.table === "appearance");

/** Settles the outbox as a host that accepts everything would. */
function pushAll(rev: number): void {
  const sent = takeOutbox(MACHINE);
  applyPushResult(
    MACHINE,
    { rev, applied: sent.map((op) => ({ table: op.table, id: op.id, rev })), rejected: [] },
    sent,
  );
}

/** What a pull does with records: apply, then remember them as the host's. */
function pull(records: SyncRecord[]): void {
  applyRemoteAppearanceRecords(MACHINE, records);
  markPulled(MACHINE, records);
}

const record = (rev: number, value: SyncRecord["value"], id = ID): SyncRecord => ({
  table: "appearance",
  id,
  rev,
  value,
});

describe("syncAppearance", () => {
  beforeEach(mockLocalStorage);

  it("syncs workspace aliases independently of custom labels under full-path project IDs", () => {
    rememberProject(PATH);
    saveTabGroupLabel(KEY, "previous custom name");
    saveWorkspaceProjectNames([PATH], { [KEY]: "pf-account-srv" });
    capture();
    expect(appearanceOps()[0].value).toEqual({
      projectId: ID,
      label: "previous custom name",
      workspaceLabel: "pf-account-srv",
    });
    pushAll(1);
    pull([
      record(2, { projectId: ID, label: "previous custom name", workspaceLabel: "account-api" }),
    ]);
    expect(loadTabGroupLabels()[KEY]).toBe("account-api");
    pull([record(3, { projectId: ID, label: "previous custom name" })]);
    expect(loadTabGroupLabels()[KEY]).toBe("previous custom name");
  });

  it("captures label, color and mascot under the project's sync id, never the logo", () => {
    rememberProject(PATH);
    saveTabGroupLabel(KEY, "ai ui-portal");
    saveTabGroupColor(KEY, 3);
    saveTabGroupMascot(KEY, "cat");
    saveTabGroupLogo(KEY, "/home/me/logo.png");
    capture();
    expect(appearanceOps()).toEqual([
      {
        table: "appearance",
        id: ID,
        baseRev: 0,
        value: { projectId: ID, label: "ai ui-portal", colorIndex: 3, mascot: "cat" },
      },
    ]);
  });

  it("sends a custom color instead of a palette index", () => {
    rememberProject(PATH);
    saveTabGroupCustomColor(KEY, "#AABBCC");
    capture();
    expect(appearanceOps()[0].value).toEqual({ projectId: ID, customColor: "#aabbcc" });
  });

  it("queues nothing for a project without a custom appearance", () => {
    rememberProject(PATH);
    capture();
    expect(appearanceOps()).toEqual([]);
  });

  it("applies a record through the appearance stores and does not echo it", () => {
    rememberProject(PATH);
    capture();
    pull([
      record(5, { projectId: ID, label: "ai ui-portal", customColor: "#112233", mascot: "fox" }),
    ]);
    expect(loadTabGroupLabels()[KEY]).toBe("ai ui-portal");
    expect(loadTabGroupCustomColors()[KEY]).toBe("#112233");
    expect(loadTabGroupMascots()[KEY]).toBe("fox");
    capture();
    expect(appearanceOps()).toEqual([]);
  });

  it("replaces fields the record no longer carries and keeps the logo", () => {
    rememberProject(PATH);
    saveTabGroupLabel(KEY, "old");
    saveTabGroupCustomColor(KEY, "#112233");
    saveTabGroupMascot(KEY, "cat");
    saveTabGroupLogo(KEY, "/home/me/logo.png");
    capture();
    pull([record(5, { projectId: ID, colorIndex: 2 })]);
    expect(loadTabGroupLabels()[KEY]).toBeUndefined();
    expect(loadTabGroupCustomColors()[KEY]).toBeUndefined();
    expect(loadTabGroupColors()[KEY]).toBe(2);
    expect(loadTabGroupMascots()[KEY]).toBeUndefined();
    expect(loadTabGroupLogos()[KEY]).toBe("/home/me/logo.png");
  });

  it("ignores fields it cannot store", () => {
    rememberProject(PATH);
    capture();
    pull([
      record(5, {
        projectId: ID,
        label: 7,
        colorIndex: 99,
        customColor: "red",
        mascot: "fox",
      } as never),
    ]);
    expect(loadTabGroupLabels()[KEY]).toBeUndefined();
    expect(loadTabGroupColors()[KEY]).toBeUndefined();
    expect(loadTabGroupCustomColors()[KEY]).toBeUndefined();
    expect(loadTabGroupMascots()[KEY]).toBe("fox");
  });

  it("pushes a tombstone when a synced appearance is reset locally", () => {
    rememberProject(PATH);
    saveTabGroupLabel(KEY, "ai ui-portal");
    capture();
    pushAll(4);
    saveTabGroupLabel(KEY, "");
    capture();
    expect(appearanceOps()).toEqual([{ table: "appearance", id: ID, baseRev: 4, value: null }]);
    pushAll(5);
    capture();
    expect(appearanceOps()).toEqual([]);
  });

  it("a rename reset before it was ever pushed leaves nothing on the host", () => {
    rememberProject(PATH);
    saveTabGroupLabel(KEY, "ai ui-portal");
    capture();
    saveTabGroupLabel(KEY, "");
    capture();
    expect(appearanceOps()).toEqual([{ table: "appearance", id: ID, baseRev: 0, value: null }]);
  });

  it("a tombstone clears an appearance this machine applied", () => {
    rememberProject(PATH);
    capture();
    pull([record(5, { projectId: ID, label: "ai ui-portal", colorIndex: 2, mascot: "fox" })]);
    saveTabGroupLogo(KEY, "/home/me/logo.png");
    pull([record(6, null)]);
    expect(loadTabGroupLabels()).toEqual({});
    expect(loadTabGroupColors()).toEqual({});
    expect(loadTabGroupMascots()).toEqual({});
    expect(loadTabGroupLogos()[KEY]).toBe("/home/me/logo.png");
    capture();
    expect(appearanceOps()).toEqual([]);
  });

  it("first contact: an unstyled project takes the host's appearance instead of deleting it", () => {
    rememberProject(PATH);
    // The record was pulled before this machine had resolved the project.
    pull([record(5, { projectId: ID, label: "ai ui-portal", colorIndex: 2 })]);
    expect(loadTabGroupLabels()).toEqual({});
    capture();
    expect(appearanceOps()).toEqual([]);
    expect(loadTabGroupLabels()[KEY]).toBe("ai ui-portal");
    expect(loadTabGroupColors()[KEY]).toBe(2);
    capture();
    expect(appearanceOps()).toEqual([]);
  });

  it("first contact: an old tombstone does not wipe a local rename", () => {
    rememberProject(PATH);
    saveTabGroupLabel(KEY, "mine");
    captureLocalProjectChanges(MACHINE);
    pull([record(5, null)]);
    expect(loadTabGroupLabels()[KEY]).toBe("mine");
    capture();
    expect(appearanceOps()).toEqual([
      { table: "appearance", id: ID, baseRev: 5, value: { projectId: ID, label: "mine" } },
    ]);
  });

  it("a project that left the rail and came back takes the host's appearance again", () => {
    rememberProject(PATH);
    saveTabGroupLabel(KEY, "ai ui-portal");
    capture();
    pushAll(4);
    forgetProject(PATH);
    saveTabGroupLabel(KEY, "");
    capture();
    expect(appearanceOps()).toEqual([]);
    rememberProject(PATH);
    capture();
    expect(appearanceOps()).toEqual([]);
    expect(loadTabGroupLabels()[KEY]).toBe("ai ui-portal");
  });

  it("a remote rail project is styled under its remote path", () => {
    const remote = "remote://env-w/C:/work/web-portal";
    rememberProject(remote);
    capture();
    const id = "loc:env-w:c:/work/web-portal";
    pull([record(5, { projectId: id, label: "ai ui-portal" }, id)]);
    expect(loadTabGroupLabels()).toEqual({ [pathKey(remote)]: "ai ui-portal" });
    saveTabGroupLabel(pathKey(remote), "portal");
    capture();
    expect(appearanceOps()).toEqual([
      { table: "appearance", id, baseRev: 5, value: { projectId: id, label: "portal" } },
    ]);
  });
});
