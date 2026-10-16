import { afterEach, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
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
