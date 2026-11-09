// @vitest-environment happy-dom
import { beforeEach, expect, it } from "vitest";
import { LEGACY_NAME, migrateLegacyStorage } from "./legacyStorageMigration";

const remote = "remote://env/Users/me/projects/family-site";
const json = (key: string) => JSON.parse(localStorage.getItem(key) ?? "null");

beforeEach(() => localStorage.clear());

it("does nothing without legacy keys", () => {
  localStorage.setItem("bycoda.recentProjects", "[]");
  expect(migrateLegacyStorage()).toBe(false);
  expect(localStorage.getItem("bycoda.recentProjects")).toBe("[]");
});

it("merges legacy projects and groups into the current keys, then drops every legacy key", () => {
  localStorage.setItem(
    "bycoda.recentProjects",
    JSON.stringify([{ path: "G:/work/web", openedAt: 2 }]),
  );
  localStorage.setItem(
    `${LEGACY_NAME}.recentProjects`,
    JSON.stringify([
      { path: "g:/work/web", openedAt: 1 },
      { path: remote, openedAt: 1 },
    ]),
  );
  localStorage.setItem("bycoda.projectGroups", JSON.stringify([{ id: "g1", name: "personal" }]));
  localStorage.setItem(
    `${LEGACY_NAME}.projectGroups`,
    JSON.stringify([
      { id: "g1", name: "old" },
      { id: "g2", name: "work" },
    ]),
  );
  localStorage.setItem("bycoda.projectGroupAssignments", JSON.stringify({ "g:/work/web": "g2" }));
  localStorage.setItem(
    `${LEGACY_NAME}.projectGroupAssignments`,
    JSON.stringify({
      "g:/work/web": "g1",
      [remote]: "g1",
      "/gone": "missing",
    }),
  );
  localStorage.setItem(`${LEGACY_NAME}.projectRailOrder`, JSON.stringify([remote]));
  localStorage.setItem(
    `${LEGACY_NAME}.remote-projects.v2`,
    JSON.stringify({ [remote]: { key: remote } }),
  );
  localStorage.setItem(
    `${LEGACY_NAME}.sync.dismissedRemoteProjects.v2`,
    JSON.stringify(["loc:env:/x"]),
  );
  localStorage.setItem(
    `${LEGACY_NAME}:tab-group:mascots`,
    JSON.stringify({ [remote]: "mushroom" }),
  );
  localStorage.setItem(`${LEGACY_NAME}.remote-history.v2:${remote}`, "[1]");
  localStorage.setItem(`${LEGACY_NAME}.uiScale`, "1.2");
  localStorage.setItem(`${LEGACY_NAME}.sync.machineId`, "old");

  expect(migrateLegacyStorage()).toBe(true);

  expect(json("bycoda.recentProjects")).toEqual([
    { path: "G:/work/web", openedAt: 2 },
    { path: remote, openedAt: 1 },
  ]);
  expect(json("bycoda.projectGroups")).toEqual([
    { id: "g1", name: "personal" },
    { id: "g2", name: "work" },
  ]);
  expect(json("bycoda.projectGroupAssignments")).toEqual({ "g:/work/web": "g2", [remote]: "g1" });
  expect(json("bycoda.projectRailOrder")).toEqual([remote]);
  expect(json("bycoda.remote-projects.v2")).toEqual({ [remote]: { key: remote } });
  expect(json("bycoda.sync.dismissedRemoteProjects.v2")).toEqual(["loc:env:/x"]);
  expect(json("bycoda:tab-group:mascots")).toEqual({ [remote]: "mushroom" });
  expect(localStorage.getItem(`bycoda.remote-history.v2:${remote}`)).toBe("[1]");
  expect(localStorage.getItem("bycoda.uiScale")).toBeNull();
  expect(localStorage.getItem("bycoda.sync.machineId")).toBeNull();
  expect(Object.keys(localStorage).filter((key) => key.startsWith(LEGACY_NAME))).toEqual([]);
  expect(migrateLegacyStorage()).toBe(false);
});
