import { afterEach, expect, it } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionTaskLinkError, SessionTaskLinks } from "./session-links";

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});
async function fixture(
  tasks = new Set(["t1", "t2"]),
  sessions = new Set(["s1", "s2", "s3"]),
  beforeTaskCheck: () => Promise<void> = async () => {},
) {
  const dir = await mkdtemp(join(tmpdir(), "links-"));
  dirs.push(dir);
  const make = () =>
    new SessionTaskLinks(dir, {
      taskExists: async (id) => {
        await beforeTaskCheck();
        return tasks.has(id);
      },
      sessionExists: async (id) => sessions.has(id),
      now: () => 7,
    });
  return { dir, make, links: make(), tasks, sessions };
}

it("links many sessions to one task and reads both directions", async () => {
  const { links } = await fixture();
  await links.link("s1", "t1");
  await links.link("s2", "t1");
  expect(await links.taskFor("s1")).toBe("t1");
  expect((await links.sessionsFor("t1")).sort()).toEqual(["s1", "s2"]);
});

it("allows at most one task per session", async () => {
  const { links } = await fixture();
  await links.link("s1", "t1");
  await expect(links.link("s1", "t2")).rejects.toMatchObject({
    code: "already-linked",
  });
  expect(await links.link("s1", "t1")).toMatchObject({ taskId: "t1" });
  expect(await links.taskFor("s1")).toBe("t1");
});

it("refuses unknown tasks and bad ids without writing", async () => {
  const { links } = await fixture();
  await expect(links.link("s1", "nope")).rejects.toBeInstanceOf(SessionTaskLinkError);
  await expect(links.link("", "t1")).rejects.toMatchObject({
    code: "invalid-id",
  });
  expect(await links.taskFor("s1")).toBeUndefined();
});

it("refuses a session the store does not know without writing", async () => {
  const { links } = await fixture();
  await expect(links.link("ghost", "t1")).rejects.toMatchObject({ code: "session-not-found" });
  expect(await links.taskFor("ghost")).toBeUndefined();
  expect(await links.sessionsFor("t1")).toEqual([]);
});

/** Holds the first task check (a blocker link) open so later links queue behind it. */
function blockFirstCheck() {
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let entered!: () => void;
  const reached = new Promise<void>((resolve) => (entered = resolve));
  return {
    release,
    reached,
    beforeTaskCheck: async () => {
      calls += 1;
      if (calls > 1) return;
      entered();
      await gate;
    },
  };
}

it("leaves no orphan when a task is deleted while a link waits for the write queue", async () => {
  const tasks = new Set(["t1", "t2"]);
  const block = blockFirstCheck();
  const { links } = await fixture(tasks, undefined, block.beforeTaskCheck);
  const blocker = links.link("s2", "t2");
  await block.reached;
  const pending = links.link("s1", "t1");
  // The delete lands after the link was submitted but before its write runs.
  tasks.delete("t1");
  block.release();
  await blocker;
  await expect(pending).rejects.toMatchObject({ code: "task-not-found" });
  expect(await links.taskFor("s1")).toBeUndefined();
  expect(await links.sessionsFor("t1")).toEqual([]);
});

it("leaves no orphan when a session is deleted while a link waits for the write queue", async () => {
  const sessions = new Set(["s1", "s2"]);
  const block = blockFirstCheck();
  const { links } = await fixture(undefined, sessions, block.beforeTaskCheck);
  const blocker = links.link("s2", "t2");
  await block.reached;
  const pending = links.link("s1", "t1");
  sessions.delete("s1");
  block.release();
  await blocker;
  await expect(pending).rejects.toMatchObject({ code: "session-not-found" });
  expect(await links.taskFor("s1")).toBeUndefined();
});

it("serialized checks still allow concurrent links for different sessions", async () => {
  const { links } = await fixture();
  await Promise.all([links.link("s1", "t1"), links.link("s2", "t1"), links.link("s3", "t2")]);
  expect((await links.sessionsFor("t1")).sort()).toEqual(["s1", "s2"]);
  expect(await links.taskFor("s3")).toBe("t2");
});

it("keeps a link that was relinked to a live task after the prune scan", async () => {
  const { links } = await fixture();
  await links.link("s1", "t1");
  // The scan sees t1 as deleted; before the write lands another client moves s1 to live t2.
  let scanned!: () => void;
  const scanDone = new Promise<void>((resolve) => (scanned = resolve));
  let proceed!: () => void;
  const gate = new Promise<void>((resolve) => (proceed = resolve));
  let calls = 0;
  const pruned = links.prune(
    () => true,
    async (id) => {
      calls += 1;
      if (calls === 1) {
        scanned();
        await gate;
        return id !== "t1";
      }
      return id !== "t1";
    },
  );
  await scanDone;
  await links.unlink("s1");
  await links.link("s1", "t2");
  proceed();
  expect(await pruned).toBe(0);
  expect(await links.taskFor("s1")).toBe("t2");
});

it("unlinks and allows relinking elsewhere", async () => {
  const { links } = await fixture();
  await links.link("s1", "t1");
  expect(await links.unlink("s1")).toBe(true);
  expect(await links.unlink("s1")).toBe(false);
  await links.link("s1", "t2");
  expect(await links.taskFor("s1")).toBe("t2");
});

it("keeps links after a Host restart", async () => {
  const { links, make } = await fixture();
  await links.link("s1", "t1");
  expect(await make().taskFor("s1")).toBe("t1");
});

it("keeps the first row when a file names two tasks for one session", async () => {
  const { dir, make } = await fixture();
  await mkdir(join(dir, "tasks"), { recursive: true });
  await writeFile(
    join(dir, "tasks", "session-links.json"),
    JSON.stringify([
      { sessionId: "s1", taskId: "t1", linkedAt: 1 },
      { sessionId: "s1", taskId: "t2", linkedAt: 2 },
    ]),
  );
  expect(await make().taskFor("s1")).toBe("t1");
});

it("prunes links of deleted sessions or tasks", async () => {
  const { links } = await fixture();
  await links.link("s1", "t1");
  await links.link("s2", "t2");
  expect(
    await links.prune(
      (id) => id !== "s1",
      () => true,
    ),
  ).toBe(1);
  expect(await links.taskFor("s1")).toBeUndefined();
  expect(await links.taskFor("s2")).toBe("t2");
});
