import { expect, it, vi } from "vitest";
import { createCrewProject, crewProjectNameIssue, newCrewProjectParent } from "./crewProjects";

it("creates a new project next to the current one, on its own machine", () => {
  expect(newCrewProjectParent("G:/Projects/bycoda")).toBe("G:/Projects");
  expect(newCrewProjectParent("remote://env-1/home/me/app")).toBe("/home/me");
});

it("rejects folder names that would escape or break the parent folder", () => {
  expect(crewProjectNameIssue("  ")).not.toBe("");
  expect(crewProjectNameIssue("..")).not.toBe("");
  expect(crewProjectNameIssue("a/b")).not.toBe("");
  expect(crewProjectNameIssue("snake-game")).toBe("");
});

it("creates the folder, then registers exactly that folder as a project", async () => {
  const request = vi.fn(async (_machine: string, method: string, params: unknown) =>
    method === "projects.createDirectory"
      ? { path: "G:/Projects/snake", entries: [] }
      : { id: "p2", cwd: (params as { cwd: string }).cwd },
  );
  const project = await createCrewProject(request, "m1", "G:/Projects", " snake ");
  expect(request.mock.calls).toEqual([
    ["m1", "projects.createDirectory", { path: "G:/Projects", name: "snake" }],
    ["m1", "projects.open", { cwd: "G:/Projects/snake" }],
  ]);
  expect(project).toMatchObject({ id: "p2", cwd: "G:/Projects/snake" });
  await expect(createCrewProject(request, "m1", "G:/Projects", "../x")).rejects.toThrow();
  expect(request).toHaveBeenCalledTimes(2);
});
