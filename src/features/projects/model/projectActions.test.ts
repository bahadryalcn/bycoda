// @vitest-environment happy-dom
import { beforeEach, expect, it } from "vitest";
import {
  loadProjectActions,
  saveProjectActions,
  validActionUrl,
  projectActionShortcutError,
  type ProjectAction,
} from "./projectActions";
beforeEach(() => localStorage.clear());
const action: ProjectAction = {
  id: "test",
  name: "Test",
  icon: "play",
  command: "pnpm test",
  url: "",
};
it("keeps actions scoped to a normalized project path", () => {
  saveProjectActions("C:\\project", [action]);
  expect(loadProjectActions("C:/project")).toEqual([action]);
  expect(loadProjectActions("C:/other")).toEqual([]);
});
it("rejects project duplicates and reserved app shortcuts", () => {
  const shortcut = "Control+Option+KeyY";
  expect(projectActionShortcutError(shortcut, [{ ...action, shortcut }], "other")).toContain(
    "Already used",
  );
  expect(projectActionShortcutError(shortcut, [{ ...action, shortcut }], action.id)).toBe("");
  expect(projectActionShortcutError("Control+KeyP", [], "other")).not.toBe("");
});
it("ignores corrupted storage and malformed records", () => {
  localStorage.setItem("bycoda.projectActions.v1", "broken");
  expect(loadProjectActions("/project")).toEqual([]);
  saveProjectActions("/project", [
    action,
    { ...action, icon: "invalid" } as unknown as ProjectAction,
  ]);
  expect(loadProjectActions("/project")).toEqual([action]);
});
it("allows only web URLs", () => {
  expect(validActionUrl("http://localhost:5173")).toBe(true);
  expect(validActionUrl("https://example.com")).toBe(true);
  expect(validActionUrl("")).toBe(true);
  expect(validActionUrl("javascript:alert(1)")).toBe(false);
  expect(validActionUrl("file:///etc/passwd")).toBe(false);
});
it("persists the optional managed development server setting and rejects malformed settings", () => {
  saveProjectActions("/repo", [
    action,
    { ...action, id: "dev", devServer: true },
    { ...action, id: "corrupt", devServer: "yes" } as unknown as ProjectAction,
  ]);
  expect(loadProjectActions("/repo")).toEqual([action, { ...action, id: "dev", devServer: true }]);
});
