import { afterEach, describe, expect, it, vi } from "vitest";
import { DesktopLive } from "../desktop/desktopLive";
import { GROUP_GRANT_TTL_MS, GROUP_RELAY_TIMEOUT_MS } from "./desktop-group-lock";
import { createGroupLockService } from "./rpc";

afterEach(() => vi.useRealTimers());

const project = (cwd: string, groupId?: string) => ({
  cwd,
  name: cwd.split("/").pop()!,
  ...(groupId ? { groupId } : {}),
});
const snapshot = {
  version: 1 as const,
  groups: [{ id: "open", name: "Open" }],
  projects: [project("/open", "open"), project("/plain")],
  excludedPaths: ["/secret", "/child-secret"],
  excludedGroupIds: ["locked", "child", "hidden"],
  concealed: {
    locked: [
      {
        id: "locked",
        name: "Locked",
        projects: [project("/secret", "locked")],
      },
      {
        id: "child",
        name: "Child",
        parentId: "locked",
        projects: [project("/child-secret", "child")],
      },
    ],
    hidden: [{ id: "hidden", name: "Hidden" }],
  },
};

function liveWithSnapshot(now = () => Date.now()) {
  const live = new DesktopLive(now);
  live.beat({
    clientId: "desktop",
    sessions: [],
    projectDirectory: snapshot,
    groupLock: { version: 1, epoch: "e1", replies: [] },
  });
  return live;
}
const ids = (live: DesktopLive, principal?: string) => {
  const directory = live.projectDirectory([], "host", live.groupLock.access(principal));
  return {
    groups: directory.groups.map((group) => group.id),
    projects: directory.projects.map((entry) => entry.cwd),
    locked: directory.lockedGroups?.map((group) => group.id),
    hidden: directory.hiddenGroups?.map((group) => group.id),
  };
};
const context = (principalId: string) => ({ principalId, authorized: async () => true });

/** Polls like the desktop heartbeat until the Host hands over a job, then answers it. */
async function answer(live: DesktopLive, reply: (job: any) => object) {
  let jobs: { id: string }[] = [];
  await vi.waitFor(() => {
    jobs = live.beat({ clientId: "desktop", sessions: [], groupLock: { version: 1, epoch: "e1" } })
      .groupLock.jobs;
    expect(jobs.length).toBeGreaterThan(0);
  });
  live.beat({
    clientId: "desktop",
    sessions: [],
    groupLock: {
      version: 1,
      epoch: "e1",
      replies: jobs.map((job) => ({ id: job.id, ...reply(job) })),
    },
  });
  return jobs;
}

describe("per-device directory", () => {
  it("shows locked groups by name only and hides hidden groups and nested ones", () => {
    const live = liveWithSnapshot();
    expect(ids(live, "phone")).toEqual({
      groups: ["open"],
      projects: ["/open", "/plain"],
      locked: ["locked"],
      hidden: undefined,
    });
    expect(JSON.stringify(live.projectDirectory([], "host"))).not.toContain("secret");
  });

  it("opens a group and its projects for the device that holds the grant only", () => {
    const live = liveWithSnapshot();
    live.groupLock.grantGroup("phone", "locked");
    expect(ids(live, "phone")).toMatchObject({
      groups: ["open", "locked"],
      projects: ["/open", "/plain", "/secret"],
      locked: ["child"],
    });
    expect(ids(live, "other").projects).not.toContain("/secret");
    live.groupLock.grantGroup("phone", "child");
    expect(ids(live, "phone").projects).toContain("/child-secret");
  });

  it("lists hidden group names only after the hidden-list grant, without their projects", () => {
    const live = liveWithSnapshot();
    live.groupLock.grantHidden("phone");
    expect(ids(live, "phone").hidden).toEqual(["hidden"]);
    expect(ids(live, "phone").groups).not.toContain("hidden");
    expect(ids(live, "other").hidden).toBeUndefined();
  });

  it("ignores concealed data for a group the desktop no longer excludes", () => {
    const live = new DesktopLive();
    live.beat({
      clientId: "desktop",
      sessions: [],
      projectDirectory: { ...snapshot, excludedGroupIds: [] },
    });
    live.groupLock.grantGroup("phone", "locked");
    expect(ids(live, "phone").projects).not.toContain("/secret");
  });
});

describe("grants", () => {
  it("expire after the idle window and announce it", () => {
    vi.useFakeTimers();
    const live = liveWithSnapshot();
    const changed = vi.fn();
    live.groupLock.onChange = changed;
    live.groupLock.grantGroup("phone", "locked");
    expect(live.groupLock.access("phone").groupIds.has("locked")).toBe(true);
    vi.advanceTimersByTime(GROUP_GRANT_TTL_MS + 1_000);
    expect(live.groupLock.access("phone").groupIds.size).toBe(0);
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it("end for every device when the desktop's lock epoch changes", () => {
    const live = liveWithSnapshot();
    live.groupLock.grantGroup("phone", "locked");
    live.groupLock.grantHidden("phone");
    live.beat({ clientId: "desktop", sessions: [], groupLock: { version: 1, epoch: "e1" } });
    expect(live.groupLock.access("phone").groupIds.size).toBe(1);
    live.beat({ clientId: "desktop", sessions: [], groupLock: { version: 1, epoch: "e2" } });
    expect(live.groupLock.access("phone")).toEqual({ groupIds: new Set(), hiddenList: false });
  });

  it("end when a desktop window is seen for the first time (a restart)", () => {
    const live = liveWithSnapshot();
    live.groupLock.grantGroup("phone", "locked");
    live.beat({ clientId: "restarted", sessions: [], groupLock: { version: 1, epoch: "z" } });
    expect(live.groupLock.access("phone").groupIds.size).toBe(0);
  });

  it("lock drops one group or every group of the calling device only", () => {
    const live = liveWithSnapshot();
    live.groupLock.grantGroup("phone", "locked");
    live.groupLock.grantGroup("phone", "child");
    live.groupLock.grantGroup("other", "locked");
    live.groupLock.revoke("phone", "child");
    expect([...live.groupLock.access("phone").groupIds]).toEqual(["locked"]);
    live.groupLock.revoke("phone");
    expect(live.groupLock.access("phone").groupIds.size).toBe(0);
    expect(live.groupLock.access("other").groupIds.size).toBe(1);
  });
});

describe("remote unlock relay", () => {
  it("is unavailable without a live desktop window", async () => {
    const live = new DesktopLive();
    const service = createGroupLockService({ groupLock: () => live.groupLock });
    expect(live.groupLock.ready()).toBe(false);
    await expect(
      service.unlock({ groupId: "locked", password: "pw" }, context("phone")),
    ).rejects.toMatchObject({ code: "GROUP_LOCK_DESKTOP_UNAVAILABLE" });
  });

  it("grants only on an ok verdict and answers wrong and throttled without a grant", async () => {
    const live = liveWithSnapshot();
    const service = createGroupLockService({ groupLock: () => live.groupLock });
    const verdicts: object[] = [
      { result: "wrong", retryAfterMs: 0 },
      { result: "throttled", retryAfterMs: 30_000 },
      { result: "ok" },
    ];
    const results = [];
    for (const verdict of verdicts) {
      const pending = service.unlock({ groupId: "locked", password: "pw" }, context("phone"));
      await answer(live, () => verdict);
      results.push(await pending);
      if (results.length < 3) expect(live.groupLock.access("phone").groupIds.size).toBe(0);
    }
    expect(results).toEqual([
      { result: "wrong" },
      { result: "throttled", retryAfterMs: 30_000 },
      { result: "ok" },
    ]);
    expect(live.groupLock.access("phone").groupIds.has("locked")).toBe(true);
  });

  it("answers an unknown group exactly like a wrong password", async () => {
    const live = liveWithSnapshot();
    const service = createGroupLockService({ groupLock: () => live.groupLock });
    // The desktop says "wrong" for both; the Host adds nothing that tells them apart.
    const answers = [];
    for (const groupId of ["locked", "no-such-group"]) {
      const pending = service.unlock({ groupId, password: "pw" }, context("phone"));
      await answer(live, () => ({ result: "wrong" }));
      answers.push(await pending);
    }
    expect(answers[0]).toEqual(answers[1]);
  });

  it("hands a password to the desktop once and never keeps it", async () => {
    const live = liveWithSnapshot();
    const service = createGroupLockService({ groupLock: () => live.groupLock });
    const pending = service.authorizeHidden({ password: "s3cret" }, context("phone"));
    const jobs = await answer(live, () => ({ result: "ok" }));
    expect(jobs).toMatchObject([{ kind: "authorizeHidden", password: "s3cret" }]);
    // A later heartbeat is not handed the same password again.
    expect(
      live.beat({ clientId: "desktop", sessions: [], groupLock: { version: 1, epoch: "e1" } })
        .groupLock.jobs,
    ).toEqual([]);
    await expect(pending).resolves.toEqual({ result: "ok" });
    expect(live.groupLock.access("phone").hiddenList).toBe(true);
    // The password lived only in the pending job, which is gone once answered.
    expect((live.groupLock as unknown as { pending: Map<string, unknown> }).pending.size).toBe(0);
  });

  it("fails as unavailable when the desktop never answers", async () => {
    vi.useFakeTimers();
    const live = liveWithSnapshot(() => Date.now());
    const service = createGroupLockService({ groupLock: () => live.groupLock });
    const pending = service.unlock({ groupId: "locked", password: "pw" }, context("phone"));
    const expectation = expect(pending).rejects.toMatchObject({
      code: "GROUP_LOCK_DESKTOP_UNAVAILABLE",
    });
    await vi.advanceTimersByTimeAsync(GROUP_RELAY_TIMEOUT_MS + 1);
    await expectation;
    expect(live.groupLock.access("phone").groupIds.size).toBe(0);
  });

  it("lets only a hidden-list grant hide or show groups, and ends an unlock on hide", async () => {
    const live = liveWithSnapshot();
    const service = createGroupLockService({ groupLock: () => live.groupLock });
    await expect(
      service.setHidden({ groupId: "open", hidden: true }, context("phone")),
    ).rejects.toThrow("hidden groups password");
    live.groupLock.grantHidden("phone");
    live.groupLock.grantGroup("phone", "locked");
    const pending = service.setHidden({ groupId: "locked", hidden: true }, context("phone"));
    await answer(live, (job) => {
      expect(job).toMatchObject({ kind: "setHidden", groupId: "locked", hidden: true });
      return { result: "ok" };
    });
    await expect(pending).resolves.toEqual({ updated: true });
    expect(live.groupLock.access("phone").groupIds.has("locked")).toBe(false);
  });

  it("reports a failed hide as an error, not as success", async () => {
    const live = liveWithSnapshot();
    const service = createGroupLockService({ groupLock: () => live.groupLock });
    live.groupLock.grantHidden("phone");
    const pending = service.setHidden({ groupId: "gone", hidden: false }, context("phone"));
    await answer(live, () => ({ error: "failed" }));
    await expect(pending).rejects.toThrow("could not be updated");
  });

  it("rejects malformed parameters before anything is relayed", async () => {
    const live = liveWithSnapshot();
    const service = createGroupLockService({ groupLock: () => live.groupLock });
    await expect(service.unlock({ groupId: "locked" }, context("phone"))).rejects.toThrow();
    await expect(
      service.unlock({ groupId: "locked", password: "pw", extra: 1 }, context("phone")),
    ).rejects.toThrow();
  });
});

describe("parseDesktopProjectDirectory concealed data", () => {
  it("drops malformed concealed data instead of trusting it", async () => {
    const { parseDesktopProjectDirectory } = await import("../desktop/desktopLive");
    expect(parseDesktopProjectDirectory(snapshot)?.concealed?.locked).toHaveLength(2);
    expect(
      parseDesktopProjectDirectory({ ...snapshot, concealed: { locked: [{ id: 1 }], hidden: [] } })
        ?.concealed,
    ).toBeUndefined();
  });
});
