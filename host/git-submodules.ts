import { execFileAsync as exec } from "../src/shared/lib/processExecution.node";
import { realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";

const MAX_SUBMODULES = 256;

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await exec("git", ["--no-pager", ...args], {
    cwd,
    windowsHide: true,
    timeout: 15_000,
    maxBuffer: 8 * 1024 * 1024,
    encoding: "utf8",
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" },
  });
  return stdout;
}

/** Initialized gitlinks only. Never clones, checks out, or executes submodule hooks. */
export async function hostGitSubmodules(cwd: string): Promise<string[]> {
  const root = await realpath(cwd);
  const queue = [root];
  const seen = new Set([root]);
  const paths: string[] = [];
  for (let index = 0; index < queue.length; index++) {
    const parent = queue[index];
    const entries = await git(parent, ["ls-files", "--stage", "-z", "--", "."]);
    for (const entry of entries.split("\0")) {
      const tab = entry.indexOf("\t");
      if (tab < 0 || !/^160000 [a-f0-9]+ 0$/.test(entry.slice(0, tab))) continue;
      const path = entry.slice(tab + 1);
      const child = await realpath(join(parent, path)).catch(() => null);
      if (!child || seen.has(child)) continue;
      const rel = relative(root, child);
      if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) continue;
      // Uninitialized submodules otherwise inherit their parent's repository.
      if (!(await stat(join(child, ".git")).catch(() => null))) continue;
      const top = await git(child, ["rev-parse", "--show-toplevel"]);
      if ((await realpath(top.trim())) !== child) continue;
      if (paths.length >= MAX_SUBMODULES) throw new Error("Too many nested submodules");
      seen.add(child);
      paths.push(rel.split(sep).join("/"));
      queue.push(child);
    }
  }
  return paths.sort();
}
