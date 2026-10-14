// @vitest-environment happy-dom
import { expect, it } from "vitest";
import { openRemoteProject, remotePath, remoteProjectFor } from "./remoteProjects";

it("finds a saved UNC project through its corrected remote path", () => {
  const legacyKey = "remote://env/server/share/repo";
  const project = {
    key: legacyKey,
    environmentId: "env",
    projectId: "project",
    cwd: "\\\\server\\share\\repo",
  };
  localStorage.setItem("bycoda.remote-projects.v2", JSON.stringify({ [legacyKey]: project }));
  expect(remoteProjectFor(remotePath("env", project.cwd))).toEqual(project);
  localStorage.removeItem("bycoda.remote-projects.v2");
});

it("opens a folder on the host and saves it as a remote project", async () => {
  const calls: unknown[] = [];
  const project = await openRemoteProject(
    async (method, params) => {
      calls.push([method, params]);
      return { id: "p1", cwd: "/srv/code/app", name: "app" };
    },
    "env",
    "/srv/code/app/",
  );
  expect(calls).toEqual([["projects.open", { cwd: "/srv/code/app/" }]]);
  expect(project).toEqual({
    key: "remote://env/srv/code/app",
    environmentId: "env",
    projectId: "p1",
    cwd: "/srv/code/app",
  });
  expect(remoteProjectFor(project.key)).toEqual(project);
  await expect(openRemoteProject(async () => null, "env", "/x")).rejects.toThrow("malformed");
  localStorage.removeItem("bycoda.remote-projects.v2");
});
