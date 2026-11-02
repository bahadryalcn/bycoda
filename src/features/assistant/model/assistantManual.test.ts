import { expect, it, vi } from "vitest";
vi.mock("../../group-lock/model/groupLock", () => ({ isProjectLocked: () => false }));
vi.mock("./assistantClient", () => ({ assistantRequest: vi.fn() }));
import { manualEnrollmentVersion, mergeManualProjectScope, visibleAssistantProjects } from "./assistantManual";
it("filters discovered Host names by owner-visible paths and current lock before labels", () => {
  const records = [{ id: "a", path: "C:\\Work\\Alpha", name: "Visible" }, { id: "secret", path: "C:\\Work\\Secret", name: "Hidden identity" }, { id: "locked", path: "/locked", name: "Locked identity" }];
  expect(visibleAssistantProjects(records, ["c:/work/alpha/", "/locked"], path => path === "/locked")).toEqual([records[0]]);
  expect(visibleAssistantProjects(records, [], () => false)).toEqual([]);
});
it("preserves uneditable hidden project IDs without selecting new hidden projects", () => {
  expect(mergeManualProjectScope(["hidden", "one"], ["one", "two"], ["two", "invented"])).toEqual(["hidden", "two"]);
  expect(mergeManualProjectScope(["hidden"], [], ["injected"])).toEqual(["hidden"]);
});
it("enrollment uses the prior session grant version, including a revoked grant", () => {
  expect(manualEnrollmentVersion([{ sessionId: "session", version: 7, active: false } as any], "session")).toBe(7);
  expect(manualEnrollmentVersion([], "new")).toBe(0);
});
