import { execFileAsync as exec } from "../../src/shared/lib/processExecution.node";
import { withHostGitMutation } from "./git-mutations";
import { headBranchFromFiles } from "./git-actions";

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

/** The checkout's watched refs revision (`GitWatches.read`): `etag` moves whenever
 * HEAD, a ref, packed-refs or the config changes. */
export type RefsRevision = (cwd: string) => Promise<{ etag: string; watching: boolean }>;

/** Two processes, run together: every start blocks the Host event loop on Windows. */
async function readBranches(cwd: string): Promise<HostBranches> {
  const [{ stdout: refs }, { stdout: configuredRemotes }, fromFiles] = await Promise.all([
    exec(
      "git",
      ["for-each-ref", "--format=%(refname)%00%(symref)", "refs/heads", "refs/remotes"],
      options(cwd),
    ),
    exec("git", ["remote"], options(cwd)),
    headBranchFromFiles(cwd),
  ]);
  // Files answer a branch, "" (detached) or undefined (reftable or unreadable: ask git).
  const current =
    fromFiles === undefined
      ? await exec("git", ["symbolic-ref", "--quiet", "HEAD"], options(cwd))
          .then(({ stdout }) => stdout.trim().replace(/^refs\/heads\//, "") || null)
          .catch(() => null)
      : fromFiles || null;
  const remotePrefixes = configuredRemotes
    .split("\n")
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  const branches: string[] = [];
  const remotes: HostBranches["remotes"] = [];
  for (const line of refs.split("\n")) {
    const [ref = "", symref] = line.split("\0");
    if (ref.startsWith("refs/heads/")) branches.push(ref.slice("refs/heads/".length));
    else if (ref.startsWith("refs/remotes/") && !symref) {
      const short = ref.slice("refs/remotes/".length);
      const remote = remotePrefixes.find((name) => short.startsWith(`${name}/`));
      if (remote) remotes.push({ remote, name: short.slice(remote.length + 1) });
    }
  }
  return { current, branches, remotes };
}

const listed = new Map<string, { etag: string; value: Promise<HostBranches> }>();
const MAX_LISTED = 64;

/**
 * Like an editor's branch picker: while the checkout's `.git` metadata is watched and
 * unchanged, the last list is reused without running git. Without `revision`, or when
 * the checkout is not watched, it always reads (mutations validate against fresh state).
 */
export async function hostBranches(cwd: string, revision?: RefsRevision): Promise<HostBranches> {
  const watched = revision && (await revision(cwd).catch(() => undefined));
  if (!watched?.watching || !watched.etag) return readBranches(cwd);
  const hit = listed.get(cwd);
  if (hit?.etag === watched.etag) return hit.value;
  const value = readBranches(cwd);
  listed.delete(cwd);
  listed.set(cwd, { etag: watched.etag, value });
  while (listed.size > MAX_LISTED) listed.delete(listed.keys().next().value!);
  value.catch(() => {
    if (listed.get(cwd)?.value === value) listed.delete(cwd);
  });
  return value;
}

export async function switchHostBranch(
  cwd: string,
  branch: unknown,
  remote?: unknown,
): Promise<HostBranches> {
  // The watch reports a settled change up to a second later; show this one at once.
  listed.delete(cwd);
  try {
    return await withHostGitMutation(cwd, () => switchHostBranchSerialized(cwd, branch, remote));
  } finally {
    listed.delete(cwd);
  }
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
  listed.delete(cwd);
  try {
    return await withHostGitMutation(cwd, () => createHostBranchSerialized(cwd, branch));
  } finally {
    listed.delete(cwd);
  }
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
