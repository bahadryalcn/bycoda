import { describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  gitCommit,
  gitFetch,
  gitPull,
  gitStash,
  gitHeadMessage,
  isCheckoutBlockedByChanges,
  listProjectFiles,
  listSkills,
  pickNativeFolders as pickFolders,
  pickFolders as pickProjectFolders,
  resolveProjectLocation,
} from "./fs";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

const picker = vi.hoisted(() => ({ openFolderPicker: vi.fn() }));
vi.mock("../../features/projects/ui/openFolderPicker", () => picker);

it("routes project and session folder requests through the in-app browser", async () => {
  picker.openFolderPicker.mockResolvedValueOnce(["/work/project"]);
  await expect(pickProjectFolders("Choose session project", false)).resolves.toEqual([
    "/work/project",
  ]);
  expect(picker.openFolderPicker).toHaveBeenCalledWith({
    title: "Choose session project",
    multiple: false,
  });
});

it("requires native approval before returning an in-app selected project", async () => {
  vi.mocked(invoke).mockReset();
  picker.openFolderPicker.mockResolvedValueOnce(["/work/project"]);
  vi.mocked(invoke).mockRejectedValueOnce(new Error("File access was not approved"));
  await expect(pickProjectFolders()).rejects.toThrow("File access was not approved");
  expect(invoke).toHaveBeenCalledWith("authorize_project_path", { path: "/work/project" });
});

it("does not request native approval when the in-app picker is cancelled", async () => {
  vi.mocked(invoke).mockReset();
  picker.openFolderPicker.mockResolvedValueOnce([]);
  await expect(pickProjectFolders()).resolves.toEqual([]);
  expect(invoke).not.toHaveBeenCalled();
});

describe("pickFolders", () => {
  it("can request a single project folder", async () => {
    vi.mocked(open).mockResolvedValueOnce("/a/project");
    await expect(pickFolders("Choose session project", false)).resolves.toEqual(["/a/project"]);
    expect(vi.mocked(open).mock.lastCall?.[0]).toMatchObject({
      directory: true,
      multiple: false,
      title: "Choose session project",
    });
  });
  it("returns every folder chosen in one pass", async () => {
    vi.mocked(open).mockResolvedValueOnce(["/a/one", "/a/two"]);
    await expect(pickFolders()).resolves.toEqual(["/a/one", "/a/two"]);
    expect(vi.mocked(open).mock.lastCall?.[0]).toMatchObject({
      directory: true,
      multiple: true,
    });
  });

  it("handles the dialog returning a bare string for a single folder", async () => {
    vi.mocked(open).mockResolvedValueOnce("/a/only");
    await expect(pickFolders()).resolves.toEqual(["/a/only"]);
  });

  it("returns nothing when the dialog is dismissed", async () => {
    vi.mocked(open).mockResolvedValueOnce(null);
    await expect(pickFolders()).resolves.toEqual([]);
  });
});

describe("isCheckoutBlockedByChanges", () => {
  it("detects git's tracked-file checkout error", () => {
    expect(
      isCheckoutBlockedByChanges(
        "error: Your local changes to the following files would be overwritten by checkout:\n\ta.txt\nPlease commit your changes or stash them before you switch branches.",
      ),
    ).toBe(true);
  });

  it("detects git's untracked-file checkout error", () => {
    expect(
      isCheckoutBlockedByChanges(
        "error: The following untracked working tree files would be overwritten by checkout:\n\tnew.txt\nPlease move or remove them before you switch branches.",
      ),
    ).toBe(true);
  });

  it("detects the mapped app error", () => {
    expect(
      isCheckoutBlockedByChanges(
        "Your local changes would be overwritten. Commit or stash them first.",
      ),
    ).toBe(true);
  });

  it("ignores unrelated git errors", () => {
    expect(isCheckoutBlockedByChanges("Branch missing not found")).toBe(false);
    expect(isCheckoutBlockedByChanges("Not a git repository")).toBe(false);
  });
});

describe("listSkills", () => {
  it("invokes list_skills with cwd and disabledPaths", async () => {
    vi.mocked(invoke).mockResolvedValueOnce([]);
    await listSkills("/repo", ["/repo/.agents/skills/review/SKILL.md"]);
    expect(invoke).toHaveBeenCalledWith("list_skills", {
      cwd: "/repo",
      disabledPaths: ["/repo/.agents/skills/review/SKILL.md"],
    });
  });

  it("passes null when disabledPaths is omitted", async () => {
    vi.mocked(invoke).mockResolvedValueOnce([]);
    await listSkills("/repo");
    expect(invoke).toHaveBeenCalledWith("list_skills", {
      cwd: "/repo",
      disabledPaths: null,
    });
  });
});

describe("resolveProjectLocation", () => {
  it("passes the saved filesystem identity to the backend", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      path: "/repo-renamed",
      identity: "unix:1:2",
    });

    await expect(resolveProjectLocation("/repo", "unix:1:2")).resolves.toEqual({
      path: "/repo-renamed",
      identity: "unix:1:2",
    });
    expect(invoke).toHaveBeenCalledWith("resolve_project_location", {
      path: "/repo",
      identity: "unix:1:2",
    });
  });

  it("uses null until the project has a saved identity", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(null);
    await resolveProjectLocation("/repo");
    expect(invoke).toHaveBeenCalledWith("resolve_project_location", {
      path: "/repo",
      identity: null,
    });
  });
});

describe("gitCommit", () => {
  it("invokes git_commit without amend by default", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    await gitCommit("/repo", "Add feature");
    expect(invoke).toHaveBeenCalledWith("git_commit", {
      cwd: "/repo",
      message: "Add feature",
      amend: false,
    });
  });

  it("passes amend when requested", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    await gitCommit("/repo", "Fix feature", true);
    expect(invoke).toHaveBeenCalledWith("git_commit", {
      cwd: "/repo",
      message: "Fix feature",
      amend: true,
    });
  });
});

describe("git option flags", () => {
  it("sends signoff, rebase, and prune only when asked for", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    await gitCommit("/repo", "Msg", false, true);
    expect(invoke).toHaveBeenLastCalledWith("git_commit", {
      cwd: "/repo",
      message: "Msg",
      amend: false,
      signoff: true,
    });
    await gitPull("/repo");
    expect(invoke).toHaveBeenLastCalledWith("git_pull", { cwd: "/repo" });
    await gitPull("/repo", true);
    expect(invoke).toHaveBeenLastCalledWith("git_pull", {
      cwd: "/repo",
      rebase: true,
    });
    await gitFetch("/repo");
    expect(invoke).toHaveBeenLastCalledWith("git_fetch", { cwd: "/repo" });
    await gitFetch("/repo", true);
    expect(invoke).toHaveBeenLastCalledWith("git_fetch", {
      cwd: "/repo",
      prune: true,
    });
    await gitStash("/repo", undefined, "staged");
    expect(invoke).toHaveBeenLastCalledWith("git_stash", {
      cwd: "/repo",
      message: null,
      mode: "staged",
    });
  });
});

describe("gitHeadMessage", () => {
  it("invokes git_head_message with cwd", async () => {
    vi.mocked(invoke).mockResolvedValueOnce("Subject\n\nBody");
    await expect(gitHeadMessage("/repo")).resolves.toBe("Subject\n\nBody");
    expect(invoke).toHaveBeenCalledWith("git_head_message", { cwd: "/repo" });
  });
});

describe("listProjectFiles", () => {
  const entries = [
    { name: "a.ts", relative: "src/a.ts" },
    { name: "README.md", relative: "README.md" },
  ];

  it("rebuilds absolute paths from a Windows-style root", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      root: "C:/Users/me/proj",
      files: entries,
    });
    await expect(listProjectFiles("C:\\Users\\me\\proj")).resolves.toEqual([
      { name: "a.ts", path: "C:/Users/me/proj/src/a.ts", relative: "src/a.ts" },
      {
        name: "README.md",
        path: "C:/Users/me/proj/README.md",
        relative: "README.md",
      },
    ]);
  });

  it("rebuilds absolute paths from POSIX roots, including a bare slash", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      root: "/home/me/proj",
      files: entries,
    });
    const posix = await listProjectFiles("/home/me/proj");
    expect(posix[0]).toEqual({
      name: "a.ts",
      path: "/home/me/proj/src/a.ts",
      relative: "src/a.ts",
    });
    vi.mocked(invoke).mockResolvedValueOnce({ root: "/", files: entries });
    expect((await listProjectFiles("/"))[1]?.path).toBe("/README.md");
  });

  it("passes a remote host's full entries through untouched", async () => {
    const full = [{ name: "a.ts", path: "remote://m/p/a.ts", relative: "a.ts" }];
    vi.mocked(invoke).mockResolvedValueOnce(full);
    await expect(listProjectFiles("/p")).resolves.toBe(full);
  });
});
