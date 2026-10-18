import { afterEach, expect, it, vi } from "vitest";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkspaceCommands } from "./workspace-commands";
import { hostWorktrees } from "./git-worktrees";

vi.mock("./git-worktrees", () => ({ hostWorktrees: vi.fn() }));
const roots: string[] = [];
afterEach(async () => {
  vi.clearAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function setup() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "bycoda-roots-")));
  roots.push(root);
  const projects = Array.from({ length: 105 }, (_, index) => ({
    cwd: join(root, `project-${index}`),
  }));
  await mkdir(projects[104].cwd);
  const commands = new WorkspaceCommands(
    { projects: () => projects, attachmentDir: join(root, "attachments") } as never,
    (async (_id: string, action: () => Promise<unknown>) => action()) as never,
  );
  return { root, projects, commands };
}

it("opens a file among 105 registered projects without querying Git", async () => {
  const { projects, commands } = await setup();
  const path = join(projects[104].cwd, "hello.txt");
  await writeFile(path, "hello");
  await commands.run("read_text_file", { path });
  expect(hostWorktrees).not.toHaveBeenCalled();
});

it("isolates concurrent atomic text saves and removes only owned temporary files", async () => {
  const { projects, commands } = await setup();
  const path = join(projects[104].cwd, "same.txt");
  await writeFile(path, "base");
  const now = vi.spyOn(Date, "now").mockReturnValue(42);
  try {
    await Promise.all([
      commands.run("write_text_file", { path, content: "first" }),
      commands.run("write_text_file", { path, content: "second" }),
    ]);
  } finally {
    now.mockRestore();
  }
  expect(["first", "second"]).toContain(await readFile(path, "utf8"));
  expect(await readdir(projects[104].cwd)).toEqual(["same.txt"]);
});

it.skipIf(process.platform === "win32")("preserves executable and private file modes", async () => {
  const { projects, commands } = await setup();
  const path = join(projects[104].cwd, "mode.txt");
  for (const mode of [0o755, 0o600]) {
    await writeFile(path, "before");
    await chmod(path, mode);
    await commands.run("write_text_file", { path, content: "after" });
    expect((await stat(path)).mode & 0o777).toBe(mode);
  }
});

it("preserves locked and unlocked worktree metadata", async () => {
  const { projects, commands } = await setup();
  const cwd = projects[104].cwd;
  vi.mocked(hostWorktrees).mockResolvedValue({
    defaultRoot: cwd,
    worktrees: [
      { path: cwd, locked: true },
      { path: `${cwd}-other`, locked: false },
    ],
  } as never);
  expect(await commands.run("git_worktrees", { cwd })).toMatchObject({
    worktrees: [{ locked: true }, { locked: false }],
  });
});

it("blocks all working-tree stash mutations while project is busy", async () => {
  const { projects } = await setup();
  const cwd = projects[104].cwd;
  const gate = vi.fn(async () => {
    throw new Error("Project is busy");
  });
  const commands = new WorkspaceCommands(
    { projects: () => [{ id: "p", cwd }], attachmentDir: join(cwd, "attachments") } as never,
    gate,
  );
  for (const command of ["git_stash", "git_stash_action", "git_resolve_conflict"]) {
    await expect(commands.run(command, { cwd })).rejects.toThrow("Project is busy");
  }
  expect(gate).toHaveBeenCalledTimes(3);
});

it("resolves worktrees, caches results, invalidates and still rejects outside paths", async () => {
  const { root, projects, commands } = await setup();
  const tree = join(root, "tree");
  await mkdir(tree);
  const path = join(tree, "hello.txt");
  await writeFile(path, "hello");
  vi.mocked(hostWorktrees).mockImplementation(async (cwd) => ({
    defaultRoot: cwd,
    worktrees: cwd === projects[0].cwd ? [{ path: tree, missing: false } as never] : [],
  }));
  await commands.run("read_text_file", { path });
  expect(hostWorktrees).toHaveBeenCalledTimes(105);
  await commands.run("read_text_file", { path });
  expect(hostWorktrees).toHaveBeenCalledTimes(105);
  commands.invalidateRoots();
  await expect(commands.run("read_text_file", { path: join(root, "outside.txt") })).rejects.toThrow(
    "outside",
  );
  expect(hostWorktrees).toHaveBeenCalledTimes(210);
});
