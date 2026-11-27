import { expect, test } from "vitest";
import { organizationPageListsProject } from "./assistant-visible-project";

test("a Host cwd with backslashes matches the desktop's slash spelling", () => {
  const items = [{ cwd: "G:/Projects/Firisbe/UI DEVELOPMENTS/pf-ui-portal" }];
  expect(
    organizationPageListsProject(items, "G:\\Projects\\Firisbe\\UI DEVELOPMENTS\\pf-ui-portal"),
  ).toBe(true);
});

test("drive-letter case and a trailing slash do not hide a project", () => {
  expect(organizationPageListsProject([{ cwd: "g:/work/app/" }], "G:\\work\\app")).toBe(true);
});

test("a different folder or a missing cwd is not visible", () => {
  expect(organizationPageListsProject([{ cwd: "G:/work/other" }, {}], "G:\\work\\app")).toBe(false);
  expect(organizationPageListsProject([], "/home/a")).toBe(false);
});
