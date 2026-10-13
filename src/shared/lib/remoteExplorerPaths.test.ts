// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { parentPath } from "./paths";
import { localExplorerPath, saveExplorerMapping } from "./remoteExplorerPaths";
import { revealPath, setRemoteCommandRunner } from "../../platform/tauri/fs";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));
beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

it("maps Unicode and spaces through the longest matching share root and isolates machines", () => {
  saveExplorerMapping("remote://mac/Users/dev", "\\\\MacBook\\dev");
  saveExplorerMapping("remote://mac/Users/dev/projects", "Z:/projects");
  expect(localExplorerPath("remote://mac/Users/dev/projects/özet images/a.png")).toBe(
    "Z:/projects/özet images/a.png",
  );
  expect(localExplorerPath("remote://mac/Users/dev/docs")).toBe("//MacBook/dev/docs");
  expect(localExplorerPath("remote://other/Users/dev/docs")).toBeUndefined();
  expect(localExplorerPath("remote://mac/Users/developer/docs")).toBeUndefined();
  expect(localExplorerPath("remote://mac/Users/dev/../secret")).toBeUndefined();
});

it("rejects invalid mapping paths and tolerates corrupted storage", () => {
  for (const local of ["share/folder", "\\\\MacBook", "//MacBook/share/../private", 'Z:/bad"path'])
    expect(() => saveExplorerMapping("remote://mac/repo", local)).toThrow();
  localStorage.setItem("bycoda.remote-explorer-paths.v1", "{}");
  expect(localExplorerPath("remote://mac/repo")).toBeUndefined();
});

it("supports a mounted filesystem root", () => {
  saveExplorerMapping("remote://mac/", "/");
  expect(localExplorerPath("remote://mac/tmp/özet.md")).toBe("/tmp/özet.md");
});

it("keeps parent navigation within POSIX, Windows and UNC remote roots", () => {
  expect(parentPath("remote://mac/Users")).toBe("remote://mac/");
  expect(parentPath("remote://mac/")).toBe("remote://mac/");
  expect(parentPath("remote://pc/C:/repo")).toBe("remote://pc/C:/");
  expect(parentPath("remote://pc/C:/")).toBe("remote://pc/C:/");
  expect(parentPath("remote://pc//server/share")).toBe("remote://pc//server/share");
});

it("reveals the mapped original through the local OS rather than the remote host", async () => {
  const remote = vi.fn();
  setRemoteCommandRunner(remote);
  await expect(revealPath("remote://mac/repo/a.png")).rejects.toThrow("shared folder path");
  saveExplorerMapping("remote://mac/repo", "\\\\MacBook\\repo");
  await revealPath("remote://mac/repo/a.png");
  expect(invoke).toHaveBeenCalledWith("reveal_path", {
    path: "//MacBook/repo/a.png",
  });
  expect(remote).not.toHaveBeenCalled();
});
