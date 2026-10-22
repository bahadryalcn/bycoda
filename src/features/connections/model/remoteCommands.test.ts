import { beforeEach, expect, it, vi } from "vitest";

const { remoteRequest, remoteMachineFor, invokeLocal } = vi.hoisted(() => ({
  remoteRequest: vi.fn(),
  invokeLocal: vi.fn(),
  remoteMachineFor: vi.fn(async (environmentId: string) =>
    environmentId === "env"
      ? { id: "machine", name: "Home", endpoint: "", environmentId }
      : undefined,
  ),
}));
vi.mock("./connections", () => ({ remoteRequest, remoteMachineFor }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeLocal }));

import { WORKSPACE_COMMANDS } from "../../../../host/workspace-commands";
import { GIT_ACTION_COMMANDS } from "../../../../host/git-actions";
import { HOST_COMMANDS, runMachineCommand, runRemoteCommand } from "./remoteCommands";
import { parseRemotePath, remotePath } from "./remoteProjects";
import {
  exportSkill,
  deleteSkill,
  importSkill,
  listDir,
  browseDirectory,
  listClaudeCommands,
  readBinaryFile,
  readTextFile,
  statFiles,
  writeTextFile,
} from "../../../platform/tauri/fs";

beforeEach(() => {
  remoteRequest.mockReset();
  invokeLocal.mockReset();
});

it("stores restrictions on the owning machine and migrates only that machine's legacy paths", async () => {
  const policy = { disabledNames: ["good-css"], disabledPaths: [] };
  remoteRequest.mockResolvedValue(policy);
  expect(
    await runMachineCommand("env", "skill_policy_get", {
      cwd: "",
      legacyDisabledPaths: [
        "C:/local/skills/good-css/SKILL.md",
        "remote://other/skills/other/SKILL.md",
        "remote://env/skills/good-css/SKILL.md",
      ],
    }),
  ).toEqual(policy);
  expect(remoteRequest).toHaveBeenLastCalledWith("machine", "workspace.run", {
    command: "skill_policy_get",
    args: { cwd: "", legacyDisabledPaths: ["/skills/good-css/SKILL.md"] },
  });
  await runMachineCommand("env", "skill_policy_set", { cwd: "", name: "good-css", enabled: false });
  expect(remoteRequest).toHaveBeenLastCalledWith("machine", "workspace.run", {
    command: "skill_policy_set",
    args: { cwd: "", name: "good-css", enabled: false },
  });
  expect(invokeLocal).not.toHaveBeenCalled();
});

it("routes slash-command discovery to the host and preserves command metadata", async () => {
  const commands = [
    {
      name: "gsd:plan",
      description: "Plan",
      argumentHint: "[phase]",
      scope: "project",
    },
  ];
  remoteRequest.mockResolvedValue(commands);
  expect(await listClaudeCommands("remote://env/work/repo")).toEqual(commands);
  expect(remoteRequest).toHaveBeenCalledWith("machine", "workspace.run", {
    command: "list_claude_commands",
    args: { cwd: "/work/repo" },
  });
  expect(invokeLocal).not.toHaveBeenCalled();
});

it("keeps local writes local when their content mentions a remote path", async () => {
  await writeTextFile("/home/me/note.txt", "remote://env/home/me/repo");
  expect(invokeLocal).toHaveBeenCalledWith("write_text_file", {
    path: "/home/me/note.txt",
    content: "remote://env/home/me/repo",
  });
  expect(remoteRequest).not.toHaveBeenCalled();
});

it("runs the same file command on the machine with host paths", async () => {
  remoteRequest.mockResolvedValue([
    { name: "src", path: "/home/me/repo/src", isDir: true, ignored: false },
  ]);
  expect(await listDir("remote://env/home/me/repo")).toEqual([
    {
      name: "src",
      path: "remote://env/home/me/repo/src",
      isDir: true,
      ignored: false,
    },
  ]);
  expect(remoteRequest).toHaveBeenCalledWith("machine", "workspace.run", {
    command: "list_dir",
    args: { path: "/home/me/repo" },
  });
});

it("routes Windows folders outside projects to metadata browsing on their owning machine", async () => {
  const path = "C:/Users/kraba/.bycoda-build/packages";
  remoteRequest.mockResolvedValue({
    path,
    parent: "C:/Users/kraba/.bycoda-build",
    canOpenFiles: false,
    entries: [{ name: "bycoda.exe", path: `${path}/bycoda.exe`, isDir: false, ignored: false }],
  });
  expect(await browseDirectory(`remote://env/${path}/bycoda.exe`, true)).toEqual({
    path: `remote://env/${path}`,
    parent: "remote://env/C:/Users/kraba/.bycoda-build",
    canOpenFiles: false,
    entries: [
      { name: "bycoda.exe", path: `remote://env/${path}/bycoda.exe`, isDir: false, ignored: false },
    ],
  });
  expect(remoteRequest).toHaveBeenCalledWith("machine", "workspace.run", {
    command: "browse_dir",
    args: { path: `${path}/bycoda.exe`, containing: true },
  });
  expect(invokeLocal).not.toHaveBeenCalled();
  remoteRequest.mockResolvedValue({ path: "C:/", parent: null, canOpenFiles: false, entries: [] });
  expect(await browseDirectory("remote://env/C:/")).toMatchObject({
    path: "remote://env/C:/",
    parent: null,
  });
});

it("maps path results back and leaves file contents alone", async () => {
  remoteRequest.mockResolvedValueOnce("remote://not-a-path");
  expect(await readTextFile("remote://env/home/me/a.txt")).toBe("remote://not-a-path");
  remoteRequest.mockResolvedValueOnce([{ path: "/home/me/a.txt", mtimeMs: 1 }]);
  expect(await statFiles(["remote://env/home/me/a.txt"])).toEqual([
    { path: "remote://env/home/me/a.txt", mtimeMs: 1 },
  ]);
  remoteRequest.mockResolvedValueOnce("/home/me/b.txt");
  expect(
    await runRemoteCommand("rename_path", {
      path: "remote://env/home/me/a.txt",
      name: "b.txt",
    }),
  ).toBe("remote://env/home/me/b.txt");
  remoteRequest.mockResolvedValueOnce("C:/work/x.ts");
  expect(
    await runRemoteCommand("create_path", {
      parent: "remote://env/C:/work",
      name: "x.ts",
      isDir: false,
    }),
  ).toBe("remote://env/C:/work/x.ts");
  expect(remoteRequest).toHaveBeenLastCalledWith("machine", "workspace.run", {
    command: "create_path",
    args: { parent: "C:/work", name: "x.ts", isDir: false },
  });
});

it("decodes remote binary reads", async () => {
  remoteRequest.mockResolvedValueOnce("AAEC/w==");
  expect(await readBinaryFile("remote://env/home/me/image.png")).toEqual(
    new Uint8Array([0, 1, 2, 255]),
  );
});

it("preserves Windows drive and UNC paths", () => {
  expect(parseRemotePath(remotePath("env", "C:\\work\\repo"))?.hostPath).toBe("C:/work/repo");
  expect(parseRemotePath(remotePath("env", "\\\\server\\share\\repo"))?.hostPath).toBe(
    "//server/share/repo",
  );
});

it("adds remote paths to Git index entries", async () => {
  remoteRequest.mockResolvedValueOnce({
    branch: "main",
    files: [{ path: "src/app.ts", relative: "src/app.ts", status: "modified" }],
  });
  const index = (await runRemoteCommand("git_diff_index", {
    cwd: "remote://env/home/me/repo",
  })) as { files: { path: string }[] };
  expect(index.files[0].path).toBe("remote://env/home/me/repo/src/app.ts");
});

it("maps the conflict entries of an index, and leaves a host without them alone", async () => {
  remoteRequest.mockResolvedValueOnce({
    branch: "main",
    files: [],
    conflicts: [{ path: "a.txt", relative: "a.txt", kind: "both-modified" }],
    operation: "merge",
  });
  expect(
    await runRemoteCommand("git_diff_index", {
      cwd: "remote://env/home/me/repo",
    }),
  ).toMatchObject({
    conflicts: [
      {
        path: "remote://env/home/me/repo/a.txt",
        relative: "a.txt",
        kind: "both-modified",
      },
    ],
    operation: "merge",
  });
  remoteRequest.mockResolvedValueOnce({ branch: "main", files: [] });
  const older = (await runRemoteCommand("git_diff_files", {
    cwd: "remote://env/home/me/repo",
  })) as Record<string, unknown>;
  expect("conflicts" in older).toBe(false);
});

it("reads the three versions of a conflicted file through the host", async () => {
  remoteRequest.mockResolvedValueOnce({
    path: "a.txt",
    relative: "a.txt",
    kind: "both-modified",
    base: "a\n",
    ours: "b\n",
    theirs: "c\n",
    binary: false,
    tooLarge: false,
  });
  expect(
    await runRemoteCommand("git_conflict_stages", {
      cwd: "remote://env/home/me/repo",
      relative: "a.txt",
    }),
  ).toMatchObject({ path: "remote://env/home/me/repo/a.txt", ours: "b\n" });
  expect(remoteRequest).toHaveBeenCalledWith("machine", "workspace.run", {
    command: "git_conflict_stages",
    args: { cwd: "/home/me/repo", relative: "a.txt" },
  });
});

it("routes project search through the host and maps match paths", async () => {
  remoteRequest.mockResolvedValueOnce({
    matches: [{ path: "/home/me/repo/src/app.ts", relative: "src/app.ts", line: 4 }],
    truncated: false,
  });
  expect(
    await runRemoteCommand("search_project", {
      options: { cwd: "remote://env/home/me/repo", query: "hello" },
    }),
  ).toMatchObject({
    matches: [{ path: "remote://env/home/me/repo/src/app.ts", line: 4 }],
  });
  expect(remoteRequest).toHaveBeenCalledWith("machine", "workspace.run", {
    command: "search_project",
    args: { options: { cwd: "/home/me/repo", query: "hello" } },
  });
});

it("forwards exactly the commands the host answers", () => {
  expect([...HOST_COMMANDS].sort()).toEqual([...WORKSPACE_COMMANDS].sort());
  for (const command of GIT_ACTION_COMMANDS) expect(HOST_COMMANDS.has(command)).toBe(true);
});

it("returns checkpoint paths from the owning machine without duplicating the checkout prefix", async () => {
  remoteRequest.mockResolvedValueOnce({
    files: [{ path: "/home/me/repo/a.txt", relative: "a.txt", undoable: false }],
  });
  const status = await runRemoteCommand("session_checkpoint_status", {
    cwd: "remote://env/home/me/repo",
    sessionId: "host-session",
  });
  expect(status).toEqual({
    files: [{ path: "remote://env/home/me/repo/a.txt", relative: "a.txt", undoable: false }],
  });
});

it("sends git actions with the project translated and files left relative", async () => {
  remoteRequest.mockResolvedValueOnce([{ line: 1, sha: "a" }]);
  await runRemoteCommand("git_blame", {
    cwd: "remote://env/home/me/repo",
    relative: "src/app.ts",
  });
  expect(remoteRequest).toHaveBeenLastCalledWith("machine", "workspace.run", {
    command: "git_blame",
    args: { cwd: "/home/me/repo", relative: "src/app.ts" },
  });
  // Conflicts and operation state are repo-relative already.
  remoteRequest.mockResolvedValueOnce({
    operation: "merge",
    conflicts: ["src/app.ts"],
  });
  expect(
    await runRemoteCommand("git_operation_status", {
      cwd: "remote://env/home/me/repo",
    }),
  ).toEqual({ operation: "merge", conflicts: ["src/app.ts"] });
});

it.each(["git_stage_files", "git_unstage_files", "git_discard_files"])(
  "sends %s as one host request with literal repository-relative paths",
  async (command) => {
    const relatives = ["src/a[1].ts", "folder with spaces/b.ts"];
    remoteRequest.mockResolvedValueOnce(undefined);
    await runRemoteCommand(command, { cwd: "remote://env/home/me/repo", relatives });
    expect(remoteRequest).toHaveBeenLastCalledWith("machine", "workspace.run", {
      command,
      args: { cwd: "/home/me/repo", relatives },
    });
  },
);

it("reports a host that predates a command as outdated", async () => {
  remoteRequest.mockRejectedValueOnce("Host rejected request: Unsupported workspace command");
  await expect(runRemoteCommand("git_tags", { cwd: "remote://env/home/me/repo" })).rejects.toThrow(
    "Update bycoda Host",
  );
});

it("refuses what the host cannot do and explains outdated hosts", async () => {
  await expect(runRemoteCommand("reveal_path", { path: "remote://env/home/me/a" })).rejects.toThrow(
    "isn’t available for projects on another machine",
  );
  await expect(
    runRemoteCommand("copy_path", {
      from: "/Users/me/local.txt",
      destParent: "remote://env/home/me",
    }),
  ).rejects.toThrow("within one machine");
  await expect(
    runRemoteCommand("move_path", {
      from: "remote://env/home/me/a",
      destParent: "remote://other/home/me",
    }),
  ).rejects.toThrow("within one machine");
  await expect(runRemoteCommand("list_dir", { path: "remote://gone/home/me" })).rejects.toThrow(
    "isn’t connected",
  );
  remoteRequest.mockRejectedValueOnce("Unsupported remote operation");
  await expect(runRemoteCommand("list_dir", { path: "remote://env/home/me" })).rejects.toThrow(
    "Update bycoda Host",
  );
  expect(remoteRequest).toHaveBeenCalledTimes(1);
});

it("routes skill export and import to the machine and maps the written path back", async () => {
  remoteRequest.mockResolvedValueOnce({
    name: "tool",
    files: [{ path: "SKILL.md", data: "eA==" }],
  });
  expect(
    await exportSkill(
      "remote://env/home/me/.agents/skills/tool/SKILL.md",
      "remote://env/home/me/repo",
    ),
  ).toEqual({ name: "tool", files: [{ path: "SKILL.md", data: "eA==" }] });
  expect(remoteRequest).toHaveBeenLastCalledWith("machine", "workspace.run", {
    command: "skill_export",
    args: {
      path: "/home/me/.agents/skills/tool/SKILL.md",
      cwd: "/home/me/repo",
    },
  });

  remoteRequest.mockResolvedValueOnce("/home/me/.agents/skills/tool/SKILL.md");
  const bundle = { name: "tool", files: [{ path: "SKILL.md", data: "eA==" }] };
  expect(await importSkill("remote://env/home/me/repo", bundle, true)).toBe(
    "remote://env/home/me/.agents/skills/tool/SKILL.md",
  );
  expect(remoteRequest).toHaveBeenLastCalledWith("machine", "workspace.run", {
    command: "skill_import",
    args: {
      cwd: "/home/me/repo",
      name: "tool",
      files: bundle.files,
      overwrite: true,
    },
  });

  // A local target never leaves this computer.
  invokeLocal.mockResolvedValueOnce("/Users/me/.agents/skills/tool/SKILL.md");
  await importSkill("", bundle, false);
  expect(invokeLocal).toHaveBeenLastCalledWith("skill_import", {
    cwd: "",
    name: "tool",
    files: bundle.files,
    overwrite: false,
  });
  expect(remoteRequest).toHaveBeenCalledTimes(2);
});

it("tells the user an older host needs updating to copy skills", async () => {
  remoteRequest.mockRejectedValueOnce("Host rejected request: Unsupported workspace command");
  await expect(
    importSkill("remote://env/home/me/repo", { name: "tool", files: [] }, false),
  ).rejects.toThrow("needs updating to copy skills");
});

it("routes skill deletion by its remote path and preserves the project context", async () => {
  remoteRequest.mockResolvedValueOnce(null);
  await deleteSkill(
    "remote://env/home/me/.agents/skills/tool/SKILL.md",
    "remote://env/home/me/repo",
  );
  expect(remoteRequest).toHaveBeenLastCalledWith("machine", "workspace.run", {
    command: "skill_delete",
    args: {
      path: "/home/me/.agents/skills/tool/SKILL.md",
      cwd: "/home/me/repo",
    },
  });
  expect(invokeLocal).not.toHaveBeenCalled();
  remoteRequest.mockRejectedValueOnce("Unsupported workspace command");
  await expect(
    deleteSkill("remote://env/home/me/.agents/skills/tool/SKILL.md", ""),
  ).rejects.toThrow("needs updating to delete skills");
});

it("translates disabled skill paths only for the addressed machine", async () => {
  remoteRequest.mockResolvedValueOnce([]);
  await runRemoteCommand("list_skills", {
    cwd: "remote://env/home/me/repo",
    disabledPaths: [
      "remote://env/home/me/repo/.agents/skills/review/SKILL.md",
      "remote://other/home/me/skills/review/SKILL.md",
      "C:/local/skills/review/SKILL.md",
    ],
  });
  expect(remoteRequest).toHaveBeenLastCalledWith("machine", "workspace.run", {
    command: "list_skills",
    args: { cwd: "/home/me/repo", disabledPaths: ["/home/me/repo/.agents/skills/review/SKILL.md"] },
  });
});

it("addresses a machine without a project path for skill commands", async () => {
  remoteRequest.mockResolvedValueOnce([
    {
      name: "tool",
      description: "",
      path: "/home/me/.agents/skills/tool/SKILL.md",
      scope: "user",
      source: "agents",
    },
  ]);
  expect(await runMachineCommand("env", "list_skills", { cwd: "" })).toEqual([
    {
      name: "tool",
      description: "",
      path: "remote://env/home/me/.agents/skills/tool/SKILL.md",
      scope: "user",
      source: "agents",
    },
  ]);
  expect(remoteRequest).toHaveBeenLastCalledWith("machine", "workspace.run", {
    command: "list_skills",
    args: { cwd: "" },
  });

  remoteRequest.mockResolvedValueOnce("/home/me/.agents/skills/tool/SKILL.md");
  expect(
    await runMachineCommand("env", "skill_import", {
      name: "tool",
      files: [],
      overwrite: false,
    }),
  ).toBe("remote://env/home/me/.agents/skills/tool/SKILL.md");

  // An empty cwd next to a remote skill path is "no project", not another machine.
  remoteRequest.mockResolvedValueOnce({ name: "tool", files: [] });
  await exportSkill("remote://env/home/me/.agents/skills/tool/SKILL.md", "");
  expect(remoteRequest).toHaveBeenLastCalledWith("machine", "workspace.run", {
    command: "skill_export",
    args: { path: "/home/me/.agents/skills/tool/SKILL.md", cwd: "" },
  });

  await expect(
    runMachineCommand("env", "skill_export", {
      path: "remote://other/x/SKILL.md",
      cwd: "",
    }),
  ).rejects.toThrow("within one machine");
  await expect(runMachineCommand("env", "list_dir", { path: "remote://env/x" })).rejects.toThrow(
    "isn’t available",
  );
});
