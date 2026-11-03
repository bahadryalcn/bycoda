// @vitest-environment happy-dom
import { afterEach, expect, it } from "vitest";
import { projectKey } from "../../../shared/lib/paths";
import { saveTabGroupLabel } from "../../workspace/model/tabGroups";
import { resolveVoiceProjects, voiceProjectNames } from "./voiceProjectNames";

afterEach(() => localStorage.clear());
it("uses the saved displayed name with the original folder alias and exact identity", () => {
  const path = "G:/Projects/my_projects/monocode";
  saveTabGroupLabel(projectKey(path), "bycoda");
  const projects = voiceProjectNames([{ path }]);
  expect(projects).toEqual([
    { path, name: "bycoda", folderName: "monocode", aliases: ["bycoda", "monocode"] },
  ]);
  expect(resolveVoiceProjects(projects, "Bycoda")).toMatchObject({
    projects: [{ path }],
    ambiguous: false,
  });
  expect(resolveVoiceProjects(projects, "monocode").projects).toEqual(projects);
  saveTabGroupLabel(projectKey(path), "New name");
  expect(voiceProjectNames([{ path }])[0].name).toBe("New name");
});
it("keeps duplicate aliases ambiguous and does not import a hidden label or another Host", () => {
  const first = "remote://host-a/work/monocode",
    second = "remote://host-b/work/monocode";
  saveTabGroupLabel(projectKey(first), "bycoda");
  saveTabGroupLabel(projectKey(second), "bycoda");
  saveTabGroupLabel(projectKey("/private"), "Secret");
  const projects = voiceProjectNames([{ path: first }, { path: second }]);
  expect(resolveVoiceProjects(projects, "bycoda")).toMatchObject({ ambiguous: true, total: 2 });
  expect(resolveVoiceProjects(projects, "Secret").projects).toEqual([]);
  expect(resolveVoiceProjects(projects, first)).toMatchObject({
    projects: [{ path: first }],
    ambiguous: false,
  });
  expect(voiceProjectNames([{ path: second, name: "Host display" }])[0].path).toBe(second);
});

it("normalizes spoken Turkish names and returns partial candidates without choosing a project", () => {
  const projects = voiceProjectNames([
    { path: "/portal", name: "FİRİSBE Portal" },
    { path: "/admin", name: "Firisbe Admin" },
    { path: "/other", name: "Unrelated" },
  ]);
  expect(resolveVoiceProjects(projects, "firisbe   portal")).toMatchObject({
    match: "exact",
    requiresConfirmation: false,
    projects: [{ path: "/portal" }],
  });
  expect(resolveVoiceProjects(projects, "firisbe")).toMatchObject({
    match: "partial",
    requiresConfirmation: true,
    ambiguous: true,
    total: 2,
  });
  expect(resolveVoiceProjects(projects, "İSBE Portal")).toMatchObject({
    match: "partial",
    requiresConfirmation: true,
    ambiguous: false,
    projects: [{ path: "/portal" }],
  });
  expect(resolveVoiceProjects(projects, "f").projects).toEqual([]);
  expect(resolveVoiceProjects(projects, "/admin")).toMatchObject({
    match: "exact",
    projects: [{ path: "/admin" }],
    requiresConfirmation: false,
  });
});
