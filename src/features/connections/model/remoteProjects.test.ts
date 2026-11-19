// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import {
  openRemoteProject,
  remotePath,
  remoteSessionGitCwd,
  remoteProjectFor,
  subscribeRemoteProjects,
  verifyRemoteProjectAlias,
} from "./remoteProjects";

const REGISTRY_KEY = "bycoda.remote-projects.v2";

it("uses a remote tab's linked checkout for Git even when the file cwd points elsewhere", () => {
  const project = { environmentId: "mac", cwd: "/repo" };
  expect(
    remoteSessionGitCwd(project, "remote://mac/repo", "remote://mac/repo", "/worktrees/fix"),
  ).toBe("remote://mac/worktrees/fix");
  expect(remoteSessionGitCwd(project, "/worktrees/fix", "remote://mac/repo")).toBe(
    "remote://mac/worktrees/fix",
  );
  expect(
    remoteSessionGitCwd(
      project,
      "remote://mac/other",
      "remote://mac/repo",
      "remote://mac/worktrees/fix",
    ),
  ).toBe("remote://mac/worktrees/fix");
  expect(remoteSessionGitCwd(project, "remote://mac/repo", "remote://mac/repo")).toBe(
    "remote://mac/repo",
  );
});

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

it("parses the registry only when its stored text changes", () => {
  const key = remotePath("env", "/repo");
  const project = { key, environmentId: "env", projectId: "p1", cwd: "/repo" };
  localStorage.setItem(REGISTRY_KEY, JSON.stringify({ [key]: project }));
  expect(remoteProjectFor(key)).toEqual(project);
  const parse = vi.spyOn(JSON, "parse");
  try {
    for (let read = 0; read < 3; read += 1) expect(remoteProjectFor(key)).toEqual(project);
    expect(parse).not.toHaveBeenCalled();
    localStorage.setItem(
      REGISTRY_KEY,
      JSON.stringify({ [key]: { ...project, projectId: "p2" } }),
    );
    expect(remoteProjectFor(key)?.projectId).toBe("p2");
    expect(parse).toHaveBeenCalledTimes(1);
  } finally {
    parse.mockRestore();
    localStorage.removeItem(REGISTRY_KEY);
  }
});

it("wakes registry subscribers only for registry writes, storage clears, or this window's change event", () => {
  const onChange = vi.fn();
  const unsubscribe = subscribeRemoteProjects(onChange);
  try {
    window.dispatchEvent(new StorageEvent("storage", { key: "bycoda.unrelated" }));
    expect(onChange).not.toHaveBeenCalled();
    window.dispatchEvent(new StorageEvent("storage", { key: REGISTRY_KEY }));
    expect(onChange).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new StorageEvent("storage", { key: null }));
    expect(onChange).toHaveBeenCalledTimes(2);
    window.dispatchEvent(new Event("bycoda:remote-projects-changed"));
    expect(onChange).toHaveBeenCalledTimes(3);
  } finally {
    unsubscribe();
  }
  window.dispatchEvent(new StorageEvent("storage", { key: REGISTRY_KEY }));
  expect(onChange).toHaveBeenCalledTimes(3);
});
