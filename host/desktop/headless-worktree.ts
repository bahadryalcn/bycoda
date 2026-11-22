import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { userInfo } from "node:os";
import { basename, dirname, isAbsolute, join, posix, relative, sep } from "node:path";
import { hostGitRepositoryKey } from "../git/git-mutations";

const unavailable = () =>
  new Error("Cannot verify exclusive Host ownership of the worktree and repository.");

const within = (path: string, root: string) =>
  path === root || path.startsWith(root === "/" ? root : root + "/");

/** A bind mount is invisible to realpath. Refuse nested mounts, network shares and
 * visible aliases that expose the same backing tree elsewhere in the namespace. */
export function privateWorkspaceMount(root: string, mountinfo: string): boolean {
  const mounts = mountinfo
    .trimEnd()
    .split("\n")
    .map((line) => {
      const [before, after] = line.split(" - ");
      const fields = before?.split(" ");
      const unescape = (path?: string) =>
        path?.replace(/\\([0-7]{3})/g, (_, code: string) =>
          String.fromCharCode(parseInt(code, 8)),
        ) ?? "";
      return {
        device: fields?.[2],
        root: unescape(fields?.[3]),
        path: unescape(fields?.[4]),
        type: after?.split(" ")[0] ?? "",
      };
    });
  if (
    mounts.some(
      (mount) =>
        !mount.device || !mount.root.startsWith("/") || !mount.path.startsWith("/") || !mount.type,
    )
  )
    return false;
  const parent = mounts
    .filter((mount) => within(root, mount.path))
    .sort((a, b) => b.path.length - a.path.length)[0];
  if (!parent || !["ext4", "xfs", "btrfs", "tmpfs", "overlay", "f2fs", "zfs"].includes(parent.type))
    return false;
  const backing = posix.join(parent.root, posix.relative(parent.path, root));
  return !mounts.some(
    (mount) =>
      mount !== parent &&
      (within(mount.path, root) ||
        (mount.device === parent.device &&
          (within(mount.root, backing) || within(backing, mount.root)))),
  );
}

/** A dedicated account may run provider children. A desktop or service running before
 * Host startup, even one in the same systemd unit, is outside that process tree. */
export function ownsServiceProcesses(host: number, parents: ReadonlyMap<number, number>): boolean {
  if (!parents.has(host)) return false;
  const owned = new Set([host]);
  for (const pid of parents.keys()) {
    const chain = new Set<number>();
    let next: number | undefined = pid;
    while (next !== undefined && !owned.has(next)) {
      if (chain.has(next)) return false;
      chain.add(next);
      next = parents.get(next);
    }
    if (next === undefined) return false;
    for (const child of chain) owned.add(child);
  }
  return true;
}

export async function assertServiceOwner(
  uid: number,
  pid = process.pid,
  proc = "/proc",
): Promise<void> {
  // Only a system service, never a user's login session or a desktop-launched Host.
  const cgroup = await readFile(join(proc, "self", "cgroup"), "utf8");
  if (!/^0::\/system\.slice\/[^/\n]+\.service$/m.test(cgroup)) throw unavailable();
  const mounts = await readFile(join(proc, "self", "mounts"), "utf8");
  const procMount = mounts.split("\n").filter((line) => line.split(" ")[1] === "/proc");
  if (
    procMount.length !== 1 ||
    procMount[0]?.split(" ")[2] !== "proc" ||
    /(?:,| )hidepid=(?!0(?:,| )|off(?:,| ))/.test(procMount[0])
  )
    throw unavailable();
  const parents = new Map<number, number>();
  for (const name of await readdir(proc)) {
    if (!/^\d+$/.test(name)) continue;
    let status: string;
    try {
      status = await readFile(join(proc, name, "status"), "utf8");
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException).code === "ENOENT" ||
        (error as NodeJS.ErrnoException).code === "ESRCH"
      )
        continue;
      throw error;
    }
    const ids = /^Uid:\s+([\d\t ]+)$/m.exec(status)?.[1];
    if (!ids) throw unavailable();
    if (
      !ids
        .trim()
        .split(/\s+/)
        .some((id) => Number(id) === uid)
    )
      continue;
    const parent = /^PPid:\s+(\d+)$/m.exec(status)?.[1];
    if (!parent) throw unavailable();
    parents.set(Number(name), Number(parent));
  }
  if (!ownsServiceProcesses(pid, parents)) throw unavailable();
}

export async function assertPrivateCheckout(
  root: string,
  path: string,
  project: string,
  uid: number,
) {
  if (!isAbsolute(root)) throw unavailable();
  const directory = await realpath(root);
  const info = await stat(directory);
  if (directory === "/" || !info.isDirectory() || info.uid !== uid || (info.mode & 0o077) !== 0) {
    throw unavailable();
  }
  if (!privateWorkspaceMount(directory, await readFile("/proc/self/mountinfo", "utf8")))
    throw unavailable();
  const checkout = await realpath(path).catch(async (error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
    // A journal may resume after Git already removed the directory.
    return join(await realpath(dirname(path)), basename(path));
  });
  const paths = [checkout, await realpath(project), await hostGitRepositoryKey(project)];
  if (
    checkout === directory ||
    paths.some((entry) => {
      const child = relative(directory, entry);
      return child === ".." || child.startsWith(".." + sep) || isAbsolute(child);
    })
  )
    throw unavailable();
}

/** A server administrator enrolls one private account and storage root. No client
 * input, heartbeat age or empty desktop database establishes this deployment mode. */
export function dedicatedWorktreeVerifier() {
  const root = process.env.BYCODA_HEADLESS_WORKSPACE_ROOT;
  if (process.platform !== "linux" || !root) return undefined;
  return async (path: string, project: string) => {
    const { uid, shell } = userInfo();
    if (uid <= 0 || !/\/(nologin|false)$/.test(shell ?? "")) throw unavailable();
    await assertPrivateCheckout(root, path, project, uid);
    await assertServiceOwner(uid);
  };
}
