import { execFileAsync as exec } from "../src/shared/lib/processExecution.node";
import { withHostGitMutation } from "./git-mutations";

const options = (cwd: string, mutation = false) => ({
  cwd,
  timeout: mutation ? 120_000 : 10_000,
  windowsHide: true,
  env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" },
  maxBuffer: 1024 * 1024,
});

export type HostBranches = {
  current: string | null;
  branches: string[];
  remotes: { remote: string; name: string }[];
};

export async function hostBranches(cwd: string): Promise<HostBranches> {
  const [{ stdout: names }, { stdout: remoteNames }, { stdout: configuredRemotes }, current] =
    await Promise.all([
      exec("git", ["for-each-ref", "--format=%(refname:strip=2)", "refs/heads"], options(cwd)),
      exec(
        "git",
        ["for-each-ref", "--format=%(refname:strip=2)%00%(symref)", "refs/remotes"],
        options(cwd),
      ),
      exec("git", ["remote"], options(cwd)),
      exec("git", ["symbolic-ref", "--quiet", "HEAD"], options(cwd))
        .then(({ stdout }) => stdout.trim().replace(/^refs\/heads\//, ""))
        .catch(() => null),
    ]);
  const remotePrefixes = configuredRemotes
    .split("\n")
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  const remotes = remoteNames
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      const [ref, symref] = line.split("\0");
      const remote = remotePrefixes.find((name) => ref.startsWith(`${name}/`));
      return remote && !symref ? [{ remote, name: ref.slice(remote.length + 1) }] : [];
    });
  return { current, branches: names.split("\n").filter(Boolean), remotes };
}

export async function switchHostBranch(
  cwd: string,
  branch: unknown,
  remote?: unknown,
): Promise<HostBranches> {
  return withHostGitMutation(cwd, () => switchHostBranchSerialized(cwd, branch, remote));
}

async function switchHostBranchSerialized(
  cwd: string,
  branch: unknown,
  remote?: unknown,
): Promise<HostBranches> {
  if (typeof branch !== "string" || branch.length > 255 || !branch || branch.startsWith("-"))
    throw new Error("Invalid branch");
  const state = await hostBranches(cwd);
  const remoteRef =
    typeof remote === "string" &&
    state.remotes.some((entry) => entry.remote === remote && entry.name === branch)
      ? `refs/remotes/${remote}/${branch}`
      : null;
  if (remote != null && !remoteRef) throw new Error("Choose an available remote branch");
  if (!state.branches.includes(branch) && !remoteRef)
    throw new Error("Choose an existing local branch");
  if (state.current === branch) return state;
  const { stdout: changes } = await exec(
    "git",
    ["status", "--porcelain", "--untracked-files=all"],
    options(cwd),
  );
  if (changes) throw new Error("Commit or stash changes on the host before switching branches");
  if (remoteRef && !state.branches.includes(branch))
    await exec("git", ["switch", "--track", "-c", branch, remoteRef], options(cwd, true));
  else await exec("git", ["switch", branch], options(cwd, true));
  return hostBranches(cwd);
}

export async function createHostBranch(cwd: string, branch: unknown): Promise<HostBranches> {
  return withHostGitMutation(cwd, () => createHostBranchSerialized(cwd, branch));
}

async function createHostBranchSerialized(cwd: string, branch: unknown): Promise<HostBranches> {
  if (
    typeof branch !== "string" ||
    !branch ||
    branch.length > 255 ||
    branch.startsWith("-") ||
    branch.startsWith("@")
  )
    throw new Error("Enter a valid branch name");
  await exec("git", ["check-ref-format", "--branch", branch], options(cwd));
  const state = await hostBranches(cwd);
  if (state.branches.includes(branch)) throw new Error("Branch already exists");
  const { stdout: changes } = await exec(
    "git",
    ["status", "--porcelain", "--untracked-files=all"],
    options(cwd),
  );
  if (changes) throw new Error("Commit or stash changes on the host before switching branches");
  await exec("git", ["switch", "-c", branch], options(cwd, true));
  return hostBranches(cwd);
}
