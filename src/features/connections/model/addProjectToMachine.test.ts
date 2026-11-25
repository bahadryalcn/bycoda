import { beforeEach, expect, it, vi } from "vitest";

const fs = vi.hoisted(() => ({
  cloneRepo: vi.fn(),
  gitRemotes: vi.fn(),
  homeDir: vi.fn(),
  listDir: vi.fn(),
  readTextFile: vi.fn(),
  writeTextFileChecked: vi.fn(),
}));
const pickFolderOnMachine = vi.hoisted(() => vi.fn());
const remoteRequest = vi.hoisted(() => vi.fn());
const loadRemoteCapabilities = vi.hoisted(() => vi.fn());
const openRemoteProject = vi.hoisted(() => vi.fn());
vi.mock("../../../platform/tauri/fs", () => fs);
vi.mock("./machineFolderPick", () => ({ pickFolderOnMachine }));
vi.mock("./connections", () => ({ remoteRequest, loadRemoteCapabilities }));
vi.mock("./remoteProjects", () => ({ openRemoteProject }));

import {
  ADD_PROJECT_TO_MACHINE_EVENT,
  addProjectToMachine,
  cloneDestination,
  cloneProjectToMachine,
  cloneUrlChoices,
  copiedByDefault,
  copyIgnoredFiles,
  listIgnoredFiles,
  repositoryNames,
  type AddProjectToMachineRequest,
} from "./addProjectToMachine";

const MAC = { kind: "remote", machineId: "m2" } as const;

beforeEach(() => {
  vi.stubGlobal("window", new EventTarget());
  for (const mock of [...Object.values(fs), pickFolderOnMachine, remoteRequest, openRemoteProject])
    mock.mockReset();
  loadRemoteCapabilities.mockReset().mockResolvedValue(["projects.clone.v1"]);
});

it("offers the same repository over SSH and HTTPS", () => {
  expect(cloneUrlChoices("git@github.com:owner/clinic.git")).toEqual({
    ssh: "git@github.com:owner/clinic.git",
    https: "https://github.com/owner/clinic.git",
    current: "ssh",
  });
  expect(cloneUrlChoices("https://github.com/owner/clinic")).toEqual({
    ssh: "git@github.com:owner/clinic.git",
    https: "https://github.com/owner/clinic",
    current: "https",
  });
  expect(repositoryNames("git@github.com:owner/clinic.git")).toEqual({
    label: "owner/clinic",
    folder: "clinic",
  });
  expect(cloneDestination("C:\\Users\\me\\", "git@github.com:owner/clinic.git")).toBe(
    "C:\\Users\\me\\clinic",
  );
  expect(cloneDestination("/Users/me", "git@github.com:owner/clinic.git")).toBe("/Users/me/clinic");
});

it("goes straight to the folder browser when the source has no hosted remote", async () => {
  fs.gitRemotes.mockResolvedValue([{ name: "origin", url: "C:/repos/clinic" }]);
  pickFolderOnMachine.mockResolvedValue("remote://env/Users/me/clinic");
  await expect(addProjectToMachine(MAC, "G:/clinic")).resolves.toBe("remote://env/Users/me/clinic");
});

it("asks the mounted dialog and resolves with its answer", async () => {
  fs.gitRemotes.mockResolvedValue([{ name: "origin", url: "git@github.com:owner/clinic.git" }]);
  window.addEventListener(ADD_PROJECT_TO_MACHINE_EVENT, (event) => {
    const request = (event as CustomEvent<AddProjectToMachineRequest>).detail;
    request.claim();
    expect(request.url).toBe("git@github.com:owner/clinic.git");
    request.settle("remote://env/Users/me/clinic");
  });
  await expect(addProjectToMachine(MAC, "G:/clinic")).resolves.toBe("remote://env/Users/me/clinic");
  expect(pickFolderOnMachine).not.toHaveBeenCalled();
});

it("lists ignored files and leaves out folders git ignores whole", async () => {
  fs.listDir.mockImplementation(async (path: string) =>
    path === "G:/clinic"
      ? [
          { name: ".env", path: "G:/clinic/.env", isDir: false, ignored: true },
          { name: "README.md", path: "G:/clinic/README.md", isDir: false, ignored: false },
          { name: "node_modules", path: "G:/clinic/node_modules", isDir: true, ignored: true },
          { name: ".git", path: "G:/clinic/.git", isDir: true, ignored: false },
          { name: "apps", path: "G:/clinic/apps", isDir: true, ignored: false },
        ]
      : [{ name: ".env.local", path: `${path}/.env.local`, isDir: false, ignored: true }],
  );
  await expect(listIgnoredFiles("G:/clinic")).resolves.toEqual([".env", "apps/.env.local"]);
  expect(fs.listDir).toHaveBeenCalledTimes(2);
  expect(copiedByDefault("apps/.env.local")).toBe(true);
  expect(copiedByDefault("PRIVATE-NOTES.md")).toBe(false);
});

it("clones on the target machine and registers the clone as a project", async () => {
  remoteRequest.mockResolvedValue({ path: "/Users/me/clinic" });
  openRemoteProject.mockResolvedValue({ key: "remote://env/Users/me/clinic" });
  await expect(
    cloneProjectToMachine({
      machine: { id: "m2", environmentId: "env" },
      url: "git@github.com:owner/clinic.git",
      parent: " /Users/me ",
    }),
  ).resolves.toBe("remote://env/Users/me/clinic");
  expect(remoteRequest).toHaveBeenCalledWith(
    "m2",
    "projects.clone",
    expect.objectContaining({
      url: "git@github.com:owner/clinic.git",
      parentPath: "/Users/me",
      name: "clinic",
    }),
    false,
    true,
  );
  expect(openRemoteProject).toHaveBeenCalledWith(expect.any(Function), "env", "/Users/me/clinic");
});

it("refuses a host that cannot clone and clones locally without one", async () => {
  loadRemoteCapabilities.mockResolvedValue([]);
  await expect(
    cloneProjectToMachine({ machine: { id: "m2", environmentId: "env" }, url: "u", parent: "/p" }),
  ).rejects.toThrow("cannot clone");
  expect(remoteRequest).not.toHaveBeenCalled();
  fs.cloneRepo.mockResolvedValue("C:/Users/me/clinic");
  await expect(
    cloneProjectToMachine({ machine: undefined, url: "u", parent: "C:/Users/me" }),
  ).resolves.toBe("C:/Users/me/clinic");
});

it("copies the chosen files and reports the ones that fail", async () => {
  fs.readTextFile.mockImplementation(async (path: string) => {
    if (path.endsWith("logo.png")) throw new Error("not text");
    return "KEY=1";
  });
  fs.writeTextFileChecked.mockResolvedValue({});
  await expect(
    copyIgnoredFiles("G:/clinic/", "remote://env/Users/me/clinic", [".env", "logo.png"]),
  ).resolves.toEqual(["logo.png"]);
  expect(fs.writeTextFileChecked).toHaveBeenCalledWith(
    "remote://env/Users/me/clinic/.env",
    "KEY=1",
  );
});
