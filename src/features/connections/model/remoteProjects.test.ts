// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import {
  openRemoteProject,
  remotePath,
  remoteProjectFor,
  verifyRemoteProjectAlias,
} from "./remoteProjects";

const binding = {
  key: "remote://env/G:/repo",
  environmentId: "env",
  projectId: "legacy",
  cwd: "G:/repo",
};

it("does not resolve an already matching project", async () => {
  const request = vi.fn();
  await verifyRemoteProjectAlias(request, binding, "legacy");
  expect(request).not.toHaveBeenCalled();
});

it("accepts legacy IDs only after the owning host resolves both folders to one project", async () => {
  const request = vi.fn(async (method: string) =>
    method === "projects.list"
      ? [
          { id: "legacy", cwd: "G:/repo" },
          { id: "canonical", cwd: "G:\\repo" },
        ]
      : { id: "canonical", cwd: "G:\\repo" },
  );
  await verifyRemoteProjectAlias(request, binding, "canonical");
  expect(request.mock.calls).toHaveLength(3);
  expect(request).toHaveBeenCalledWith("projects.open", { cwd: "G:/repo" });
  expect(request).toHaveBeenCalledWith("projects.open", { cwd: "G:\\repo" });
});

it("rejects a genuinely different project even if its display name matches", async () => {
  const request = vi.fn(async (method: string, params: unknown) =>
    method === "projects.list"
      ? [
          { id: "legacy", cwd: "G:/repo", name: "repo" },
          { id: "other", cwd: "G:/other", name: "repo" },
        ]
      : { id: (params as { cwd: string }).cwd },
  );
  await expect(verifyRemoteProjectAlias(request, binding, "other")).rejects.toThrow(
    "different host project",
  );
});

it("rejects missing projects and stale folder bindings before resolving anything", async () => {
  for (const projects of [
    [],
    [
      { id: "legacy", cwd: "G:/moved" },
      { id: "other", cwd: "G:/repo" },
    ],
  ]) {
    const request = vi.fn(async () => projects);
    await expect(verifyRemoteProjectAlias(request, binding, "other")).rejects.toThrow(
      "different host project",
    );
    expect(request).toHaveBeenCalledTimes(1);
  }
});

it("does not accept an alias when host verification fails or is malformed", async () => {
  for (const result of [null, {}, { id: "" }]) {
    const request = vi.fn(async (method: string) =>
      method === "projects.list"
        ? [
            { id: "legacy", cwd: "G:/repo" },
            { id: "other", cwd: "G:\\repo" },
          ]
        : result,
    );
    await expect(verifyRemoteProjectAlias(request, binding, "other")).rejects.toThrow(
      "different host project",
    );
  }
  const request = vi.fn(async () => {
    throw new Error("Host offline");
  });
  await expect(verifyRemoteProjectAlias(request, binding, "other")).rejects.toThrow("Host offline");
});

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
