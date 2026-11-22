import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { DesktopLive } from "./desktopLive";
import {
  assertPrivateCheckout,
  assertServiceOwner,
  ownsServiceProcesses,
  privateWorkspaceMount,
} from "./headless-worktree";

it("rejects mounts and bind aliases exposing private workspaces under another name", () => {
  const root = "/srv/private worktrees";
  const system = "10 1 9:1 / / rw - ext4 /dev/sda1 rw\n";
  const lines = (extra: string) => privateWorkspaceMount(root, system + extra);
  expect(lines("")).toBe(true);
  expect(lines("11 10 9:1 /srv/private\\040worktrees/a /backup rw - ext4 /dev/sda1 rw")).toBe(
    false,
  );
  expect(lines("11 10 9:1 /srv /other rw - ext4 /dev/sda1 rw")).toBe(false);
  expect(lines("11 10 9:2 / /srv/private\\040worktrees/a/mount rw - xfs /dev/sdb rw")).toBe(false);
  expect(lines("11 10 9:1 /other /backup rw - ext4 /dev/sda1 rw")).toBe(true);
  expect(privateWorkspaceMount(root, system.replace("ext4", "nfs4"))).toBe(false);
  expect(lines("not a mountinfo entry")).toBe(false);
});

it.skipIf(process.platform !== "linux")(
  "requires the checkout and common Git directory inside private account storage",
  async () => {
    const base = await mkdtemp(join(tmpdir(), "bycoda-private-checkout-"));
    const root = join(base, "workspaces");
    const project = join(root, "repo");
    const target = join(root, "worktree");
    const external = join(base, "outside");
    try {
      await mkdir(root, { mode: 0o700 });
      await mkdir(project);
      await mkdir(target);
      await mkdir(join(project, ".git"));
      await mkdir(external);
      const verify = (path = target) =>
        assertPrivateCheckout(root, path, project, process.getuid!());
      await verify();
      await verify(join(root, "already-removed"));
      await chmod(root, 0o750);
      await expect(verify()).rejects.toThrow("exclusive Host ownership");
      await chmod(root, 0o700);
      await symlink(external, join(root, "alias"));
      await expect(verify(join(root, "alias"))).rejects.toThrow("exclusive Host ownership");
      await writeFile(join(project, ".git", "commondir"), external);
      await expect(verify()).rejects.toThrow("exclusive Host ownership");
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  },
);

it("revokes headless admission when a desktop arrives during verification or before mutation", async () => {
  const beat = { clientId: "laptop", sessions: [] };
  const early: DesktopLive = new DesktopLive(Date.now, false, async () => {
    early.beat(beat);
  });
  let changed = false;
  const write = async (assertLease: () => void) => {
    assertLease();
    changed = true;
  };
  await expect(early.withRemovalLease("1", "/repo", write, async () => "/project")).rejects.toThrow(
    "native terminal usage",
  );
  const late = new DesktopLive(Date.now, false, async () => {});
  await expect(
    late.withRemovalLease(
      "2",
      "/repo",
      async (assertLease) => {
        late.beat(beat);
        await write(assertLease);
      },
      async () => "/project",
    ),
  ).rejects.toThrow("native terminal usage");
  expect(changed).toBe(false);
});

it("requires every service-account process to descend from the Host", () => {
  const parents = new Map([
    [20, 1],
    [13, 15],
    [15, 20],
  ]);
  expect(ownsServiceProcesses(20, parents)).toBe(true);
  expect(ownsServiceProcesses(21, parents)).toBe(false);
  expect(ownsServiceProcesses(20, new Map([...parents, [80, 1]]))).toBe(false);
  expect(ownsServiceProcesses(20, new Map([...parents, [81, 82], [82, 81]]))).toBe(false);
});

it("rejects an interactive Host, an unrelated effective UID match, and unreadable ownership", async () => {
  const proc = await mkdtemp(join(tmpdir(), "bycoda-proc-"));
  try {
    for (const name of ["self", "1", "20", "21", "60"]) await mkdir(join(proc, name));
    const cgroup = join(proc, "self", "cgroup");
    const mounts = join(proc, "self", "mounts");
    await writeFile(mounts, "proc /proc proc rw,hidepid=2 0 0\n");
    await writeFile(cgroup, "0::/user.slice/user-333.slice/session-1.scope\n");
    const status = (pid: number, ids: string, parent: number) =>
      writeFile(join(proc, String(pid), "status"), `Uid:\t${ids}\nPPid:\t${parent}\n`);
    await status(1, "0 0 0 0", 0);
    await status(20, "333 333 333 333", 1);
    await status(21, "333 333 333 333", 20);
    await status(60, "500 500 500 500", 1);
    await expect(assertServiceOwner(333, 20, proc)).rejects.toThrow("exclusive Host ownership");
    await writeFile(cgroup, "0::/system.slice/bycoda-host.service\n");
    await expect(assertServiceOwner(333, 20, proc)).rejects.toThrow("exclusive Host ownership");
    await writeFile(mounts, "proc /proc proc rw,hidepid=0 0 0\n");
    await assertServiceOwner(333, 20, proc);
    await status(60, "500 333 500 500", 1);
    await expect(assertServiceOwner(333, 20, proc)).rejects.toThrow("exclusive Host ownership");
    await writeFile(join(proc, "60", "status"), "Uid: unknown\n");
    await expect(assertServiceOwner(333, 20, proc)).rejects.toThrow("exclusive Host ownership");
  } finally {
    await rm(proc, { recursive: true, force: true });
  }
});

it("grants the unattended removal path only after the grace period and only on opt-in", async () => {
  let at = 1_000_000;
  const live = new DesktopLive(() => at, false, undefined);
  const lease = (unattended?: boolean, run = async (assert: () => void) => assert()) =>
    live.withRemovalLease("x", "/repo", run, undefined, { unattended });
  await expect(lease()).rejects.toThrow("native terminal usage");
  // Just after a Host start a desktop may still be reconnecting.
  await expect(lease(true)).rejects.toThrow("native terminal usage");
  at += 121_000;
  await expect(lease(true)).resolves.toBeUndefined();
  live.beat({ clientId: "laptop", sessions: [] });
  await expect(lease(true)).rejects.toThrow("native terminal usage");
  at += 60_000;
  await expect(lease(true)).rejects.toThrow("native terminal usage");
  at += 61_000;
  await expect(lease()).rejects.toThrow("native terminal usage");
  await expect(lease(true)).resolves.toBeUndefined();
  await expect(
    lease(true, async (assert) => {
      live.beat({ clientId: "laptop", sessions: [] });
      assert();
    }),
  ).rejects.toThrow("native terminal usage");
});

it("keeps the dedicated verifier path when no desktop is known", async () => {
  const verify = vi.fn(async () => {});
  const live = new DesktopLive(Date.now, false, verify);
  await live.withRemovalLease("1", "/repo", async () => {}, async () => "/project", {
    unattended: false,
  });
  expect(verify).toHaveBeenCalledWith("/repo", "/project");
});

/** Runs one attended removal lease whose desktop answers with `reply`. */
async function attendedLease(
  requireEditorChecks: boolean,
  reply: { granted: boolean; checks?: string[]; reason?: string },
) {
  const live = new DesktopLive(Date.now, false, undefined, requireEditorChecks);
  const beat = { clientId: "desktop", sessions: [] };
  live.beat(beat);
  const removal = live.withRemovalLease("job", "/repo", async (assertLease) => assertLease());
  await vi.waitFor(() => {
    const job = live.removalLeaseBeat(beat).jobs.find((entry) => entry.path);
    expect(job).toBeDefined();
    live.removalLeaseBeat({
      ...beat,
      removalLeaseReplies: [{ id: job!.id, release: false, ...reply }],
    });
  });
  return removal;
}

it("surfaces the editors refusal instead of the generic terminal message", async () => {
  await expect(attendedLease(false, { granted: false, reason: "editors" })).rejects.toThrow(
    "Save or close unsaved files under this worktree",
  );
  await expect(attendedLease(false, { granted: false, reason: "terminals" })).rejects.toThrow(
    "native terminal usage",
  );
});

it("accepts a grant with the editors check and, with the flag off, one without it", async () => {
  await expect(attendedLease(true, { granted: true, checks: ["editors"] })).resolves.toBeUndefined();
  await expect(attendedLease(false, { granted: true, checks: ["editors"] })).resolves.toBeUndefined();
  await expect(attendedLease(false, { granted: true })).resolves.toBeUndefined();
});

it("refuses a grant without the editors check once the flag is on", async () => {
  await expect(attendedLease(true, { granted: true })).rejects.toThrow("Update the desktop app");
  await expect(attendedLease(true, { granted: true, checks: ["other"] })).rejects.toThrow(
    "Update the desktop app",
  );
});
